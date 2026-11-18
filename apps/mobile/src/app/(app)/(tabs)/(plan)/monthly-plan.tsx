import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { indiaBusinessDate, shiftPlanMonth, type MonthlyPlanDto } from '@welyt/shared';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { FinanceScreen, financeStyles as styles } from '@/components/FinanceScreen';
import { useSuccessSnackbar } from '@/components/SuccessSnackbar';
import { AuthButton } from '@/components/auth/AuthButton';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { useWorkspaceEditor } from '@/components/navigation/WorkspaceNavigation';
import { displayBalance } from '@/features/accounts/format-balance';
import { useAuthStore } from '@/features/auth/auth-store';
import {
  MonthlyPlanEditor,
  MonthlyTotals,
  planGroupLabels,
} from '@/features/income/MonthlyPlanEditor';
import {
  autoCopyRuleQuery,
  monthlyPlanApi,
  monthlyPlanQuery,
} from '@/features/income/monthly-plan-api';
import { colors } from '@/theme/colors';

const monthFormat = new Intl.DateTimeFormat('en-IN', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function monthLabel(month: string) {
  return monthFormat.format(new Date(`${month}-01T00:00:00Z`));
}

function AutoCopyControls({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const options = autoCopyRuleQuery(userId);
  const rule = useQuery(options);
  const save = useMutation({
    mutationFn: monthlyPlanApi.setAutoCopyRule,
    onSuccess: (saved) => queryClient.setQueryData(options.queryKey, saved),
  });
  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        Month-start auto-copy
      </Text>
      <Text style={styles.muted}>
        Copy the previous month into the new month at India-local midnight, only when no plan is
        saved there.
      </Text>
      {rule.isPending ? (
        <Text style={styles.muted}>Loading auto-copy setting...</Text>
      ) : rule.isError ? (
        <>
          <StatusBanner tone="error" message={`Could not load the rule. ${rule.error.message}`} />
          <AuthButton label="Retry rule" variant="secondary" onPress={() => void rule.refetch()} />
        </>
      ) : (
        <>
          {rule.data.firstTargetMonth ? (
            <Text style={styles.label}>Enabled from {monthLabel(rule.data.firstTargetMonth)}</Text>
          ) : (
            <Text style={styles.label}>Off</Text>
          )}
          <StatusBanner tone="error" message={save.error?.message} />
          <AuthButton
            label={rule.data.enabled ? 'Disable auto-copy' : 'Enable auto-copy'}
            variant="secondary"
            loading={save.isPending}
            onPress={() => save.mutate(!rule.data.enabled)}
          />
        </>
      )}
    </View>
  );
}

function MonthlyPlanView({ userId }: { userId: string }) {
  const router = useRouter();
  const showSuccess = useSuccessSnackbar();
  const [month, setMonth] = useState(() => indiaBusinessDate(new Date()).slice(0, 7));
  const [revision, setRevision] = useState<number>();
  const [editor, setEditor] = useState<{ initial: MonthlyPlanDto | null } | null>(null);
  const history = useQuery(monthlyPlanQuery(userId, month, revision));
  const closeEditor = useCallback(() => setEditor(null), []);
  useWorkspaceEditor(editor !== null, closeEditor);
  const previousMonth = shiftPlanMonth(month, -1);
  const nextMonth = shiftPlanMonth(month, 1);
  const heading = monthLabel(month);
  const plan = history.data;

  if (editor) {
    return (
      <FinanceScreen
        key="editor"
        title={`Plan ${heading}`}
        subtitle="Enter planned amounts in INR. This does not change receipts or cash."
        backLabel="Monthly Plan"
        onBack={closeEditor}
      >
        <MonthlyPlanEditor
          userId={userId}
          month={month}
          initial={editor.initial}
          onCancel={closeEditor}
          onSaved={() => {
            closeEditor();
            setRevision(undefined);
            showSuccess('Plan saved.');
          }}
        />
      </FinanceScreen>
    );
  }

  function navigateMonth(value: string | null) {
    if (value === null) return;
    setRevision(undefined);
    setMonth(value);
  }

  return (
    <FinanceScreen
      title="Monthly Plan"
      subtitle="Forecast income and allocate it without affecting receipts or cash."
    >
      <AuthButton
        label="Income History"
        variant="secondary"
        onPress={() => router.navigate('/income')}
      />
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>
          {heading}
        </Text>
        <View style={styles.row}>
          <View style={styles.grow}>
            <AuthButton
              label="Previous month"
              variant="secondary"
              disabled={previousMonth === null}
              onPress={() => navigateMonth(previousMonth)}
            />
          </View>
          <View style={styles.grow}>
            <AuthButton
              label="Next month"
              variant="secondary"
              disabled={nextMonth === null}
              onPress={() => navigateMonth(nextMonth)}
            />
          </View>
        </View>
      </View>
      {revision !== undefined ? (
        <AuthButton
          label="Show current revision"
          variant="secondary"
          onPress={() => setRevision(undefined)}
        />
      ) : null}
      {history.isError ? (
        <>
          <StatusBanner
            tone="error"
            message={`Could not load the plan. ${history.error.message}`}
          />
          <AuthButton
            label="Retry plan"
            variant="secondary"
            onPress={() => void history.refetch()}
          />
        </>
      ) : history.isPending ? (
        <ActivityIndicator
          accessibilityLabel="Loading monthly plan"
          color={colors.rust}
          style={styles.loading}
        />
      ) : plan ? (
        <>
          <View style={styles.card}>
            <Text style={styles.heading}>Revision {plan.revision}</Text>
            {plan.createdVia !== 'manual' ? (
              <Text style={styles.muted}>
                {plan.createdVia === 'auto_copy'
                  ? 'Automatically copied from the previous month'
                  : 'Copied from the previous month'}
              </Text>
            ) : null}
            <Text style={styles.label}>
              Expected net income: {displayBalance('INR', plan.forecastIncome)}
            </Text>
            <MonthlyTotals totals={plan.totals} />
          </View>
          {plan.allocations.map(({ id, name, amount, group }) => (
            <View key={id} style={styles.card}>
              <Text style={styles.heading}>{name}</Text>
              <Text style={styles.label}>
                {planGroupLabels[group]}: {displayBalance('INR', amount)}
              </Text>
            </View>
          ))}
          {plan.revision > 1 ? (
            <AuthButton
              label="Previous revision"
              variant="secondary"
              onPress={() => setRevision(plan.revision - 1)}
            />
          ) : null}
          {revision === undefined ? (
            <AuthButton label="Edit plan" onPress={() => setEditor({ initial: plan })} />
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.muted}>No plan saved for this month.</Text>
          <AuthButton label="Create plan" onPress={() => setEditor({ initial: null })} />
        </>
      )}
      <AutoCopyControls userId={userId} />
    </FinanceScreen>
  );
}

export default function MonthlyPlanScreen() {
  const userId = useAuthStore((state) => state.user?.id);
  return userId ? <MonthlyPlanView key={userId} userId={userId} /> : null;
}
