import {
  Injectable, Logger, NotFoundException,
  BadRequestException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService }  from '../redis/redis.service';
import { SubmitKycDto }  from './dto/submit-kyc.dto';
import { RejectKycDto }  from './dto/reject-kyc.dto';
import axios             from 'axios';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  async submit(userId: string, dto: SubmitKycDto) {
    const existing = await this.prisma.kycApplication.findFirst({ where:{ userId }, orderBy:{ createdAt:'desc' } });
    if (existing?.status === 'APPROVED')  throw new ConflictException('KYC already approved');
    if (existing?.status === 'SUBMITTED') throw new ConflictException('KYC already under review');

    const application = await this.prisma.kycApplication.create({
      data: {
        userId, provider:dto.provider, documentType:dto.documentType,
        documentRef:dto.documentRef, fullName:dto.fullName,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        address:dto.address, status:'SUBMITTED',
      },
    });
    await this.prisma.user.update({ where:{ id:userId }, data:{ kycStatus:'SUBMITTED' } });
    this.logger.log(`KYC submitted: ${application.id} for user ${userId}`);

    if (dto.provider === 'manual' || dto.documentRef.startsWith('DEMO-')) {
      setTimeout(() => this.autoApprove(application.id, userId), 3000);
      return { ...application, message:'Demo mode — auto-approving in 3 seconds.' };
    }
    if (dto.provider === 'hyperverge') {
      this.callHyperverge(application.id, userId, dto).catch(e =>
        this.logger.error(`Hyperverge failed: ${e.message}`)
      );
    }
    return { ...application, message:'KYC submitted for review.' };
  }

  async getStatus(userId: string) {
    const app  = await this.prisma.kycApplication.findFirst({
      where:   { userId }, orderBy:{ createdAt:'desc' },
      select:  { id:true, status:true, documentType:true, provider:true, createdAt:true, reviewedAt:true, rejectedReason:true },
    });
    const user = await this.prisma.user.findUnique({ where:{ id:userId }, select:{ kycStatus:true } });
    return { userId, kycStatus:user?.kycStatus ?? 'NOT_SUBMITTED', application:app ?? null };
  }

  async getAllApplications(page=1, limit=20, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.kycApplication.findMany({
        where, orderBy:{ createdAt:'desc' }, skip:(page-1)*limit, take:limit,
        include:{ user:{ select:{ email:true, phone:true, createdAt:true } } },
      }),
      this.prisma.kycApplication.count({ where }),
    ]);
    return { data, total, page, limit, totalPages:Math.ceil(total/limit) };
  }

  async approve(applicationId: string, reviewedBy: string) {
    const app = await this.prisma.kycApplication.findUnique({ where:{ id:applicationId } });
    if (!app)                     throw new NotFoundException('Application not found');
    if (app.status === 'APPROVED') throw new BadRequestException('Already approved');

    const [updated] = await this.prisma.$transaction([
      this.prisma.kycApplication.update({
        where:{ id:applicationId },
        data: { status:'APPROVED', reviewedAt:new Date(), reviewedBy },
      }),
      this.prisma.user.update({ where:{ id:app.userId }, data:{ kycStatus:'APPROVED' } }),
      this.prisma.auditLog.create({
        data: { userId:reviewedBy, action:'KYC_APPROVE', entityType:'KycApplication',
                entityId:applicationId, payload:{ applicationId, approvedUserId:app.userId } },
      }),
    ]);

    await this.redis.publish('kyc:approved', JSON.stringify({ userId:app.userId, applicationId, approvedBy:reviewedBy }));
    this.logger.log(`KYC approved: ${applicationId}`);
    return updated;
  }

  async reject(applicationId: string, dto: RejectKycDto, reviewedBy: string) {
    const app = await this.prisma.kycApplication.findUnique({ where:{ id:applicationId } });
    if (!app)                     throw new NotFoundException('Application not found');
    if (app.status === 'APPROVED') throw new BadRequestException('Cannot reject an approved application');

    const [updated] = await this.prisma.$transaction([
      this.prisma.kycApplication.update({
        where:{ id:applicationId },
        data: { status:'REJECTED', rejectedReason:dto.reason, reviewedAt:new Date(), reviewedBy },
      }),
      this.prisma.user.update({ where:{ id:app.userId }, data:{ kycStatus:'REJECTED' } }),
      this.prisma.auditLog.create({
        data: { userId:reviewedBy, action:'KYC_REJECT', entityType:'KycApplication',
                entityId:applicationId, payload:{ applicationId, reason:dto.reason } },
      }),
    ]);

    await this.redis.publish('kyc:rejected', JSON.stringify({ userId:app.userId, applicationId, reason:dto.reason }));
    this.logger.log(`KYC rejected: ${applicationId} — ${dto.reason}`);
    return updated;
  }

  async getApplication(applicationId: string) {
    const app = await this.prisma.kycApplication.findUnique({
      where:   { id:applicationId },
      include: { user:{ select:{ email:true, phone:true } } },
    });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  async getStats() {
    const [total, submitted, approved, rejected] = await Promise.all([
      this.prisma.kycApplication.count(),
      this.prisma.kycApplication.count({ where:{ status:'SUBMITTED' } }),
      this.prisma.kycApplication.count({ where:{ status:'APPROVED' } }),
      this.prisma.kycApplication.count({ where:{ status:'REJECTED' } }),
    ]);
    return {
      total, submitted, approved, rejected, pendingReview:submitted,
      approvalRate: total > 0 ? ((approved/total)*100).toFixed(1)+'%' : '0%',
    };
  }

  private async autoApprove(applicationId: string, userId: string) {
    try {
      await this.prisma.$transaction([
        this.prisma.kycApplication.update({
          where:{ id:applicationId },
          data: { status:'APPROVED', reviewedAt:new Date(), reviewedBy:'system-auto' },
        }),
        this.prisma.user.update({ where:{ id:userId }, data:{ kycStatus:'APPROVED' } }),
      ]);
      await this.redis.publish('kyc:approved', JSON.stringify({ userId, applicationId, approvedBy:'system-auto' }));
      this.logger.log(`KYC auto-approved: ${applicationId}`);
    } catch (err: any) {
      this.logger.error(`Auto-approve failed: ${err.message}`);
    }
  }

  private async callHyperverge(applicationId: string, userId: string, dto: SubmitKycDto) {
    const apiKey = process.env.HYPERVERGE_API_KEY;
    if (!apiKey) { await this.autoApprove(applicationId, userId); return; }
    try {
      const res = await axios.post(
        'https://ind.hyperverge.co/v1/verify',
        { transactionId:applicationId, document:dto.documentType, documentId:dto.documentRef, fullName:dto.fullName },
        { headers:{ appId:apiKey, appKey:apiKey, 'Content-Type':'application/json' }, timeout:30000 },
      );
      if (res.data?.result?.action === 'accept') {
        await this.approve(applicationId, 'hyperverge-auto');
      } else {
        await this.reject(applicationId, { reason:res.data?.result?.reason ?? 'Verification failed' }, 'hyperverge-auto');
      }
    } catch (err: any) {
      this.logger.error(`Hyperverge error: ${err.message}`);
      await this.prisma.kycApplication.update({ where:{ id:applicationId }, data:{ status:'SUBMITTED' } });
    }
  }
}
