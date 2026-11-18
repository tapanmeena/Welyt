import type { AccountDto } from '@welyt/shared';

export {
  FinanceScreen as AccountsShell,
  FinanceChoice as AccountChoice,
  financeStyles as accountsStyles,
} from '@/components/FinanceScreen';

export const accountKindLabels: Record<AccountDto['kind'], string> = {
  bank: 'Bank',
  cash: 'Physical cash',
  ewallet: 'E-wallet / prepaid',
  brokerage_cash: 'Brokerage cash',
};
