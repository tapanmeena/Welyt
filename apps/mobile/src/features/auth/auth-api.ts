import type {
  AuthSessionResponseDto,
  AuthTokensDto,
  AuthUserDto,
  AuthVerifyEmailResponseDto,
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  MessageResponseDto,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
  VerifyEmailInput,
} from '@welyt/shared';
import { Platform } from 'react-native';
import { apiRequest } from '@/lib/api-client';

function defaultDeviceName(): string {
  return `Welyt (${Platform.OS})`;
}

export const authApi = {
  register(input: RegisterInput): Promise<AuthSessionResponseDto> {
    return apiRequest<AuthSessionResponseDto>('/auth/register', {
      method: 'POST',
      skipAuth: true,
      body: {
        ...input,
        deviceName: input.deviceName ?? defaultDeviceName(),
      },
    });
  },

  login(input: LoginInput): Promise<AuthSessionResponseDto> {
    return apiRequest<AuthSessionResponseDto>('/auth/login', {
      method: 'POST',
      skipAuth: true,
      body: {
        ...input,
        deviceName: input.deviceName ?? defaultDeviceName(),
      },
    });
  },

  refresh(refreshToken: string): Promise<{ tokens: AuthTokensDto }> {
    return apiRequest<{ tokens: AuthTokensDto }>('/auth/refresh', {
      method: 'POST',
      skipAuth: true,
      skipRefresh: true,
      body: { refreshToken },
    });
  },

  me(accessTokenOverride?: string): Promise<{ user: AuthUserDto }> {
    return apiRequest<{ user: AuthUserDto }>('/auth/me', {
      method: 'GET',
      ...(accessTokenOverride ? { accessTokenOverride, skipRefresh: true } : {}),
    });
  },

  updateProfile(input: UpdateProfileInput): Promise<{ user: AuthUserDto }> {
    return apiRequest<{ user: AuthUserDto }>('/auth/me', {
      method: 'PATCH',
      body: input,
    });
  },

  verifyEmail(input: VerifyEmailInput): Promise<AuthVerifyEmailResponseDto> {
    return apiRequest<AuthVerifyEmailResponseDto>('/auth/verify-email', {
      method: 'POST',
      body: input,
    });
  },

  resendVerification(): Promise<MessageResponseDto> {
    return apiRequest<MessageResponseDto>('/auth/resend-verification', {
      method: 'POST',
      body: {},
    });
  },

  forgotPassword(input: ForgotPasswordInput): Promise<MessageResponseDto> {
    return apiRequest<MessageResponseDto>('/auth/forgot-password', {
      method: 'POST',
      skipAuth: true,
      body: input,
    });
  },

  resetPassword(input: ResetPasswordInput): Promise<MessageResponseDto> {
    return apiRequest<MessageResponseDto>('/auth/reset-password', {
      method: 'POST',
      skipAuth: true,
      body: input,
    });
  },

  changePassword(input: ChangePasswordInput): Promise<MessageResponseDto> {
    return apiRequest<MessageResponseDto>('/auth/change-password', {
      method: 'POST',
      body: input,
    });
  },

  logout(refreshToken: string | null): Promise<MessageResponseDto> {
    return apiRequest<MessageResponseDto>('/auth/logout', {
      method: 'POST',
      skipRefresh: true,
      body: refreshToken ? { refreshToken } : {},
    });
  },

  logoutAll(): Promise<MessageResponseDto> {
    return apiRequest<MessageResponseDto>('/auth/logout-all', {
      method: 'POST',
      body: {},
    });
  },
};
