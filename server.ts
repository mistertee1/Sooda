import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import { Database } from './src/core/database/index.ts';
import { TenantResolver, TenantContext } from './src/core/tenant/index.ts';
import { AuditLogService, AuditAction, registerAuditDatabaseProvider } from './src/core/observability/index.ts';
import {
  TenantSettingsService,
  StorefrontService,
  PlatformAdministrationService,
  StoreManagementService,
} from './src/core/services/index.ts';
import {
  formatErrorResponse,
  NotFoundError,
  TenantMismatchError,
  AuthorizationError,
  AuthenticationError,
  ValidationError,
} from './src/core/errors/index.ts';
import {
  ROLE_PERMISSIONS,
  AuthenticationService,
  AuthenticatedPrincipal,
  SessionService,
  SESSION_COOKIE_NAME,
} from './src/core/auth/index.ts';
import { verifyPassword, dummyVerify } from './src/core/security/password.ts';
import { ConfigurationManager } from './src/core/config/index.ts';
import { SystemRole, AccountStatus } from './src/core/domain/index.ts';
import { RateLimiter, MemoryRateLimitStore } from './src/core/security/rateLimit.ts';

export interface SoodaRequest extends Request {
  tenantContext?: TenantContext | null;
  principal?: AuthenticatedPrincipal | null;
  traceId?: string;
}

