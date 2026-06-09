import {
  Injectable, Logger, BadRequestException,
  NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { KycProviderService } from './kyc.provider.service';
import { SubmitKycDto, KycWebhookDto, KycListQueryDto } from './dto/kyc.dto';

const RATE_LIMIT_WINDOW = 3600;  // 1 hour
const MAX_SUBMISSIONS   = 3;      // max re-submissions per hour

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private prisma:    PrismaService,
    private redis:     RedisService,
    private providers: KycProviderService,
  ) {}

  // ─── Submit KYC ───────────────────────────────────────────────

  async submit(userId: string, dto: SubmitKycDto) {
    // Rate limit: max 3 submissions per hour per user
    const rateKey = `kyc:rate:${userId}`;
    const count   = await this.redis.incr(rateKey);
    if (count === 1) await this.redis.expire(rateKey, RATE_LIMIT_WINDOW);
    if (count > MAX_SUBMISSIONS) {
      throw new BadRequestException('Too many KYC submissions. Please wait before trying again.');
    }

    // Block if already approved
    const existing = await this.prisma.kycApplication.findFirst({
      where: { userId, status: 'APPROVED' },
    });
    if (existing) throw new ConflictException('KYC already approved');

    // Block if pending/submitted recently (within 24h)
    const pending = await this.prisma.kycApplication.findFirst({
      where: {
        userId,
        status: { in: ['SUBMITTED'] },
        createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
      },
    });
    if (pending) throw new ConflictException('KYC submission already under review. Please wait for the result.');

    const application = await this.prisma.kycApplication.create({
      data: {
        userId,
        provider:     dto.provider,
        status:       'SUBMITTED',
        documentType: dto.documentType,
        documentRef:  dto.documentRef,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action:     'KYC_SUBMITTED',
        entityType: 'KycApplication',
        entityId:   application.id,
        payload:    { provider: dto.provider, documentType: dto.documentType },
      },
    });

    this.logger.log(`KYC submitted: ${application.id} user=${userId} provider=${dto.provider}`);

    // Async: call provider and process result
    this.processProviderVerification(application.id, userId, dto.provider, dto.documentRef)
      .catch(e => this.logger.error(`Provider verification failed for ${application.id}:`, e.message));

    return {
      applicationId: application.id,
      status:        'SUBMITTED',
      message:       'KYC submitted. Verification usually takes 1–5 minutes.',
    };
  }

  // ─── Process provider result (async, called after submit) ─────

  private async processProviderVerification(
    applicationId: string,
    userId:        string,
    provider:      string,
    documentRef:   string,
  ) {
    try {
      const result = await this.providers.verify(provider, documentRef);

      if (result.status === 'approved') {
        await this.approveInternal(applicationId, userId, 'auto-provider');
      } else if (result.status === 'rejected') {
        await this.rejectInternal(applicationId, userId, result.reason ?? 'Provider rejected document', 'auto-provider');
      } else {
        // needs_review — flag for manual admin review
        await this.prisma.kycApplication.update({
          where: { id: applicationId },
          data:  { status: 'SUBMITTED' }, // stays SUBMITTED awaiting admin
        });
        this.logger.warn(`KYC needs manual review: ${applicationId} reason=${result.reason}`);
      }
    } catch (err: any) {
      this.logger.error(`processProviderVerification error for ${applicationId}:`, err.message);
      // Leave as SUBMITTED for manual review
    }
  }

  // ─── Webhook from provider ────────────────────────────────────

  /**
   * Called by provider's webhook when async verification completes.
   * Validate webhook signature in production (HMAC-SHA256 header).
   */
  async handleWebhook(dto: KycWebhookDto) {
    const application = await this.prisma.kycApplication.findFirst({
      where: { documentRef: dto.referenceId },
      orderBy: { createdAt: 'desc' },
    });

    if (!application) {
      this.logger.warn(`Webhook received for unknown referenceId: ${dto.referenceId}`);
      return { ok: true };
    }

    if (dto.status === 'approved') {
      await this.approveInternal(application.id, application.userId, 'webhook');
    } else if (dto.status === 'rejected') {
      await this.rejectInternal(application.id, application.userId, dto.rejectionReason ?? 'Provider rejected', 'webhook');
    } else {
      this.logger.log(`KYC webhook needs_review: ${application.id}`);
    }

    return { ok: true, applicationId: application.id };
  }

  // ─── Admin approve/reject ─────────────────────────────────────

  async approve(applicationId: string, reviewedBy: string) {
    const app = await this.prisma.kycApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('KYC application not found');
    if (app.status === 'APPROVED') throw new ConflictException('Already approved');

    return this.approveInternal(applicationId, app.userId, reviewedBy);
  }

  async reject(applicationId: string, reason: string, reviewedBy: string) {
    const app = await this.prisma.kycApplication.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('KYC application not found');
    if (app.status === 'REJECTED') throw new ConflictException('Already rejected');

    return this.rejectInternal(applicationId, app.userId, reason, reviewedBy);
  }

  private async approveInternal(applicationId: string, userId: string, approvedBy: string) {
    const [app] = await Promise.all([
      this.prisma.kycApplication.update({
        where: { id: applicationId },
        data:  { status: 'APPROVED', verifiedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data:  { kycStatus: 'APPROVED', riskScore: 0 },
      }),
      this.prisma.auditLog.create({
        data: {
          userId:     approvedBy,
          action:     'KYC_APPROVED',
          entityType: 'KycApplication',
          entityId:   applicationId,
          payload:    { approvedBy, autoApproved: approvedBy.includes('auto') || approvedBy === 'webhook' },
        },
      }),
    ]);

    // Invalidate KYC status cache
    await this.redis.del(`kyc:status:${userId}`);

    this.logger.log(`KYC approved: ${applicationId} user=${userId} by=${approvedBy}`);
    return app;
  }

  private async rejectInternal(applicationId: string, userId: string, reason: string, rejectedBy: string) {
    const [app] = await Promise.all([
      this.prisma.kycApplication.update({
        where: { id: applicationId },
        data:  { status: 'REJECTED', rejectedReason: reason },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data:  { kycStatus: 'REJECTED' },
      }),
      this.prisma.auditLog.create({
        data: {
          userId:     rejectedBy,
          action:     'KYC_REJECTED',
          entityType: 'KycApplication',
          entityId:   applicationId,
          payload:    { reason, rejectedBy },
        },
      }),
    ]);

    await this.redis.del(`kyc:status:${userId}`);

    this.logger.log(`KYC rejected: ${applicationId} user=${userId} reason=${reason}`);
    return app;
  }

  // ─── Re-submit after rejection ────────────────────────────────

  async resubmit(userId: string, dto: SubmitKycDto) {
    const latest = await this.prisma.kycApplication.findFirst({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (latest?.status === 'APPROVED') throw new ConflictException('Already approved');
    if (latest?.status === 'SUBMITTED') throw new ConflictException('Already under review');

    // Allow re-submission only for REJECTED or PENDING
    return this.submit(userId, dto);
  }

  // ─── Status queries ───────────────────────────────────────────

  async getStatus(userId: string) {
    const cacheKey = `kyc:status:${userId}`;
    const cached   = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const application = await this.prisma.kycApplication.findFirst({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
    });

    const user = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { kycStatus: true, riskScore: true },
    });

    const result = {
      kycStatus:     user?.kycStatus ?? 'PENDING',
      riskScore:     user?.riskScore ?? 0,
      latestApplication: application
        ? {
            id:           application.id,
            status:       application.status,
            provider:     application.provider,
            documentType: application.documentType,
            createdAt:    application.createdAt,
            verifiedAt:   application.verifiedAt,
            rejectedReason: application.rejectedReason,
          }
        : null,
      canTransact: user?.kycStatus === 'APPROVED',
    };

    // Cache for 5 minutes (invalidated on approve/reject)
    await this.redis.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }

  async getApplicationById(applicationId: string) {
    const app = await this.prisma.kycApplication.findUnique({
      where: { id: applicationId },
    });
    if (!app) throw new NotFoundException('KYC application not found');
    return app;
  }

  async getAll(query: KycListQueryDto) {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 50;
    const skip  = (page - 1) * limit;

    const where: any = {};
    if (query.status)   where.status   = query.status;
    if (query.provider) where.provider = query.provider;

    const [data, total] = await Promise.all([
      this.prisma.kycApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take:    limit,
        include: {
          user: { select: { email: true, phone: true, role: true } },
        },
      }),
      this.prisma.kycApplication.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getStats() {
    const [pending, submitted, approved, rejected, total] = await Promise.all([
      this.prisma.kycApplication.count({ where: { status: 'PENDING' } }),
      this.prisma.kycApplication.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.kycApplication.count({ where: { status: 'APPROVED' } }),
      this.prisma.kycApplication.count({ where: { status: 'REJECTED' } }),
      this.prisma.kycApplication.count(),
    ]);

    const approvalRate = total > 0 ? ((approved / total) * 100).toFixed(1) : '0';

    return { total, pending, submitted, approved, rejected, approvalRatePercent: approvalRate };
  }
}
