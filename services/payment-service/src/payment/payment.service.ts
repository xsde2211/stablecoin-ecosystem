import {
  Injectable, NotFoundException,
  BadRequestException, Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService }        from '../prisma/prisma.service';
import { RedisService }         from '../redis/redis.service';
import { CreatePaymentDto }     from './dto/create-payment.dto';
import { MarkPaidDto }          from './dto/mark-paid.dto';
import * as QRCode              from 'qrcode';
import axios                    from 'axios';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  async create(userId: string, dto: CreatePaymentDto) {
    const merchant = await this.prisma.merchant.findFirst({ where:{ userId } });
    if (!merchant) throw new BadRequestException('Not registered as merchant. POST /merchant/register first.');
    if (!merchant.isActive) throw new BadRequestException('Merchant account suspended');

    const expiresAt = new Date(Date.now() + (dto.expiresIn ?? 900) * 1000);
    const payment   = await this.prisma.paymentRequest.create({
      data: {
        merchantId: merchant.id, amount:dto.amount, token:dto.token,
        reference:dto.reference, description:dto.description, webhookUrl:dto.webhookUrl,
        expiresAt, status:'PENDING',
      },
    });

    const qrPayload = JSON.stringify({
      paymentId: payment.id, amount:dto.amount, token:dto.token,
      address:   merchant.settlementAddress, chain:merchant.settlementChain,
      reference: dto.reference, expiresAt:expiresAt.toISOString(),
    });

    const qrDataUrl  = await QRCode.toDataURL(qrPayload, { errorCorrectionLevel:'M', width:300, margin:1 });
    const deepLink   = `stablecoin://pay?id=${payment.id}&amount=${dto.amount}&token=${dto.token}&chain=${merchant.settlementChain}`;

    await this.prisma.qrPayment.create({ data:{ paymentId:payment.id, qrData:qrDataUrl, deepLink } });
    await this.redis.set(`payment:${payment.id}`, JSON.stringify({ status:'PENDING', amount:dto.amount, token:dto.token }), (dto.expiresIn??900)+60);

    this.logger.log(`Payment created: ${payment.id} — ${dto.amount} ${dto.token}`);
    return { ...payment, qrData:qrDataUrl, deepLink, settlementAddress:merchant.settlementAddress, settlementChain:merchant.settlementChain };
  }

  async getById(id: string) {
    const payment = await this.prisma.paymentRequest.findUnique({
      where:   { id },
      include: { qrPayment:true, merchant:{ select:{ settlementAddress:true, settlementChain:true, businessName:true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status === 'PENDING' && new Date() > payment.expiresAt) {
      await this.prisma.paymentRequest.update({ where:{ id }, data:{ status:'EXPIRED' } });
      await this.redis.del(`payment:${id}`);
      return { ...payment, status:'EXPIRED' };
    }
    return payment;
  }

  async markPaid(paymentId: string, dto: MarkPaidDto) {
    const payment = await this.prisma.paymentRequest.findUnique({ where:{ id:paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'PENDING') throw new BadRequestException(`Payment already ${payment.status}`);
    if (new Date() > payment.expiresAt) throw new BadRequestException('Payment expired');

    const updated = await this.prisma.paymentRequest.update({
      where: { id:paymentId },
      data:  { status:'PAID', paidAt:new Date(), txHash:dto.txHash, paidOnChain:dto.chain },
    });
    await this.prisma.qrPayment.updateMany({ where:{ paymentId }, data:{ paidAt:new Date(), txHash:dto.txHash } });
    await this.redis.set(`payment:${paymentId}`, JSON.stringify({ status:'PAID', txHash:dto.txHash }), 3600);

    if (payment.webhookUrl) {
      this.fireWebhook(payment.webhookUrl, updated).catch(e =>
        this.logger.error(`Webhook failed ${paymentId}: ${e.message}`)
      );
    }
    this.logger.log(`Payment ${paymentId} PAID: ${dto.txHash} on ${dto.chain}`);
    return updated;
  }

  async getMerchantPayments(userId: string, page=1, limit=20, status?: string) {
    const merchant = await this.prisma.merchant.findFirst({ where:{ userId } });
    if (!merchant) throw new BadRequestException('Merchant not found');
    const where: any = { merchantId:merchant.id };
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.paymentRequest.findMany({ where, orderBy:{ createdAt:'desc' }, skip:(page-1)*limit, take:limit, include:{ qrPayment:true } }),
      this.prisma.paymentRequest.count({ where }),
    ]);
    return { data, total, page, limit, totalPages:Math.ceil(total/limit) };
  }

  async getMerchantStats(userId: string) {
    const merchant = await this.prisma.merchant.findFirst({ where:{ userId } });
    if (!merchant) throw new BadRequestException('Merchant not found');
    const [total, paid, pending, expired] = await Promise.all([
      this.prisma.paymentRequest.count({ where:{ merchantId:merchant.id } }),
      this.prisma.paymentRequest.count({ where:{ merchantId:merchant.id, status:'PAID' } }),
      this.prisma.paymentRequest.count({ where:{ merchantId:merchant.id, status:'PENDING' } }),
      this.prisma.paymentRequest.count({ where:{ merchantId:merchant.id, status:'EXPIRED' } }),
    ]);
    const thirtyDaysAgo = new Date(Date.now() - 30*24*60*60*1000);
    const revenue = await this.prisma.paymentRequest.findMany({
      where:  { merchantId:merchant.id, status:'PAID', paidAt:{ gte:thirtyDaysAgo } },
      select: { amount:true, token:true },
    });
    const byToken: Record<string,number> = {};
    for (const r of revenue) byToken[r.token] = (byToken[r.token]??0) + parseFloat(r.amount.toString());
    return { merchantId:merchant.id, businessName:merchant.businessName, totalPayments:total, paidPayments:paid, pendingPayments:pending, expiredPayments:expired, conversionRate:total>0?((paid/total)*100).toFixed(1)+'%':'0%', revenueByToken:byToken };
  }

  async cancel(paymentId: string, userId: string) {
    const merchant = await this.prisma.merchant.findFirst({ where:{ userId } });
    const payment  = await this.prisma.paymentRequest.findFirst({ where:{ id:paymentId, merchantId:merchant?.id } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.status !== 'PENDING') throw new BadRequestException(`Cannot cancel — status is ${payment.status}`);
    const updated = await this.prisma.paymentRequest.update({ where:{ id:paymentId }, data:{ status:'CANCELLED' } });
    await this.redis.del(`payment:${paymentId}`);
    return updated;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async expireStale() {
    const result = await this.prisma.paymentRequest.updateMany({
      where: { status:'PENDING', expiresAt:{ lt:new Date() } },
      data:  { status:'EXPIRED' },
    });
    if (result.count > 0) this.logger.log(`Auto-expired ${result.count} payments`);
  }

  private async fireWebhook(url: string, payment: any) {
    await axios.post(url, { event:'payment.paid', paymentId:payment.id, amount:payment.amount, token:payment.token, txHash:payment.txHash, paidAt:payment.paidAt }, { timeout:5000 });
  }
}
