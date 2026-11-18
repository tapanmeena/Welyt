import { Stack } from 'expo-router';
import { SuccessSnackbarProvider } from '@/components/SuccessSnackbar';
import { useAuthStore } from '@/features/auth/auth-store';
import { colors } from '@/theme/colors';

export default function ProtectedAppLayout() {
  const userId = useAuthStore((state) => state.user?.id);
  return (
    <SuccessSnackbarProvider key={userId}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.cream },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="change-password" />
        <Stack.Screen name="accounts/index" />
        <Stack.Screen name="accounts/[accountId]" />
        <Stack.Screen name="income" />
        <Stack.Screen name="monthly-plan" />
      </Stack>
    </SuccessSnackbarProvider>
  );
}
