import { Stack } from 'expo-router';
import { useAuthStore } from '@/features/auth/auth-store';
import { colors } from '@/theme/colors';

export default function AuthGroupLayout() {
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);

  const isAuthenticated = status === 'authenticated' && user !== null;
  const isEmailVerified = isAuthenticated && user.emailVerifiedAt !== null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream },
      }}
    >
      <Stack.Protected
        guard={!isAuthenticated}
        redirectTo={isEmailVerified ? '/' : '/verify-email'}
      >
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="reset-password" />
      </Stack.Protected>

      <Stack.Protected guard={!isEmailVerified} redirectTo="/">
        <Stack.Screen name="verify-email" />
      </Stack.Protected>
    </Stack>
  );
}
