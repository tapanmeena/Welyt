import { useQuery } from '@tanstack/react-query';
import type { AccountDto } from '@welyt/shared';
import { useRouter } from 'expo-router';
import { ChevronRight, Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '@/components/auth/AuthButton';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { AccountForm } from '@/features/accounts/AccountForm';
import {
  AccountsShell,
  accountKindLabels,
  accountsStyles as styles,
} from '@/features/accounts/AccountsShell';
import { accountsQueries } from '@/features/accounts/accounts-api';
import { useAuthStore } from '@/features/auth/auth-store';
import { colors, radii } from '@/theme/colors';

function AccountGroup({
  title,
  accounts,
  onSelect,
}: {
  title: string;
  accounts: AccountDto[];
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {accounts.map((account) => (
        <Pressable
          key={account.id}
          accessibilityRole="button"
          accessibilityLabel={`${account.name}, ${account.currencyCode}${account.archivedAt ? ', archived' : ''}`}
          onPress={() => onSelect(account.id)}
          style={({ pressed }) => [styles.card, styles.row, pressed && styles.pressed]}
        >
          <View style={listStyles.tile}>
            <Wallet size={20} color={colors.tileNavyFg} strokeWidth={1.7} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.heading}>{account.name}</Text>
            <Text style={styles.muted}>
              {accountKindLabels[account.kind]} / {account.currencyCode}
            </Text>
          </View>
          <ChevronRight size={17} color={colors.muted} strokeWidth={1.8} />
        </Pressable>
      ))}
    </View>
  );
}

function AccountsList({ userId }: { userId: string }) {
  const router = useRouter();
  const accounts = useQuery(accountsQueries.list(userId));
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (adding) {
    return (
      <AccountsShell
        key="create"
        title="Add account"
        subtitle="Choose the currency in which you hold this balance."
        backLabel="Accounts"
        onBack={() => setAdding(false)}
      >
        <AccountForm
          userId={userId}
          onSaved={() => {
            setNotice('Account created. Open it to record your first balance.');
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      </AccountsShell>
    );
  }

  const active = accounts.data?.filter((account) => !account.archivedAt) ?? [];
  const archived = accounts.data?.filter((account) => account.archivedAt) ?? [];
  const select = (accountId: string) =>
    router.push({ pathname: '/accounts/[accountId]', params: { accountId } });

  return (
    <AccountsShell
      title="Accounts & Cash"
      subtitle="Track dated balances in each account's original currency."
      backLabel="Workspace"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    >
      <StatusBanner tone="success" message={notice} />
      <AuthButton
        label="Add account"
        onPress={() => {
          setNotice(null);
          setAdding(true);
        }}
      />
      {accounts.isError ? (
        <View style={styles.section}>
          <StatusBanner
            tone="error"
            message={`Could not load accounts. ${accounts.error.message}`}
          />
          <AuthButton
            variant="secondary"
            label="Retry accounts"
            loading={accounts.isFetching}
            onPress={() => void accounts.refetch()}
          />
        </View>
      ) : accounts.isPending ? (
        <ActivityIndicator
          accessibilityLabel="Loading accounts"
          color={colors.rust}
          style={styles.loading}
        />
      ) : active.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.heading}>No active accounts</Text>
          <Text style={styles.muted}>
            Add a bank, cash, e-wallet, or brokerage cash account to get started.
          </Text>
        </View>
      ) : null}
      {active.length > 0 ? (
        <AccountGroup title="Active accounts" accounts={active} onSelect={select} />
      ) : null}
      {archived.length > 0 ? (
        <AccountGroup title="Archived accounts" accounts={archived} onSelect={select} />
      ) : null}
    </AccountsShell>
  );
}

export default function AccountsRoute() {
  const userId = useAuthStore((state) => state.user?.id);
  return userId ? <AccountsList key={userId} userId={userId} /> : null;
}

const listStyles = StyleSheet.create({
  tile: {
    backgroundColor: colors.tileNavyBg,
    width: 40,
    height: 40,
    borderRadius: radii.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
