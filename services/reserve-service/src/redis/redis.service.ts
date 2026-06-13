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
  async get(k: string)                         { return this.client.get(k); }
  async set(k: string, v: string, t?: number)  { t ? await this.client.setEx(k,t,v) : await this.client.set(k,v); }
  async del(k: string)                         { await this.client.del(k); }
  async exists(k: string)                      { return (await this.client.exists(k))===1; }
  async publish(ch: string, msg: string)       { await this.client.publish(ch, msg); }
  async onModuleDestroy()                      { await this.client.disconnect(); }
}
