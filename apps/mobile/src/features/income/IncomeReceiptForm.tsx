import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  incomeReceiptInputSchema,
  indiaBusinessDate,
  type IncomeReceiptDto,
  type IncomeReceiptInput,
} from '@welyt/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Text, View } from 'react-native';
import { FinanceChoice, financeStyles as styles } from '@/components/FinanceScreen';
import { AuthButton } from '@/components/auth/AuthButton';
import { FormTextField } from '@/components/auth/FormTextField';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { resolveFormError } from '@/components/auth/form-errors';
import { accountsQueries } from '@/features/accounts/accounts-api';
import { incomeApi, incomeHistoryKey } from './income-api';

const dateAndSourceFields = [
  { name: 'receivedDate', label: 'Received date', placeholder: 'YYYY-MM-DD' },
  { name: 'type', label: 'Income type', placeholder: 'e.g. Salary' },
  { name: 'source', label: 'Income source', placeholder: 'e.g. Employer' },
] as const;

const amountFields = [
  { name: 'amount', label: 'Amount received', optional: false },
  { name: 'gross', label: 'Gross amount (optional)', optional: true },
  { name: 'tds', label: 'TDS (optional)', optional: true },
] as const;

export function IncomeReceiptForm({
  userId,
  original,
  onSaved,
  onCancel,
}: {
  userId: string;
  original: IncomeReceiptDto | null;
  onSaved: (receipt: IncomeReceiptDto) => void;
  onCancel: () => void;
}) {
  const catalog = useQuery(accountsQueries.currencies(userId));
  const queryClient = useQueryClient();
  const [bannerError, setBannerError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<IncomeReceiptInput>({
    resolver: zodResolver(incomeReceiptInputSchema),
    defaultValues: {
      receivedDate: original?.receivedDate ?? indiaBusinessDate(new Date()),
      type: original?.type ?? '',
      source: original?.source ?? '',
      currencyCode: original?.currencyCode ?? 'INR',
      amount: original?.amount ?? '',
      gross: original?.gross ?? null,
      tds: original?.tds ?? null,
      notes: original?.notes ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (values: IncomeReceiptInput) => {
      const body = { ...values, notes: values.notes?.trim() || null };
      return original ? incomeApi.correct(original.id, body) : incomeApi.create(body);
    },
  });
  const submit = handleSubmit(async (values) => {
    setBannerError(null);
    try {
      const saved = await save.mutateAsync(values);
      void queryClient.invalidateQueries({ queryKey: incomeHistoryKey(userId) });
      onSaved(saved);
    } catch (error) {
      setBannerError(
        resolveFormError(error, setError, [
          'receivedDate',
          'type',
          'source',
          'currencyCode',
          'amount',
          'gross',
          'tds',
          'notes',
        ]) || null,
      );
    }
  });

  return (
    <View style={styles.card}>
      <StatusBanner tone="error" message={bannerError} />
      {dateAndSourceFields.map(({ name, label, placeholder }) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <FormTextField
              label={label}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              editable={!isSubmitting}
              placeholder={placeholder}
              {...(name === 'receivedDate'
                ? { autoCorrect: false, maxLength: 10, helperText: 'Use YYYY-MM-DD in India time.' }
                : {})}
              errorMessage={errors[name]?.message}
            />
          )}
        />
      ))}
      <Text style={styles.label}>Receipt currency</Text>
      {catalog.isError ? (
        <>
          <StatusBanner
            tone="error"
            message={`Could not load currencies. ${catalog.error.message}`}
          />
          <AuthButton
            label="Retry currencies"
            variant="secondary"
            loading={catalog.isFetching}
            onPress={() => void catalog.refetch()}
          />
        </>
      ) : catalog.isPending ? (
        <Text style={styles.muted}>Loading currencies...</Text>
      ) : (
        <Controller
          control={control}
          name="currencyCode"
          render={({ field }) => (
            <View style={styles.choices}>
              {catalog.data.map((currency) => (
                <FinanceChoice
                  key={currency.code}
                  label={currency.code}
                  accessibilityLabel={`${currency.code} ${currency.name}`}
                  selected={field.value === currency.code}
                  onPress={() => field.onChange(currency.code)}
                  disabled={isSubmitting}
                />
              ))}
            </View>
          )}
        />
      )}
      <StatusBanner tone="error" message={errors.currencyCode?.message} />
      {amountFields.map(({ name, label, optional }) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <FormTextField
              label={label}
              value={field.value ?? ''}
              onChangeText={(text) => field.onChange(optional && text === '' ? null : text)}
              onBlur={field.onBlur}
              editable={!isSubmitting}
              inputMode="decimal"
              placeholder="0.00"
              {...(!optional
                ? { helperText: 'Enter the net amount in the selected currency.' }
                : {})}
              errorMessage={errors[name]?.message}
            />
          )}
        />
      ))}
      <Controller
        control={control}
        name="notes"
        render={({ field }) => (
          <FormTextField
            label="Notes (optional)"
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            editable={!isSubmitting}
            errorMessage={errors.notes?.message}
            multiline
          />
        )}
      />
      <AuthButton
        label={original ? 'Save correction' : 'Save receipt'}
        loading={isSubmitting}
        disabled={!catalog.data}
        onPress={() => void submit()}
      />
      <AuthButton label="Cancel" variant="secondary" disabled={isSubmitting} onPress={onCancel} />
    </View>
  );
}