export function createApp(options?: { isProduction?: boolean; db?: Database }) {
  const app = express();
  const isProduction = options?.isProduction !== undefined ? options.isProduction : process.env.NODE_ENV === 'production';
  const serverConfig = ConfigurationManager.getInstance().getServerConfig();
  const rateLimitStore = new MemoryRateLimitStore();
  const rateLimiter = new RateLimiter(rateLimitStore, serverConfig.rateLimitMaxRequests, serverConfig.rateLimitWindowMs);

  // Database and Application Services initialization
  const getActiveDb = (): Database => (options?.db ? options.db : Database.getInstance());
  const db = options?.db || new Proxy({} as Database, {
    get(_target, prop, receiver) {
      const activeDb = getActiveDb();
      const val = Reflect.get(activeDb, prop, receiver);
      if (typeof val === 'function') {
        return val.bind(activeDb);
      }
      return val;
    },
  });
  registerAuditDatabaseProvider(getActiveDb);
  AuditLogService.getInstance(db);
  const sessionService = new SessionService(db, AuditLogService.getInstance());
  const authService = new AuthenticationService(db, sessionService, AuditLogService.getInstance());
  const tenantSettingsService = new TenantSettingsService(db);
  const storefrontService = new StorefrontService(db);
  const platformAdminService = new PlatformAdministrationService(db);
  const storeManagementService = new StoreManagementService(db);

  // 1. HARDENED REQUEST SIZE LIMITS
  // Defends against payload bomb attacks and unmetered memory exhaustion
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  // 2. HARDENED SECURITY HEADERS
  // Modern, standards-compliant security headers (obsolete X-XSS-Protection removed)
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' ws: wss:;"
    );
    next();
  });

  // 3. REQUEST TRACING
  app.use((req: SoodaRequest, res: Response, next: NextFunction) => {
    const traceId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    req.traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);
    next();
  });

  // 4. RATE LIMITING MIDDLEWARE
  app.use('/api', (req: SoodaRequest, res: Response, next: NextFunction) => {
    // Exempt local test-runner internal endpoints from aggressive throttling
    if (req.path.startsWith('/tests/')) {
      return next();
    }

    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const rateCheck = rateLimiter.isAllowed(clientIp);

    res.setHeader('X-RateLimit-Limit', serverConfig.rateLimitMaxRequests.toString());
    res.setHeader('X-RateLimit-Remaining', rateCheck.remaining.toString());

    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', Math.ceil(rateCheck.resetMs / 1000).toString());
      AuditLogService.getInstance().record({
        tenantId: req.tenantContext?.tenantId,
        actorId: req.principal?.id || 'anonymous',
        actorRole: req.principal?.role || 'ANONYMOUS',
        action: AuditAction.RATE_LIMIT_TRIGGERED,
        entityType: 'RateLimiter',
        entityId: clientIp,
        traceId: req.traceId,
        metadata: { clientIp, path: req.path },
      });

      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please slow down and retry after the backoff window.',
        },
      });
    }

    next();
  });

  // 5. STAGE 1: TENANT RESOLUTION MIDDLEWARE
  // Resolves tenant context from host/slug/header, but EXPLICITLY DOES NOT GRANT AUTHORIZATION.
  app.use((req: SoodaRequest, res: Response, next: NextFunction) => {
    const hostHeader = req.headers['host'];
    const tenantIdHeader = req.headers['x-tenant-id'] as string | undefined;
    const querySlug = req.query.slug as string | undefined;

    let matchedStore = null;

    if (tenantIdHeader) {
      matchedStore = db.getStore(tenantIdHeader);
    } else if (hostHeader) {
      const slug = TenantResolver.resolveTenantSlugFromHost(hostHeader);
      if (slug) {
        matchedStore = db.getStoreBySlug(slug);
      }
    } else if (querySlug) {
      matchedStore = db.getStoreBySlug(querySlug);
    }

    if (matchedStore) {
      req.tenantContext = {
        tenantId: matchedStore.id,
        storeSlug: matchedStore.slug,
        storeName: matchedStore.nameAr,
        isActive: matchedStore.status === 'ACTIVE',
        currency: matchedStore.currency,
        merchantId: matchedStore.merchantId,
        isAuthorized: false, // Critical principle: resolution !== authorization
      };
    } else {
      req.tenantContext = null;
    }
    next();
  });

  // 6. STAGE 2: AUTHENTICATION EXTRACTION
  app.use((req: SoodaRequest, res: Response, next: NextFunction) => {
    // 1. Primary: Extract and validate persistent session token (cookie or Bearer)
    const token = SessionService.extractTokenFromRequest(req);
    if (token) {
      const validation = sessionService.validateSession(token);
      if (validation.valid) {
        req.principal = validation.principal;
        return next();
      }
    }

    // 2. Secondary: Fallback to Phase 0 test tokens (strictly non-production dev/test only)
    const authHeader = req.headers['authorization'];
    req.principal = AuthenticationService.verifyToken(authHeader, {
      nodeEnv: process.env.NODE_ENV,
      allowTestTokens: serverConfig.allowDevTestTokens,
    });
    next();
  });

  // ---------------- SECURITY GUARDS ----------------
  const requireAuth = (req: SoodaRequest, res: Response, next: NextFunction) => {
    if (!req.principal) {
      AuditLogService.getInstance().record({
        tenantId: req.tenantContext?.tenantId,
        actorId: 'anonymous',
        actorRole: 'ANONYMOUS',
        action: AuditAction.AUTHENTICATION_FAILED,
        entityType: 'SecurityGate',
        entityId: req.path,
        traceId: req.traceId,
        metadata: { path: req.path, method: req.method },
      });
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Valid authentication credentials are required for this endpoint.',
        },
      });
    }
    next();
  };

  const requireRole = (...allowedRoles: SystemRole[]) => {
    return (req: SoodaRequest, res: Response, next: NextFunction) => {
      if (!req.principal) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required.',
          },
        });
      }
      if (!allowedRoles.includes(req.principal.role)) {
        AuditLogService.getInstance().record({
          tenantId: req.principal.tenantId || undefined,
          actorId: req.principal.id,
          actorRole: req.principal.role,
          action: AuditAction.UNAUTHORIZED_ACCESS_BLOCKED,
          entityType: 'RBACGate',
          entityId: req.path,
          traceId: req.traceId,
          metadata: { requiredRoles: allowedRoles, principalRole: req.principal.role },
        });
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `User role '${req.principal.role}' lacks authorization for this endpoint.`,
          },
        });
      }
      next();
    };
  };

  const requireTenantScope = (req: SoodaRequest, res: Response, next: NextFunction) => {
    if (!req.principal) {
      return res.status(401).json({ success: false, error: { code: 'AUTHENTICATION_REQUIRED' } });
    }

    // Target tenant may come from query, path parameter, or header
    const targetTenantId = (req.query.tenantId as string) || (req.headers['x-tenant-id'] as string) || req.tenantContext?.tenantId;

    if (!targetTenantId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TENANT_REQUIRED',
          message: 'Target tenant ID must be specified for tenant-scoped operations.',
        },
      });
    }

    // Validate target tenant ID format to prevent injection or directory traversal
    if (typeof targetTenantId !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(targetTenantId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Tenant identifier is malformed or contains invalid characters.',
        },
      });
    }

    // Platform Admins are platform-wide and can inspect any valid tenant
    if (req.principal.role === SystemRole.PLATFORM_ADMIN) {
      return next();
    }

    // Check boundary (direct tenant assignment or active tenant membership)
    const directMatch = req.principal.tenantId === targetTenantId;
    const membershipMatch = (req.principal.memberships || []).some(
      (m) => m.tenantId === targetTenantId && (m.status === AccountStatus.ACTIVE || !m.status)
    );

    if (!directMatch && !membershipMatch) {
      AuditLogService.getInstance().record({
        tenantId: targetTenantId,
        actorId: req.principal.id,
        actorRole: req.principal.role,
        action: AuditAction.CROSS_TENANT_ACCESS_BLOCKED,
        entityType: 'TenantSecurityBoundary',
        entityId: targetTenantId,
        traceId: req.traceId,
        metadata: {
          principalTenantId: req.principal.tenantId,
          attemptedTargetTenantId: targetTenantId,
          path: req.path,
          method: req.method,
        },
      });
      return res.status(403).json({
        success: false,
        error: {
          code: 'TENANT_MISMATCH',
          message: `Cross-tenant access blocked. You are not authorized to access tenant '${targetTenantId}'.`,
        },
      });
    }

    next();
  };

  // ================= API ROUTES =================

  // 1. PUBLIC: Health check & Platform status
  app.get('/api/health', (req: SoodaRequest, res: Response) => {
    const platform = db.getPlatform();
    const publicConfig = ConfigurationManager.getInstance().getPublicConfig();
    const stores = db.listStores();

    res.json({
      status: 'ok',
      platform: {
        name: platform?.name || publicConfig.appName,
        version: platform?.version || publicConfig.appVersion,
        status: platform?.status || 'ACTIVE',
        currency: publicConfig.defaultCurrency,
        primaryDomain: publicConfig.platformDomain,
      },
      tenancy: {
        activeTenantsCount: stores.length,
        isolationModel: 'SQLite Local Disk Persistence with Foreign Keys (Phase 0 Foundation)',
        cloudPersistenceStatus: 'BLOCKED (Cloud Run ephemeral container; requires managed Cloud SQL)',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // 2. PUBLIC: Tenant Context Resolution (Storefront metadata ONLY - No private settings)
  app.get('/api/tenant/resolve', (req: SoodaRequest, res: Response) => {
    const hostHeader = req.headers['host'];
    const querySlug = req.query.slug as string | undefined;

    let slugToResolve: string | null = null;

    if (querySlug) {
      // Validate slug input to prevent injection
      if (typeof querySlug !== 'string' || !/^[a-z0-9_-]+$/i.test(querySlug)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Store slug contains invalid characters.' },
        });
      }
      slugToResolve = querySlug;
    } else if (hostHeader) {
      slugToResolve = TenantResolver.resolveTenantSlugFromHost(hostHeader);
    }

    if (!slugToResolve) {
      return res.status(404).json({
        success: false,
        error: { code: 'TENANT_NOT_FOUND', message: 'No store slug specified or resolved.' },
      });
    }

    const storefront = storefrontService.resolvePublicStorefront(slugToResolve);

    if (!storefront) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TENANT_NOT_FOUND',
          message: 'No active store matches the requested domain or slug.',
        },
      });
    }

    // Public storefront representation ONLY
    return res.json({
      success: true,
      tenant: storefront,
    });
  });

  // ---------------- AUTHENTICATION ENDPOINTS ----------------

  const handleAuthentication = async (
    req: SoodaRequest,
    res: Response,
    isApiExplicit: boolean
  ) => {
    const { email, password, clientType } = req.body || {};

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Both email and password are required.',
        },
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const clientIp = (req.ip || req.socket.remoteAddress || '127.0.0.1') as string;
    const userAgent = (req.headers['user-agent'] as string) || 'UNKNOWN';

    try {
      const authResult = await authService.authenticate({
        email: normalizedEmail,
        password,
        ipAddress: clientIp,
        userAgent,
        traceId: req.traceId,
      });

      const isApiClient =
        isApiExplicit ||
        clientType === 'api' ||
        req.headers['x-auth-client'] === 'api';

      const memberships = authResult.user.memberships || [];

      if (isApiClient) {
        // Programmatic / API Client:
        // Returns Bearer token in JSON payload. Does NOT set a browser cookie.
        return res.json({
          success: true,
          data: {
            authType: 'BEARER',
            token: authResult.rawToken,
            tokenType: 'Bearer',
            user: {
              id: authResult.user.id,
              email: authResult.user.email,
              fullName: authResult.user.fullName,
              role: authResult.user.role,
              status: authResult.user.status,
              tenantId: authResult.user.tenantId,
              preferredLanguage: authResult.user.preferredLanguage,
              memberships,
              lastLoginAt: authResult.user.lastLoginAt,
            },
            expiresAt: authResult.session.expiresAt,
          },
        });
      }

      // Browser Client (Default):
      // Sets HttpOnly, SameSite=Strict session cookie.
      // Deliberately does NOT expose the raw session token in JSON to protect against client-side script harvesting (XSS).
      res.cookie(SESSION_COOKIE_NAME, authResult.rawToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      return res.json({
        success: true,
        data: {
          authType: 'COOKIE',
          user: {
            id: authResult.user.id,
            email: authResult.user.email,
            fullName: authResult.user.fullName,
            role: authResult.user.role,
            status: authResult.user.status,
            tenantId: authResult.user.tenantId,
            preferredLanguage: authResult.user.preferredLanguage,
            memberships,
            lastLoginAt: authResult.user.lastLoginAt,
          },
          expiresAt: authResult.session.expiresAt,
        },
      });
    } catch (err: any) {
      if (err.name === 'InvalidCredentialsError') {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password.',
          },
        });
      }
      if (err.name === 'AccountLockedError') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCOUNT_LOCKED',
            message: 'Account is locked due to multiple failed login attempts. Please try again later.',
          },
        });
      }
      if (err.name === 'AccountInactiveError') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCOUNT_INACTIVE',
            message: 'Account is inactive or disabled.',
          },
        });
      }
      if (err.name === 'AuditPersistenceError') {
        return res.status(500).json({
          success: false,
          error: {
            code: 'AUDIT_PERSISTENCE_FAILED',
            message: 'Security audit persistence failed. Authentication aborted.',
          },
        });
      }

      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Authentication failed due to internal error.',
        },
      });
    }
  };

  // POST /api/auth/login - Primary Browser Authentication Endpoint
  app.post('/api/auth/login', async (req: SoodaRequest, res: Response) => {
    return handleAuthentication(req, res, false);
  });

  // POST /api/auth/token - Dedicated Programmatic / API Client Authentication Endpoint
  app.post('/api/auth/token', async (req: SoodaRequest, res: Response) => {
    return handleAuthentication(req, res, true);
  });

  // POST /api/auth/logout - Server-Side Session Revocation & Cookie Eviction
  app.post('/api/auth/logout', (req: SoodaRequest, res: Response) => {
    try {
      const rawToken = SessionService.extractTokenFromRequest(req);
      if (rawToken) {
        sessionService.revokeSessionByToken(rawToken);
      }

      if (req.principal) {
        AuditLogService.getInstance().record({
          tenantId: req.principal.tenantId || undefined,
          actorId: req.principal.id,
          actorRole: req.principal.role,
          action: AuditAction.LOGOUT,
          entityType: 'User',
          entityId: req.principal.id,
          traceId: req.traceId,
          metadata: { sessionId: req.principal.sessionId },
        });
      }

      res.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        path: '/',
      });

      return res.json({
        success: true,
        message: 'Logged out successfully.',
      });
    } catch (err: any) {
      if (err.name === 'AuditPersistenceError') {
        return res.status(500).json({
          success: false,
          error: {
            code: 'AUDIT_PERSISTENCE_FAILED',
            message: 'Security audit persistence failed. Logout aborted.',
          },
        });
      }
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Logout failed.' },
      });
    }
  });

  // GET /api/auth/me - Authenticated Identity Inspection
  app.get('/api/auth/me', requireAuth, (req: SoodaRequest, res: Response) => {
    const user = db.getUser(req.principal!.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User profile not found.' },
      });
    }

    return res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          status: user.status,
          tenantId: user.tenantId,
          preferredLanguage: user.preferredLanguage,
          memberships: user.memberships ?? [],
          lastLoginAt: user.lastLoginAt,
          sessionId: req.principal!.sessionId,
        },
      },
    });
  });

  // 3. PROTECTED: Server-side RBAC & Permission Matrix (Platform Admin ONLY)
  app.get('/api/auth/roles', requireAuth, requireRole(SystemRole.PLATFORM_ADMIN), (req: SoodaRequest, res: Response) => {
    res.json({
      success: true,
      roles: Object.keys(ROLE_PERMISSIONS),
      rolePermissions: ROLE_PERMISSIONS,
      enforcement: {
        platformAdminStrictSeparation: true,
        merchantOwnerCrossTenantProhibited: true,
        serverSideGateEnforced: true,
      },
    });
  });

  // 4. PROTECTED: Tenant Settings Query (Scoped via Application Service)
  app.get('/api/tenant/settings', requireAuth, requireTenantScope, async (req: SoodaRequest, res: Response, next: NextFunction) => {
    try {
      const targetTenantId = (req.query.tenantId as string) || (req.headers['x-tenant-id'] as string) || req.tenantContext?.tenantId!;
      const settings = await tenantSettingsService.getSettings(targetTenantId, req.principal!, req.traceId);
      return res.json({
        success: true,
        settings,
      });
    } catch (err) {
      next(err);
    }
  });

  // 5. PROTECTED: Tenant Settings Mutation (PATCH - Scoped via Application Service)
  app.patch('/api/tenant/settings', requireAuth, requireTenantScope, async (req: SoodaRequest, res: Response, next: NextFunction) => {
    try {
      const targetTenantId = (req.query.tenantId as string) || (req.headers['x-tenant-id'] as string) || req.tenantContext?.tenantId!;
      const updates = req.body || {};
      const settings = await tenantSettingsService.updateSettings(targetTenantId, updates, req.principal!, req.traceId);
      return res.json({
        success: true,
        settings,
      });
    } catch (err) {
      next(err);
    }
  });

  // 6. PROTECTED: Tenant Settings Deletion (DELETE - Scoped via Application Service)
  app.delete('/api/tenant/settings', requireAuth, requireTenantScope, async (req: SoodaRequest, res: Response, next: NextFunction) => {
    try {
      const targetTenantId = (req.query.tenantId as string) || (req.headers['x-tenant-id'] as string) || req.tenantContext?.tenantId!;
      await tenantSettingsService.deleteSettings(targetTenantId, req.principal!, req.traceId);
      return res.json({
        success: true,
        message: `Settings for tenant '${targetTenantId}' successfully soft deleted.`,
      });
    } catch (err) {
      next(err);
    }
  });

  // =========================================================================
  // PHASE 2: STORE MANAGEMENT & MERCHANT DASHBOARD API ENDPOINTS
  // Central Security Invariant:
  // User -> TenantMembership -> Authorized Store -> Store Management Operation
  // =========================================================================

  // GET /api/stores - List all stores authorized for the authenticated user
  app.get('/api/stores', requireAuth, async (req: SoodaRequest, res: Response, next: NextFunction) => {
    try {
      const stores = await storeManagementService.listAuthorizedStores(req.principal!);
      return res.json({
        success: true,
        count: stores.length,
        stores,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/stores/check-slug - Real-time slug syntax and collision availability check
  app.get('/api/stores/check-slug', requireAuth, async (req: SoodaRequest, res: Response, next: NextFunction) => {
    try {
      const slug = (req.query.slug as string) || '';
      const currentStoreId = req.query.currentStoreId as string | undefined;

      if (!slug) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Slug query parameter is required',
          },
        });
      }

      const check = await storeManagementService.checkSlugAvailability(
        slug,
        currentStoreId,
        req.principal!,
        req.traceId
      );

      return res.json({
        success: true,
        ...check,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/stores/:storeId - Retrieve authorized store profile and settings
  app.get('/api/stores/:storeId', requireAuth, async (req: SoodaRequest, res: Response, next: NextFunction) => {
    try {
      const storeId = req.params.storeId;
      if (!/^[a-z0-9_-]{1,64}$/i.test(storeId)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Store identifier is malformed.',
          },
        });
      }

      const result = await storeManagementService.getStore(storeId, req.principal!, req.traceId);
      return res.json({
        success: true,
        store: result.store,
        settings: result.settings,
        membership: result.membership,
      });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/stores/:storeId - Update authorized store profile & settings (Strict Whitelist)
  app.patch('/api/stores/:storeId', requireAuth, async (req: SoodaRequest, res: Response, next: NextFunction) => {
    try {
      const storeId = req.params.storeId;
      if (!/^[a-z0-9_-]{1,64}$/i.test(storeId)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Store identifier is malformed.',
          },
        });
      }

      const result = await storeManagementService.updateStore(storeId, req.body, req.principal!, req.traceId);
      return res.json({
        success: true,
        message: 'Store profile successfully updated.',
        store: result.store,
        settings: result.settings,
      });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/stores/:storeId/status - Update store operational status (ACTIVE, INACTIVE)
  app.patch('/api/stores/:storeId/status', requireAuth, async (req: SoodaRequest, res: Response, next: NextFunction) => {
    try {
      const storeId = req.params.storeId;
      if (!/^[a-z0-9_-]{1,64}$/i.test(storeId)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: 'Store identifier is malformed.',
          },
        });
      }

      const updated = await storeManagementService.updateStoreStatus(storeId, req.body, req.principal!, req.traceId);
      return res.json({
        success: true,
        message: `Store operational status updated to '${updated.status}'.`,
        store: updated,
      });
    } catch (err) {
      next(err);
    }
  });

  // 7. PROTECTED: Audit Log Query (Platform Admin or Tenant-Scoped Merchant)
  app.get('/api/audit/recent', requireAuth, (req: SoodaRequest, res: Response) => {
    const auditService = AuditLogService.getInstance();

    if (req.principal!.role === SystemRole.PLATFORM_ADMIN) {
      // Platform admin can view all logs
      const events = auditService.getRecent(50);
      return res.json({
        success: true,
        scope: 'PLATFORM_WIDE',
        count: events.length,
        events,
      });
    }

    // Merchant can only view events for their own tenant
    const merchantTenantId = req.principal!.tenantId;
    if (!merchantTenantId) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
    }

    const events = auditService.query({ tenantId: merchantTenantId, limit: 50 });
    return res.json({
      success: true,
      scope: 'TENANT_SCOPED',
      tenantId: merchantTenantId,
      count: events.length,
      events,
    });
  });

  // 8. PROTECTED: Audit Chain Cryptographic Integrity Verification (Platform Admin ONLY)
  app.get('/api/audit/verify-integrity', requireAuth, requireRole(SystemRole.PLATFORM_ADMIN), (req: SoodaRequest, res: Response) => {
    const auditService = AuditLogService.getInstance();
    const result = auditService.verifyIntegrity();
    return res.json({
      success: true,
      cryptographicChainValid: result.valid,
      errors: result.errors,
      algorithm: 'SHA-256 Hash Chaining',
    });
  });

  // 9. PROTECTED: Active Tenants List (Platform Admin ONLY)
  app.get('/api/tenants', requireAuth, requireRole(SystemRole.PLATFORM_ADMIN), (req: SoodaRequest, res: Response) => {
    const stores = db.listStores();
    return res.json({
      success: true,
      stores,
    });
  });

  // 10. PROTECTED: Audit Log Stream (Platform Admin or Scoped Merchant)
  app.get('/api/audit/stream', requireAuth, (req: SoodaRequest, res: Response) => {
    const auditService = AuditLogService.getInstance();

    if (req.principal!.role === SystemRole.PLATFORM_ADMIN) {
      const events = auditService.getRecent(20);
      const integrity = auditService.verifyIntegrity();
      return res.json({
        success: true,
        scope: 'PLATFORM_WIDE',
        events,
        integrity,
      });
    }

    const merchantTenantId = req.principal!.tenantId;
    if (!merchantTenantId) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Tenant identifier missing from principal context.' },
      });
    }

    const events = auditService.query({ tenantId: merchantTenantId, limit: 20 });
    return res.json({
      success: true,
      scope: 'TENANT_SCOPED',
      tenantId: merchantTenantId,
      events,
      integrity: null, // Platform-wide cryptographic verification is restricted to Platform Admin
    });
  });

  // 11. DEVELOPMENT-ONLY TEST RUNNERS
  // Strictly disabled in production. Excluded completely from the routing table when NODE_ENV === 'production'.
  if (!isProduction && process.env.NODE_ENV !== 'production' && serverConfig.allowDevTestTokens) {
    const restoreOperationalDb = () => {
      try {
        const defaultPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'sooda.db');
        const operationalDb = Database.resetInstance(defaultPath);
        registerAuditDatabaseProvider(() => Database.getInstance());
        AuditLogService.resetInstance(operationalDb);
      } catch (err) {
        console.error('Failed to restore operational database after test execution:', err);
      }
    };

    app.get('/api/tests/phase0', async (req: SoodaRequest, res: Response) => {
      try {
        const { Phase0TestSuite } = await import('./src/tests/phase0.test.ts');
        const results = Phase0TestSuite.runAll();
        return res.json({
          success: true,
          results,
        });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: { message: err.message } });
      } finally {
        restoreOperationalDb();
      }
    });

    app.get('/api/tests/security', async (req: SoodaRequest, res: Response) => {
      try {
        const { runSecurityIntegrationTests } = await import('./src/tests/security.test.ts');
        const results = await runSecurityIntegrationTests();
        return res.json({
          success: true,
          results,
        });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: { message: err.message } });
      } finally {
        restoreOperationalDb();
      }
    });

    app.get('/api/tests/remediation', async (req: SoodaRequest, res: Response) => {
      try {
        const { RemediationTestSuite } = await import('./src/tests/phase0_remediation.test.ts');
        const results = await RemediationTestSuite.runAll();
        return res.json({
          success: true,
          results,
        });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: { message: err.message } });
      } finally {
        restoreOperationalDb();
      }
    });

    app.get('/api/tests/auth', async (req: SoodaRequest, res: Response) => {
      try {
        const { runAuthenticationTestSuite } = await import('./src/tests/authentication.test.ts');
        const results = await runAuthenticationTestSuite();
        return res.json({
          success: true,
          results,
        });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: { message: err.message } });
      } finally {
        restoreOperationalDb();
      }
    });

    app.get('/api/tests/stores', async (req: SoodaRequest, res: Response) => {
      try {
        const { runStoreManagementTestSuite } = await import('./src/tests/store_management.test.ts');
        const results = await runStoreManagementTestSuite();
        return res.json({
          success: true,
          results,
        });
      } catch (err: any) {
        return res.status(500).json({ success: false, error: { message: err.message } });
      } finally {
        restoreOperationalDb();
      }
    });
  }

  // 12. 404 Catch-All for Unregistered API Endpoints (Fail-Closed)
  app.all('/api/*', (req: Request, res: Response) => {
    return res.status(404).json({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `API endpoint '${req.method} ${req.path}' not found.`,
      },
    });
  });

  // Centralized Error Handler
  app.use('/api', (err: any, req: SoodaRequest, res: Response, next: NextFunction) => {
    const traceId = req.traceId || (req.headers['x-trace-id'] as string);
    const formatted = formatErrorResponse(err, isProduction, traceId);
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json(formatted);
  });

  return { app, isProduction, rateLimiter, sessionService, authService, storeManagementService, db };
}

async function startServer() {
  const { app, isProduction } = createApp();
  const PORT = 3000;

  // Vite middleware for development
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sooda SaaS Commerce Server running on http://0.0.0.0:${PORT}`);
  });
}

// Start if executed directly as the server (not imported as a test module)
const isTestExecution = process.argv.some(
  (arg) => arg.includes('.test.') || arg.includes('test:') || arg.includes('vitest')
);

if (!isTestExecution) {
  startServer().catch((err) => {
    console.error('Fatal Server Startup Error:', err);
    process.exit(1);
  });
}


