import {
  AuthKitClient,
  AuthKitClientError,
  type StoredAuthTokens,
  type TokenStorage,
} from '@tapanmeena/authkit-client';
import {
  AUTH_ERROR_CODES as AUTHKIT_ERROR_CODES,
  type AuthErrorCode as AuthKitErrorCode,
  type AuthTokensDto as AuthKitTokensDto,
  type AuthUserDto as AuthKitUserDto,
} from '@tapanmeena/authkit-shared';
import {
  AUTH_ERROR_CODES,
  type ApiErrorCode,
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
import { Platform } from 'react-native';
import {
  ApiRequestError,
  apiRequest,
  getAuthKitBaseUrl,
  getAuthKitClientId,
} from '@/lib/api-client';

function defaultDeviceName(): string {
  return `Welyt (${Platform.OS})`;
}

function deriveFallbackName(email: string): string {
  return email.split('@')[0]?.trim() || 'User';
}

function toWelytTokens(tokens: AuthKitTokensDto): AuthTokensDto {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
  };
}

function mapAuthKitUserFallback(
  authkitUser: AuthKitUserDto,
  debtMode: AuthUserDto['debtMode'] = 'remaining_emis',
): AuthUserDto {
  const verifiedAt =
    authkitUser.emailVerifiedAt ?? (authkitUser.emailVerified ? authkitUser.updatedAt : null);
  return {
    id: authkitUser.id,
    name: authkitUser.name?.trim() || deriveFallbackName(authkitUser.email),
    email: authkitUser.email,
    debtMode,
    emailVerifiedAt: verifiedAt,
    createdAt: authkitUser.createdAt,
    updatedAt: authkitUser.updatedAt,
  };
}

function mergeAuthKitAndWelytUser(
  authkitUser: AuthKitUserDto,
  welytUser: AuthUserDto,
  preferWelytName = false,
): AuthUserDto {
  const verifiedAt =
    authkitUser.emailVerifiedAt ??
    welytUser.emailVerifiedAt ??
    (authkitUser.emailVerified ? welytUser.updatedAt : null);
  const name = preferWelytName
    ? welytUser.name || authkitUser.name?.trim() || deriveFallbackName(authkitUser.email)
    : authkitUser.name?.trim() || welytUser.name || deriveFallbackName(authkitUser.email);

  return {
    id: welytUser.id,
    name,
    email: authkitUser.email,
    debtMode: welytUser.debtMode,
    emailVerifiedAt: verifiedAt,
    createdAt: welytUser.createdAt,
    updatedAt:
      welytUser.updatedAt > authkitUser.updatedAt ? welytUser.updatedAt : authkitUser.updatedAt,
  };
}

function mapAuthKitErrorCode(
  code: AuthKitErrorCode,
  context?: 'changePassword' | undefined,
): ApiErrorCode {
  switch (code) {
    case AUTHKIT_ERROR_CODES.VALIDATION_ERROR:
      return AUTH_ERROR_CODES.VALIDATION_ERROR;
    case AUTHKIT_ERROR_CODES.EMAIL_ALREADY_IN_USE:
      return AUTH_ERROR_CODES.EMAIL_ALREADY_IN_USE;
    case AUTHKIT_ERROR_CODES.INVALID_CREDENTIALS:
      return context === 'changePassword'
        ? AUTH_ERROR_CODES.INVALID_CURRENT_PASSWORD
        : AUTH_ERROR_CODES.INVALID_CREDENTIALS;
    case AUTHKIT_ERROR_CODES.EMAIL_NOT_VERIFIED:
      return AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED;
    case AUTHKIT_ERROR_CODES.OTP_INVALID_OR_EXPIRED:
      return AUTH_ERROR_CODES.INVALID_OR_EXPIRED_CODE;
    case AUTHKIT_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED:
      return AUTH_ERROR_CODES.TOO_MANY_ATTEMPTS;
    case AUTHKIT_ERROR_CODES.OTP_COOLDOWN_ACTIVE:
    case AUTHKIT_ERROR_CODES.RATE_LIMITED:
      return AUTH_ERROR_CODES.RATE_LIMITED;
    case AUTHKIT_ERROR_CODES.REFRESH_TOKEN_INVALID:
    case AUTHKIT_ERROR_CODES.REFRESH_TOKEN_REUSED:
      return AUTH_ERROR_CODES.INVALID_REFRESH_TOKEN;
    case AUTHKIT_ERROR_CODES.REFRESH_TOKEN_EXPIRED:
      return AUTH_ERROR_CODES.SESSION_EXPIRED;
    case AUTHKIT_ERROR_CODES.NOT_FOUND:
      return AUTH_ERROR_CODES.USER_NOT_FOUND;
    case AUTHKIT_ERROR_CODES.UNAUTHORIZED:
    case AUTHKIT_ERROR_CODES.TOKEN_INVALID:
    case AUTHKIT_ERROR_CODES.TOKEN_EXPIRED:
      return AUTH_ERROR_CODES.UNAUTHORIZED;
    default:
      return AUTH_ERROR_CODES.INTERNAL_ERROR;
  }
}

