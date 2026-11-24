import { AUTH_ERROR_CODES, type AuthUserDto, type UpdateProfileInput } from '@welyt/shared';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../../db/client.ts';
import { users, type UserRecord } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';

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

  constructor(db: AppDatabase) {
    this.db = db;
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
}
