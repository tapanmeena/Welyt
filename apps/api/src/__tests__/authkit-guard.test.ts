import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, type TestContext } from 'node:test';
import { createAuthVerifier } from '@tapanmeena/authkit-verify';
import {
  AUTH_ERROR_CODES,
  apiErrorResponseSchema,
  authUserSchema,
  type ApiErrorResponseDto,
  type AuthUserDto,
} from '@welyt/shared';
import { eq } from 'drizzle-orm';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey } from 'jose';
import { buildApp } from '../app.ts';
import { loadApiEnv } from '../config/env.ts';
import { createDatabase } from '../db/client.ts';
import { accounts, incomeReceipts, users } from '../db/schema.ts';
import { createTestAuthHarness } from './test-auth.ts';

async function setupHarnessApp(t: TestContext) {
  const database = createDatabase(':memory:');
  const auth = createTestAuthHarness();
  const app = await buildApp({
    env: loadApiEnv({ NODE_ENV: 'test' }),
    database,
    authVerifier: auth.authVerifier,
    logger: false,
    enableRateLimit: false,
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      database.close();
    }
  });

  return { app, db: database.db, auth };
}

describe('AuthKit environment & JWKS token verification', () => {
  it('defaults AUTHKIT_ISSUER_URL and AUTHKIT_POOL_SLUG and allows production without JWT_ACCESS_SECRET', () => {
    const devEnv = loadApiEnv({ NODE_ENV: 'development' });
    assert.equal(devEnv.authkitIssuerUrl, 'https://auth.tapanmeena.com');
    assert.equal(devEnv.authkitPoolSlug, 'one-auth');

    const prodEnv = loadApiEnv({
      NODE_ENV: 'production',
      AUTHKIT_ISSUER_URL: 'https://auth.tapanmeena.com///',
      AUTHKIT_POOL_SLUG: 'one-auth',
    });
    assert.equal(prodEnv.authkitIssuerUrl, 'https://auth.tapanmeena.com');
    assert.equal(prodEnv.authkitPoolSlug, 'one-auth');
    assert.equal(prodEnv.jwtAccessSecret, undefined);
  });

  it('verifies real Ed25519 JWKS tokens via createAuthVerifier and rejects expired, wrong-pool, or forged tokens', async (t) => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const { privateKey: wrongPrivateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const publicJwk = await exportJWK(publicKey);
    const kid = 'test-ed25519-key-1';

    const jwksServer = createServer((req, res) => {
      if (req.url === '/.well-known/jwks.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            keys: [{ ...publicJwk, kid, alg: 'EdDSA', use: 'sig' }],
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });
    jwksServer.listen(0, '127.0.0.1');
    await once(jwksServer, 'listening');
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          jwksServer.close((err) => (err ? reject(err) : resolve())),
        ),
    );

    const { port } = jwksServer.address() as AddressInfo;
    const issuer = `http://127.0.0.1:${port}`;
    const env = loadApiEnv({
      NODE_ENV: 'test',
      AUTHKIT_ISSUER_URL: issuer,
      AUTHKIT_POOL_SLUG: 'one-auth',
    });

    const app = await buildApp({
      env,
      authVerifier: createAuthVerifier({
        issuer: env.authkitIssuerUrl,
        expectedPool: env.authkitPoolSlug,
      }),
      logger: false,
      enableRateLimit: false,
    });
    t.after(() => app.close());

    async function signToken(overrides: {
      sub?: string;
      pool?: string;
      email?: string;
      emailVerified?: boolean;
      name?: string;
      expiresInSeconds?: number;
      signingKey?: CryptoKey;
    }) {
      const pool = overrides.pool ?? 'one-auth';
      const nowSec = Math.floor(Date.now() / 1000);
      return new SignJWT({
        pool,
        azp: 'welyt-mobile',
        sid: `ses_${randomUUID()}`,
        email: overrides.email ?? 'aarav@example.com',
        email_verified: overrides.emailVerified ?? true,
        ...(overrides.name !== undefined ? { name: overrides.name } : {}),
      })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt', kid })
        .setIssuer(issuer)
        .setSubject(overrides.sub ?? 'usr_ed25519_1')
        .setAudience([`pool:${pool}`, 'app:welyt-mobile'])
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + (overrides.expiresInSeconds ?? 900))
        .sign(overrides.signingKey ?? privateKey);
    }

    // Missing header -> 401
    const missingRes = await app.inject({ url: '/auth/me' });
    assert.equal(missingRes.statusCode, 401);
    assert.equal(
      apiErrorResponseSchema.parse(missingRes.json()).error.code,
      AUTH_ERROR_CODES.UNAUTHORIZED,
    );

    // Malformed header -> 401
    const malformedRes = await app.inject({
      url: '/auth/me',
      headers: { authorization: 'Basic abc123' },
    });
    assert.equal(malformedRes.statusCode, 401);

    // Forged signature -> 401
    const forgedToken = await signToken({ signingKey: wrongPrivateKey });
    const forgedRes = await app.inject({
      url: '/auth/me',
      headers: { authorization: `Bearer ${forgedToken}` },
    });
    assert.equal(forgedRes.statusCode, 401);

    // Expired token -> 401
    const expiredToken = await signToken({ expiresInSeconds: -60 });
    const expiredRes = await app.inject({
      url: '/auth/me',
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    assert.equal(expiredRes.statusCode, 401);

    // Wrong pool -> 401
    const wrongPoolToken = await signToken({ pool: 'other-pool' });
    const wrongPoolRes = await app.inject({
      url: '/auth/me',
      headers: { authorization: `Bearer ${wrongPoolToken}` },
    });
    assert.equal(wrongPoolRes.statusCode, 401);

    // Valid token -> 200
    const validToken = await signToken({
      sub: 'usr_ed25519_valid',
      email: 'aarav@example.com',
      name: 'Aarav Sharma',
      emailVerified: true,
    });
    const validRes = await app.inject({
      url: '/auth/me',
      headers: { authorization: `Bearer ${validToken}` },
    });
    assert.equal(validRes.statusCode, 200, validRes.body);
    const { user } = validRes.json<{ user: AuthUserDto }>();
    assert.equal(user.id, 'usr_ed25519_valid');
    assert.equal(user.email, 'aarav@example.com');
    assert.equal(user.name, 'Aarav Sharma');
    assert.equal(user.debtMode, 'remaining_emis');
    assert.ok(user.emailVerifiedAt);
  });
});

