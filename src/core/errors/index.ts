/**
 * Centralized Application Errors & Error Handling
 * Standardized error definitions ensuring safe error reporting
 * without leaking sensitive stack traces or internal secrets.
 */

export enum ErrorCode {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  TENANT_MISMATCH = 'TENANT_MISMATCH',
  TENANT_INACTIVE = 'TENANT_INACTIVE',
  BUSINESS_ERROR = 'BUSINESS_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  AUDIT_PERSISTENCE_FAILED = 'AUDIT_PERSISTENCE_FAILED',
  AUDIT_INTEGRITY_VIOLATION = 'AUDIT_INTEGRITY_VIOLATION',
}

export interface ErrorDetails {
  field?: string;
  code?: string;
  message: string;
  params?: Record<string, unknown>;
}

export interface SerializedError {
  success: false;
  code: ErrorCode;
  message: string;
  details?: ErrorDetails[];
  timestamp: string;
  traceId?: string;
}

export abstract class AppError extends Error {
  public abstract readonly statusCode: number;
  public abstract readonly code: ErrorCode;
  public readonly details?: ErrorDetails[];
  public readonly timestamp: string;

  constructor(message: string, details?: ErrorDetails[]) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(includeStack = false, traceId?: string): SerializedError {
    return {
      success: false,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      ...(traceId ? { traceId } : {}),
      ...(includeStack && this.stack ? { stack: this.stack } : {}),
    };
  }
}

export class ValidationError extends AppError {
  public readonly statusCode = 400;
  public readonly code = ErrorCode.VALIDATION_ERROR;
  constructor(message = 'Validation failed', details?: ErrorDetails[]) {
    super(message, details);
  }
}

export class AuthenticationError extends AppError {
  public readonly statusCode = 401;
  public readonly code = ErrorCode.AUTHENTICATION_ERROR;
  constructor(message = 'Authentication required', details?: ErrorDetails[]) {
    super(message, details);
  }
}

export class InvalidCredentialsError extends AuthenticationError {
  constructor(message = 'Invalid email or password.', details?: ErrorDetails[]) {
    super(message, details);
    this.name = 'InvalidCredentialsError';
  }
}

export class AccountLockedError extends AppError {
  public readonly statusCode = 403;
  public readonly code = ErrorCode.AUTHORIZATION_ERROR;
  constructor(message = 'Account is locked due to multiple failed login attempts. Please try again later.', details?: ErrorDetails[]) {
    super(message, details);
    this.name = 'AccountLockedError';
  }
}

export class AccountInactiveError extends AppError {
  public readonly statusCode = 403;
  public readonly code = ErrorCode.AUTHORIZATION_ERROR;
  constructor(message = 'Account is inactive or disabled.', details?: ErrorDetails[]) {
    super(message, details);
    this.name = 'AccountInactiveError';
  }
}

export class AuthorizationError extends AppError {
  public readonly statusCode = 403;
  public readonly code = ErrorCode.AUTHORIZATION_ERROR;
  constructor(message = 'Access denied: insufficient permissions', details?: ErrorDetails[]) {
    super(message, details);
  }
}

export class NotFoundError extends AppError {
  public readonly statusCode = 404;
  public readonly code = ErrorCode.NOT_FOUND;
  constructor(resource = 'Resource', id?: string) {
    super(`${resource}${id ? ` with id '${id}'` : ''} was not found`);
  }
}

export class TenantMismatchError extends AppError {
  public readonly statusCode = 403;
  public readonly code = ErrorCode.TENANT_MISMATCH;
  constructor(message = 'Access forbidden: cross-tenant operation strictly blocked') {
    super(message);
  }
}

export class TenantInactiveError extends AppError {
  public readonly statusCode = 403;
  public readonly code = ErrorCode.TENANT_INACTIVE;
  constructor(tenantId: string) {
    super(`Store tenant '${tenantId}' is currently inactive or suspended`);
  }
}

export class BusinessError extends AppError {
  public readonly statusCode = 422;
  public readonly code = ErrorCode.BUSINESS_ERROR;
  constructor(message: string, details?: ErrorDetails[]) {
    super(message, details);
  }
}

export class InternalServerError extends AppError {
  public readonly statusCode = 500;
  public readonly code = ErrorCode.INTERNAL_SERVER_ERROR;
  constructor(message = 'An unexpected server error occurred') {
    super(message);
  }
}

export class AuditPersistenceError extends AppError {
  public readonly statusCode = 500;
  public readonly code: ErrorCode = ErrorCode.AUDIT_PERSISTENCE_FAILED;
  constructor(message = 'Security audit persistence failed; operation aborted to ensure compliance', details?: ErrorDetails[]) {
    super(message, details);
  }
}

export class AuditIntegrityError extends AuditPersistenceError {
  public override readonly code: ErrorCode = ErrorCode.AUDIT_INTEGRITY_VIOLATION;
  constructor(message = 'Audit chain integrity violation detected', details?: ErrorDetails[]) {
    super(message, details);
    this.name = 'AuditIntegrityError';
  }
}

/**
 * Normalizes any caught error into a safe client-facing payload.
 * In production, suppresses unknown error message details to prevent data leakage.
 */
export function formatErrorResponse(err: unknown, isProduction = false, traceId?: string): SerializedError {
  if (err instanceof AppError) {
    return err.toJSON(!isProduction, traceId);
  }

  // Generic or unhandled exception
  const fallbackMessage = isProduction
    ? 'An unexpected error occurred. Please try again later.'
    : err instanceof Error
      ? err.message
      : 'Unknown internal error';

  return {
    success: false,
    code: ErrorCode.INTERNAL_SERVER_ERROR,
    message: fallbackMessage,
    timestamp: new Date().toISOString(),
    ...(traceId ? { traceId } : {}),
  };
}
