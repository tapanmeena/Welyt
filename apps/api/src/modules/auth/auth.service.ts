import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  AUTH_ERROR_CODES,
  type AuthSessionResponseDto,
  type AuthTokensDto,
  type AuthUserDto,
  type AuthVerifyEmailResponseDto,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type MessageResponseDto,
  type RegisterInput,
  type ResetPasswordInput,
  type UpdateProfileInput,
  type VerifyEmailInput,
} from '@welyt/shared';
import { and, desc, eq, isNull, lt, ne, or } from 'drizzle-orm';
import type { ApiEnv } from '../../config/env.ts';
import type { AppDatabase } from '../../db/client.ts';
import {
  authChallenges,
  authSessions,
  users,
  type AuthChallengePurpose,
  type UserRecord,
} from '../../db/schema.ts';
import {
  generateOpaqueToken,
  generateOtpCode,
  hashPassword,
  sha256Hex,
  signAccessToken,
  verifyDummyPassword,
  verifyPassword,
} from '../../lib/crypto.ts';
import { AppError } from '../../lib/errors.ts';
import type { Mailer } from '../../lib/mailer.ts';

export interface SessionClientMeta {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export function mapUserToDto(user: UserRecord): AuthUserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    debtMode: user.debtMode,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class AuthService {
  readonly db: AppDatabase;
  readonly env: ApiEnv;
  readonly mailer: Mailer;

  constructor(db: AppDatabase, env: ApiEnv, mailer: Mailer) {
    this.db = db;
    this.env = env;
    this.mailer = mailer;
  }

  async register(
    input: RegisterInput,
    meta: SessionClientMeta = {},
  ): Promise<AuthSessionResponseDto> {
    const existingUser = this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, input.email))
      .get();

    if (existingUser) {
      throw new AppError(
        409,
        AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE,
        'An account with this email address already exists',
        { email: ['An account with this email address already exists'] },
      );
    }

