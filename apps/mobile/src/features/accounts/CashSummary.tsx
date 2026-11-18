import { useQuery } from '@tanstack/react-query';
import type { AccountValuationDto, AccountsValuationDto } from '@welyt/shared';
import { useFocusEffect } from 'expo-router';
import { RefreshCw } from 'lucide-react-native';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { colors, radii } from '@/theme/colors';
import { accountsQueries } from './accounts-api';
import { displayBalance } from './format-balance';

type ValuationIssue = NonNullable<AccountValuationDto['issue']>;

function rateAge(ageDays: number): string {
  return `${ageDays} ${ageDays === 1 ? 'day' : 'days'} old`;
}

function issueMessage(currencyCode: string, issue: ValuationIssue): string {
  switch (issue.reason) {
    case 'missing_snapshot':
      return 'No balance recorded.';
    case 'missing_fx_rate':
      return `No ${currencyCode} to INR rate available.`;
    case 'stale_fx_rate':
      return `${currencyCode} to INR rate from ${issue.rateOn} is too old (${rateAge(issue.ageDays)}).`;
  }
}

function rateSource(source: string): string {
  if (source === 'frankfurter') return 'Frankfurter';
  return source === 'manual' ? 'manual rate' : source;
}

function CashValuation({ report }: { report: AccountsValuationDto }) {
  const accountCount = report.accounts.length;
  if (accountCount === 0) {
    return (
      <>
        <Text style={styles.label}>No accounts included in INR reporting</Text>
        <Text style={styles.detail}>Add an account or update its settings in Accounts & Cash.</Text>
      </>
    );
  }

  const valuedCount = report.accounts.filter(({ inrBalance }) => inrBalance !== null).length;
  const amount = report.complete
    ? report.totalInr
    : valuedCount > 0
      ? report.knownSubtotalInr
      : null;
  const ratesUsed = new Map(
    report.accounts.flatMap(({ currencyCode, fxRate }) =>
      fxRate ? [[currencyCode, fxRate] as const] : [],
    ),
  );

  return (
    <>
      <View style={styles.amountBlock} accessibilityLiveRegion="polite">
        <Text style={styles.label}>{report.complete ? 'Cash total' : 'Known cash subtotal'}</Text>
        {amount !== null ? (
          <Text style={styles.amount}>{displayBalance(report.reportingCurrencyCode, amount)}</Text>
        ) : (
          <Text style={styles.label}>No balances could be valued</Text>
        )}
        <Text style={styles.detail}>As of {report.asOf} (India time)</Text>
      </View>
      <Text style={styles.detail}>Active accounts included in INR reporting.</Text>
      {!report.complete ? (
        <View style={styles.detailsGroup}>
          <StatusBanner
            tone="warning"
            message={`Incomplete: ${valuedCount} of ${accountCount} included accounts could be valued.`}
          />
          {report.accounts.map(({ accountId, name, currencyCode, issue }) =>
            issue ? (
              <Text key={accountId} style={styles.detail}>
                <Text style={styles.label}>{name}: </Text>
                {issueMessage(currencyCode, issue)}
              </Text>
            ) : null,
          )}
        </View>
      ) : null}
      {ratesUsed.size > 0 ? (
        <View style={styles.detailsGroup}>
          <Text style={styles.label}>Exchange rates used</Text>
          {[...ratesUsed].map(([currencyCode, rate]) => (
            <Text key={currencyCode} style={styles.detail}>
              {`${currencyCode} to INR: ${rate.rateOn} (${rateSource(rate.source)}${rate.ageDays ? `, ${rateAge(rate.ageDays)}` : ''})`}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );
}

export function CashSummary({ userId }: { userId: string }) {
  const { data, isFetching, isPending, isError, refetch } = useQuery(
    accountsQueries.valuation(userId),
  );
  const refresh = useCallback(() => {
    void refetch({ cancelRefetch: false });
  }, [refetch]);
  useFocusEffect(refresh);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          Cash summary
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh cash summary"
          accessibilityState={{ busy: isFetching, disabled: isFetching }}
          disabled={isFetching}
          onPress={refresh}
          style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}
        >
          {isFetching ? (
            <ActivityIndicator size="small" color={colors.rust} />
          ) : (
            <RefreshCw size={17} color={colors.rust} strokeWidth={1.8} />
          )}
        </Pressable>
      </View>
      <StatusBanner
        tone="error"
        message={
          isError
            ? data
              ? 'Could not refresh the cash summary. Showing the last loaded values.'
              : 'Could not load the cash summary. Check your connection and try again.'
            : null
        }
      />
      {isPending ? <Text style={styles.detail}>Loading cash balances...</Text> : null}
      {data ? <CashValuation report={data} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 10,
    padding: 16,
    paddingTop: 9,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: colors.ink, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  refresh: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  amountBlock: { gap: 4 },
  amount: {
    color: colors.ink,
    fontSize: 27,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  label: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  detailsGroup: { gap: 5, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 9 },
});
