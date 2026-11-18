import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { AUTH_ERROR_CODES } from '@welyt/shared';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import { loadApiEnv, type ApiEnv } from './config/env.ts';
import { createDatabase, type DatabaseConnection } from './db/client.ts';
import { AppError, zodToValidationError } from './lib/errors.ts';
import { createMailer, type Mailer } from './lib/mailer.ts';
import { registerAuthRoutes } from './modules/auth/auth.routes.ts';
import { AuthService } from './modules/auth/auth.service.ts';
import { FrankfurterProvider, LAUNCH_FX_CURRENCIES } from './modules/fx/frankfurter.provider.ts';
import { startDailyFxRefresh } from './modules/fx/fx.job.ts';
import { FxService } from './modules/fx/fx.service.ts';
import { createAuthGuards } from './plugins/auth-guard.ts';

declare module 'fastify' {
  interface FastifyInstance {
    authGuards: ReturnType<typeof createAuthGuards>;
    authService: AuthService;
  }
}

export interface BuildAppOptions extends FastifyServerOptions {
  env?: ApiEnv;
  database?: DatabaseConnection;
  mailer?: Mailer;
  enableRateLimit?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const {
    env: providedEnv,
    database: providedDatabase,
    mailer: providedMailer,
    enableRateLimit = true,
    ...fastifyOptions
  } = options;

  const env = providedEnv ?? loadApiEnv();
  const app = Fastify(fastifyOptions);

  if (env.usingFallbackDevSecret && env.nodeEnv !== 'test') {
    app.log.warn(
      'JWT_ACCESS_SECRET is not set; using local development fallback secret. Set JWT_ACCESS_SECRET before deploying.',
    );
  }

  const ownsDatabase = !providedDatabase;
  const database =
    providedDatabase ??
    createDatabase(env.nodeEnv === 'test' ? ':memory:' : env.databaseUrl, {
      runMigrations: true,
    });

  let stopFxRefresh: (() => Promise<void>) | undefined;
  if (env.nodeEnv !== 'test' && env.fxAutoRefresh) {
    const fx = new FxService(database.db, new FrankfurterProvider());
    app.addHook('onReady', async () => {
      stopFxRefresh = startDailyFxRefresh(
        () => fx.refreshLatestRates(LAUNCH_FX_CURRENCIES),
        app.log,
      );
    });
  }
  app.addHook('onClose', async () => {
    await stopFxRefresh?.();
    if (ownsDatabase) {
      database.close();
    }
  });

  const ownsMailer = !providedMailer;
  const mailer = providedMailer ?? createMailer(env, app.log);
  const authGuards = createAuthGuards(database.db, env);
  const authService = new AuthService(database.db, env, mailer);

  app.decorate('authGuards', authGuards);
  app.decorate('authService', authService);
  app.decorateRequest('auth', null);

  if (ownsMailer && mailer.close) {
    app.addHook('onClose', async () => {
      mailer.close?.();
    });
  }

  if (env.nodeEnv !== 'test') {
    app.addHook('onReady', async () => {
      authService.purgeExpiredRecords();
      if (ownsMailer && mailer.verifyConnection) {
        try {
          await mailer.verifyConnection();
          app.log.info('SMTP mailer connection verified');
        } catch (err) {
          app.log.error(
            err,
            'SMTP mailer verification failed. Check SMTP_USER and SMTP_PASS (Gmail App Password) in apps/api/.env',
          );
        }
      }
    });

    const cleanupTimer = setInterval(
      () => {
        try {
          authService.purgeExpiredRecords();
        } catch (err) {
          app.log.warn(err, 'Failed to purge expired auth records');
        }
      },
      60 * 60 * 1000,
    );
    cleanupTimer.unref();

    app.addHook('onClose', async () => {
      clearInterval(cleanupTimer);
    });
  }

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  await app.register(cors, {
    origin: env.corsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  if (enableRateLimit) {
    await app.register(rateLimit, {
      global: true,
      max: 120,
      timeWindow: '1 minute',
      errorResponseBuilder: (_request, context) => {
        const retrySeconds = Math.max(1, Math.ceil(context.ttl / 1000));
        const message = `Too many requests. Please try again in ${retrySeconds} seconds.`;
        return {
          statusCode: 429,
          message,
          error: {
            code: AUTH_ERROR_CODES.RATE_LIMITED,
            message,
          },
        };
      },
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(error.toResponse());
    }

    if (error instanceof z.ZodError) {
      const appErr = zodToValidationError(error);
      return reply.status(appErr.statusCode).send(appErr.toResponse());
    }

    const maybeFastifyError = error as { statusCode?: number; message?: string; error?: unknown };
    if (maybeFastifyError.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: AUTH_ERROR_CODES.RATE_LIMITED,
          message: maybeFastifyError.message ?? 'Too many requests. Please try again shortly.',
        },
      });
    }

    if (
      typeof maybeFastifyError.statusCode === 'number' &&
      maybeFastifyError.statusCode >= 400 &&
      maybeFastifyError.statusCode < 500
    ) {
      return reply.status(maybeFastifyError.statusCode).send({
        error: {
          code: AUTH_ERROR_CODES.VALIDATION_ERROR,
          message: maybeFastifyError.message ?? 'Bad request',
        },
      });
    }

    request.log.error(error, 'Unhandled server error');
    return reply.status(500).send({
      error: {
        code: AUTH_ERROR_CODES.INTERNAL_ERROR,
        message: 'An unexpected error occurred',
      },
    });
  });

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  await registerAuthRoutes(app, {
    authService,
    authGuards,
    db: database.db,
    env,
  });

  return app;
}
