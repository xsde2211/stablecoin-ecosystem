import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout } from 'rxjs';
import { AxiosRequestConfig } from 'axios';

export type ServiceName =
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

    // Strip hop-by-hop headers AND cache-conditional headers.
    // If-None-Match / If-Modified-Since cause the upstream NestJS service
    // to respond 304 with no body — axios then fails to parse JSON.
    // Stripping them forces the upstream to always return 200 with full body.
    const {
      host,
      connection,
      'content-length':   cl,
      'accept-encoding':  ae,
      'if-none-match':    inm,      // ← prevents 304 ETag match
      'if-modified-since': ims,     // ← prevents 304 Last-Modified match
      ...forwardHeaders
    } = headers;

    const config: AxiosRequestConfig = {
      method:  method.toLowerCase() as any,
      url,
      headers: {
        ...forwardHeaders,
        'x-forwarded-from': 'gateway',
        'x-forwarded-host': headers.host ?? '',
        'Cache-Control':    'no-cache, no-store', // tell upstream not to cache
        'Pragma':           'no-cache',
      },
      params: query,
      // Accept any status < 500 so axios doesn't throw on 3xx —
      // we handle them explicitly below.
      validateStatus: (status) => status < 500,
    };

    if (['post', 'put', 'patch'].includes(method.toLowerCase()) && body !== undefined) {
      config.data = body;
    }

    try {
      const response = await firstValueFrom(
        this.http.request(config).pipe(timeout(30_000))
      );

      // 304 should never reach here after stripping If-None-Match above,
      // but guard defensively: if we somehow still get one, re-fetch without
      // any conditional headers (they're already stripped, so this won't loop).
      if (response.status === 304) {
        this.logger.warn(`Upstream returned 304 for [${service}] ${method} ${path} — treating as 502`);
        throw new HttpException(
          { message: 'Service returned 304 with no body. Cache headers issue.' },
          HttpStatus.BAD_GATEWAY,
        );
      }

      return { data: response.data, status: response.status };
    } catch (err: any) {
      // HttpException re-throw (e.g. our 304 guard above) — pass through
      if (err instanceof HttpException) throw err;

      const status = err?.response?.status ?? HttpStatus.BAD_GATEWAY;
      const data   = err?.response?.data   ?? { message: 'Service unavailable' };

      this.logger.error(
        `Proxy error [${service}] ${method} ${path}: ${status} — ${err.message}`,
      );
      throw new HttpException(data, status);
    }
  }

  isServiceConfigured(service: ServiceName): boolean {
    return !!this.serviceUrls[service];
  }
}
