import { apiErrorResponseSchema, authUserSchema, updateProfileSchema } from '@welyt/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { zodToValidationError } from '../../lib/errors.ts';
import type { createAuthGuards } from '../../plugins/auth-guard.ts';
import type { AuthService } from './auth.service.ts';

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

export interface RegisterAuthRoutesDeps {
  authService: AuthService;
  authGuards: ReturnType<typeof createAuthGuards>;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: RegisterAuthRoutesDeps,
): Promise<void> {
  const { authService, authGuards } = deps;

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
      reply.header('Cache-Control', 'no-store');
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
      reply.header('Cache-Control', 'no-store');
      const input = parseBody(updateProfileSchema, request.body);
      const user = authService.updateProfile(request.auth!.userId, input);
      return reply.status(200).send({ user });
    },
  );
}
