import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useAuthStore } from '@/features/auth/auth-store';
import { queryClient } from '@/lib/query-client';
import { colors } from '@/theme/colors';

void SplashScreen.preventAutoHideAsync().catch(() => {
  // Ignore if splash screen is unavailable on web or already prevented
});

function RootNavigator() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (status !== 'hydrating') {
      void SplashScreen.hideAsync().catch(() => {
        // Ignore if already hidden
      });
    }
  }, [status]);

  if (status === 'hydrating') {
    return (
      <View style={styles.hydratingContainer}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.hydratingLogo}
          accessibilityLabel="Welyt logo"
        />
        <ActivityIndicator size="small" color={colors.navy} />
      </View>
    );
  }

  const isAuthenticated = status === 'authenticated' && user !== null;
  const isEmailVerified = isAuthenticated && user.emailVerifiedAt !== null;
  const needsEmailVerification = isAuthenticated && user.emailVerifiedAt === null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected
        guard={isEmailVerified}
        redirectTo={needsEmailVerification ? '/verify-email' : '/sign-in'}
      >
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={!isEmailVerified} redirectTo="/">
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <RootNavigator />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  hydratingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: 20,
  },
  hydratingLogo: {
    width: 72,
    height: 72,
    borderRadius: 20,
  },
});
