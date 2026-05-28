import {
  Controller, All, Req, Res,
  UseGuards, Logger, Get,
} from '@nestjs/common';
import { AuthGuard }   from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ProxyService } from './proxy.service';

// Routes that don't require JWT — accessible by anyone
const PUBLIC_ROUTES = [
  '/auth/register',
  '/auth/login',
  '/auth/refresh',
  '/payments/',       // payment status check (merchants embed this)
  '/health',
];

function isPublic(path: string): boolean {
  return PUBLIC_ROUTES.some(r => path.startsWith(r));
}

// Map URL prefix → service name
function resolveService(path: string): string {
  if (path.startsWith('/auth'))         return 'auth';
  if (path.startsWith('/wallet'))       return 'wallet';
  if (path.startsWith('/bridge'))       return 'bridge';
  if (path.startsWith('/stablecoin'))   return 'stablecoin';
  if (path.startsWith('/treasury'))     return 'treasury';
  if (path.startsWith('/reserve'))      return 'reserve';
  if (path.startsWith('/payments'))     return 'payment';
  if (path.startsWith('/merchant'))     return 'merchant';
  if (path.startsWith('/kyc'))          return 'kyc';
  if (path.startsWith('/notifications'))return 'notification';
  if (path.startsWith('/analytics'))    return 'analytics';
  if (path.startsWith('/fraud'))        return 'fraud';
  if (path.startsWith('/admin'))        return 'admin';
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
    const service = resolveService(path);

    if (!service) {
      return res.status(404).json({ message: `No service mapped for path: ${path}` });
    }

    // Validate JWT for protected routes
    if (!isPublic(path)) {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authorization header required' });
      }
    }

    try {
      const result = await this.proxy.forward(
        service as any,
        req.method,
        path,
        req.body,
        req.headers as Record<string, string>,
        req.query as Record<string, any>,
      );
      return res.json(result);
    } catch (err: any) {
      const status  = err?.status  ?? 502;
      const message = err?.message ?? 'Gateway error';
      return res.status(status).json({ message });
    }
  }
}