// src/prisma/prisma.service.ts
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    await this.connectWithRetry();
  }

  private async connectWithRetry(
    maxAttempts = 10,
    delayMs     = 3000,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.$connect();
        this.logger.log('Database connected');
        return;
      } catch (err: any) {
        const isLast = attempt === maxAttempts;
        if (isLast) {
          this.logger.error(
            `Database connection failed after ${maxAttempts} attempts`,
            err.message,
          );
          throw err;
        }
        this.logger.warn(
          `Database not ready (attempt ${attempt}/${maxAttempts}). ` +
          `Retrying in ${delayMs / 1000}s...`
        );
        await this.sleep(delayMs);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}