    const passwordHash = await hashPassword(input.password);
    const nowIso = new Date().toISOString();
    const userId = randomUUID();
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const rawRefreshToken = generateOpaqueToken(32);
    const refreshTokenHash = sha256Hex(rawRefreshToken);
    const sessionExpiresAt = new Date(
      Date.now() + this.env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const verificationCode = generateOtpCode();
    const verificationCodeHash = sha256Hex(verificationCode);
    const challengeExpiresAt = new Date(
      Date.now() + this.env.otpTtlMinutes * 60 * 1000,
    ).toISOString();

    let createdUser: UserRecord | undefined;

    try {
      this.db.transaction((tx) => {
        tx.insert(users)
          .values({
            id: userId,
            name: input.name,
            email: input.email,
            passwordHash,
            debtMode: 'remaining_emis',
            emailVerifiedAt: null,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .run();

        tx.insert(authSessions)
          .values({
            id: sessionId,
            userId,
            familyId,
            refreshTokenHash,
            deviceName: input.deviceName ?? null,
            ipAddress: meta.ipAddress ?? null,
            userAgent: meta.userAgent ?? null,
            expiresAt: sessionExpiresAt,
            revokedAt: null,
            lastUsedAt: nowIso,
            createdAt: nowIso,
          })
          .run();

        tx.insert(authChallenges)
          .values({
            id: randomUUID(),
            userId,
            purpose: 'email_verification',
            codeHash: verificationCodeHash,
            attempts: 0,
            expiresAt: challengeExpiresAt,
            consumedAt: null,
            createdAt: nowIso,
          })
          .run();

        createdUser = tx.select().from(users).where(eq(users.id, userId)).get();
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed: users.email')
      ) {
        throw new AppError(
          409,
          AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE,
          'An account with this email address already exists',
          { email: ['An account with this email address already exists'] },
        );
      }
      throw error;
    }

    if (!createdUser) {
      throw new AppError(500, AUTH_ERROR_CODES.INTERNAL_ERROR, 'Failed to create user');
    }

    const deepLinkUrl = this.buildDeepLink('verify-email', {
      email: createdUser.email,
      code: verificationCode,
    });

    try {
      await this.mailer.sendVerificationEmail({
        to: createdUser.email,
        name: createdUser.name,
        code: verificationCode,
        deepLinkUrl,
        expiresInMinutes: this.env.otpTtlMinutes,
      });
    } catch {
      // Do not fail registration after the account transaction committed; the user can tap Resend on the verify screen.
    }

    const accessToken = await signAccessToken(
      {
        userId: createdUser.id,
        sessionId,
        emailVerified: false,
      },
      this.env.jwtAccessSecret,
      this.env.accessTokenTtlSeconds,
    );

    return {
      user: mapUserToDto(createdUser),
      tokens: {
        accessToken,
        refreshToken: rawRefreshToken,
        expiresIn: this.env.accessTokenTtlSeconds,
      },
    };
  }

  async login(input: LoginInput, meta: SessionClientMeta = {}): Promise<AuthSessionResponseDto> {
    const user = this.db.select().from(users).where(eq(users.email, input.email)).get();

    if (!user) {
      await verifyDummyPassword(input.password);
      throw new AppError(
        401,
        AUTH_ERROR_CODES.INVALID_CREDENTIALS,
        'Invalid email address or password',
      );
    }

    const passwordMatches = await verifyPassword(input.password, user.passwordHash);
    if (!passwordMatches) {
      throw new AppError(
        401,
        AUTH_ERROR_CODES.INVALID_CREDENTIALS,
        'Invalid email address or password',
      );
    }

    const tokens = await this.createSession(user, input.deviceName, meta);

    return {
      user: mapUserToDto(user),
      tokens,
    };
  }

  async refresh(rawRefreshToken: string, meta: SessionClientMeta = {}): Promise<AuthTokensDto> {
    const incomingHash = sha256Hex(rawRefreshToken);
    const existingSession = this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.refreshTokenHash, incomingHash))
      .get();

    if (!existingSession) {
      throw new AppError(
        401,
        AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN,
        'Invalid or expired refresh token',
      );
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (existingSession.revokedAt !== null) {
      // Reuse of an already rotated/revoked token revokes the entire session family.
      this.db
        .update(authSessions)
        .set({ revokedAt: nowIso })
        .where(
          and(eq(authSessions.familyId, existingSession.familyId), isNull(authSessions.revokedAt)),
        )
        .run();

      throw new AppError(
        401,
        AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN,
        'Refresh token is no longer valid',
      );
    }

    if (Date.parse(existingSession.expiresAt) <= nowMs) {
      this.db
        .update(authSessions)
        .set({ revokedAt: nowIso })
        .where(eq(authSessions.id, existingSession.id))
        .run();

      throw new AppError(401, AUTH_ERROR_CODES.SESSION_EXPIRED, 'Session has expired');
    }

    const user = this.db.select().from(users).where(eq(users.id, existingSession.userId)).get();

    if (!user) {
      throw new AppError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Account not found');
    }

    const nextSessionId = randomUUID();
    const nextRawRefreshToken = generateOpaqueToken(32);
    const nextRefreshTokenHash = sha256Hex(nextRawRefreshToken);
    const nextExpiresAt = new Date(
      nowMs + this.env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    this.db.transaction((tx) => {
      tx.update(authSessions)
        .set({ revokedAt: nowIso, lastUsedAt: nowIso })
        .where(eq(authSessions.id, existingSession.id))
        .run();

      tx.insert(authSessions)
        .values({
          id: nextSessionId,
          userId: user.id,
          familyId: existingSession.familyId,
          refreshTokenHash: nextRefreshTokenHash,
          deviceName: existingSession.deviceName,
          ipAddress: meta.ipAddress ?? existingSession.ipAddress,
          userAgent: meta.userAgent ?? existingSession.userAgent,
          expiresAt: nextExpiresAt,
          revokedAt: null,
          lastUsedAt: nowIso,
          createdAt: nowIso,
        })
        .run();
    });

    const accessToken = await signAccessToken(
      {
        userId: user.id,
        sessionId: nextSessionId,
        emailVerified: user.emailVerifiedAt !== null,
      },
      this.env.jwtAccessSecret,
      this.env.accessTokenTtlSeconds,
    );

    return {
      accessToken,
      refreshToken: nextRawRefreshToken,
      expiresIn: this.env.accessTokenTtlSeconds,
    };
  }

  logout(options: { sessionId?: string | undefined; refreshToken?: string | undefined }): void {
    const nowIso = new Date().toISOString();

    if (options.sessionId) {
      this.db
        .update(authSessions)
        .set({ revokedAt: nowIso })
        .where(and(eq(authSessions.id, options.sessionId), isNull(authSessions.revokedAt)))
        .run();
    }

    if (options.refreshToken) {
      const tokenHash = sha256Hex(options.refreshToken);
      const target = this.db
        .select({ familyId: authSessions.familyId })
        .from(authSessions)
        .where(eq(authSessions.refreshTokenHash, tokenHash))
        .get();

      if (target) {
        this.db
          .update(authSessions)
          .set({ revokedAt: nowIso })
          .where(and(eq(authSessions.familyId, target.familyId), isNull(authSessions.revokedAt)))
          .run();
      }
    }
  }

  logoutAll(userId: string): void {
    const nowIso = new Date().toISOString();
    this.db
      .update(authSessions)
      .set({ revokedAt: nowIso })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
      .run();
  }

  getMe(userId: string): AuthUserDto {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      throw new AppError(404, AUTH_ERROR_CODES.USER_NOT_FOUND, 'User not found');
    }
    return mapUserToDto(user);
  }

  updateProfile(userId: string, input: UpdateProfileInput): AuthUserDto {
    const existing = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!existing) {
      throw new AppError(404, AUTH_ERROR_CODES.USER_NOT_FOUND, 'User not found');
    }

    const nowIso = new Date().toISOString();
    this.db
      .update(users)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.debtMode !== undefined ? { debtMode: input.debtMode } : {}),
        updatedAt: nowIso,
      })
      .where(eq(users.id, userId))
      .run();

    const updated = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!updated) {
      throw new AppError(500, AUTH_ERROR_CODES.INTERNAL_ERROR, 'Failed to load updated profile');
    }
    return mapUserToDto(updated);
  }

  purgeExpiredRecords(nowIso = new Date().toISOString()): {
    deletedSessions: number;
    deletedChallenges: number;
  } {
    const sessionResult = this.db
      .delete(authSessions)
      .where(lt(authSessions.expiresAt, nowIso))
      .run();

    const challengeResult = this.db
      .delete(authChallenges)
      .where(or(lt(authChallenges.expiresAt, nowIso)))
      .run();

    return {
      deletedSessions: sessionResult.changes,
      deletedChallenges: challengeResult.changes,
    };
  }

  async verifyEmail(
    input: VerifyEmailInput,
    authenticatedSession?: { userId: string; sessionId: string } | null,
  ): Promise<AuthVerifyEmailResponseDto> {
    let user: UserRecord | undefined;

    if (authenticatedSession) {
      user = this.db.select().from(users).where(eq(users.id, authenticatedSession.userId)).get();
      if (!user) {
        throw new AppError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Authentication required');
      }
      if (input.email && input.email !== user.email) {
        throw new AppError(
          400,
          AUTH_ERROR_CODES.VALIDATION_ERROR,
          'Provided email does not match the signed-in account',
          { email: ['Provided email does not match the signed-in account'] },
        );
      }
    } else if (input.email) {
      user = this.db.select().from(users).where(eq(users.email, input.email)).get();
      if (!user) {
        throw new AppError(
          400,
          AUTH_ERROR_CODES.INVALID_OR_EXPIRED_CODE,
          'Invalid or expired verification code',
        );
      }
    } else {
      throw new AppError(
        400,
        AUTH_ERROR_CODES.VALIDATION_ERROR,
        'Email is required when verifying without an active session',
        { email: ['Email is required'] },
      );
    }

    const challenge = this.verifyChallengeCode(user.id, 'email_verification', input.code);
    const nowIso = new Date().toISOString();

    let updatedUser: UserRecord | undefined;
    this.db.transaction((tx) => {
      tx.update(authChallenges)
        .set({ consumedAt: nowIso })
        .where(eq(authChallenges.id, challenge.id))
        .run();

      tx.update(users)
        .set({
          emailVerifiedAt: user.emailVerifiedAt ?? nowIso,
          updatedAt: nowIso,
        })
        .where(eq(users.id, user.id))
        .run();

      updatedUser = tx.select().from(users).where(eq(users.id, user.id)).get();
    });

    if (!updatedUser) {
      throw new AppError(
        500,
        AUTH_ERROR_CODES.INTERNAL_ERROR,
        'Failed to update user verification',
      );
    }

    if (authenticatedSession) {
      const accessToken = await signAccessToken(
        {
          userId: updatedUser.id,
          sessionId: authenticatedSession.sessionId,
          emailVerified: true,
        },
        this.env.jwtAccessSecret,
        this.env.accessTokenTtlSeconds,
      );

      return {
        user: mapUserToDto(updatedUser),
        accessToken,
        expiresIn: this.env.accessTokenTtlSeconds,
      };
    }

    return {
      user: mapUserToDto(updatedUser),
    };
  }

  async resendVerification(userId: string): Promise<MessageResponseDto> {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      throw new AppError(404, AUTH_ERROR_CODES.USER_NOT_FOUND, 'User not found');
    }

    if (user.emailVerifiedAt !== null) {
      throw new AppError(
        400,
        AUTH_ERROR_CODES.EMAIL_ALREADY_VERIFIED,
        'Your email address is already verified',
      );
    }

    const latestChallenge = this.getLatestActiveChallenge(user.id, 'email_verification');
    const nowMs = Date.now();
    if (latestChallenge && this.env.otpResendCooldownSeconds > 0) {
      const elapsedSeconds = (nowMs - Date.parse(latestChallenge.createdAt)) / 1000;
      if (elapsedSeconds < this.env.otpResendCooldownSeconds) {
        const waitSeconds = Math.max(
          1,
          Math.ceil(this.env.otpResendCooldownSeconds - elapsedSeconds),
        );
        throw new AppError(
          429,
          AUTH_ERROR_CODES.RATE_LIMITED,
          `Please wait ${waitSeconds} seconds before requesting another verification code`,
        );
      }
    }

    const code = this.replaceChallenge(user.id, 'email_verification', nowMs);
    const deepLinkUrl = this.buildDeepLink('verify-email', {
      email: user.email,
      code,
    });

    await this.mailer.sendVerificationEmail({
      to: user.email,
      name: user.name,
      code,
      deepLinkUrl,
      expiresInMinutes: this.env.otpTtlMinutes,
    });

    return {
      message: 'A new verification code has been sent to your email address.',
    };
  }

  async forgotPassword(input: ForgotPasswordInput): Promise<MessageResponseDto> {
    const genericResponse: MessageResponseDto = {
      message: 'If an account exists for this email, a password reset code has been sent.',
    };

    const user = this.db.select().from(users).where(eq(users.email, input.email)).get();
    if (!user) {
      // Equalize non-existent lookup work slightly
      sha256Hex(generateOtpCode());
      return genericResponse;
    }

    const nowMs = Date.now();
    const latestChallenge = this.getLatestActiveChallenge(user.id, 'password_reset');
    if (latestChallenge && this.env.otpResendCooldownSeconds > 0) {
      const elapsedSeconds = (nowMs - Date.parse(latestChallenge.createdAt)) / 1000;
      if (elapsedSeconds < this.env.otpResendCooldownSeconds) {
        return genericResponse;
      }
    }

    const code = this.replaceChallenge(user.id, 'password_reset', nowMs);
    const deepLinkUrl = this.buildDeepLink('reset-password', {
      email: user.email,
      code,
    });

    await this.mailer.sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      code,
      deepLinkUrl,
      expiresInMinutes: this.env.otpTtlMinutes,
    });

    return genericResponse;
  }

  async resetPassword(input: ResetPasswordInput): Promise<MessageResponseDto> {
    const user = this.db.select().from(users).where(eq(users.email, input.email)).get();
    if (!user) {
      await verifyDummyPassword(input.newPassword);
      throw new AppError(
        400,
        AUTH_ERROR_CODES.INVALID_OR_EXPIRED_CODE,
        'Invalid or expired password reset code',
      );
    }

    const challenge = this.verifyChallengeCode(user.id, 'password_reset', input.code);
    const passwordHash = await hashPassword(input.newPassword);
    const nowIso = new Date().toISOString();

    this.db.transaction((tx) => {
      tx.update(authChallenges)
        .set({ consumedAt: nowIso })
        .where(eq(authChallenges.id, challenge.id))
        .run();

      tx.update(users)
        .set({
          passwordHash,
          emailVerifiedAt: user.emailVerifiedAt ?? nowIso,
          updatedAt: nowIso,
        })
        .where(eq(users.id, user.id))
        .run();

      tx.update(authSessions)
        .set({ revokedAt: nowIso })
        .where(and(eq(authSessions.userId, user.id), isNull(authSessions.revokedAt)))
        .run();
    });

    return {
      message: 'Your password has been reset. Please sign in with your new password.',
    };
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    input: ChangePasswordInput,
  ): Promise<MessageResponseDto> {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) {
      throw new AppError(404, AUTH_ERROR_CODES.USER_NOT_FOUND, 'User not found');
    }

    const matchesCurrent = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!matchesCurrent) {
      throw new AppError(
        400,
        AUTH_ERROR_CODES.INVALID_CURRENT_PASSWORD,
        'Current password is incorrect',
        { currentPassword: ['Current password is incorrect'] },
      );
    }

    const passwordHash = await hashPassword(input.newPassword);
    const nowIso = new Date().toISOString();

    this.db.transaction((tx) => {
      tx.update(users)
        .set({
          passwordHash,
          updatedAt: nowIso,
        })
        .where(eq(users.id, user.id))
        .run();

      tx.update(authSessions)
        .set({ revokedAt: nowIso })
        .where(
          and(
            eq(authSessions.userId, user.id),
            ne(authSessions.id, currentSessionId),
            isNull(authSessions.revokedAt),
          ),
        )
        .run();
    });

    return {
      message: 'Your password has been updated.',
    };
  }

  private replaceChallenge(
    userId: string,
    purpose: AuthChallengePurpose,
    nowMs = Date.now(),
  ): string {
    const nowIso = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + this.env.otpTtlMinutes * 60 * 1000).toISOString();
    const code = generateOtpCode();
    const codeHash = sha256Hex(code);

    this.db.transaction((tx) => {
      tx.update(authChallenges)
        .set({ consumedAt: nowIso })
        .where(
          and(
            eq(authChallenges.userId, userId),
            eq(authChallenges.purpose, purpose),
            isNull(authChallenges.consumedAt),
          ),
        )
        .run();

      tx.insert(authChallenges)
        .values({
          id: randomUUID(),
          userId,
          purpose,
          codeHash,
          attempts: 0,
          expiresAt,
          consumedAt: null,
          createdAt: nowIso,
        })
        .run();
    });

    return code;
  }

  private verifyChallengeCode(userId: string, purpose: AuthChallengePurpose, code: string) {
    const challenge = this.getLatestActiveChallenge(userId, purpose);
    const invalidError = new AppError(
      400,
      AUTH_ERROR_CODES.INVALID_OR_EXPIRED_CODE,
      purpose === 'email_verification'
        ? 'Invalid or expired verification code'
        : 'Invalid or expired password reset code',
      { code: ['Invalid or expired code'] },
    );

    if (!challenge) {
      throw invalidError;
    }

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    if (Date.parse(challenge.expiresAt) <= nowMs) {
      this.db
        .update(authChallenges)
        .set({ consumedAt: nowIso })
        .where(eq(authChallenges.id, challenge.id))
        .run();
      throw invalidError;
    }

    if (challenge.attempts >= this.env.otpMaxAttempts) {
      this.db
        .update(authChallenges)
        .set({ consumedAt: nowIso })
        .where(eq(authChallenges.id, challenge.id))
        .run();
      throw new AppError(
        429,
        AUTH_ERROR_CODES.TOO_MANY_ATTEMPTS,
        'Too many incorrect code attempts. Please request a new code.',
      );
    }

    const actualBuf = Buffer.from(sha256Hex(code), 'hex');
    const expectedBuf = Buffer.from(challenge.codeHash, 'hex');
    const matches =
      actualBuf.length === expectedBuf.length && timingSafeEqual(actualBuf, expectedBuf);

    if (!matches) {
      const nextAttempts = challenge.attempts + 1;
      const exhausted = nextAttempts >= this.env.otpMaxAttempts;

      this.db
        .update(authChallenges)
        .set({
          attempts: nextAttempts,
          ...(exhausted ? { consumedAt: nowIso } : {}),
        })
        .where(eq(authChallenges.id, challenge.id))
        .run();

      if (exhausted) {
        throw new AppError(
          429,
          AUTH_ERROR_CODES.TOO_MANY_ATTEMPTS,
          'Too many incorrect code attempts. Please request a new code.',
        );
      }

      throw invalidError;
    }

    return challenge;
  }

  protected async createSession(
    user: UserRecord,
    deviceName: string | undefined,
    meta: SessionClientMeta,
  ): Promise<AuthTokensDto> {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const sessionId = randomUUID();
    const familyId = randomUUID();
    const rawRefreshToken = generateOpaqueToken(32);
    const refreshTokenHash = sha256Hex(rawRefreshToken);
    const expiresAt = new Date(
      nowMs + this.env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    this.db
      .insert(authSessions)
      .values({
        id: sessionId,
        userId: user.id,
        familyId,
        refreshTokenHash,
        deviceName: deviceName ?? null,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        expiresAt,
        revokedAt: null,
        lastUsedAt: nowIso,
        createdAt: nowIso,
      })
      .run();

    const accessToken = await signAccessToken(
      {
        userId: user.id,
        sessionId,
        emailVerified: user.emailVerifiedAt !== null,
      },
      this.env.jwtAccessSecret,
      this.env.accessTokenTtlSeconds,
    );

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: this.env.accessTokenTtlSeconds,
    };
  }

  protected getLatestActiveChallenge(userId: string, purpose: AuthChallengePurpose) {
    return this.db
      .select()
      .from(authChallenges)
      .where(
        and(
          eq(authChallenges.userId, userId),
          eq(authChallenges.purpose, purpose),
          isNull(authChallenges.consumedAt),
        ),
      )
      .orderBy(desc(authChallenges.createdAt))
      .get();
  }

  protected buildDeepLink(pathName: string, query: Record<string, string>): string {
    const search = new URLSearchParams(query).toString();
    return `${this.env.appScheme}://${pathName}?${search}`;
  }
}
