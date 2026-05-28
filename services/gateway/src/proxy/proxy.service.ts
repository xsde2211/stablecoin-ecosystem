import { Module }      from '@nestjs/common';
import { HttpModule }  from '@nestjs/axios';
import { ProxyController } from './proxy.controller';
import { ProxyService }    from './proxy.service';

@Module({
  imports:     [HttpModule],
  controllers: [ProxyController],
  providers:   [ProxyService],
})
export class ProxyModule {}import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class ProxyService {
  private readonly serviceUrls = {
    auth:        process.env.AUTH_SERVICE_URL        ?? 'http://localhost:3002',
    wallet:      process.env.WALLET_SERVICE_URL      ?? 'http://localhost:3003',
    bridge:      process.env.BRIDGE_SERVICE_URL      ?? 'http://localhost:3004',
    stablecoin:  process.env.STABLECOIN_SERVICE_URL  ?? 'http://localhost:3005',
    treasury:    process.env.TREASURY_SERVICE_URL    ?? 'http://localhost:3006',
    payment:     process.env.PAYMENT_SERVICE_URL     ?? 'http://localhost:3007',
    merchant:    process.env.MERCHANT_SERVICE_URL    ?? 'http://localhost:3008',
    kyc:         process.env.KYC_SERVICE_URL         ?? 'http://localhost:3009',
    notification:process.env.NOTIFICATION_SERVICE_URL?? 'http://localhost:3010',
    analytics:   process.env.ANALYTICS_SERVICE_URL  ?? 'http://localhost:3011',
    fraud:       process.env.FRAUD_SERVICE_URL       ?? 'http://localhost:3012',
    admin:       process.env.ADMIN_SERVICE_URL       ?? 'http://localhost:3013',
  };

  constructor(private http: HttpService) {}

  async forward(
    service: keyof typeof this.serviceUrls,
    method:  string,
    path:    string,
    body:    any,
    headers: Record<string, string>,
  ) {
    const url = `${this.serviceUrls[service]}${path}`;

    const response = await firstValueFrom(
      this.http.request({
        method,
        url,
        data:    body,
        headers: {
          ...headers,
          'x-forwarded-from': 'gateway',
        },
      })
    );

    return response.data;
  }
}