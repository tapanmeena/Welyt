import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  AUTH_ERROR_CODES,
  type ApiErrorResponseDto,
  type AuthSessionResponseDto,
  type AuthVerifyEmailResponseDto,
  type MessageResponseDto,
} from '@welyt/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { loadApiEnv } from '../config/env.ts';
import { MemoryMailer } from '../lib/mailer.ts';

describe('Email verification, password reset & change-password flows', () => {
  let app: FastifyInstance;
  let mailer: MemoryMailer;

  beforeEach(async () => {
    mailer = new MemoryMailer();
    const env = loadApiEnv({
      NODE_ENV: 'test',
      DATABASE_URL: ':memory:',
      JWT_ACCESS_SECRET: 'test-secret-with-more-than-thirty-two-characters',
      OTP_RESEND_COOLDOWN_SECONDS: '30',
      OTP_MAX_ATTEMPTS: '3',
    });

    app = await buildApp({
      logger: false,
      env,
      mailer,
      enableRateLimit: false,
    });

    // Register a verified-only test route to verify the requireVerifiedEmail guard
    app.get(
      '/test/verified-only',
      { preHandler: [app.authGuards.authenticate, app.authGuards.requireVerifiedEmail] },
      async () => ({ ok: true }),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  it('blocks unverified users on verified-only routes until email OTP is verified', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Ananya Rao',
        email: 'ananya@example.com',
        password: 'Password123',
      },
    });
    const { tokens } = regRes.json<AuthSessionResponseDto>();
    const code = mailer.verifications[0]?.code;
    assert.ok(code);

    const blockedRes = await app.inject({
      method: 'GET',
      url: '/test/verified-only',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(blockedRes.statusCode, 403);
    assert.equal(
      blockedRes.json<ApiErrorResponseDto>().error.code,
      AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
    );

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload: { code },
    });
    assert.equal(verifyRes.statusCode, 200);
    const verifiedPayload = verifyRes.json<AuthVerifyEmailResponseDto>();
    assert.ok(verifiedPayload.user.emailVerifiedAt);
    assert.ok(verifiedPayload.accessToken);

    const allowedRes = await app.inject({
      method: 'GET',
      url: '/test/verified-only',
      headers: { authorization: `Bearer ${verifiedPayload.accessToken}` },
    });
    assert.equal(allowedRes.statusCode, 200);
  });

  it('enforces resend cooldown and locks out verification codes after max failed attempts', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Vikram Singh',
        email: 'vikram@example.com',
        password: 'Password123',
      },
    });
    const { tokens } = regRes.json<AuthSessionResponseDto>();
    const realCode = mailer.verifications[0]?.code ?? '';
    const wrongCode = realCode === '000000' ? '111111' : '000000';

    // Immediate resend hits 30s cooldown
    const cooldownRes = await app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    assert.equal(cooldownRes.statusCode, 429);
    assert.equal(cooldownRes.json<ApiErrorResponseDto>().error.code, AUTH_ERROR_CODES.RATE_LIMITED);

    // Exhaust 3 max attempts
    const try1 = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload: { code: wrongCode },
    });
    assert.equal(try1.statusCode, 400);

    const try2 = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload: { code: wrongCode },
    });
    assert.equal(try2.statusCode, 400);

    const try3 = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload: { code: wrongCode },
    });
    assert.equal(try3.statusCode, 429);
    assert.equal(try3.json<ApiErrorResponseDto>().error.code, AUTH_ERROR_CODES.TOO_MANY_ATTEMPTS);

    // Even the real code is now burned
    const tryRealAfterBurn = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      payload: { code: realCode },
    });
    assert.equal(tryRealAfterBurn.statusCode, 400);
  });

  it('handles enumeration-safe forgot-password, resets password, and revokes existing sessions', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Meera Joshi',
        email: 'meera@example.com',
        password: 'OldPassword123',
      },
    });
    const oldTokens = regRes.json<AuthSessionResponseDto>().tokens;

    const unknownForgot = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'ghost@example.com' },
    });
    assert.equal(unknownForgot.statusCode, 200);
    assert.equal(mailer.passwordResets.length, 0);

    const knownForgot = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'meera@example.com' },
    });
    assert.equal(knownForgot.statusCode, 200);
    assert.equal(
      knownForgot.json<MessageResponseDto>().message,
      unknownForgot.json<MessageResponseDto>().message,
    );
    assert.equal(mailer.passwordResets.length, 1);

    const resetCode = mailer.passwordResets[0]?.code;
    assert.ok(resetCode);

    const resetRes = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: {
        email: 'meera@example.com',
        code: resetCode,
        newPassword: 'NewPassword456',
      },
    });
    assert.equal(resetRes.statusCode, 200);

    // Old session access token and refresh token must be revoked
    const oldMe = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${oldTokens.accessToken}` },
    });
    assert.equal(oldMe.statusCode, 401);

    const oldRefresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: oldTokens.refreshToken },
    });
    assert.equal(oldRefresh.statusCode, 401);

    // Signing in with the new password succeeds and shows emailVerifiedAt populated
    const newLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'meera@example.com',
        password: 'NewPassword456',
      },
    });
    assert.equal(newLogin.statusCode, 200);
    assert.ok(newLogin.json<AuthSessionResponseDto>().user.emailVerifiedAt);
  });

  it('changes password while keeping current session active and revoking other devices', async () => {
    const dev1 = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Kabir Mehta',
        email: 'kabir@example.com',
        password: 'InitialPassword1',
      },
    });
    const tokens1 = dev1.json<AuthSessionResponseDto>().tokens;

    const dev2 = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'kabir@example.com',
        password: 'InitialPassword1',
      },
    });
    const tokens2 = dev2.json<AuthSessionResponseDto>().tokens;

    const wrongCurrent = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${tokens1.accessToken}` },
      payload: {
        currentPassword: 'WrongPassword1',
        newPassword: 'UpdatedPassword2',
      },
    });
    assert.equal(wrongCurrent.statusCode, 400);
    assert.equal(
      wrongCurrent.json<ApiErrorResponseDto>().error.code,
      AUTH_ERROR_CODES.INVALID_CURRENT_PASSWORD,
    );

    const changeRes = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${tokens1.accessToken}` },
      payload: {
        currentPassword: 'InitialPassword1',
        newPassword: 'UpdatedPassword2',
      },
    });
    assert.equal(changeRes.statusCode, 200);

    // Device 1 remains active, Device 2 is revoked
    const me1 = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tokens1.accessToken}` },
    });
    assert.equal(me1.statusCode, 200);

    const me2 = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${tokens2.accessToken}` },
    });
    assert.equal(me2.statusCode, 401);
  });
});
