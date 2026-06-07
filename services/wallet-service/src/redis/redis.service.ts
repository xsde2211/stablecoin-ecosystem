import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { createClient, RedisClientType }        from 'redis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType;

  constructor() {
    this.client = createClient({ url: process.env.REDIS_URL }) as RedisClientType;
    this.client.on('error', err => this.logger.error('Redis error:', err.message));
    this.client.connect().catch(err => this.logger.error('Redis connect failed:', err.message));
  }

  async get(key: string)                           { return this.client.get(key); }
  async set(key: string, val: string, ttl?: number) {
    ttl ? await this.client.setEx(key, ttl, val) : await this.client.set(key, val);
  }
  async del(key: string)                           { await this.client.del(key); }
  async exists(key: string)                        { return (await this.client.exists(key)) === 1; }
  async incr(key: string)                          { return this.client.incr(key); }
  async expire(key: string, ttl: number)           { await this.client.expire(key, ttl); }
  async onModuleDestroy()                          { await this.client.disconnect(); }
}
