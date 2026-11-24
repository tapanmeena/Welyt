import { z } from 'zod';

const DEFAULT_AUTHKIT_ISSUER_URL = 'https://auth.tapanmeena.com';
const DEFAULT_AUTHKIT_POOL_SLUG = 'one-auth';

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY: z
    .string()
    .trim()
    .default('')
    .transform((value) => (value === '' ? [] : value.split(',').map((entry) => entry.trim())))
    .pipe(z.array(z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]))),
  DATABASE_URL: z.string().trim().min(1).default('./data/welyt.db'),
  AUTHKIT_ISSUER_URL: z
    .string()
    .trim()
    .default(DEFAULT_AUTHKIT_ISSUER_URL)
    .transform((value) => (value === '' ? DEFAULT_AUTHKIT_ISSUER_URL : value).replace(/\/+$/, ''))
    .pipe(z.url()),
  AUTHKIT_POOL_SLUG: z
    .string()
    .trim()
    .default(DEFAULT_AUTHKIT_POOL_SLUG)
    .transform((value) => (value === '' ? DEFAULT_AUTHKIT_POOL_SLUG : value))
    .pipe(z.string().min(1)),
  JWT_ACCESS_SECRET: z.string().optional(),
  APP_SCHEME: z.string().trim().min(1).default('welyt'),
  CORS_ORIGINS: z.string().trim().default('*'),
  FX_AUTO_REFRESH: z.enum(['true', 'false']).default('true'),
  API_DOCS_ENABLED: z.enum(['true', 'false']).optional(),
});

export interface ApiEnv {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  trustProxy: string[] | false;
  databaseUrl: string;
  authkitIssuerUrl: string;
  authkitPoolSlug: string;
  jwtAccessSecret?: string | undefined;
  appScheme: string;
  corsOrigins: string[] | true;
  fxAutoRefresh: boolean;
  apiDocsEnabled: boolean;
}

export function loadApiEnv(raw: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = rawEnvSchema.parse(raw);

  const explicitSecret = parsed.JWT_ACCESS_SECRET?.trim();
  const jwtAccessSecret = explicitSecret && explicitSecret.length > 0 ? explicitSecret : undefined;

  const corsOrigins =
    parsed.CORS_ORIGINS === '*'
      ? true
      : parsed.CORS_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    trustProxy: parsed.TRUST_PROXY.length > 0 ? parsed.TRUST_PROXY : false,
    databaseUrl: parsed.DATABASE_URL,
    authkitIssuerUrl: parsed.AUTHKIT_ISSUER_URL,
    authkitPoolSlug: parsed.AUTHKIT_POOL_SLUG,
    jwtAccessSecret,
    appScheme: parsed.APP_SCHEME,
    corsOrigins,
    fxAutoRefresh: parsed.FX_AUTO_REFRESH === 'true',
    apiDocsEnabled:
      parsed.API_DOCS_ENABLED !== undefined
        ? parsed.API_DOCS_ENABLED === 'true'
        : parsed.NODE_ENV === 'development',
  };
}
