import type { AuthVerifier } from '@tapanmeena/authkit-verify';
import { AUTH_ERROR_CODES } from '@welyt/shared';
import { eq } from 'drizzle-orm';
import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { AppDatabase } from '../db/client.ts';
import { users, type UserRecord } from '../db/schema.ts';
import { AppError } from '../lib/errors.ts';

export interface RequestAuth {
  userId: string;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: RequestAuth | null;
  }
}

type VerifiedIdentity = Awaited<ReturnType<AuthVerifier['verifyAuthorizationHeader']>>;

interface ResolvedRequestAuth {
  auth: RequestAuth;
  emailVerified: boolean;
}

const AUTHKIT_MANAGED_PASSWORD_HASH = 'authkit-managed';
const resolvedAuthCache = new WeakMap<FastifyRequest, ResolvedRequestAuth>();

function deriveDefaultName(email: string): string {
  const prefix = email.split('@')[0]?.trim();
  return prefix || 'User';
}

function ensureLocalUser(db: AppDatabase, verified: VerifiedIdentity): UserRecord {
  const normalizedEmail = verified.email.trim().toLowerCase();
  const incomingName = verified.name?.trim();
  const now = new Date().toISOString();

  return db.transaction((tx) => {
    const existingById = tx.select().from(users).where(eq(users.id, verified.userId)).get();
    if (existingById) {
      if (verified.emailVerified && !existingById.emailVerifiedAt) {
        tx.update(users)
          .set({
            emailVerifiedAt: now,
            updatedAt: now,
          })
          .where(eq(users.id, existingById.id))
          .run();

        const refreshed = tx.select().from(users).where(eq(users.id, existingById.id)).get();
        if (refreshed) {
          return refreshed;
        }
      }
      return existingById;
    }

    const existingByEmail = tx.select().from(users).where(eq(users.email, normalizedEmail)).get();
    if (existingByEmail) {
      const shouldVerifyEmail = verified.emailVerified && !existingByEmail.emailVerifiedAt;
      const shouldUpdateName = Boolean(incomingName && incomingName !== existingByEmail.name);

      if (shouldVerifyEmail || shouldUpdateName) {
        tx.update(users)
          .set({
            ...(shouldVerifyEmail ? { emailVerifiedAt: now } : {}),
            ...(shouldUpdateName && incomingName ? { name: incomingName } : {}),
            updatedAt: now,
          })
          .where(eq(users.id, existingByEmail.id))
          .run();

        const refreshed = tx.select().from(users).where(eq(users.id, existingByEmail.id)).get();
        if (refreshed) {
          return refreshed;
        }
      }
      return existingByEmail;
    }

    const resolvedName = incomingName || deriveDefaultName(normalizedEmail);
    tx.insert(users)
      .values({
        id: verified.userId,
        email: normalizedEmail,
        name: resolvedName,
        passwordHash: AUTHKIT_MANAGED_PASSWORD_HASH,
        debtMode: 'remaining_emis',
        emailVerifiedAt: verified.emailVerified ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const created = tx.select().from(users).where(eq(users.id, verified.userId)).get();
    if (!created) {
      throw new AppError(500, AUTH_ERROR_CODES.INTERNAL_ERROR, 'Failed to provision local user');
    }
    return created;
  });
}

export async function resolveOptionalAuth(
  request: FastifyRequest,
  db: AppDatabase,
  authVerifier: AuthVerifier,
): Promise<RequestAuth | null> {
  const cached = resolvedAuthCache.get(request);
  if (cached) {
    request.auth = cached.auth;
    return cached.auth;
  }

  const authorization = request.headers.authorization;
  if (!authorization || (Array.isArray(authorization) && authorization.length === 0)) {
    return null;
  }

  let verified: VerifiedIdentity;
  try {
    verified = await authVerifier.verifyAuthorizationHeader(authorization);
  } catch {
    return null;
  }

  const localUser = ensureLocalUser(db, verified);
  const auth: RequestAuth = {
    userId: localUser.id,
    sessionId: verified.sessionId,
  };
  const emailVerified = verified.emailVerified || Boolean(localUser.emailVerifiedAt);

  resolvedAuthCache.set(request, { auth, emailVerified });
  request.auth = auth;
  return auth;
}

export function createAuthGuards(db: AppDatabase, authVerifier: AuthVerifier) {
  const authenticate: preHandlerAsyncHookHandler = async (request) => {
    const auth = await resolveOptionalAuth(request, db, authVerifier);
    if (!auth) {
      throw new AppError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Authentication required');
    }
    request.auth = auth;
  };

  const requireVerifiedEmail: preHandlerAsyncHookHandler = async (request) => {
    if (!request.auth) {
      const auth = await resolveOptionalAuth(request, db, authVerifier);
      if (!auth) {
        throw new AppError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Authentication required');
      }
      request.auth = auth;
    }

    const cached = resolvedAuthCache.get(request);
    if (cached) {
      if (!cached.emailVerified) {
        throw new AppError(
          403,
          AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
          'Please verify your email address before continuing',
        );
      }
      return;
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
