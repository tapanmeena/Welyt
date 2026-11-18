import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  INCOME_ERROR_CODES,
  PLAN_ALLOCATION_GROUPS,
  monthlyPlanSaveSchema,
  monthlyPlanTotals,
  parseDecimalHundredths,
  shiftPlanMonth,
  type MonthlyPlanDto,
  type MonthlyPlanSaveInput,
  type MonthlyPlanTotals,
  type PlanAllocationGroup,
} from '@welyt/shared';
import { useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Text, View } from 'react-native';
import { FinanceChoice, financeStyles as styles } from '@/components/FinanceScreen';
import { AuthButton } from '@/components/auth/AuthButton';
import { FormTextField } from '@/components/auth/FormTextField';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { displayBalance } from '@/features/accounts/format-balance';
import { ApiRequestError } from '@/lib/api-client';
import { monthlyPlanApi, monthlyPlanKey, monthlyPlanQuery } from './monthly-plan-api';

export const planGroupLabels: Record<PlanAllocationGroup, string> = {
  fixed: 'Fixed',
  flexible: 'Flexible',
  saving: 'Saving',
};

export function MonthlyTotals({
  totals,
  editing = false,
}: {
  totals: MonthlyPlanTotals;
  editing?: boolean;
}) {
  const shortfall = totals.remaining.startsWith('-');
  return (
    <View style={styles.section} accessibilityLiveRegion="polite">
      {PLAN_ALLOCATION_GROUPS.map((group) => (
        <Text key={group} style={styles.muted}>
          {planGroupLabels[group]}: {displayBalance('INR', totals.byGroup[group])}
        </Text>
      ))}
      <Text style={styles.label}>Total allocated: {displayBalance('INR', totals.allocated)}</Text>
      {shortfall ? (
        <StatusBanner
          tone="warning"
          message={`Shortfall: ${displayBalance('INR', totals.remaining.slice(1))}.${editing ? ' You can still save this plan.' : ''}`}
        />
      ) : (
        <Text style={styles.label}>Unallocated: {displayBalance('INR', totals.remaining)}</Text>
      )}
    </View>
  );
}

function planFields(plan: MonthlyPlanDto | null): MonthlyPlanSaveInput {
  return {
    expectedRevision: plan?.revision ?? 0,
    forecastIncome: plan?.forecastIncome ?? '',
    allocations:
      plan?.allocations.map(({ name, group, amount }) => ({ name, group, amount })) ?? [],
  };
}

function previewTotals(values: unknown): MonthlyPlanTotals | null {
  const input = monthlyPlanSaveSchema.safeParse(values);
  if (!input.success) return null;
  const forecast = parseDecimalHundredths(input.data.forecastIncome);
  if (!forecast) return null;
  const lines = [];
  for (const { group, amount } of input.data.allocations) {
    const parsed = parseDecimalHundredths(amount);
    if (!parsed) return null;
    lines.push({ group, amountHundredths: parsed.hundredths });
  }
  return monthlyPlanTotals(forecast.hundredths, lines);
}

