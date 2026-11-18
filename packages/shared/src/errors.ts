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

export const ACCOUNTS_ERROR_CODES = {
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  ACCOUNT_ARCHIVED: 'ACCOUNT_ARCHIVED',
  OBSERVATION_NOT_FOUND: 'OBSERVATION_NOT_FOUND',
  OBSERVATION_NOT_CURRENT: 'OBSERVATION_NOT_CURRENT',
  OBSERVATION_DATE_OCCUPIED: 'OBSERVATION_DATE_OCCUPIED',
} as const;

export type AccountsErrorCode = (typeof ACCOUNTS_ERROR_CODES)[keyof typeof ACCOUNTS_ERROR_CODES];
export const INCOME_ERROR_CODES = {
  INCOME_RECEIPT_NOT_FOUND: 'INCOME_RECEIPT_NOT_FOUND',
  INCOME_RECEIPT_NOT_CURRENT: 'INCOME_RECEIPT_NOT_CURRENT',
  INCOME_RECEIPT_ARCHIVED: 'INCOME_RECEIPT_ARCHIVED',
  MONTHLY_PLAN_NOT_FOUND: 'MONTHLY_PLAN_NOT_FOUND',
  MONTHLY_PLAN_REVISION_CONFLICT: 'MONTHLY_PLAN_REVISION_CONFLICT',
} as const;

export type IncomeErrorCode = (typeof INCOME_ERROR_CODES)[keyof typeof INCOME_ERROR_CODES];
export type ApiErrorCode = AuthErrorCode | AccountsErrorCode | IncomeErrorCode;

export const apiErrorDetailSchema = z.object({
  code: z.enum({ ...AUTH_ERROR_CODES, ...ACCOUNTS_ERROR_CODES, ...INCOME_ERROR_CODES }),
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
});

export const apiErrorResponseSchema = z.object({
  error: apiErrorDetailSchema,
});

export type ApiErrorDetailDto = z.infer<typeof apiErrorDetailSchema>;
export type ApiErrorResponseDto = z.infer<typeof apiErrorResponseSchema>;
