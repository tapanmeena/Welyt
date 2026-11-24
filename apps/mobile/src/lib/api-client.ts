import { AUTH_ERROR_CODES, apiErrorResponseSchema, type ApiErrorCode } from '@welyt/shared';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_AUTHKIT_URL = 'https://auth.tapanmeena.com';
const DEFAULT_AUTHKIT_CLIENT_ID = 'welyt-mobile';
const LOOPBACK_URL_PATTERN = /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i;

function extractDevMetroHost(): string | null {
  const candidates = [Constants.expoConfig?.hostUri, Constants.experienceUrl, Constants.linkingUri];

  for (const raw of candidates) {
    if (!raw) {
      continue;
    }
    const withoutScheme = raw.replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//, '');
    const authority = withoutScheme.split('/')[0];
    const host = authority?.split(':')[0]?.trim();
    if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
      return host;
    }
  }

  return null;
}

function rewriteDevLoopbackUrl(url: string): string {
  if (__DEV__ && Platform.OS !== 'web') {
    const loopbackMatch = LOOPBACK_URL_PATTERN.exec(url);
    if (loopbackMatch) {
      const [, protocol, , port = '', pathname = ''] = loopbackMatch;
      const metroHost = extractDevMetroHost();
      if (metroHost) {
        return `${protocol}${metroHost}${port}${pathname}`;
      }
      if (Platform.OS === 'android') {
        return `${protocol}10.0.2.2${port}${pathname}`;
      }
    }
  }
  return url;
}

export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');

  if (configured) {
    return rewriteDevLoopbackUrl(configured);
  }

  if (Platform.OS !== 'web') {
    const metroHost = extractDevMetroHost();
    if (metroHost) {
      return `http://${metroHost}:3000`;
    }
    if (Platform.OS === 'android') {
      return 'http://10.0.2.2:3000';
    }
  }

  return 'http://localhost:3000';
}

export function getAuthKitBaseUrl(): string {
  const extraUrl =
    typeof Constants.expoConfig?.extra?.authkitUrl === 'string'
      ? Constants.expoConfig.extra.authkitUrl.trim()
      : '';
  const configured = (process.env.EXPO_PUBLIC_AUTHKIT_URL?.trim() || extraUrl).replace(/\/+$/, '');
  return rewriteDevLoopbackUrl(configured || DEFAULT_AUTHKIT_URL);
}

export function getAuthKitClientId(): string {
  const extraClientId =
    typeof Constants.expoConfig?.extra?.authkitClientId === 'string'
      ? Constants.expoConfig.extra.authkitClientId.trim()
      : '';
  return (
    process.env.EXPO_PUBLIC_AUTHKIT_CLIENT_ID?.trim() || extraClientId || DEFAULT_AUTHKIT_CLIENT_ID
  );
}

export class ApiRequestError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly fieldErrors: Record<string, string[]> | undefined;
  readonly isNetworkError: boolean;

  constructor(options: {
    statusCode: number;
    code: ApiErrorCode;
    message: string;
    fieldErrors?: Record<string, string[]> | undefined;
    isNetworkError?: boolean | undefined;
  }) {
    super(options.message);
    this.name = 'ApiRequestError';
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.fieldErrors = options.fieldErrors;
    this.isNetworkError = options.isNetworkError ?? false;
  }
}

export interface AuthClientBindings {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  refreshAccessToken: () => Promise<string | null>;
}

let authBindings: AuthClientBindings | null = null;

export function bindAuthToApiClient(bindings: AuthClientBindings): void {
  authBindings = bindings;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  skipAuth?: boolean;
  skipRefresh?: boolean;
  accessTokenOverride?: string;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function performRawFetch(
  path: string,
  options: ApiRequestOptions,
  accessToken: string | null,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (!options.skipAuth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const baseUrl = getApiBaseUrl();

  try {
    return await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiRequestError({
      statusCode: 0,
      code: AUTH_ERROR_CODES.INTERNAL_ERROR,
      message: __DEV__
        ? `Unable to reach the server (${baseUrl}). Ensure the API server is running and reachable on your network.`
        : 'Unable to reach the server. Check your internet connection and try again.',
      isNetworkError: true,
    });
  }
}

async function tryRefreshAccessToken(): Promise<string | null> {
  if (!authBindings) {
    return null;
  }

  try {
    return await authBindings.refreshAccessToken();
  } catch (error) {
    if (error instanceof ApiRequestError && error.isNetworkError) {
      throw error;
    }
    return null;
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  let initialToken =
    options.accessTokenOverride ??
    (options.skipAuth ? null : (authBindings?.getAccessToken() ?? null));

  if (
    !initialToken &&
    !options.skipAuth &&
    !options.skipRefresh &&
    !options.accessTokenOverride &&
    authBindings?.getRefreshToken()
  ) {
    initialToken = await tryRefreshAccessToken();
  }

  let response = await performRawFetch(path, options, initialToken);

  if (
    response.status === 401 &&
    !options.skipAuth &&
    !options.skipRefresh &&
    !options.accessTokenOverride &&
    authBindings?.getRefreshToken()
  ) {
    const refreshedAccessToken = await tryRefreshAccessToken();
    if (refreshedAccessToken) {
      response = await performRawFetch(path, options, refreshedAccessToken);
    }
  }

  const payload = await parseJsonSafe(response);

  if (!response.ok) {
    const parsedError = apiErrorResponseSchema.safeParse(payload);
    if (parsedError.success) {
      throw new ApiRequestError({
        statusCode: response.status,
        code: parsedError.data.error.code,
        message: parsedError.data.error.message,
        fieldErrors: parsedError.data.error.fieldErrors,
      });
    }

    throw new ApiRequestError({
      statusCode: response.status,
      code:
        response.status === 401
          ? AUTH_ERROR_CODES.UNAUTHORIZED
          : response.status === 429
            ? AUTH_ERROR_CODES.RATE_LIMITED
            : AUTH_ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong while processing your request.',
    });
  }

  return payload as T;
}
