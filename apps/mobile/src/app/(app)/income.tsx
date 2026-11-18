import { useQuery } from '@tanstack/react-query';
import {
  indiaBusinessDate,
  indiaFiscalWindow,
  type IncomeHistoryDto,
  type IncomeReceiptDto,
  type IncomeReceiptValuationDto,
} from '@welyt/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { FinanceScreen, financeStyles as styles } from '@/components/FinanceScreen';
import { useSuccessSnackbar } from '@/components/SuccessSnackbar';
import { AuthButton } from '@/components/auth/AuthButton';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { displayBalance } from '@/features/accounts/format-balance';
import { useAuthStore } from '@/features/auth/auth-store';
import { IncomeReceiptForm } from '@/features/income/IncomeReceiptForm';
import { incomeHistoryQuery } from '@/features/income/income-api';
import { colors } from '@/theme/colors';

const monthFormat = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function fiscalYearStart(date: string): string {
  return indiaFiscalWindow(date).startsOn.slice(0, 4);
}

function yearLabel(start: string): string {
  return `FY ${start}-${String(Number(start) + 1)
    .padStart(4, '0')
    .slice(-2)}`;
}

type Total = Pick<IncomeHistoryDto, 'complete' | 'totalInr' | 'knownSubtotalInr'>;

function IncomeTotal({
  total,
  hasValuedReceipt,
  period,
}: {
  total: Total;
  hasValuedReceipt: boolean;
  period: 'Financial year' | 'Month';
}) {
  const inr = total.complete ? total.totalInr : hasValuedReceipt ? total.knownSubtotalInr : null;
  return (
    <View style={styles.section} accessibilityLiveRegion="polite">
      <Text style={styles.label}>
        {total.complete ? `${period} total` : `${period} subtotal (incomplete)`}
      </Text>
      <Text style={styles.heading}>
        {inr === null ? 'No receipts could be converted' : displayBalance('INR', inr)}
      </Text>
    </View>
  );
}

function ReceiptRow({
  receipt,
  onCorrect,
}: {
  receipt: IncomeReceiptValuationDto;
  onCorrect: () => void;
}) {
  const { fxRate, issue, currencyCode } = receipt;
  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{receipt.source}</Text>
      <Text style={styles.muted}>
        {receipt.receivedDate} | {receipt.type}
      </Text>
      <Text style={styles.label}>Received: {displayBalance(currencyCode, receipt.amount)}</Text>
      {receipt.inrAmount !== null && currencyCode !== 'INR' ? (
        <Text style={styles.label}>{displayBalance('INR', receipt.inrAmount)}</Text>
      ) : null}
      {fxRate ? (
        <Text style={styles.muted}>
          FX: {fxRate.rateOn} ({fxRate.source === 'frankfurter' ? 'Frankfurter' : fxRate.source}
          {fxRate.ageDays > 0
            ? `, ${fxRate.ageDays} day${fxRate.ageDays === 1 ? '' : 's'} old`
            : ''}
          )
        </Text>
      ) : null}
      {issue ? (
        <StatusBanner
          tone="warning"
          message={
            issue.reason === 'stale_fx_rate'
              ? `The ${currencyCode} rate from ${issue.rateOn} is ${issue.ageDays} days old and was not used.`
              : `No ${currencyCode} to INR rate is available for this receipt.`
          }
        />
      ) : null}
      {receipt.gross !== null ? (
        <Text style={styles.muted}>Gross: {displayBalance(currencyCode, receipt.gross)}</Text>
      ) : null}
      {receipt.tds !== null ? (
        <Text style={styles.muted}>TDS: {displayBalance(currencyCode, receipt.tds)}</Text>
      ) : null}
      {receipt.notes ? <Text style={styles.muted}>{receipt.notes}</Text> : null}
      <AuthButton label="Correct receipt" variant="secondary" onPress={onCorrect} />
    </View>
  );
}