export function MonthlyPlanEditor({
  userId,
  month,
  initial,
  onSaved,
  onCancel,
}: {
  userId: string;
  month: string;
  initial: MonthlyPlanDto | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const {
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<MonthlyPlanSaveInput>({
    resolver: zodResolver(monthlyPlanSaveSchema),
    defaultValues: planFields(initial),
  });
  const list = useFieldArray({ control, name: 'allocations' });
  const draft = useWatch({ control });
  const preview = previewTotals(draft);
  const previous = shiftPlanMonth(month, -1);
  const save = useMutation({
    mutationFn: (values: MonthlyPlanSaveInput) => monthlyPlanApi.save(month, values),
  });
  const copy = useMutation({ mutationFn: (source: string) => monthlyPlanApi.get(source) });
  const refresh = useMutation({
    mutationFn: () => queryClient.fetchQuery({ ...monthlyPlanQuery(userId, month), staleTime: 0 }),
  });
  const busy = copy.isPending || refresh.isPending || isSubmitting;

  async function copyPrevious() {
    if (previous === null) return;
    setConfirmCopy(false);
    try {
      const source = await copy.mutateAsync(previous);
      if (!source) {
        setMessage({ tone: 'info', text: `There is no saved plan for ${previous}.` });
        return;
      }
      reset({ ...planFields(source), expectedRevision: 0, copiedFromPlanId: source.id });
      setMessage({ tone: 'info', text: `Draft copied from ${previous}. Nothing is saved yet.` });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not copy the plan.',
      });
    }
  }

  async function keepDraftOnLatestRevision() {
    try {
      const latest = await refresh.mutateAsync();
      if (!latest) {
        setMessage({
          tone: 'error',
          text: 'No saved revision was found. Your draft is unchanged.',
        });
        return;
      }
      const { forecastIncome, allocations } = getValues();
      reset({ forecastIncome, allocations, expectedRevision: latest.revision });
      setConflicted(false);
      setMessage({
        tone: 'info',
        text: `Draft kept. Review it before saving a new revision after revision ${latest.revision}.`,
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not load the latest revision.',
      });
    }
  }

  const submit = handleSubmit(async (values) => {
    setMessage(null);
    try {
      await save.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: monthlyPlanKey(userId, month) });
      onSaved();
    } catch (error) {
      const conflict =
        error instanceof ApiRequestError &&
        error.code === INCOME_ERROR_CODES.MONTHLY_PLAN_REVISION_CONFLICT;
      setConflicted(conflict);
      setMessage({
        tone: 'error',
        text: conflict
          ? 'A plan was saved while you were editing. Your draft is still here.'
          : error instanceof Error
            ? error.message
            : 'Could not save the plan.',
      });
    }
  });

  return (
    <View style={styles.section}>
      <StatusBanner tone={message?.tone ?? 'info'} message={message?.text} />
      {conflicted ? (
        <AuthButton
          label="Keep draft on latest revision"
          variant="secondary"
          loading={refresh.isPending}
          onPress={() => void keepDraftOnLatestRevision()}
        />
      ) : null}
      {draft.expectedRevision === 0 && previous && !conflicted ? (
        confirmCopy ? (
          <View style={styles.card}>
            <Text style={styles.label}>
              Replace your unsaved inputs with the plan from last month?
            </Text>
            <AuthButton label="Replace draft" disabled={busy} onPress={() => void copyPrevious()} />
            <AuthButton
              label="Keep draft"
              variant="secondary"
              onPress={() => setConfirmCopy(false)}
            />
          </View>
        ) : (
          <AuthButton
            label="Copy Previous Month"
            variant="secondary"
            loading={copy.isPending}
            disabled={busy}
            onPress={() => {
              if (isDirty) setConfirmCopy(true);
              else void copyPrevious();
            }}
          />
        )
      ) : null}
      <Controller
        control={control}
        name="forecastIncome"
        render={({ field }) => (
          <FormTextField
            label="Expected net income (INR)"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            inputMode="decimal"
            editable={!busy}
            errorMessage={errors.forecastIncome?.message}
          />
        )}
      />
      {list.fields.map(({ id }, index) => (
        <View key={id} style={styles.card}>
          <Controller
            control={control}
            name={`allocations.${index}.name`}
            render={({ field }) => (
              <FormTextField
                label={`Allocation ${index + 1} name`}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                editable={!busy}
                errorMessage={errors.allocations?.[index]?.name?.message}
              />
            )}
          />
          <Controller
            control={control}
            name={`allocations.${index}.group`}
            render={({ field }) => (
              <View style={styles.choices}>
                {PLAN_ALLOCATION_GROUPS.map((group) => (
                  <FinanceChoice
                    key={group}
                    label={planGroupLabels[group]}
                    selected={field.value === group}
                    disabled={busy}
                    onPress={() => field.onChange(group)}
                  />
                ))}
              </View>
            )}
          />
          <Controller
            control={control}
            name={`allocations.${index}.amount`}
            render={({ field }) => (
              <FormTextField
                label={`Allocation ${index + 1} amount (INR)`}
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                editable={!busy}
                inputMode="decimal"
                errorMessage={errors.allocations?.[index]?.amount?.message}
              />
            )}
          />
          <AuthButton
            label={`Remove allocation ${index + 1}`}
            variant="secondary"
            disabled={busy}
            onPress={() => list.remove(index)}
          />
        </View>
      ))}
      <AuthButton
        label="Add allocation"
        variant="secondary"
        disabled={busy}
        onPress={() => list.append({ name: '', group: 'fixed', amount: '' })}
      />
      {preview ? <MonthlyTotals totals={preview} editing /> : null}
      <AuthButton
        label="Save plan"
        loading={isSubmitting}
        disabled={busy || conflicted}
        onPress={() => void submit()}
      />
      <AuthButton label="Cancel" variant="secondary" disabled={busy} onPress={onCancel} />
    </View>
  );
}
