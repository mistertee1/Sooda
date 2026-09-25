/**
 * Centralized Configuration Management
 * Strict separation of public config, server-only config, and secrets.
 * Validates configuration safely without exposing sensitive details.
 */

import { z } from 'zod';

// Public Configuration schema (Safe to expose to client)
export const publicConfigSchema = z.object({
  appName: z.string().default('Sooda SaaS'),
  appVersion: z.string().default('0.1.0-alpha'),
  defaultLocale: z.enum(['ar', 'en']).default('ar'),
  defaultDirection: z.enum(['rtl', 'ltr']).default('rtl'),
  defaultCurrency: z.string().default('SDG'),
  supportedLocales: z.array(z.string()).default(['ar', 'en']),
  supportedCurrencies: z.array(z.string()).default(['SDG', 'USD', 'SAR', 'AED']),
  platformDomain: z.string().default('sooda.sd'),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;

// Server-only configuration schema
export const serverConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.number().default(3000),
  host: z.string().default('0.0.0.0'),
  sessionSecret: z.string().min(16).default('sooda-dev-session-secret-min-32-chars-key-2026'),
  enableAuditLogging: z.boolean().default(true),
  rateLimitMaxRequests: z.number().default(100),
  rateLimitWindowMs: z.number().default(60000),
  allowDevTestTokens: z.boolean().default(false),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private readonly publicConfig: PublicConfig;
  private readonly serverConfig: ServerConfig;

  private constructor() {
    // Validate public config
    const publicParsed = publicConfigSchema.safeParse({
      appName: 'Sooda SaaS',
      appVersion: '0.1.0-alpha',
      defaultLocale: 'ar',
      defaultDirection: 'rtl',
      defaultCurrency: 'SDG',
      platformDomain: 'sooda.sd',
    });

    if (!publicParsed.success) {
      throw new Error(`Invalid public configuration: ${JSON.stringify(publicParsed.error.format())}`);
    }
    this.publicConfig = publicParsed.data;

    // Determine environment safely
    const nodeEnv = (typeof process !== 'undefined' && process.env?.NODE_ENV) || 'development';
    const isProd = nodeEnv === 'production';
    
    // In production, test tokens are strictly locked out and can NEVER be enabled
    const allowTestTokens = !isProd && (
      process.env?.ALLOW_DEV_TEST_TOKENS === 'true' ||
      nodeEnv === 'development' ||
      nodeEnv === 'test'
    );

    // Determine session secret with strict fail-closed production enforcement
    const sessionSecret = (typeof process !== 'undefined' && process.env?.SESSION_SECRET) || 
      (isProd ? undefined : 'sooda-dev-session-secret-min-32-chars-key-2026');

    if (isProd && (!sessionSecret || sessionSecret === 'sooda-dev-session-secret-min-32-chars-key-2026')) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: SESSION_SECRET must be explicitly configured in production environments. Refusing to start with missing or default secret.'
      );
    }

    // Validate server config
    const serverParsed = serverConfigSchema.safeParse({
      nodeEnv,
      port: 3000,
      host: '0.0.0.0',
      sessionSecret: sessionSecret || 'sooda-dev-session-secret-min-32-chars-key-2026',
      enableAuditLogging: true,
      rateLimitMaxRequests: 100,
      rateLimitWindowMs: 60000,
      allowDevTestTokens: allowTestTokens,
    });

    if (!serverParsed.success) {
      throw new Error(`Invalid server configuration: ${JSON.stringify(serverParsed.error.format())}`);
    }
    this.serverConfig = serverParsed.data;
  }

  public static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  public getPublicConfig(): PublicConfig {
    return { ...this.publicConfig };
  }

  public getServerConfig(): ServerConfig {
    // Only accessible in node environment
    if (typeof window !== 'undefined') {
      throw new Error('Security Violation: Server configuration accessed from client-side context!');
    }
    return { ...this.serverConfig };
  }

  public static validateEnv(env: Record<string, string | undefined>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];
    if (env.PORT && isNaN(Number(env.PORT))) {
      errors.push('PORT must be a valid integer number');
    }
    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
