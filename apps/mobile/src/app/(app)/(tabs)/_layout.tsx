import { Tabs } from 'expo-router';
import { ClipboardList, Ellipsis, House, Wallet } from 'lucide-react-native';
import { useContext } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  WorkspaceNavigationContext,
  renderWorkspaceTabScene,
  workspaceTabBarHeight,
} from '@/components/navigation/WorkspaceNavigation';
import { colors, radii } from '@/theme/colors';

export default function WorkspaceTabs() {
  const { bottom } = useSafeAreaInsets();
  const visible = useContext(WorkspaceNavigationContext)?.tabBarVisible;

  return (
    <Tabs
      backBehavior={Platform.OS === 'web' ? 'fullHistory' : 'firstRoute'}
      screenLayout={renderWorkspaceTabScene}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.cream },
        tabBarActiveTintColor: colors.rust,
        tabBarInactiveTintColor: colors.muted,
        tabBarActiveBackgroundColor: colors.selectedBg,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: styles.label,
        tabBarItemStyle: styles.tab,
        tabBarStyle: [
          styles.bar,
          { height: workspaceTabBarHeight + bottom },
          !visible && styles.hidden,
        ],
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home',
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="accounts/index"
        options={{
          title: 'Accounts',
          tabBarAccessibilityLabel: 'Accounts',
          tabBarIcon: ({ color, size }) => <Wallet color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="(plan)"
        options={{
          title: 'Plan',
          tabBarAccessibilityLabel: 'Plan',
          tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarAccessibilityLabel: 'More',
          tabBarIcon: ({ color, size }) => <Ellipsis color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.card,
    borderTopColor: colors.line,
    paddingTop: 4,
  },
  tab: { borderRadius: radii.control, marginHorizontal: 3, marginBottom: 4, minHeight: 48 },
  label: { fontSize: 12, fontWeight: '600' },
  hidden: { display: 'none' },
});
