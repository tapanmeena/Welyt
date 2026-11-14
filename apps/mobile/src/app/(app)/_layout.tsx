import { Stack } from 'expo-router';

export default function ProtectedAppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="change-password" />
    </Stack>
  );
}
