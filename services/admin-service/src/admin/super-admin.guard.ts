import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Granting/revoking on-chain roles (minter, burner, validator, etc.) is
 * deliberately restricted to SUPER_ADMIN only — not ADMIN, not COMPLIANCE.
 * This runs after AuthGuard('jwt') (which populates req.user from the JWT
 * payload — { sub, email, role } — already includes role, no extra DB call
 * needed here).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (req.user?.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Only Super Admin can perform this action');
    }
    return true;
  }
}