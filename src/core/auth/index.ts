/**
 * Authorization Architecture & Access Control
 * Strict Role-Based Access Control (RBAC) with Tenant Isolation.
 * 
 * CORE RULES:
 * 1. Platform Admin permissions are completely segregated from Merchant permissions.
 * 2. Merchant Owners and Staff can NEVER exercise Platform Admin privileges.
 * 3. Any action on tenant-scoped data requires that the user's `tenantId` matches the resource's `tenantId`.
 * 4. Authorization decisions are strictly evaluated server-side.
 */

import { SystemRole, Permission, User, AccountStatus, TenantMembership } from '../domain/index.ts';
import { AuthorizationError, TenantMismatchError } from '../errors/index.ts';
import { TenantResolver } from '../tenant/index.ts';

export * from './session.ts';
export * from './service.ts';
export * from './policy.ts';



