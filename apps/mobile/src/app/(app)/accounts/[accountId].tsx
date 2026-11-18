import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { accountParamsSchema, type BalanceSnapshotDto } from '@welyt/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '@/components/auth/AuthButton';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { AccountForm } from '@/features/accounts/AccountForm';
import {
  AccountsShell,
  accountKindLabels,
  accountsStyles as styles,
  displayBalance,
} from '@/features/accounts/AccountsShell';
import { SnapshotForm } from '@/features/accounts/SnapshotForm';
import { accountsApi, accountsQueries } from '@/features/accounts/accounts-api';
import { useAuthStore } from '@/features/auth/auth-store';
import { colors, radii } from '@/theme/colors';

type Panel =
  { type: 'edit' | 'archive' | 'record' } | { type: 'correct'; snapshot: BalanceSnapshotDto };

function SnapshotRow({
  snapshot,
  onCorrect,
}: {
  snapshot: BalanceSnapshotDto;
  onCorrect: (() => void) | null;
}) {
  const superseded = snapshot.retiredAt !== null;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.heading}>
            {displayBalance(snapshot.currencyCode, snapshot.balance)}
          </Text>
          <Text style={styles.muted}>{snapshot.observedOn}</Text>
        </View>
        {superseded || snapshot.replacesObservationId ? (
          <Text style={detailStyles.badge}>{superseded ? 'Superseded' : 'Correction'}</Text>
        ) : null}
      </View>
      {snapshot.notes ? <Text style={styles.muted}>{snapshot.notes}</Text> : null}
      {onCorrect ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Correct balance for ${snapshot.observedOn}`}
          onPress={onCorrect}
          style={({ pressed }) => [detailStyles.textAction, pressed && styles.pressed]}
        >
          <Text style={detailStyles.actionLabel}>Correct balance</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AccountDetail({
  userId,
  accountId,
  onBack,
}: {
  userId: string;
  accountId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const list = useQuery(accountsQueries.list(userId));
  const account = list.data?.find((item) => item.id === accountId);
  const history = useQuery({ ...accountsQueries.snapshots(userId, accountId), enabled: !!account });
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const archive = useMutation({
    mutationFn: () => accountsApi.archiveAccount(accountId),
    onSuccess: (saved) => {
      const { queryKey } = accountsQueries.list(userId);
      queryClient.setQueryData(queryKey, (items) =>
        items?.map((item) => (item.id === saved.id ? saved : item)),
      );
      void queryClient.invalidateQueries({ queryKey });
      setPanel(null);
      setNotice('Account archived. You can still read its balance history.');
    },
  });

  function openPanel(next: Panel) {
    setNotice(null);
    setPanel(next);
  }
  const closePanel = () => setPanel(null);
  function finish(message: string) {
    setNotice(message);
    closePanel();
  }

  if (account && !account.archivedAt && panel?.type === 'edit') {
    return (
      <AccountsShell
        key="edit"
        title="Edit account"
        subtitle={account.name}
        backLabel="Account details"
        onBack={closePanel}
      >
        <AccountForm
          userId={userId}
          account={account}
          onSaved={() => finish('Account updated.')}
          onCancel={closePanel}
        />
      </AccountsShell>
    );
  }
  if (account && !account.archivedAt && (panel?.type === 'record' || panel?.type === 'correct')) {
    const original = panel.type === 'correct' ? panel.snapshot : null;
    return (
      <AccountsShell
        key={original?.id ?? 'record'}
        title={original ? 'Correct balance' : 'Record balance'}
        subtitle={
          original
            ? `The original ${account.currencyCode} balance stays in history.`
            : `Record an observed balance for ${account.name}.`
        }
        backLabel="Account details"
        onBack={closePanel}
      >
        <SnapshotForm
          userId={userId}
          account={account}
          original={original}
          onSaved={() =>
            finish(
              original
                ? 'Correction saved. The original is marked superseded.'
                : 'Balance recorded.',
            )
          }
          onCancel={closePanel}
        />
      </AccountsShell>
    );
  }

  const latest = history.data?.find((snapshot) => snapshot.retiredAt === null);
  return (
    <AccountsShell
      title={account?.name ?? 'Account details'}
      subtitle={
        account
          ? `${accountKindLabels[account.kind]} / ${account.currencyCode}`
          : 'Manage an account and its dated balances.'
      }
      backLabel="Accounts"
      onBack={onBack}
    >
      <StatusBanner tone="success" message={notice} />
      {list.isError ? (
        <View style={styles.section}>
          <StatusBanner
            tone="error"
            message={`Could not load account details. ${list.error.message}`}
          />
          <AuthButton
            variant="secondary"
            label="Retry accounts"
            loading={list.isFetching}
            onPress={() => void list.refetch()}
          />
        </View>
      ) : list.isPending ? (
        <ActivityIndicator
          accessibilityLabel="Loading account"
          color={colors.rust}
          style={styles.loading}
        />
      ) : !account ? (
        <StatusBanner tone="info" message="This account is not available." />
      ) : null}
      {account ? (
        <>
          <View style={detailStyles.balanceCard}>
            <Text style={detailStyles.balanceLabel}>Latest recorded balance</Text>
            <Text style={detailStyles.balanceValue}>
              {latest
                ? displayBalance(latest.currencyCode, latest.balance)
                : history.isPending
                  ? 'Loading balance...'
                  : history.isError && !history.data
                    ? 'Balance unavailable'
                    : 'No balance recorded'}
            </Text>
            {latest ? (
              <Text style={detailStyles.balanceLabel}>Observed on {latest.observedOn}</Text>
            ) : null}
          </View>
          {account.archivedAt ? (
            <StatusBanner
              tone="info"
              message="Archived account. Its balance history is read-only."
            />
          ) : (
            <View style={styles.section}>
              <AuthButton label="Record balance" onPress={() => openPanel({ type: 'record' })} />
              <AuthButton
                variant="secondary"
                label="Edit account"
                onPress={() => openPanel({ type: 'edit' })}
              />
            </View>
          )}
          {account.purpose || account.notes || !account.inNetWorth ? (
            <View style={styles.card}>
              {account.purpose ? (
                <Text style={styles.muted}>Purpose: {account.purpose}</Text>
              ) : null}
              {account.notes ? <Text style={styles.muted}>{account.notes}</Text> : null}
              {!account.inNetWorth ? (
                <Text style={styles.muted}>Excluded from INR reporting.</Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>
              Balance history
            </Text>
            {history.isError ? (
              <>
                <StatusBanner
                  tone="error"
                  message={`Could not load balance history. ${history.error.message}`}
                />
                <AuthButton
                  variant="secondary"
                  label="Retry history"
                  loading={history.isFetching}
                  onPress={() => void history.refetch()}
                />
              </>
            ) : history.isPending ? (
              <ActivityIndicator
                accessibilityLabel="Loading history"
                color={colors.rust}
                style={styles.loading}
              />
            ) : history.data.length === 0 ? (
              <Text style={styles.muted}>There are no snapshots for this account yet.</Text>
            ) : null}
            {history.data?.map((snapshot) => (
              <SnapshotRow
                key={snapshot.id}
                snapshot={snapshot}
                onCorrect={
                  !account.archivedAt && !snapshot.retiredAt
                    ? () => openPanel({ type: 'correct', snapshot })
                    : null
                }
              />
            ))}
          </View>
          {!account.archivedAt ? (
            panel?.type === 'archive' ? (
              <View style={styles.card}>
                <Text accessibilityRole="header" style={styles.heading}>
                  Archive this account?
                </Text>
                <Text style={styles.muted}>
                  The balance history stays available, but you will no longer be able to edit the
                  account or record balances.
                </Text>
                <StatusBanner tone="error" message={archive.error?.message} />
                <AuthButton
                  variant="danger"
                  label="Confirm archive"
                  loading={archive.isPending}
                  onPress={() => archive.mutate()}
                />
                <AuthButton
                  variant="secondary"
                  label="Cancel"
                  disabled={archive.isPending}
                  onPress={closePanel}
                />
              </View>
            ) : (
              <AuthButton
                variant="secondary"
                label="Archive account"
                onPress={() => {
                  archive.reset();
                  openPanel({ type: 'archive' });
                }}
              />
            )
          ) : null}
        </>
      ) : null}
    </AccountsShell>
  );
}

export default function AccountDetailRoute() {
  const router = useRouter();
  const { accountId } = useLocalSearchParams();
  const userId = useAuthStore((state) => state.user?.id);
  const account = accountParamsSchema.safeParse({ accountId });
  const onBack = () => (router.canGoBack() ? router.back() : router.replace('/accounts'));

  if (!userId) return null;
  if (!account.success) {
    return (
      <AccountsShell
        title="Account not found"
        subtitle="Open an account from your list."
        backLabel="Accounts"
        onBack={onBack}
      >
        <Text style={styles.muted}>The account link is not valid.</Text>
      </AccountsShell>
    );
  }
  return (
    <AccountDetail
      key={`${userId}:${account.data.accountId}`}
      userId={userId}
      accountId={account.data.accountId}
      onBack={onBack}
    />
  );
}

const detailStyles = StyleSheet.create({
  balanceCard: { backgroundColor: colors.navy, borderRadius: radii.hero, padding: 18, gap: 7 },
  balanceLabel: { color: colors.heroSubtle, fontSize: 13, lineHeight: 19 },
  balanceValue: {
    color: colors.heroText,
    fontSize: 25,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  badge: {
    backgroundColor: colors.badgeNeutralBg,
    color: colors.badgeNeutralFg,
    borderRadius: radii.badge,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '600',
  },
  textAction: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 44 },
  actionLabel: { color: colors.rust, fontSize: 13, fontWeight: '700' },
});
