import { randomUUID } from 'node:crypto';
import { AuthVerifyError, extractBearerToken, type AuthVerifier } from '@tapanmeena/authkit-verify';

type VerifiedIdentity = Awaited<ReturnType<AuthVerifier['verifyToken']>>;

export interface TestTokenOptions {
  userId?: string;
  email: string;
  name?: string;
  emailVerified?: boolean;
  sessionId?: string;
  pool?: string;
  clientId?: string;
}

export function createTestAuthHarness(defaultPool = 'one-auth') {
  const tokens = new Map<string, VerifiedIdentity>();

  const authVerifier: AuthVerifier = {
    async verifyToken(token: string): Promise<VerifiedIdentity> {
      const identity = tokens.get(token);
      if (!identity) {
        throw new AuthVerifyError('TOKEN_INVALID', 'Invalid access token', 401);
      }
      if (identity.pool !== defaultPool) {
        throw new AuthVerifyError('POOL_MISMATCH', 'Token pool mismatch', 403);
      }
      return identity;
    },
    async verifyAuthorizationHeader(authorizationHeader): Promise<VerifiedIdentity> {
      const token = extractBearerToken(authorizationHeader);
      return authVerifier.verifyToken(token);
    },
  };

  function issueToken(options: TestTokenOptions): string {
    const token = `test-token-${randomUUID()}`;
    const userId = options.userId ?? `usr_${randomUUID()}`;
    const sessionId = options.sessionId ?? `ses_${randomUUID()}`;
    const pool = options.pool ?? defaultPool;
    const clientId = options.clientId ?? 'welyt-mobile';
    const email = options.email.trim().toLowerCase();
    const emailVerified = options.emailVerified ?? true;
    const nowSec = Math.floor(Date.now() / 1000);

    tokens.set(token, {
      userId,
      email,
      emailVerified,
      ...(options.name !== undefined ? { name: options.name } : {}),
      pool,
      clientId,
      sessionId,
      claims: {
        iss: 'https://auth.tapanmeena.com',
        sub: userId,
        aud: [`pool:${pool}`, `app:${clientId}`],
        pool,
        azp: clientId,
        sid: sessionId,
        email,
        email_verified: emailVerified,
        ...(options.name !== undefined ? { name: options.name } : {}),
        iat: nowSec,
        exp: nowSec + 900,
      },
    });

    return token;
  }

  function authHeader(options: TestTokenOptions): { authorization: string } {
    return { authorization: `Bearer ${issueToken(options)}` };
  }

  return {
    authVerifier,
    issueToken,
    authHeader,
  };
}
