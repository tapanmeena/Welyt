import { z } from 'zod';

export const AUTH_ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  EMAIL_ALREADY_IN_USE: 'EMAIL_ALREADY_IN_USE',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  EMAIL_ALREADY_VERIFIED: 'EMAIL_ALREADY_VERIFIED',
  INVALID_OR_EXPIRED_CODE: 'INVALID_OR_EXPIRED_CODE',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
  RATE_LIMITED: 'RATE_LIMITED',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  INVALID_CURRENT_PASSWORD: 'INVALID_CURRENT_PASSWORD',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

export const authErrorCodeValues = Object.values(AUTH_ERROR_CODES) as [
  AuthErrorCode,
  ...AuthErrorCode[],
];

export const apiErrorDetailSchema = z.object({
  code: z.enum(authErrorCodeValues),
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
});

export const apiErrorResponseSchema = z.object({
  error: apiErrorDetailSchema,
});

export type ApiErrorDetailDto = z.infer<typeof apiErrorDetailSchema>;
export type ApiErrorResponseDto = z.infer<typeof apiErrorResponseSchema>;