function IncomeList({ userId }: { userId: string }) {
  const router = useRouter();
  const showSuccess = useSuccessSnackbar();
  const currentYear = fiscalYearStart(indiaBusinessDate(new Date()));
  const [year, setYear] = useState(currentYear);
  const [edit, setEdit] = useState<{ original: IncomeReceiptDto | null } | null>(null);
  const history = useQuery(incomeHistoryQuery(userId, year));

  if (edit) {
    return (
      <FinanceScreen
        key={edit.original?.id ?? 'new'}
        title={edit.original ? 'Correct receipt' : 'Record income'}
        subtitle="Record money actually received. This does not change account balances."
        backLabel="Income & Plan"
        onBack={() => setEdit(null)}
      >
        <IncomeReceiptForm
          userId={userId}
          original={edit.original}
          onCancel={() => setEdit(null)}
          onSaved={(saved) => {
            setYear(fiscalYearStart(saved.receivedDate));
            showSuccess(edit.original ? 'Receipt corrected.' : 'Receipt recorded.');
            setEdit(null);
          }}
        />
      </FinanceScreen>
    );
  }

  function navigateYear(offset: number) {
    setYear(String(Number(year) + offset).padStart(4, '0'));
  }

  const report = history.data;
  return (
    <FinanceScreen
      title="Income & Plan"
      subtitle="Review actual receipts by financial year. INR figures use the FX rate available on the date received."
      backLabel="Workspace"
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    >
      <AuthButton
        label="Monthly Plan"
        variant="secondary"
        onPress={() => router.push('/monthly-plan')}
      />
      <AuthButton label="Record income" onPress={() => setEdit({ original: null })} />
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>
          {yearLabel(year)}
        </Text>
        <Text style={styles.muted}>
          April {year} to March {Number(year) + 1}
        </Text>
        <View style={styles.row}>
          <View style={styles.grow}>
            <AuthButton
              label="Previous year"
              variant="secondary"
              disabled={Number(year) === 0}
              onPress={() => navigateYear(-1)}
            />
          </View>
          <View style={styles.grow}>
            <AuthButton
              label="Next year"
              variant="secondary"
              disabled={year >= currentYear}
              onPress={() => navigateYear(1)}
            />
          </View>
        </View>
        {report?.months.length ? (
          <IncomeTotal
            total={report}
            period="Financial year"
            hasValuedReceipt={report.months.some((month) =>
              month.receipts.some((receipt) => receipt.inrAmount !== null),
            )}
          />
        ) : null}
      </View>
      {history.isError ? (
        <View style={styles.section}>
          <StatusBanner
            tone="error"
            message={`Could not load income history. ${history.error.message}`}
          />
          <AuthButton
            label="Retry history"
            variant="secondary"
            loading={history.isFetching}
            onPress={() => void history.refetch()}
          />
        </View>
      ) : history.isPending ? (
        <ActivityIndicator
          accessibilityLabel="Loading income history"
          color={colors.rust}
          style={styles.loading}
        />
      ) : report?.months.length === 0 ? (
        <Text style={styles.muted}>No income receipts in this financial year.</Text>
      ) : (
        report?.months.map((month) => (
          <View key={month.month} style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>
              {monthFormat.format(new Date(`${month.month}-01T00:00:00Z`))}
            </Text>
            <IncomeTotal
              total={month}
              period="Month"
              hasValuedReceipt={month.receipts.some((receipt) => receipt.inrAmount !== null)}
            />
            {month.receipts.map((receipt) => (
              <ReceiptRow
                key={receipt.id}
                receipt={receipt}
                onCorrect={() => setEdit({ original: receipt })}
              />
            ))}
          </View>
        ))
      )}
    </FinanceScreen>
  );
}

export default function IncomeScreen() {
  const userId = useAuthStore((state) => state.user?.id);
  return userId ? <IncomeList key={userId} userId={userId} /> : null;
}