function toApiRequestError(
  error: unknown,
  context?: 'changePassword' | undefined,
): ApiRequestError {
  if (error instanceof ApiRequestError) {
    return error;
  }

  if (error instanceof AuthKitClientError) {
    const code = mapAuthKitErrorCode(error.code, context);
    let fieldErrors = error.details;
    if (!fieldErrors) {
      if (error.code === AUTHKIT_ERROR_CODES.EMAIL_ALREADY_IN_USE) {
        fieldErrors = { email: [error.message] };
      } else if (error.code === AUTHKIT_ERROR_CODES.OTP_INVALID_OR_EXPIRED) {
        fieldErrors = { code: [error.message] };
      } else if (
        context === 'changePassword' &&
        error.code === AUTHKIT_ERROR_CODES.INVALID_CREDENTIALS
      ) {
        fieldErrors = { currentPassword: [error.message] };
      }
    }

    return new ApiRequestError({
      statusCode: error.statusCode,
      code,
      message: error.message,
      fieldErrors,
    });
  }

  return new ApiRequestError({
    statusCode: 500,
    code: AUTH_ERROR_CODES.INTERNAL_ERROR,
    message: error instanceof Error && error.message ? error.message : 'Something went wrong.',
  });
}

export interface AuthKitStoreBridge {
  getSessionTokens: () => { accessToken: string | null; refreshToken: string | null };
  getCurrentUserEmail: () => string | null;
  onTokensRefreshed: (tokens: AuthTokensDto) => Promise<void>;
  onSessionInvalidated: () => Promise<void>;
}

let storeBridge: AuthKitStoreBridge | null = null;
let cachedTokens: StoredAuthTokens | null = null;

export function bindStoreToAuthKit(bridge: AuthKitStoreBridge): void {
  storeBridge = bridge;
}

export function clearAuthKitCachedTokens(): void {
  cachedTokens = null;
}

export function seedAuthKitTokens(tokens: {
  accessToken?: string | null | undefined;
  refreshToken: string;
  expiresInSeconds?: number | undefined;
}): void {
  cachedTokens = {
    accessToken: tokens.accessToken ?? '',
    refreshToken: tokens.refreshToken,
    expiresAt:
      tokens.accessToken && tokens.expiresInSeconds
        ? Date.now() + tokens.expiresInSeconds * 1000
        : 0,
  };
}

const authKitTokenStorage: TokenStorage = {
  getTokens(): StoredAuthTokens | null {
    if (cachedTokens?.refreshToken) {
      return { ...cachedTokens };
    }
    const fallback = storeBridge?.getSessionTokens();
    if (fallback?.refreshToken) {
      return {
        accessToken: fallback.accessToken ?? '',
        refreshToken: fallback.refreshToken,
        expiresAt: fallback.accessToken ? Date.now() + 60_000 : 0,
      };
    }
    return null;
  },

  async setTokens(tokens: StoredAuthTokens): Promise<void> {
    cachedTokens = { ...tokens };
    const expiresIn = Math.max(1, Math.round((tokens.expiresAt - Date.now()) / 1000));
    await storeBridge?.onTokensRefreshed({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn,
    });
  },

  clearTokens(): void {
    // Only clear in-memory cache here; persistent SecureStore is cleared explicitly on 401/403 or logout
    // so offline network errors during refresh never wipe the user's saved session.
    cachedTokens = null;
  },
};

const authKitFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch {
    const baseUrl = getAuthKitBaseUrl();
    throw new ApiRequestError({
      statusCode: 0,
      code: AUTH_ERROR_CODES.INTERNAL_ERROR,
      message: __DEV__
        ? `Unable to reach AuthKit (${baseUrl}). Ensure the authentication server is reachable.`
        : 'Unable to reach the authentication service. Check your internet connection and try again.',
      isNetworkError: true,
    });
  }
};

let clientInstance: AuthKitClient | null = null;

function getAuthKitClient(): AuthKitClient {
  if (!clientInstance) {
    clientInstance = new AuthKitClient({
      baseUrl: getAuthKitBaseUrl(),
      clientId: getAuthKitClientId(),
      storage: authKitTokenStorage,
      fetchImpl: authKitFetch,
      deviceName: defaultDeviceName(),
    });
  }
  return clientInstance;
}

async function resolveSessionUser(
  authkitUser: AuthKitUserDto,
  accessToken: string,
): Promise<AuthUserDto> {
  try {
    const { user: welytUser } = await apiRequest<{ user: AuthUserDto }>('/auth/me', {
      method: 'GET',
      accessTokenOverride: accessToken,
      skipRefresh: true,
    });
    return mergeAuthKitAndWelytUser(authkitUser, welytUser);
  } catch (error) {
    if (error instanceof ApiRequestError && error.isNetworkError) {
      return mapAuthKitUserFallback(authkitUser);
    }
    throw error;
  }
}

