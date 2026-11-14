import { z } from 'zod';

const DEFAULT_DEV_JWT_SECRET = 'welyt-dev-only-jwt-secret-change-before-production';

const rawEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().trim().min(1).default('./data/welyt.db'),
  JWT_ACCESS_SECRET: z.string().optional(),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(60),
  APP_SCHEME: z.string().trim().min(1).default('welyt'),
  CORS_ORIGINS: z.string().trim().default('*'),
  MAILER_PROVIDER: z.enum(['auto', 'smtp', 'console']).default('auto'),
  SMTP_HOST: z.string().trim().min(1).default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
  SMTP_USER: z.string().trim().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().trim().optional(),
});

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface ApiEnv {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  jwtAccessSecret: string;
  usingFallbackDevSecret: boolean;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  otpTtlMinutes: number;
  otpMaxAttempts: number;
  otpResendCooldownSeconds: number;
  appScheme: string;
  corsOrigins: string[] | true;
  mailerProvider: 'smtp' | 'console';
  smtp: SmtpConfig | null;
}

export function loadApiEnv(raw: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = rawEnvSchema.parse(raw);

  const explicitSecret = parsed.JWT_ACCESS_SECRET?.trim();
  if (parsed.NODE_ENV === 'production') {
    if (!explicitSecret || explicitSecret.length < 32) {
      throw new Error('JWT_ACCESS_SECRET must be set to at least 32 characters in production');
    }
  } else if (explicitSecret && explicitSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters when provided');
  }

  const jwtAccessSecret = explicitSecret || DEFAULT_DEV_JWT_SECRET;
  const usingFallbackDevSecret = !explicitSecret;

  const corsOrigins =
    parsed.CORS_ORIGINS === '*'
      ? true
      : parsed.CORS_ORIGINS.split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0);

  const smtpUser = parsed.SMTP_USER && parsed.SMTP_USER.length > 0 ? parsed.SMTP_USER : undefined;
  const trimmedSmtpPass = parsed.SMTP_PASS?.trim();
  const rawSmtpPass = trimmedSmtpPass && trimmedSmtpPass.length > 0 ? trimmedSmtpPass : undefined;
  const isGmailHost = parsed.SMTP_HOST.toLowerCase() === 'smtp.gmail.com';
  const smtpPass = rawSmtpPass && isGmailHost ? rawSmtpPass.replace(/\s+/g, '') : rawSmtpPass;

  if ((smtpUser && !smtpPass) || (!smtpUser && smtpPass)) {
    throw new Error('Both SMTP_USER and SMTP_PASS must be set together when configuring SMTP');
  }

  const mailerProvider: 'smtp' | 'console' =
    parsed.MAILER_PROVIDER === 'smtp'
      ? 'smtp'
      : parsed.MAILER_PROVIDER === 'console'
        ? 'console'
        : smtpUser && smtpPass
          ? 'smtp'
          : 'console';

  if (mailerProvider === 'smtp' && (!smtpUser || !smtpPass)) {
    throw new Error('SMTP_USER and SMTP_PASS are required when MAILER_PROVIDER is set to smtp');
  }

  const smtp: SmtpConfig | null =
    mailerProvider === 'smtp' && smtpUser && smtpPass
      ? {
          host: parsed.SMTP_HOST,
          port: parsed.SMTP_PORT,
          secure:
            parsed.SMTP_SECURE !== undefined
              ? parsed.SMTP_SECURE === 'true'
              : parsed.SMTP_PORT === 465,
          user: smtpUser,
          pass: smtpPass,
          from:
            parsed.SMTP_FROM && parsed.SMTP_FROM.length > 0
              ? parsed.SMTP_FROM
              : `Welyt <${smtpUser}>`,
        }
      : null;

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    jwtAccessSecret,
    usingFallbackDevSecret,
    accessTokenTtlSeconds: parsed.ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlDays: parsed.REFRESH_TOKEN_TTL_DAYS,
    otpTtlMinutes: parsed.OTP_TTL_MINUTES,
    otpMaxAttempts: parsed.OTP_MAX_ATTEMPTS,
    otpResendCooldownSeconds: parsed.OTP_RESEND_COOLDOWN_SECONDS,
    appScheme: parsed.APP_SCHEME,
    corsOrigins,
    mailerProvider,
    smtp,
  };
}
