import { AUTH_ERROR_CODES } from '@welyt/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { ApiEnv } from '../config/env.ts';
import type { AppDatabase } from '../db/client.ts';
import { authSessions, users } from '../db/schema.ts';
import { verifyAccessToken, type AccessTokenClaims } from '../lib/crypto.ts';
import { AppError } from '../lib/errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AccessTokenClaims | null;
  }
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) {
    return null;
  }
  const [scheme, token, extra] = authorizationHeader.trim().split(/\s+/);
  if (!scheme || !token || extra !== undefined || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  return token;
}

export async function resolveOptionalAuth(
  request: FastifyRequest,
  db: AppDatabase,
  env: ApiEnv,
): Promise<AccessTokenClaims | null> {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    return null;
  }

  const claims = await verifyAccessToken(token, env.jwtAccessSecret);
  if (!claims) {
    return null;
  }

  const session = db
    .select({
      id: authSessions.id,
      userId: authSessions.userId,
      revokedAt: authSessions.revokedAt,
      expiresAt: authSessions.expiresAt,
    })
    .from(authSessions)
    .where(eq(authSessions.id, claims.sessionId))
    .get();

  if (!session || session.userId !== claims.userId || session.revokedAt !== null) {
    return null;
  }

  if (Date.parse(session.expiresAt) <= Date.now()) {
    return null;
  }

  return claims;
}

export function createAuthGuards(db: AppDatabase, env: ApiEnv) {
  const authenticate: preHandlerAsyncHookHandler = async (request) => {
    const claims = await resolveOptionalAuth(request, db, env);
    if (!claims) {
      throw new AppError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Authentication required');
    }
    request.auth = claims;
  };

  const requireVerifiedEmail: preHandlerAsyncHookHandler = async (request) => {
    if (!request.auth) {
      const claims = await resolveOptionalAuth(request, db, env);
      if (!claims) {
        throw new AppError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Authentication required');
      }
      request.auth = claims;
    }

    const user = db
      .select({ emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, request.auth.userId))
      .get();

    if (!user) {
      throw new AppError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Authentication required');
    }

    if (!user.emailVerifiedAt) {
      throw new AppError(
        403,
        AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
        'Please verify your email address before continuing',
      );
    }
  };

  return {
    authenticate,
    requireVerifiedEmail,
  };
}
