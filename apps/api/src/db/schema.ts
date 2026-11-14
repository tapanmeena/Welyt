import { DEBT_MODES } from '@welyt/shared';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const AUTH_CHALLENGE_PURPOSES = ['email_verification', 'password_reset'] as const;
export type AuthChallengePurpose = (typeof AUTH_CHALLENGE_PURPOSES)[number];

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    debtMode: text('debt_mode', { enum: DEBT_MODES }).notNull().default('remaining_emis'),
    emailVerifiedAt: text('email_verified_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('users_email_unique_idx').on(table.email)],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: text('family_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    deviceName: text('device_name'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    lastUsedAt: text('last_used_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('auth_sessions_refresh_hash_unique_idx').on(table.refreshTokenHash),
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_family_id_idx').on(table.familyId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: AUTH_CHALLENGE_PURPOSES }).notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('auth_challenges_user_purpose_idx').on(table.userId, table.purpose),
    index('auth_challenges_expires_at_idx').on(table.expiresAt),
  ],
);

export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;
export type AuthSessionRecord = typeof authSessions.$inferSelect;
export type NewAuthSessionRecord = typeof authSessions.$inferInsert;
export type AuthChallengeRecord = typeof authChallenges.$inferSelect;
export type NewAuthChallengeRecord = typeof authChallenges.$inferInsert;
