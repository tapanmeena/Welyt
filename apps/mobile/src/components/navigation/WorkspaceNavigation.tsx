import { useFocusEffect, useIsFocused } from 'expo-router';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';

export const workspaceTabBarHeight = 60;

export const WorkspaceNavigationContext = createContext<{
  tabBarVisible: boolean;
  setEditorOpen: (open: boolean) => void;
} | null>(null);

export function useWorkspaceEditor(open: boolean, close: () => void) {
  const setEditorOpen = useContext(WorkspaceNavigationContext)?.setEditorOpen;

  useFocusEffect(
    useCallback(() => {
      if (!open || !setEditorOpen) return;

      setEditorOpen(true);
      const back =
        Platform.OS === 'android'
          ? BackHandler.addEventListener('hardwareBackPress', () => {
              close();
              return true;
            })
          : undefined;
      return () => {
        back?.remove();
        setEditorOpen(false);
      };
    }, [close, open, setEditorOpen]),
  );
}

function WebTabScene({ children }: { children: ReactNode }) {
  const focused = useIsFocused();
  return <View style={focused ? styles.scene : styles.hidden}>{children}</View>;
}

export function renderWorkspaceTabScene({ children }: { children: ReactNode }) {
  // Web stacks tab scenes behind the active one; hide their content without unmounting it.
  return Platform.OS === 'web' ? <WebTabScene>{children}</WebTabScene> : <>{children}</>;
}

const styles = StyleSheet.create({
  scene: { flex: 1 },
  hidden: { display: 'none' },
});
