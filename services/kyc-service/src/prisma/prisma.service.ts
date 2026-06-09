import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ log: [{ emit: 'stdout', level: 'error' }, { emit: 'stdout', level: 'warn' }] });
  }

  async onModuleInit() { await this.connectWithRetry(); }

  private async connectWithRetry(maxAttempts = 10, delayMs = 3000): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try { await this.$connect(); this.logger.log('Database connected'); return; }
      catch (err: any) {
        if (attempt === maxAttempts) { this.logger.error(`DB failed after ${maxAttempts} attempts`, err.message); throw err; }
        this.logger.warn(`DB not ready (${attempt}/${maxAttempts}). Retrying in ${delayMs/1000}s...`);
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }

  async onModuleDestroy() { await this.$disconnect(); }
}
