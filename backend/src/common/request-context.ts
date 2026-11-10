import type { Request } from 'express';
import { Role } from '@prisma/client';

export interface AuthUser {
  userId: string;
}

export interface TenantContext {
  companyId: string;
  membershipId: string;
  role: Role;
  canReviewSignatures: boolean;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  tenant?: TenantContext;
}
