import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuthedRequest, AuthUser, TenantContext } from './request-context';

export const IS_PUBLIC_KEY = 'isPublic';
export const TENANT_KEY = 'tenantScoped';
export const ROLES_KEY = 'roles';

/** Route does not require a JWT. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Route is scoped to a company: requires a valid X-Company-Id the user belongs to. */
export const TenantScoped = () => SetMetadata(TENANT_KEY, true);

/** Restrict route to the given roles (implies tenant scope). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user satisfies AuthUser;
});

export const CurrentTenant = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const tenant = ctx.switchToHttp().getRequest<AuthedRequest>().tenant;
  if (!tenant) throw new Error('CurrentTenant used on a route that is not tenant-scoped');
  return tenant satisfies TenantContext;
});
