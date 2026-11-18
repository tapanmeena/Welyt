import {
  apiErrorResponseSchema,
  authSessionResponseSchema,
  authTokensSchema,
  authUserSchema,
  authVerifyEmailResponseSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  messageResponseSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from '@welyt/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
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
        openapi: {
          tags: ['Authentication'],
          summary: 'Register a new user account',
          description:
            'Creates an account, dispatches a 6-digit email verification code (logged to the API console when SMTP is not configured), and returns initial session tokens.',
          body: {
            schema: registerSchema,
            example: {
              name: 'Aarav Sharma',
              email: 'aarav@example.com',
              password: 'Password123',
              deviceName: 'Browser Dev',
            },
          },
          responses: {
            201: {
              schema: authSessionResponseSchema,
              description: 'Account created with initial session tokens',
            },
            409: {
              schema: apiErrorResponseSchema,
              description: 'Email address is already registered',
            },
          },
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
        openapi: {
          tags: ['Authentication'],
          summary: 'Sign in with email and password',
          description:
            'Authenticates user credentials and returns a session token pair. Copy `tokens.accessToken` into **Authorize** to test protected endpoints.',
          body: {
            schema: loginSchema,
            example: {
              email: 'aarav@example.com',
              password: 'Password123',
              deviceName: 'Browser Dev',
            },
          },
          responses: {
            200: {
              schema: authSessionResponseSchema,
              description: 'Authenticated session tokens and user profile',
            },
            401: {
              schema: apiErrorResponseSchema,
              description: 'Invalid email or password',
            },
          },
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
        openapi: {
          tags: ['Authentication'],
          summary: 'Rotate refresh token',
          description:
            'Exchanges a valid refresh token for a new access and refresh token pair. Reusing an already rotated refresh token revokes the entire session family.',
          body: {
            schema: refreshTokenSchema,
            example: {
              refreshToken: 'paste-refresh-token-here',
            },
          },
          responses: {
            200: {
              schema: z.object({ tokens: authTokensSchema }),
              description: 'Rotated token pair',
            },
            401: {
              schema: apiErrorResponseSchema,
              description: 'Invalid, revoked, or expired refresh token',
            },
          },
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

  app.post(
    '/auth/logout',
    {
      config: {
        openapi: {
          tags: ['Authentication'],
          summary: 'Sign out current session',
          description:
            'Revokes the session identified by the bearer token and/or the provided refresh token.',
          auth: 'optional',
          body: {
            schema: logoutSchema,
            example: {},
          },
          responses: {
            200: {
              schema: messageResponseSchema,
              description: 'Session signed out',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(logoutSchema, request.body);
      const claims = await resolveOptionalAuth(request, db, env);

      authService.logout({
        sessionId: claims?.sessionId,
        refreshToken: input.refreshToken,
      });

      return reply.status(200).send({ message: 'Signed out' });
    },
  );

  app.post(
    '/auth/logout-all',
    {
      preHandler: [authGuards.authenticate],
      config: {
        openapi: {
          tags: ['Authentication'],
          summary: 'Sign out from all devices',
          description: 'Revokes all active sessions belonging to the authenticated user.',
          auth: 'bearer',
          responses: {
            200: {
              schema: messageResponseSchema,
              description: 'All active sessions revoked',
            },
          },
        },
      },
    },
    async (request, reply) => {
      authService.logoutAll(request.auth!.userId);
      return reply.status(200).send({ message: 'Signed out from all devices' });
    },
  );

  app.get(
    '/auth/me',
    {
      preHandler: [authGuards.authenticate],
      config: {
        openapi: {
          tags: ['Authentication'],
          summary: 'Get current user profile',
          auth: 'bearer',
          responses: {
            200: {
              schema: z.object({ user: authUserSchema }),
              description: 'Current user profile',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'User not found',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = authService.getMe(request.auth!.userId);
      return reply.status(200).send({ user });
    },
  );

  app.patch(
    '/auth/me',
    {
      preHandler: [authGuards.authenticate],
      config: {
        openapi: {
          tags: ['Authentication'],
          summary: 'Update current user profile',
          auth: 'bearer',
          body: {
            schema: updateProfileSchema,
            example: {
              name: 'Aarav Sharma',
              debtMode: 'remaining_emis',
            },
          },
          responses: {
            200: {
              schema: z.object({ user: authUserSchema }),
              description: 'Updated user profile',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'User not found',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const input = parseBody(updateProfileSchema, request.body);
      const user = authService.updateProfile(request.auth!.userId, input);
      return reply.status(200).send({ user });
    },
  );

  app.post(
    '/auth/verify-email',
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '15 minutes',
        },
        openapi: {
          tags: ['Authentication'],
          summary: 'Verify email with 6-digit OTP',
          description:
            'Verifies the account email using the 6-digit OTP. When called with an active bearer token, `email` can be omitted and a refreshed verified `accessToken` is returned.',
          auth: 'optional',
          body: {
            schema: verifyEmailSchema,
            example: {
              code: '123456',
            },
          },
          responses: {
            200: {
              schema: authVerifyEmailResponseSchema,
              description: 'Email verified (includes a fresh accessToken when signed in)',
            },
            409: {
              schema: apiErrorResponseSchema,
              description: 'Email is already verified',
            },
          },
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
        openapi: {
          tags: ['Authentication'],
          summary: 'Resend email verification OTP',
          auth: 'bearer',
          responses: {
            200: {
              schema: messageResponseSchema,
              description: 'Verification OTP sent',
            },
            409: {
              schema: apiErrorResponseSchema,
              description: 'Email is already verified',
            },
          },
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
        openapi: {
          tags: ['Authentication'],
          summary: 'Request password reset OTP',
          description:
            'Sends a 6-digit password reset code if a matching account exists (logged to the API console when SMTP is not configured).',
          body: {
            schema: forgotPasswordSchema,
            example: {
              email: 'aarav@example.com',
            },
          },
          responses: {
            200: {
              schema: messageResponseSchema,
              description: 'Password reset instructions dispatched if account exists',
            },
          },
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
        openapi: {
          tags: ['Authentication'],
          summary: 'Reset password with 6-digit OTP',
          body: {
            schema: resetPasswordSchema,
            example: {
              email: 'aarav@example.com',
              code: '123456',
              newPassword: 'NewPassword123',
            },
          },
          responses: {
            200: {
              schema: messageResponseSchema,
              description: 'Password reset and existing sessions revoked',
            },
          },
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
        openapi: {
          tags: ['Authentication'],
          summary: 'Change password while signed in',
          description: 'Updates the password and revokes other active sessions.',
          auth: 'bearer',
          body: {
            schema: changePasswordSchema,
            example: {
              currentPassword: 'Password123',
              newPassword: 'NewPassword123',
            },
          },
          responses: {
            200: {
              schema: messageResponseSchema,
              description: 'Password updated',
            },
          },
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
