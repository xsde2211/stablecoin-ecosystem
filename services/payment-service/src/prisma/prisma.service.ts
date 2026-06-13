import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  constructor() { super({ log:[{emit:'stdout',level:'error'},{emit:'stdout',level:'warn'}] }); }
  async onModuleInit() { await this.connectWithRetry(); }
  private async connectWithRetry(max=10,delay=3000): Promise<void> {
    for(let i=1;i<=max;i++){
      try { await this.$connect(); this.logger.log('Database connected'); return; }
      catch(e:any){ if(i===max) throw e; this.logger.warn(`DB retry ${i}/${max}`); await new Promise(r=>setTimeout(r,delay)); }
    }
  }
  async onModuleDestroy() { await this.$disconnect(); }
}
