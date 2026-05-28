import { Injectable, NotFoundException, BadRequestException, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePaymentDto } from "./dto/create-payment.dto";
import { MarkPaidDto } from "./dto/mark-paid.dto";
import * as QRCode from "qrcode";

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  constructor(private prisma: PrismaService) {}

  async create(merchantId: string, dto: CreatePaymentDto) {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId } });
    if (!merchant) throw new NotFoundException("Merchant not found");

    const expiresAt = new Date(Date.now() + (dto.expiresIn ?? 900) * 1000);

    const payment = await this.prisma.paymentRequest.create({
      data: { merchantId, amount: dto.amount, token: dto.token, reference: dto.reference, expiresAt, status: "PENDING" },
    });

    const qrPayload = JSON.stringify({
      paymentId: payment.id,
      amount:    dto.amount,
      token:     dto.token,
      address:   merchant.settlementAddress,
      chain:     merchant.settlementChain,
      expiresAt: expiresAt.toISOString(),
    });

    const qrDataUrl = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel: "M", width: 300 });
    const deepLink  = `stablecoin://pay?id=${payment.id}&amount=${dto.amount}&token=${dto.token}`;

    await this.prisma.qrPayment.create({
      data: { paymentId: payment.id, qrData: qrDataUrl, deepLink },
    });

    this.logger.log(`Payment created: ${payment.id} for merchant ${merchantId}`);
    return { ...payment, qrData: qrDataUrl, deepLink };
  }

  async getById(id: string) {
    const payment = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { qrPayment: true },
    });
    if (!payment) throw new NotFoundException("Payment not found");

    const isExpired = new Date() > payment.expiresAt && payment.status === "PENDING";
    if (isExpired) {
      await this.prisma.paymentRequest.update({ where: { id }, data: { status: "EXPIRED" } });
      return { ...payment, status: "EXPIRED" };
    }
    return payment;
  }

  async markPaid(paymentId: string, dto: MarkPaidDto) {
    const payment = await this.prisma.paymentRequest.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException("Payment not found");
    if (payment.status !== "PENDING") throw new BadRequestException(`Payment is already ${payment.status}`);
    if (new Date() > payment.expiresAt) throw new BadRequestException("Payment has expired");

    const updated = await this.prisma.paymentRequest.update({
      where: { id: paymentId },
      data: { status: "PAID", paidAt: new Date(), txHash: dto.txHash },
    });

    await this.prisma.qrPayment.update({
      where: { paymentId },
      data: { paidAt: new Date(), txHash: dto.txHash },
    });

    this.logger.log(`Payment ${paymentId} marked PAID: ${dto.txHash}`);
    return updated;
  }

  async getMerchantPayments(merchantId: string, page = 1, limit = 20, status?: string) {
    const where: any = { merchantId };
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.paymentRequest.findMany({
        where, orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit, take: limit,
        include: { qrPayment: true },
      }),
      this.prisma.paymentRequest.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStalePayments() {
    const result = await this.prisma.paymentRequest.updateMany({
      where: { status: "PENDING", expiresAt: { lt: new Date() } },
      data:  { status: "EXPIRED" },
    });
    if (result.count > 0) this.logger.log(`Expired ${result.count} stale payments`);
  }
}
