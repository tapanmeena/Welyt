import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const OTP_CODE_LENGTH = 6;

export const DEBT_MODES = ['remaining_emis', 'outstanding_principal'] as const;
export type DebtMode = (typeof DEBT_MODES)[number];

export const debtModeSchema = z.enum(DEBT_MODES);

export const emailFieldSchema = z
  .string()
  .trim()
  .max(254, 'Email must be at most 254 characters')
  .toLowerCase()
  .pipe(z.email('Enter a valid email address'));

export const nameFieldSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be at most 100 characters');

export const passwordPolicySchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`)
  .refine((value) => /[a-z]/.test(value), 'Password must include at least one lowercase letter')
  .refine((value) => /[A-Z]/.test(value), 'Password must include at least one uppercase letter')
  .refine((value) => /[0-9]/.test(value), 'Password must include at least one number');

export const loginPasswordSchema = z
  .string()
  .min(1, 'Password is required')
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter a valid 6-digit code');

export const deviceNameSchema = z.string().trim().min(1).max(120).optional();

export const registerSchema = z.object({
  name: nameFieldSchema,
  email: emailFieldSchema,
  password: passwordPolicySchema,
  deviceName: deviceNameSchema,
});

export const loginSchema = z.object({
  email: emailFieldSchema,
  password: loginPasswordSchema,
  deviceName: deviceNameSchema,
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

export const verifyEmailSchema = z.object({
  code: otpCodeSchema,
  email: emailFieldSchema.optional(),
});

export const resendVerificationSchema = z.object({
  email: emailFieldSchema.optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailFieldSchema,
});

export const resetPasswordSchema = z.object({
  email: emailFieldSchema,
  code: otpCodeSchema,
  newPassword: passwordPolicySchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: loginPasswordSchema,
    newPassword: passwordPolicySchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from your current password',
    path: ['newPassword'],
  });

export const updateProfileSchema = z
  .object({
    name: nameFieldSchema.optional(),
    debtMode: debtModeSchema.optional(),
  })
  .refine((data) => data.name !== undefined || data.debtMode !== undefined, {
    message: 'At least one profile field must be provided',
  });

export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  debtMode: debtModeSchema,
  emailVerifiedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});

export const authSessionResponseSchema = z.object({
  user: authUserSchema,
  tokens: authTokensSchema,
});

export const authVerifyEmailResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string().optional(),
  expiresIn: z.number().int().positive().optional(),
});

export const messageResponseSchema = z.object({
  message: z.string(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export type AuthUserDto = z.infer<typeof authUserSchema>;
export type AuthTokensDto = z.infer<typeof authTokensSchema>;
export type AuthSessionResponseDto = z.infer<typeof authSessionResponseSchema>;
export type AuthVerifyEmailResponseDto = z.infer<typeof authVerifyEmailResponseSchema>;
export type MessageResponseDto = z.infer<typeof messageResponseSchema>;
