import { Stack, useSegments } from 'expo-router';
import { useMemo, useState } from 'react';
import { SuccessSnackbarProvider } from '@/components/SuccessSnackbar';
import {
  WorkspaceNavigationContext,
  workspaceTabBarHeight,
} from '@/components/navigation/WorkspaceNavigation';
import { useAuthStore } from '@/features/auth/auth-store';
import { colors } from '@/theme/colors';

export default function ProtectedAppLayout() {
  const userId = useAuthStore((state) => state.user?.id);
  return <WorkspaceStack key={userId} />;
}

function WorkspaceStack() {
  const segments = useSegments();
  const [editorOpen, setEditorOpen] = useState(false);
  const tabBarVisible = segments.includes('(tabs)') && !editorOpen;
  const chrome = useMemo(() => ({ tabBarVisible, setEditorOpen }), [tabBarVisible]);

  return (
    <WorkspaceNavigationContext.Provider value={chrome}>
      <SuccessSnackbarProvider bottomOffset={tabBarVisible ? workspaceTabBarHeight : 0}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.cream },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="accounts/[accountId]" />
          <Stack.Screen name="change-password" />
        </Stack>
      </SuccessSnackbarProvider>
    </WorkspaceNavigationContext.Provider>
  );
}
