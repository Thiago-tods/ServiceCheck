import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import { ROLES_KEY, TENANT_KEY } from '../common/decorators';
import { AuthedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves the company for tenant-scoped routes from the X-Company-Id header and
 * proves the authenticated user holds an active membership there. Authorization
 * lives here (backend), never only in the client.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const scoped =
      this.reflector.getAllAndOverride<boolean>(TENANT_KEY, targets) ||
      !!this.reflector.getAllAndOverride<unknown[]>(ROLES_KEY, targets);
    if (!scoped) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['x-company-id'];
    const companyId = Array.isArray(header) ? header[0] : header;
    if (!req.user || !companyId || !isUUID(companyId)) {
      throw new ForbiddenException('A valid X-Company-Id header is required');
    }

    const membership = await this.prisma.membership.findFirst({
      where: { userId: req.user.userId, companyId, active: true },
    });
    // Same response for "no such company" and "not a member": no tenant enumeration.
    if (!membership) throw new ForbiddenException('No access to this company');

    req.tenant = {
      companyId,
      membershipId: membership.id,
      role: membership.role,
      canReviewSignatures: membership.canReviewSignatures,
    };
    return true;
  }
}
