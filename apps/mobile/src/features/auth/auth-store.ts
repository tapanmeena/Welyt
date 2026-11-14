import type { AuthSessionResponseDto, AuthTokensDto, AuthUserDto } from '@welyt/shared';
import { create } from 'zustand';
import { ApiRequestError, bindAuthToApiClient } from '@/lib/api-client';
import { queryClient } from '@/lib/query-client';
import {
  clearPersistedSession,
  loadPersistedSession,
  savePersistedSession,
  updatePersistedRefreshToken,
  updatePersistedUser,
} from '@/lib/secure-storage';
import { authApi } from './auth-api';

export type AuthStatus = 'hydrating' | 'unauthenticated' | 'authenticated';

interface AuthState {
  status: AuthStatus;
  user: AuthUserDto | null;
  accessToken: string | null;
  refreshToken: string | null;
  hydrate: () => Promise<void>;
  setSession: (session: AuthSessionResponseDto) => Promise<void>;
  updateTokens: (tokens: AuthTokensDto) => Promise<void>;
  applyVerifiedUser: (user: AuthUserDto, accessToken?: string) => Promise<void>;
  clearSession: () => Promise<void>;
}

let hydrationPromise: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'hydrating',
  user: null,
  accessToken: null,
  refreshToken: null,

  hydrate: async () => {
    if (hydrationPromise) {
      return hydrationPromise;
    }

    hydrationPromise = (async () => {
      const persisted = await loadPersistedSession();
      if (!persisted) {
        set({
          status: 'unauthenticated',
          user: null,
          accessToken: null,
          refreshToken: null,
        });
        return;
      }

      try {
        const { tokens } = await authApi.refresh(persisted.refreshToken);
        const { user } = await authApi.me(tokens.accessToken);

        await savePersistedSession({
          refreshToken: tokens.refreshToken,
          user,
        });

        set({
          status: 'authenticated',
          user,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        });
      } catch (error) {
        if (error instanceof ApiRequestError && error.isNetworkError) {
          // Offline resilience: retain persisted refresh token and cached user on transient network failure
          set({
            status: 'authenticated',
            user: persisted.user,
            accessToken: null,
            refreshToken: persisted.refreshToken,
          });
          return;
        }

        await clearPersistedSession();
        set({
          status: 'unauthenticated',
          user: null,
          accessToken: null,
          refreshToken: null,
        });
      }
    })();

    try {
      await hydrationPromise;
    } finally {
      hydrationPromise = null;
    }
  },

  setSession: async (session) => {
    await savePersistedSession({
      refreshToken: session.tokens.refreshToken,
      user: session.user,
    });

    set({
      status: 'authenticated',
      user: session.user,
      accessToken: session.tokens.accessToken,
      refreshToken: session.tokens.refreshToken,
    });
  },

  updateTokens: async (tokens) => {
    await updatePersistedRefreshToken(tokens.refreshToken);
    set({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  },

  applyVerifiedUser: async (user, accessToken) => {
    await updatePersistedUser(user);
    set((current) => ({
      user,
      accessToken: accessToken ?? current.accessToken,
      status: current.refreshToken ? 'authenticated' : current.status,
    }));
  },

  clearSession: async () => {
    await clearPersistedSession();
    queryClient.clear();
    set({
      status: 'unauthenticated',
      user: null,
      accessToken: null,
      refreshToken: null,
    });
  },
}));

bindAuthToApiClient({
  getAccessToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  onTokensRefreshed: async (tokens) => {
    await useAuthStore.getState().updateTokens(tokens);
  },
  onSessionInvalidated: async () => {
    await useAuthStore.getState().clearSession();
  },
});
