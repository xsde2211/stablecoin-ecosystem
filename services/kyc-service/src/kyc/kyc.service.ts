import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SubmitKycDto } from "./dto/submit-kyc.dto";
import axios from "axios";

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);
  constructor(private prisma: PrismaService) {}

  async submit(userId: string, dto: SubmitKycDto) {
    const existing = await this.prisma.kycApplication.findFirst({
      where: { userId, status: { in: ["SUBMITTED", "APPROVED"] } },
    });
    if (existing) throw new BadRequestException("KYC already submitted or approved");

    const application = await this.prisma.kycApplication.create({
      data: { userId, provider: dto.provider, status: "SUBMITTED", documentType: dto.documentType, documentRef: dto.documentRef },
    });

    // In production: call actual KYC provider API
    // this.callKycProvider(dto.provider, application.id, dto);
    // For now simulate
    this.simulateVerification(application.id, userId);

    this.logger.log(`KYC submitted: ${application.id} for user ${userId}`);
    return application;
  }

  async getStatus(userId: string) {
    const application = await this.prisma.kycApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    if (!application) return { status: "NOT_SUBMITTED", message: "No KYC submitted yet" };
    return application;
  }

  async getAll(page = 1, limit = 50, status?: string) {
    const where: any = {};
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.kycApplication.findMany({
        where, orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit, take: limit,
      }),
      this.prisma.kycApplication.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async approve(applicationId: string, reviewedBy: string) {
    const app = await this.prisma.kycApplication.update({
      where: { id: applicationId },
      data:  { status: "APPROVED", verifiedAt: new Date() },
    });
    await this.prisma.user.update({ where: { id: app.userId }, data: { kycStatus: "APPROVED" } });
    await this.prisma.auditLog.create({
      data: { userId: reviewedBy, action: "KYC_APPROVE", entityType: "KycApplication", entityId: applicationId, payload: {} },
    });
    this.logger.log(`KYC approved: ${applicationId} by ${reviewedBy}`);
    return app;
  }

  async reject(applicationId: string, reason: string, reviewedBy: string) {
    const app = await this.prisma.kycApplication.update({
      where: { id: applicationId },
      data:  { status: "REJECTED", rejectedReason: reason },
    });
    await this.prisma.user.update({ where: { id: app.userId }, data: { kycStatus: "REJECTED" } });
    await this.prisma.auditLog.create({
      data: { userId: reviewedBy, action: "KYC_REJECT", entityType: "KycApplication", entityId: applicationId, payload: { reason } },
    });
    return app;
  }

  // Simulate provider callback — replace with real webhook handler in production
  private simulateVerification(appId: string, userId: string) {
    setTimeout(async () => {
      try {
        await this.approve(appId, "system-auto");
        this.logger.log(`KYC auto-approved (simulation): ${appId}`);
      } catch (e) {
        this.logger.error(`Auto-approve failed for ${appId}:`, e);
      }
    }, 5000);
  }
}
