import { Tabs } from 'expo-router';
import { renderWorkspaceTabScene } from '@/components/navigation/WorkspaceNavigation';
import { colors } from '@/theme/colors';

export const unstable_settings = { anchor: 'monthly-plan' };

export default function PlanLayout() {
  return (
    <Tabs
      backBehavior="initialRoute"
      screenLayout={renderWorkspaceTabScene}
      tabBar={() => null}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.cream } }}
    >
      <Tabs.Screen name="monthly-plan" />
      <Tabs.Screen name="income" />
    </Tabs>
  );
}
