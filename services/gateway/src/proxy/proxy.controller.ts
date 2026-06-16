import {
  Controller, All, Req, Res,
  Logger, Get,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ProxyService, ServiceName } from './proxy.service';

// Routes that don't require JWT — accessible by anyone
const PUBLIC_ROUTES = [
  '/auth/register',
  '/auth/login',
  '/auth/refresh',
  '/health',
  '/docs',
];

// Path PREFIXES (not just full paths) that are public — for dynamic segments
const PUBLIC_PREFIXES = [
  '/payments/',  // GET /payments/:id is scanned by wallet apps without auth
];

function isPublic(method: string, path: string): boolean {
  if (PUBLIC_ROUTES.some(r => path === r || path.startsWith(r))) return true;

  // POST /payments/:id/paid is called by listener-service (internal) — also public
  // GET  /payments/:id      is called by wallet app after QR scan — public
  if (PUBLIC_PREFIXES.some(p => path.startsWith(p))) {
    // but /payments (list) and /payments/stats/overview and /payments (create) require auth
    const afterPrefix = path.slice('/payments/'.length);
    // afterPrefix looks like "<uuid>" or "<uuid>/paid" or "<uuid>/cancel" or "stats/overview"
    if (afterPrefix.startsWith('stats')) return false;
    if (method === 'GET' && !afterPrefix.includes('/')) return true;       // GET /payments/:id
    if (method === 'POST' && afterPrefix.endsWith('/paid')) return true;   // POST /payments/:id/paid
    return false;
  }

  return false;
}

// Map URL prefix → service name. Order matters: longer/more-specific prefixes first.
function resolveService(path: string): ServiceName | '' {
  if (path.startsWith('/auth'))          return 'auth';
  if (path.startsWith('/wallet'))        return 'wallet';
  if (path.startsWith('/bridge'))        return 'bridge';
  if (path.startsWith('/stablecoin'))    return 'stablecoin';
  if (path.startsWith('/treasury'))      return 'treasury';
  if (path.startsWith('/reserve'))       return 'reserve';
  if (path.startsWith('/payments'))      return 'payment';
  if (path.startsWith('/merchant'))      return 'merchant';
  if (path.startsWith('/kyc'))           return 'kyc';
  if (path.startsWith('/notifications')) return 'notification';
  if (path.startsWith('/analytics'))     return 'analytics';
  if (path.startsWith('/fraud'))         return 'fraud';
  if (path.startsWith('/listener'))      return 'listener';
  if (path.startsWith('/admin'))         return 'admin';
  return '';
}

@ApiTags('Gateway')
@Controller()
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(private proxy: ProxyService) {}

  @Get('health')
  @ApiOperation({ summary: 'Gateway health check' })
  health() {
    return {
      status:    'ok',
      service:   'gateway',
      timestamp: new Date().toISOString(),
    };
  }

  // Catch-all route — forwards every request to the right service
  @All('*')
  async proxyAll(@Req() req: Request, @Res() res: Response) {
    const path    = req.path;
    const method  = req.method;
    const service = resolveService(path);

    if (!service) {
      return res.status(404).json({ message: `No service mapped for path: ${path}` });
    }

    // Validate JWT presence for protected routes.
    // Actual signature/blacklist/suspension verification happens in the
    // downstream service via its own JwtAuthGuard — the gateway only
    // checks that an Authorization header is present so we fail fast
    // with a clean 401 instead of a confusing 502 from downstream.
    if (!isPublic(method, path)) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization header required' });
      }
    }

    try {
      const result = await this.proxy.forward(
        service,
        method,
        path,
        req.body,
        req.headers as Record<string, string>,
        req.query as Record<string, any>,
      );
      return res.status(result.status).json(result.data);
    } catch (err: any) {
      const status = err?.getStatus?.() ?? 502;
      const data    = err?.getResponse?.() ?? { message: err?.message ?? 'Gateway error' };
      return res.status(status).json(data);
    }
  }
}
