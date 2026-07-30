import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout } from 'rxjs';
import { AxiosRequestConfig } from 'axios';

export type ServiceName =
  | 'auth' | 'wallet' | 'bridge' | 'stablecoin'
  | 'treasury' | 'reserve' | 'payment' | 'merchant'
  | 'kyc' | 'notification' | 'analytics' | 'fraud'
  | 'listener' | 'admin' | 'swap';

// Routes that submit blockchain transactions and must wait for
// the RPC broadcast — these need a longer timeout than regular DB calls.
// wallet/send: EVM tx broadcast can take 60-90s on busy testnet RPCs
// stablecoin/mint, stablecoin/burn: same reason
// bridge/*: bridge processor awaits tx submission
const LONG_TIMEOUT_ROUTES: Array<{ service: ServiceName; pathPrefix: string }> = [
  { service: 'wallet',     pathPrefix: '/wallet/send'      },
  { service: 'stablecoin', pathPrefix: '/stablecoin/mint'  },
  { service: 'stablecoin', pathPrefix: '/stablecoin/burn'  },
  { service: 'bridge',     pathPrefix: '/bridge/'          },
  { service: 'treasury',   pathPrefix: '/treasury/execute' },
];

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
    swap:         process.env.SWAP_SERVICE_URL         ?? 'http://localhost:3016',
  };

  constructor(private http: HttpService) {}

  // Default timeout for normal API calls (DB reads/writes)
  private readonly DEFAULT_TIMEOUT_MS = 45_000;

  // Extended timeout for blockchain transaction routes.
  // EVM testnet tx broadcast + 1 confirmation can take up to 2 minutes.
  // We don't wait for confirmation (wallet-service returns on submission),
  // but the RPC call itself can be slow on free-tier nodes.
  private readonly BLOCKCHAIN_TIMEOUT_MS = 120_000; // 2 minutes

  private getTimeoutMs(service: ServiceName, path: string): number {
    for (const route of LONG_TIMEOUT_ROUTES) {
      if (route.service === service && path.startsWith(route.pathPrefix)) {
        return this.BLOCKCHAIN_TIMEOUT_MS;
      }
    }
    return this.DEFAULT_TIMEOUT_MS;
  }

  async forward(
    service: ServiceName,
    method:  string,
    path:    string,
    body:    any,
    headers: Record<string, string>,
    query:   Record<string, any> = {},
  ): Promise<any> {
    const baseUrl    = this.serviceUrls[service];
    const url        = `${baseUrl}${path}`;
    const timeoutMs  = this.getTimeoutMs(service, path);

    const {
      host,
      connection,
      'content-length':   cl,
      'accept-encoding':  ae,
      'if-none-match':    inm,
      'if-modified-since': ims,
      ...forwardHeaders
    } = headers;

    const config: AxiosRequestConfig = {
      method:  method.toLowerCase() as any,
      url,
      headers: {
        ...forwardHeaders,
        'x-forwarded-from': 'gateway',
        'x-forwarded-host': headers.host ?? '',
        'Cache-Control':    'no-cache, no-store',
        'Pragma':           'no-cache',
      },
      params: query,
      validateStatus: (status) => status < 500,
    };

    if (['post', 'put', 'patch'].includes(method.toLowerCase()) && body !== undefined) {
      config.data = body;
    }

    try {
      const response = await firstValueFrom(
        this.http.request(config).pipe(timeout(timeoutMs))
      );

      if (response.status === 304) {
        this.logger.warn(`Upstream returned 304 for [${service}] ${method} ${path} — treating as 502`);
        throw new HttpException(
          { message: 'Service returned 304 with no body. Cache headers issue.' },
          HttpStatus.BAD_GATEWAY,
        );
      }

      return { data: response.data, status: response.status };
    } catch (err: any) {
      if (err instanceof HttpException) throw err;

      if (err?.response) {
        this.logger.error(
          `Proxy error [${service}] ${method} ${path}: ${err.response.status} — ${err.message}`,
        );
        throw new HttpException(err.response.data ?? { message: 'Upstream error' }, err.response.status);
      }

      const isTimeout = err?.name === 'TimeoutError' || err?.code === 'ETIMEDOUT';
      const status    = isTimeout ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY;
      const reason    = err?.code ?? err?.name ?? 'unknown';
      const message   = isTimeout
        ? `${service}-service did not respond within ${timeoutMs / 1000}s`
        : `${service}-service is unreachable (${reason})`;

      this.logger.error(
        `Proxy error [${service}] ${method} ${path}: ${status} — ${reason} — ${err?.message ?? '(no message)'}`,
      );
      throw new HttpException({ message }, status);
    }
  }

  isServiceConfigured(service: ServiceName): boolean {
    return !!this.serviceUrls[service];
  }
}