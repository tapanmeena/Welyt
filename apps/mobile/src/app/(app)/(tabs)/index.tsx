import { FinanceScreen } from '@/components/FinanceScreen';
import { CashSummary } from '@/features/accounts/CashSummary';
import { useAuthStore } from '@/features/auth/auth-store';

export default function HomeScreen() {
  const userId = useAuthStore((state) => state.user?.id);
  if (!userId) return null;

  return (
    <FinanceScreen title="Home">
      <CashSummary userId={userId} />
    </FinanceScreen>
  );
}
