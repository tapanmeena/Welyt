import AsyncStorage from '@react-native-async-storage/async-storage';
import { authUserSchema, type AuthUserDto } from '@welyt/shared';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { z } from 'zod';

const REFRESH_TOKEN_KEY = 'welyt.auth.refresh_token';
const CACHED_USER_KEY = 'welyt.auth.cached_user';

const persistedSessionSchema = z.object({
  refreshToken: z.string().min(1),
  user: authUserSchema,
});

export type PersistedSession = z.infer<typeof persistedSessionSchema>;

const isNativeSecureStoreAvailable = Platform.OS === 'ios' || Platform.OS === 'android';

async function getRawItem(key: string): Promise<string | null> {
  if (isNativeSecureStoreAvailable) {
    return SecureStore.getItemAsync(key);
  }
  if (typeof window === 'undefined') {
    return null;
  }
  return AsyncStorage.getItem(key);
}

async function setRawItem(key: string, value: string): Promise<void> {
  if (isNativeSecureStoreAvailable) {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function deleteRawItem(key: string): Promise<void> {
  if (isNativeSecureStoreAvailable) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }
  await AsyncStorage.removeItem(key);
}

export async function loadPersistedSession(): Promise<PersistedSession | null> {
  try {
    const [refreshToken, rawUser] = await Promise.all([
      getRawItem(REFRESH_TOKEN_KEY),
      getRawItem(CACHED_USER_KEY),
    ]);

    if (!refreshToken || !rawUser) {
      return null;
    }

    const parsedUser: unknown = JSON.parse(rawUser);
    const validated = persistedSessionSchema.safeParse({
      refreshToken,
      user: parsedUser,
    });

    if (!validated.success) {
      await clearPersistedSession();
      return null;
    }

    return validated.data;
  } catch {
    return null;
  }
}

export async function savePersistedSession(session: {
  refreshToken: string;
  user: AuthUserDto;
}): Promise<void> {
  await Promise.all([
    setRawItem(REFRESH_TOKEN_KEY, session.refreshToken),
    setRawItem(CACHED_USER_KEY, JSON.stringify(session.user)),
  ]);
}

export async function updatePersistedRefreshToken(refreshToken: string): Promise<void> {
  await setRawItem(REFRESH_TOKEN_KEY, refreshToken);
}

export async function updatePersistedUser(user: AuthUserDto): Promise<void> {
  await setRawItem(CACHED_USER_KEY, JSON.stringify(user));
}

export async function clearPersistedSession(): Promise<void> {
  await Promise.all([deleteRawItem(REFRESH_TOKEN_KEY), deleteRawItem(CACHED_USER_KEY)]);
}
