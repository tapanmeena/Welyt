import { Tabs } from 'expo-router';
import { colors } from '@/theme/colors';

export const unstable_settings = { anchor: 'monthly-plan' };

export default function PlanLayout() {
  return (
    <Tabs
      backBehavior="history"
      tabBar={() => null}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.cream } }}
    >
      <Tabs.Screen name="monthly-plan" />
      <Tabs.Screen name="income" />
    </Tabs>
  );
}
