import { Injectable, NotFoundException, ConflictException, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterMerchantDto } from "./dto/register-merchant.dto";
import { UpdateMerchantDto } from "./dto/update-merchant.dto";
import * as crypto from "crypto";

@Injectable()
export class MerchantService {
  private readonly logger = new Logger(MerchantService.name);
  constructor(private prisma: PrismaService) {}

  async register(userId: string, dto: RegisterMerchantDto) {
    const existing = await this.prisma.merchant.findUnique({ where: { userId } });
    if (existing) throw new ConflictException("Merchant already registered for this account");

    const merchant = await this.prisma.merchant.create({
      data: {
        userId,
        name:              dto.name,
        apiKey:            crypto.randomUUID(),
        settlementAddress: dto.settlementAddress,
        settlementChain:   dto.settlementChain,
        webhookUrl:        dto.webhookUrl,
        isActive:          true,
      },
    });

    this.logger.log(`Merchant registered: ${merchant.id} for user ${userId}`);
    return merchant;
  }

  async getProfile(userId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { userId } });
    if (!merchant) throw new NotFoundException("Merchant profile not found");
    return merchant;
  }

  async update(userId: string, dto: UpdateMerchantDto) {
    const merchant = await this.prisma.merchant.findUnique({ where: { userId } });
    if (!merchant) throw new NotFoundException("Merchant not found");
    return this.prisma.merchant.update({ where: { userId }, data: dto });
  }

  async rotateApiKey(userId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { userId } });
    if (!merchant) throw new NotFoundException("Merchant not found");

    const updated = await this.prisma.merchant.update({
      where: { userId },
      data:  { apiKey: crypto.randomUUID() },
    });

    this.logger.log(`API key rotated for merchant ${merchant.id}`);
    return { apiKey: updated.apiKey, message: "API key rotated successfully" };
  }

  async validateApiKey(apiKey: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { apiKey } });
    if (!merchant || !merchant.isActive) return null;
    return merchant;
  }

  async getStats(userId: string) {
    const merchant = await this.prisma.merchant.findUnique({ where: { userId } });
    if (!merchant) throw new NotFoundException("Merchant not found");

    const [total, paid, pending, expired] = await Promise.all([
      this.prisma.paymentRequest.count({ where: { merchantId: merchant.id } }),
      this.prisma.paymentRequest.count({ where: { merchantId: merchant.id, status: "PAID" } }),
      this.prisma.paymentRequest.count({ where: { merchantId: merchant.id, status: "PENDING" } }),
      this.prisma.paymentRequest.count({ where: { merchantId: merchant.id, status: "EXPIRED" } }),
    ]);

    const revenue = await this.prisma.paymentRequest.aggregate({
      where: { merchantId: merchant.id, status: "PAID" },
      _sum:  { amount: true },
    });

    return {
      merchantId: merchant.id,
      totalPayments: total,
      paidPayments:    paid,
      pendingPayments: pending,
      expiredPayments: expired,
      totalRevenue:    revenue._sum.amount?.toString() ?? "0",
    };
  }
}
