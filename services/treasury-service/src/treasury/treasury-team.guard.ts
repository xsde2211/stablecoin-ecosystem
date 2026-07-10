import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

const ALLOWED = ['SIGNER', 'GUARDIAN', 'ADMIN', 'SUPER_ADMIN'];

@Injectable()
export class TreasuryTeamGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!ALLOWED.includes(req.user?.role)) {
      throw new ForbiddenException('Only the treasury team (Signer/Guardian) or Admin can perform this action');
    }
    return true;
  }
}