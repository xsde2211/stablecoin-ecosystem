import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import axios            from 'axios';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class PriceService {
  private readonly logger = new Logger(PriceService.name);

  constructor(private redis: RedisService) {}

  // Same numbers the wallet dashboard and stablecoin-service's own
  // /stablecoin/live-prices already show — INRX/EGOLD/ESLVR track live
  // INR/gold/silver rates, so this is the one true price source for a
  // swap between them. Cached briefly so a burst of quote requests
  // doesn't hammer stablecoin-service (which itself caches upstream).
  async getStablecoinPrices(): Promise<Record<string, { usd: number; inr: number }>> {
    const cacheKey = 'swap:stablecoinPrices';
    const cached   = await this.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const url = process.env.STABLECOIN_SERVICE_URL ?? 'http://localhost:3005';
    const res = await axios.get(`${url}/stablecoin/live-prices`, { timeout: 8000 });
    const prices = res.data?.prices;
    if (!prices) throw new BadRequestException('stablecoin-service returned no price data');

    await this.redis.set(cacheKey, JSON.stringify(prices), 15).catch(() => {});
    return prices;
  }
}
