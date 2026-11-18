import { AUTH_ERROR_CODES, type ApiErrorResponseDto, type AuthErrorCode } from '@welyt/shared';
import type { z } from 'zod';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: AuthErrorCode;
  readonly fieldErrors: Record<string, string[]> | undefined;

  constructor(
    statusCode: number,
    code: AuthErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }

  toResponse(): ApiErrorResponseDto {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
      },
    };
  }
}

export function fieldValidationError(field: string, message: string): AppError {
  return new AppError(400, AUTH_ERROR_CODES.VALIDATION_ERROR, message, { [field]: [message] });
}

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw zodToValidationError(parsed.error);
  }
  return parsed.data;
}

export function zodToValidationError(zodError: z.ZodError): AppError {
  const fieldErrors: Record<string, string[]> = {};

  for (const issue of zodError.issues) {
    const key = issue.path.length > 0 ? issue.path.map(String).join('.') : '_root';
    const existing = fieldErrors[key];
    if (existing) {
      existing.push(issue.message);
    } else {
      fieldErrors[key] = [issue.message];
    }
  }

  const firstIssue = zodError.issues[0];
  const message = firstIssue?.message ?? 'Invalid request payload';

  return new AppError(400, AUTH_ERROR_CODES.VALIDATION_ERROR, message, fieldErrors);
}
