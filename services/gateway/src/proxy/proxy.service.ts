import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout } from 'rxjs';
import { AxiosRequestConfig } from 'axios';

type ServiceName =
  | 'auth' | 'wallet' | 'bridge' | 'stablecoin'
  | 'treasury' | 'reserve' | 'payment' | 'merchant'
  | 'kyc' | 'notification' | 'analytics' | 'fraud'
  | 'listener' | 'admin';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  private readonly serviceUrls: Record<ServiceName, string> = {
    auth:         process.env.AUTH_SERVICE_URL         ?? 'http://localhost:3002',
    wallet:       process.env.WALLET_SERVICE_URL       ?? 'http://localhost:3003',
    bridge:       process.env.BRIDGE_SERVICE_URL       ?? 'http://localhost:3004',
    stablecoin:   process.env.STABLECOIN_SERVICE_URL   ?? 'http://localhost:3005',
    treasury:     process.env.TREASURY_SERVICE_URL     ?? 'http://localhost:3006',
    reserve:      process.env.RESERVE_SERVICE_URL      ?? 'http://localhost:3007',
    payment:      process.env.PAYMENT_SERVICE_URL      ?? 'http://localhost:3008',
    merchant:     process.env.MERCHANT_SERVICE_URL     ?? 'http://localhost:3009',
    kyc:          process.env.KYC_SERVICE_URL          ?? 'http://localhost:3010',
    notification: process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3011',
    analytics:    process.env.ANALYTICS_SERVICE_URL    ?? 'http://localhost:3012',
    fraud:        process.env.FRAUD_SERVICE_URL        ?? 'http://localhost:3013',
    listener:     process.env.LISTENER_SERVICE_URL     ?? 'http://localhost:3014',
    admin:        process.env.ADMIN_SERVICE_URL        ?? 'http://localhost:3015',
  };

  constructor(private http: HttpService) {}

  async forward(
    service: ServiceName,
    method:  string,
    path:    string,
    body:    any,
    headers: Record<string, string>,
    query:   Record<string, any> = {},
  ): Promise<any> {
    const baseUrl = this.serviceUrls[service];
    const url     = `${baseUrl}${path}`;

    // Strip hop-by-hop headers — don't forward these
    const { host, connection, 'content-length': cl, ...forwardHeaders } = headers;

    const config: AxiosRequestConfig = {
      method:  method.toLowerCase(),
      url,
      headers: {
        ...forwardHeaders,
        'x-forwarded-from': 'gateway',
        'x-forwarded-host': headers.host ?? '',
      },
      params: query,
    };

    // Only attach body for methods that support it
    if (['post', 'put', 'patch'].includes(method.toLowerCase()) && body) {
      config.data = body;
    }

    try {
      const response = await firstValueFrom(
        this.http.request(config).pipe(timeout(30_000))
      );
      return response.data;
    } catch (err: any) {
      const status  = err?.response?.status  ?? HttpStatus.BAD_GATEWAY;
      const message = err?.response?.data    ?? 'Service unavailable';

      // 304 is NOT an error — it means "use cached response"
      // axios throws on 304 because it's a redirect-like code
      if (status === 304) {
        return err?.response?.data ?? {};
      }

      this.logger.error(`Proxy error [${service}] ${method} ${path}: ${status}`);
      throw new HttpException(message, status);
    }
  }

  isServiceHealthy(service: ServiceName): boolean {
    return !!this.serviceUrls[service];
  }
}