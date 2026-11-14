import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  AUTH_ERROR_CODES,
  type ApiErrorResponseDto,
  type AuthSessionResponseDto,
  type AuthTokensDto,
  type AuthUserDto,
} from '@welyt/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { loadApiEnv } from '../config/env.ts';
import { MemoryMailer } from '../lib/mailer.ts';

describe('Core authentication & session lifecycle', () => {
  let app: FastifyInstance;
  let mailer: MemoryMailer;

  beforeEach(async () => {
    mailer = new MemoryMailer();
    const env = loadApiEnv({
      NODE_ENV: 'test',
      DATABASE_URL: ':memory:',
      JWT_ACCESS_SECRET: 'test-secret-with-more-than-thirty-two-characters',
      OTP_RESEND_COOLDOWN_SECONDS: '0',
    });

    app = await buildApp({
      logger: false,
      env,
      mailer,
      enableRateLimit: false,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers a user, normalizes email, sends verification code, and returns session tokens', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: '  Aarav Sharma  ',
        email: '  Aarav.Sharma@Example.com ',
        password: 'Password123',
        deviceName: 'iPhone 16',
      },
    });

    assert.equal(response.statusCode, 201);
    const body = response.json<AuthSessionResponseDto>();
    assert.equal(body.user.name, 'Aarav Sharma');
    assert.equal(body.user.email, 'aarav.sharma@example.com');
    assert.equal(body.user.debtMode, 'remaining_emis');
    assert.equal(body.user.emailVerifiedAt, null);
    assert.ok(body.tokens.accessToken.length > 20);
    assert.ok(body.tokens.refreshToken.length > 20);
    assert.equal(mailer.verifications.length, 1);
    assert.equal(mailer.verifications[0]?.to, 'aarav.sharma@example.com');
    assert.match(mailer.verifications[0]?.code ?? '', /^\d{6}$/);

    const duplicate = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Aarav Duplicate',
        email: 'aarav.sharma@example.com',
        password: 'Password123',
      },
    });

    assert.equal(duplicate.statusCode, 409);
    assert.equal(
      duplicate.json<ApiErrorResponseDto>().error.code,
      AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE,
    );
  });

  it('authenticates valid login, rejects bad credentials, and serves/updates /auth/me', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Priya Nair',
        email: 'priya@example.com',
        password: 'Password123',
      },
    });

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'priya@example.com',
        password: 'WrongPassword123',
      },
    });
    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(
      wrongPassword.json<ApiErrorResponseDto>().error.code,
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    );

    const missingUser = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'nobody@example.com',
        password: 'Password123',
      },
    });
    assert.equal(missingUser.statusCode, 401);
    assert.equal(
      missingUser.json<ApiErrorResponseDto>().error.code,
      AUTH_ERROR_CODES.INVALID_CREDENTIALS,
    );

    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'PRIYA@example.com',
        password: 'Password123',
      },
    });
    assert.equal(loginRes.statusCode, 200);
    const { tokens } = loginRes.json<AuthSessionResponseDto>();

    const meRes = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
    });
    assert.equal(meRes.statusCode, 200);
    assert.equal(meRes.json<{ user: AuthUserDto }>().user.email, 'priya@example.com');

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
      },
      payload: {
        name: 'Priya Menon',
        debtMode: 'outstanding_principal',
      },
    });
    assert.equal(patchRes.statusCode, 200);
    const updatedUser = patchRes.json<{ user: AuthUserDto }>().user;
    assert.equal(updatedUser.name, 'Priya Menon');
    assert.equal(updatedUser.debtMode, 'outstanding_principal');
  });

  it('rotates refresh tokens and revokes the entire session family upon token reuse', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Rohan Verma',
        email: 'rohan@example.com',
        password: 'Password123',
      },
    });
    const initialTokens = regRes.json<AuthSessionResponseDto>().tokens;

    const refreshRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken: initialTokens.refreshToken,
      },
    });
    assert.equal(refreshRes.statusCode, 200);
    const rotatedTokens = refreshRes.json<{ tokens: AuthTokensDto }>().tokens;
    assert.notEqual(rotatedTokens.refreshToken, initialTokens.refreshToken);

    // Replaying the already-rotated refresh token must fail AND revoke the rotated session family
    const replayRes = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken: initialTokens.refreshToken,
      },
    });
    assert.equal(replayRes.statusCode, 401);
    assert.equal(
      replayRes.json<ApiErrorResponseDto>().error.code,
      AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN,
    );

    // The legitimate rotated token in the same family must now also be revoked
    const afterTheftRefresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken: rotatedTokens.refreshToken,
      },
    });
    assert.equal(afterTheftRefresh.statusCode, 401);

    const meWithRevokedFamily = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${rotatedTokens.accessToken}`,
      },
    });
    assert.equal(meWithRevokedFamily.statusCode, 401);
  });

  it('revokes current session on logout and all sessions on logout-all', async () => {
    const firstDevice = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Neha Gupta',
        email: 'neha@example.com',
        password: 'Password123',
      },
    });
    const tokens1 = firstDevice.json<AuthSessionResponseDto>().tokens;

    const secondDevice = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'neha@example.com',
        password: 'Password123',
      },
    });
    const tokens2 = secondDevice.json<AuthSessionResponseDto>().tokens;

    const logoutRes = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        authorization: `Bearer ${tokens1.accessToken}`,
      },
      payload: {
        refreshToken: tokens1.refreshToken,
      },
    });
    assert.equal(logoutRes.statusCode, 200);

    // Device 1 access token is immediately rejected, while Device 2 remains active
    const me1 = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tokens1.accessToken}` },
    });
    assert.equal(me1.statusCode, 401);

    const me2 = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tokens2.accessToken}` },
    });
    assert.equal(me2.statusCode, 200);

    // Logout all from Device 2
    const logoutAllRes = await app.inject({
      method: 'POST',
      url: '/auth/logout-all',
      headers: { authorization: `Bearer ${tokens2.accessToken}` },
    });
    assert.equal(logoutAllRes.statusCode, 200);

    const me2After = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tokens2.accessToken}` },
    });
    assert.equal(me2After.statusCode, 401);
  });

  it('purges expired sessions and challenges while keeping active records intact', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Devika Patel',
        email: 'devika@example.com',
        password: 'Password123',
      },
    });
    const { tokens } = regRes.json<AuthSessionResponseDto>();

    const beforeExpiry = app.authService.purgeExpiredRecords(new Date().toISOString());
    assert.equal(beforeExpiry.deletedSessions, 0);
    assert.equal(beforeExpiry.deletedChallenges, 0);

    const farFutureIso = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    const afterExpiry = app.authService.purgeExpiredRecords(farFutureIso);
    assert.equal(afterExpiry.deletedSessions, 1);
    assert.equal(afterExpiry.deletedChallenges, 1);

    const meRes = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(meRes.statusCode, 401);
  });
});
