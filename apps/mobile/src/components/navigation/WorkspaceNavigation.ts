import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext } from 'react';
import { BackHandler } from 'react-native';

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
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        close();
        return true;
      });
      return () => {
        back.remove();
        setEditorOpen(false);
      };
    }, [close, open, setEditorOpen]),
  );
}
