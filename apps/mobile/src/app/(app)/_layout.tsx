import { Stack } from 'expo-router';
import { colors } from '@/theme/colors';

export default function ProtectedAppLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.cream },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="change-password" />
    </Stack>
  );
}
