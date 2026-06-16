import {
  Injectable, Logger, NotFoundException,
  ConflictException, BadRequestException,
} from '@nestjs/common';
import { PrismaService }         from '../prisma/prisma.service';
import { RedisService }          from '../redis/redis.service';
import { RegisterMerchantDto }   from './dto/register-merchant.dto';
import { UpdateMerchantDto }     from './dto/update-merchant.dto';
import * as crypto from 'crypto';

@Injectable()
export class MerchantService {
  private readonly logger = new Logger(MerchantService.name);
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  // ─── Register as merchant ───────────────────────────────────────────────────

  async register(userId: string, dto: RegisterMerchantDto) {
    const existing = await this.prisma.merchant.findFirst({ where:{ userId } });
    if (existing) throw new ConflictException('You are already registered as a merchant');

    const apiKey    = `pk_${crypto.randomBytes(16).toString('hex')}`;
    const apiSecret = crypto.randomBytes(32).toString('hex');
    const hashedSecret = crypto.createHash('sha256').update(apiSecret).digest('hex');

    const merchant = await this.prisma.merchant.create({
      data: {
        userId,
        businessName:      dto.businessName,
        businessEmail:     dto.businessEmail,
        gstin:             dto.gstin,
        settlementChain:   dto.settlementChain,
        settlementAddress: dto.settlementAddress,
        apiKey,
        apiSecretHash:     hashedSecret,
        isActive:          true,
      },
    });

    await this.prisma.auditLog.create({
      data: { userId, action:'MERCHANT_REGISTER', entityType:'Merchant', entityId:merchant.id,
              payload:{ businessName:dto.businessName, settlementChain:dto.settlementChain } },
    });

    this.logger.log(`Merchant registered: ${merchant.id} — ${dto.businessName}`);

    // Return apiSecret ONCE — never stored in plaintext
    return {
      ...merchant,
      apiSecret,
      message: 'Save your API secret now — it will not be shown again.',
    };
  }

  // ─── Get profile ─────────────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const merchant = await this.prisma.merchant.findFirst({ where:{ userId } });
    if (!merchant) throw new NotFoundException('Merchant profile not found. Register first.');

    const { apiSecretHash, ...safe } = merchant;
    return safe;
  }

  // ─── Update profile ──────────────────────────────────────────────────────────

  async updateProfile(userId: string, dto: UpdateMerchantDto) {
    const merchant = await this.prisma.merchant.findFirst({ where:{ userId } });
    if (!merchant) throw new NotFoundException('Merchant profile not found');

    const updated = await this.prisma.merchant.update({
      where: { id:merchant.id },
      data:  {
        businessName:      dto.businessName      ?? merchant.businessName,
        businessEmail:     dto.businessEmail     ?? merchant.businessEmail,
        gstin:             dto.gstin             ?? merchant.gstin,
        settlementChain:   dto.settlementChain   ?? merchant.settlementChain,
        settlementAddress: dto.settlementAddress ?? merchant.settlementAddress,
      },
    });

    await this.prisma.auditLog.create({
          data: { userId, action:'MERCHANT_UPDATE', entityType:'Merchant', entityId:merchant.id,
          payload: JSON.parse(JSON.stringify(dto)) },
    });

    const { apiSecretHash, ...safe } = updated;
    return safe;
  }

  // ─── Rotate API key/secret ────────────────────────────────────────────────────

  async rotateKey(userId: string) {
    const merchant = await this.prisma.merchant.findFirst({ where:{ userId } });
    if (!merchant) throw new NotFoundException('Merchant profile not found');

    const apiKey       = `pk_${crypto.randomBytes(16).toString('hex')}`;
    const apiSecret    = crypto.randomBytes(32).toString('hex');
    const hashedSecret = crypto.createHash('sha256').update(apiSecret).digest('hex');

    await this.prisma.merchant.update({
      where: { id:merchant.id },
      data:  { apiKey, apiSecretHash:hashedSecret },
    });

    await this.prisma.auditLog.create({
      data: { userId, action:'MERCHANT_ROTATE_KEY', entityType:'Merchant', entityId:merchant.id, payload:{} },
    });

    this.logger.log(`API key rotated for merchant ${merchant.id}`);
    return { apiKey, apiSecret, message:'New API key generated. Old key is now invalid.' };
  }

  // ─── Get stats ──────────────────────────────────────────────────────────────────

  async getStats(userId: string) {
    const merchant = await this.prisma.merchant.findFirst({ where:{ userId } });
    if (!merchant) throw new NotFoundException('Merchant profile not found');

    const [totalPayments, paidPayments, totalRevenue] = await Promise.all([
      this.prisma.paymentRequest.count({ where:{ merchantId:merchant.id } }),
      this.prisma.paymentRequest.count({ where:{ merchantId:merchant.id, status:'PAID' } }),
      this.prisma.paymentRequest.findMany({
        where:  { merchantId:merchant.id, status:'PAID' },
        select: { amount:true, token:true },
      }),
    ]);

    const revenueByToken: Record<string,number> = {};
    for (const r of totalRevenue) {
      revenueByToken[r.token] = (revenueByToken[r.token] ?? 0) + parseFloat(r.amount.toString());
    }

    return {
      merchantId: merchant.id,
      businessName: merchant.businessName,
      isActive: merchant.isActive,
      totalPayments,
      paidPayments,
      conversionRate: totalPayments > 0 ? ((paidPayments/totalPayments)*100).toFixed(1)+'%' : '0%',
      revenueByToken,
      settlementChain: merchant.settlementChain,
      settlementAddress: merchant.settlementAddress,
      memberSince: merchant.createdAt,
    };
  }

  // ─── Verify API key (used by gateway for merchant API auth) ────────────────────

  async verifyApiKey(apiKey: string, apiSecret: string) {
    const merchant = await this.prisma.merchant.findUnique({ where:{ apiKey } });
    if (!merchant || !merchant.isActive) throw new BadRequestException('Invalid API key');

    const hashedSecret = crypto.createHash('sha256').update(apiSecret).digest('hex');
    if (hashedSecret !== merchant.apiSecretHash) throw new BadRequestException('Invalid API secret');

    return { merchantId:merchant.id, userId:merchant.userId, businessName:merchant.businessName };
  }
}