describe('Local user provisioning, email linking, verified guard, and /auth/me', () => {
  it('lazy-provisions new AuthKit users and falls back to email prefix when name claim is absent', async (t) => {
    const { app, db, auth } = await setupHarnessApp(t);

    const headers = auth.authHeader({
      userId: 'usr_new_authkit',
      email: 'priya.nair@example.com',
      emailVerified: true,
    });

    const meRes = await app.inject({ url: '/auth/me', headers });
    assert.equal(meRes.statusCode, 200, meRes.body);
    const user = authUserSchema.parse(meRes.json<{ user: unknown }>().user);
    assert.equal(user.id, 'usr_new_authkit');
    assert.equal(user.email, 'priya.nair@example.com');
    assert.equal(user.name, 'priya.nair');
    assert.equal(user.debtMode, 'remaining_emis');
    assert.ok(user.emailVerifiedAt);

    const stored = db.select().from(users).where(eq(users.id, 'usr_new_authkit')).get();
    assert.ok(stored);
    assert.equal(stored.passwordHash, 'authkit-managed');
  });

  it('links existing Welyt users by email while preserving their users.id, debtMode, and financial records', async (t) => {
    const { app, db, auth } = await setupHarnessApp(t);
    const legacyUserId = 'legacy-welyt-user-uuid';
    const createdAt = '2025-01-10T08:00:00.000Z';

    db.insert(users)
      .values({
        id: legacyUserId,
        email: 'legacy.owner@example.com',
        name: 'Legacy Name',
        passwordHash: 'scrypt$16384$8$1$deadbeef$cafebabe',
        debtMode: 'outstanding_principal',
        emailVerifiedAt: null,
        createdAt,
        updatedAt: createdAt,
      })
      .run();

    const accountId = randomUUID();
    db.insert(accounts)
      .values({
        id: accountId,
        userId: legacyUserId,
        name: 'Existing Savings',
        kind: 'bank',
        currencyCode: 'INR',
        inNetWorth: true,
        createdAt,
        updatedAt: createdAt,
      })
      .run();

    const receiptId = randomUUID();
    db.insert(incomeReceipts)
      .values({
        id: receiptId,
        userId: legacyUserId,
        receivedDate: '2025-04-01',
        type: 'Salary',
        source: 'Legacy Corp',
        currencyCode: 'INR',
        amountHundredths: 250_000_00,
        createdAt,
      })
      .run();

    // Authenticate with a brand-new AuthKit sub but matching email
    const headers = auth.authHeader({
      userId: 'usr_authkit_different_sub',
      email: 'Legacy.Owner@Example.com',
      name: 'Updated AuthKit Name',
      emailVerified: true,
    });

    const meRes = await app.inject({ url: '/auth/me', headers });
    assert.equal(meRes.statusCode, 200, meRes.body);
    const { user } = meRes.json<{ user: AuthUserDto }>();
    assert.equal(user.id, legacyUserId);
    assert.equal(user.email, 'legacy.owner@example.com');
    assert.equal(user.name, 'Updated AuthKit Name');
    assert.equal(user.debtMode, 'outstanding_principal');
    assert.ok(user.emailVerifiedAt);

    // Ensure no second row was inserted in users
    const allUsers = db.select().from(users).all();
    assert.equal(allUsers.length, 1);

    // Verify existing accounts and income records remain accessible under linked user
    const accountsRes = await app.inject({ url: '/accounts', headers });
    assert.equal(accountsRes.statusCode, 200, accountsRes.body);
    assert.equal(accountsRes.json<Array<{ id: string }>>()[0]?.id, accountId);

    const incomeRes = await app.inject({ url: '/income', headers });
    assert.equal(incomeRes.statusCode, 200, incomeRes.body);
    assert.equal(incomeRes.json<Array<{ id: string }>>()[0]?.id, receiptId);
  });

  it('blocks unverified tokens with 403 EMAIL_NOT_VERIFIED on verified routes until refreshed with emailVerified: true', async (t) => {
    const { app, auth } = await setupHarnessApp(t);

    const unverifiedHeaders = auth.authHeader({
      userId: 'usr_pending_verify',
      email: 'pending@example.com',
      name: 'Pending User',
      emailVerified: false,
    });

    // /auth/me is accessible to authenticated unverified users
    const meUnverified = await app.inject({ url: '/auth/me', headers: unverifiedHeaders });
    assert.equal(meUnverified.statusCode, 200, meUnverified.body);
    assert.equal(meUnverified.json<{ user: AuthUserDto }>().user.emailVerifiedAt, null);

    // Verified financial endpoints reject with 403 EMAIL_NOT_VERIFIED
    const blockedAccounts = await app.inject({ url: '/accounts', headers: unverifiedHeaders });
    assert.equal(blockedAccounts.statusCode, 403);
    assert.equal(
      blockedAccounts.json<ApiErrorResponseDto>().error.code,
      AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
    );

    // After verifying email on AuthKit and refreshing token, emailVerified becomes true
    const verifiedHeaders = auth.authHeader({
      userId: 'usr_pending_verify',
      email: 'pending@example.com',
      name: 'Pending User',
      emailVerified: true,
    });

    const allowedAccounts = await app.inject({ url: '/accounts', headers: verifiedHeaders });
    assert.equal(allowedAccounts.statusCode, 200, allowedAccounts.body);

    const meVerified = await app.inject({ url: '/auth/me', headers: verifiedHeaders });
    assert.equal(meVerified.statusCode, 200);
    assert.ok(meVerified.json<{ user: AuthUserDto }>().user.emailVerifiedAt);

    // Also allow access when localUser.emailVerifiedAt is already set even if token claim is false
    const staleClaimHeaders = auth.authHeader({
      userId: 'usr_pending_verify',
      email: 'pending@example.com',
      name: 'Pending User',
      emailVerified: false,
    });
    const staleClaimAllowed = await app.inject({ url: '/accounts', headers: staleClaimHeaders });
    assert.equal(staleClaimAllowed.statusCode, 200, staleClaimAllowed.body);
  });

  it('reads and updates debtMode and name via GET/PATCH /auth/me and retires legacy password/OTP routes', async (t) => {
    const { app, auth } = await setupHarnessApp(t);
    const headers = auth.authHeader({
      userId: 'usr_profile_test',
      email: 'profile@example.com',
      name: 'Initial Name',
      emailVerified: true,
    });

    const initial = await app.inject({ url: '/auth/me', headers });
    assert.equal(initial.statusCode, 200);
    assert.equal(initial.json<{ user: AuthUserDto }>().user.debtMode, 'remaining_emis');

    const emptyPatch = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers,
      payload: {},
    });
    assert.equal(emptyPatch.statusCode, 400);
    assert.equal(
      emptyPatch.json<ApiErrorResponseDto>().error.code,
      AUTH_ERROR_CODES.VALIDATION_ERROR,
    );

    const updated = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers,
      payload: {
        name: 'Updated Name',
        debtMode: 'outstanding_principal',
      },
    });
    assert.equal(updated.statusCode, 200, updated.body);
    const updatedUser = authUserSchema.parse(updated.json<{ user: unknown }>().user);
    assert.equal(updatedUser.name, 'Updated Name');
    assert.equal(updatedUser.debtMode, 'outstanding_principal');

    const reread = await app.inject({ url: '/auth/me', headers });
    assert.equal(reread.statusCode, 200);
    assert.equal(reread.json<{ user: AuthUserDto }>().user.name, 'Updated Name');
    assert.equal(reread.json<{ user: AuthUserDto }>().user.debtMode, 'outstanding_principal');

    for (const retiredUrl of [
      '/auth/login',
      '/auth/register',
      '/auth/refresh',
      '/auth/verify-email',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/auth/change-password',
    ]) {
      const res = await app.inject({ method: 'POST', url: retiredUrl, payload: {} });
      assert.equal(res.statusCode, 404, `Expected ${retiredUrl} to return 404`);
    }
  });
});
