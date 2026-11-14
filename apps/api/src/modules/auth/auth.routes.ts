import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@welyt/shared';
import type { FastifyInstance } from 'fastify';
import type { ApiEnv } from '../../config/env.ts';
import type { AppDatabase } from '../../db/client.ts';
import { zodToValidationError } from '../../lib/errors.ts';
import { resolveOptionalAuth, type createAuthGuards } from '../../plugins/auth-guard.ts';
import { AuthService, type SessionClientMeta } from './auth.service.ts';

function parseBody<T>(
  schema: {
    safeParse: (
      val: unknown,
    ) => { success: true; data: T } | { success: false; error: import('zod').ZodError };
  },
  body: unknown,
): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw zodToValidationError(parsed.error);
  }
  return parsed.data;
}

function getClientMeta(
  ip: string,
  userAgentHeader: string | string[] | undefined,
): SessionClientMeta {
  const userAgent = Array.isArray(userAgentHeader) ? userAgentHeader[0] : userAgentHeader;
  return {
    ipAddress: ip,
    userAgent,
  };
}

export interface RegisterAuthRoutesDeps {
  authService: AuthService;
  authGuards: ReturnType<typeof createAuthGuards>;
  db: AppDatabase;
  env: ApiEnv;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: RegisterAuthRoutesDeps,
): Promise<void> {
  const { authService, authGuards, db, env } = deps;

  app.post(
    '/auth/register',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(registerSchema, request.body);
      const result = await authService.register(
        input,
        getClientMeta(request.ip, request.headers['user-agent']),
      );
      return reply.status(201).send(result);
    },
  );

  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(loginSchema, request.body);
      const result = await authService.login(
        input,
        getClientMeta(request.ip, request.headers['user-agent']),
      );
      return reply.status(200).send(result);
    },
  );

  app.post(
    '/auth/refresh',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(refreshTokenSchema, request.body);
      const tokens = await authService.refresh(
        input.refreshToken,
        getClientMeta(request.ip, request.headers['user-agent']),
      );
      return reply.status(200).send({ tokens });
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const input = parseBody(logoutSchema, request.body);
    const claims = await resolveOptionalAuth(request, db, env);

    authService.logout({
      sessionId: claims?.sessionId,
      refreshToken: input.refreshToken,
    });

    return reply.status(200).send({ message: 'Signed out' });
  });

  app.post(
    '/auth/logout-all',
    { preHandler: [authGuards.authenticate] },
    async (request, reply) => {
      authService.logoutAll(request.auth!.userId);
      return reply.status(200).send({ message: 'Signed out from all devices' });
    },
  );

  app.get('/auth/me', { preHandler: [authGuards.authenticate] }, async (request, reply) => {
    const user = authService.getMe(request.auth!.userId);
    return reply.status(200).send({ user });
  });

  app.patch('/auth/me', { preHandler: [authGuards.authenticate] }, async (request, reply) => {
    const input = parseBody(updateProfileSchema, request.body);
    const user = authService.updateProfile(request.auth!.userId, input);
    return reply.status(200).send({ user });
  });

  app.post(
    '/auth/verify-email',
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(verifyEmailSchema, request.body);
      const claims = await resolveOptionalAuth(request, db, env);
      const result = await authService.verifyEmail(input, claims);
      return reply.status(200).send(result);
    },
  );

  app.post(
    '/auth/resend-verification',
    {
      preHandler: [authGuards.authenticate],
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const result = await authService.resendVerification(request.auth!.userId);
      return reply.status(200).send(result);
    },
  );

  app.post(
    '/auth/forgot-password',
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(forgotPasswordSchema, request.body);
      const result = await authService.forgotPassword(input);
      return reply.status(200).send(result);
    },
  );

  app.post(
    '/auth/reset-password',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(resetPasswordSchema, request.body);
      const result = await authService.resetPassword(input);
      return reply.status(200).send(result);
    },
  );

  app.post(
    '/auth/change-password',
    {
      preHandler: [authGuards.authenticate],
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(changePasswordSchema, request.body);
      const result = await authService.changePassword(
        request.auth!.userId,
        request.auth!.sessionId,
        input,
      );
      return reply.status(200).send(result);
    },
  );
}