export const authApi = {
  async register(input: RegisterInput): Promise<AuthSessionResponseDto> {
    try {
      const session = await getAuthKitClient().register({
        name: input.name,
        email: input.email,
        password: input.password,
        deviceName: input.deviceName ?? defaultDeviceName(),
      });
      const user = await resolveSessionUser(session.user, session.tokens.accessToken);
      return {
        user,
        tokens: toWelytTokens(session.tokens),
      };
    } catch (error) {
      throw toApiRequestError(error);
    }
  },

  async login(input: LoginInput): Promise<AuthSessionResponseDto> {
    try {
      const session = await getAuthKitClient().login({
        email: input.email,
        password: input.password,
        deviceName: input.deviceName ?? defaultDeviceName(),
      });
      const user = await resolveSessionUser(session.user, session.tokens.accessToken);
      return {
        user,
        tokens: toWelytTokens(session.tokens),
      };
    } catch (error) {
      throw toApiRequestError(error);
    }
  },

  async refresh(refreshToken?: string): Promise<{ tokens: AuthTokensDto }> {
    if (refreshToken && (!cachedTokens || cachedTokens.refreshToken !== refreshToken)) {
      seedAuthKitTokens({ refreshToken });
    }

    try {
      const stored = await getAuthKitClient().refreshTokens();
      const expiresIn = Math.max(1, Math.round((stored.expiresAt - Date.now()) / 1000));
      return {
        tokens: {
          accessToken: stored.accessToken,
          refreshToken: stored.refreshToken,
          expiresIn,
        },
      };
    } catch (error) {
      const apiErr = toApiRequestError(error);
      if (apiErr.statusCode === 401 || apiErr.statusCode === 403) {
        await storeBridge?.onSessionInvalidated();
      }
      throw apiErr;
    }
  },

  async me(accessTokenOverride?: string): Promise<{ user: AuthUserDto }> {
    try {
      if (accessTokenOverride && cachedTokens?.refreshToken) {
        cachedTokens = {
          ...cachedTokens,
          accessToken: accessTokenOverride,
          expiresAt: Math.max(cachedTokens.expiresAt, Date.now() + 60_000),
        };
      }

      const [authkitMe, welytMe] = await Promise.all([
        getAuthKitClient().me(),
        apiRequest<{ user: AuthUserDto }>('/auth/me', {
          method: 'GET',
          ...(accessTokenOverride ? { accessTokenOverride, skipRefresh: true } : {}),
        }),
      ]);

      return {
        user: mergeAuthKitAndWelytUser(authkitMe.user, welytMe.user),
      };
    } catch (error) {
      throw toApiRequestError(error);
    }
  },

  async updateProfile(input: UpdateProfileInput): Promise<{ user: AuthUserDto }> {
    try {
      let authkitUser: AuthKitUserDto | null = null;
      if (input.name !== undefined) {
        const updatedIdentity = await getAuthKitClient().updateProfile({ name: input.name });
        authkitUser = updatedIdentity.user;
      }

      const { user: welytUser } = await apiRequest<{ user: AuthUserDto }>('/auth/me', {
        method: 'PATCH',
        body: input,
      });

      if (!authkitUser) {
        try {
          const identity = await getAuthKitClient().me();
          authkitUser = identity.user;
        } catch {
          return { user: welytUser };
        }
      }

      return {
        user: mergeAuthKitAndWelytUser(authkitUser, welytUser, input.name !== undefined),
      };
    } catch (error) {
      throw toApiRequestError(error);
    }
  },

  async verifyEmail(input: VerifyEmailInput): Promise<AuthVerifyEmailResponseDto> {
    const email = input.email ?? storeBridge?.getCurrentUserEmail() ?? undefined;
    if (!email) {
      throw new ApiRequestError({
        statusCode: 400,
        code: AUTH_ERROR_CODES.VALIDATION_ERROR,
        message: 'Email is required to verify your account',
        fieldErrors: { email: ['Email is required'] },
      });
    }

    try {
      const { user: authkitUser } = await getAuthKitClient().verifyEmail({
        email,
        code: input.code,
      });

      const activeRefreshToken = storeBridge?.getSessionTokens().refreshToken;
      if (activeRefreshToken) {
        // Immediately rotate tokens against AuthKit so the new access token carries email_verified: true
        const { tokens } = await authApi.refresh(activeRefreshToken);
        const { user } = await authApi.me(tokens.accessToken);
        return {
          user,
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn,
        };
      }

      return {
        user: mapAuthKitUserFallback(authkitUser),
      };
    } catch (error) {
      throw toApiRequestError(error);
    }
  },

  async resendVerification(email?: string): Promise<MessageResponseDto> {
    const targetEmail = email ?? storeBridge?.getCurrentUserEmail() ?? undefined;
    if (!targetEmail) {
      throw new ApiRequestError({
        statusCode: 400,
        code: AUTH_ERROR_CODES.VALIDATION_ERROR,
        message: 'Email is required to resend a verification code',
        fieldErrors: { email: ['Email is required'] },
      });
    }

    try {
      return await getAuthKitClient().sendOtp(targetEmail, 'email_verification');
    } catch (error) {
      throw toApiRequestError(error);
    }
  },

  async forgotPassword(input: ForgotPasswordInput): Promise<MessageResponseDto> {
    try {
      return await getAuthKitClient().sendOtp(input.email, 'password_reset');
    } catch (error) {
      throw toApiRequestError(error);
    }
  },

  async resetPassword(input: ResetPasswordInput): Promise<MessageResponseDto> {
    try {
      return await getAuthKitClient().resetPassword({
        email: input.email,
        code: input.code,
        newPassword: input.newPassword,
      });
    } catch (error) {
      throw toApiRequestError(error);
    }
  },

  async changePassword(input: ChangePasswordInput): Promise<MessageResponseDto> {
    try {
      return await getAuthKitClient().changePassword({
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
      });
    } catch (error) {
      throw toApiRequestError(error, 'changePassword');
    }
  },

  async logout(refreshToken: string | null): Promise<MessageResponseDto> {
    if (refreshToken && !cachedTokens?.refreshToken) {
      seedAuthKitTokens({
        accessToken: storeBridge?.getSessionTokens().accessToken,
        refreshToken,
      });
    }

    try {
      await getAuthKitClient().logout();
      return { message: 'Signed out' };
    } catch (error) {
      throw toApiRequestError(error);
    }
  },

  async logoutAll(): Promise<MessageResponseDto> {
    try {
      return await getAuthKitClient().logoutAll();
    } catch (error) {
      throw toApiRequestError(error);
    }
  },
};
