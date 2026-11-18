import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ACCOUNTS_ERROR_CODES,
  balanceObservationSchema,
  indiaBusinessDate,
  type AccountDto,
  type BalanceObservationInput,
  type BalanceSnapshotDto,
} from '@welyt/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { View } from 'react-native';
import { AuthButton } from '@/components/auth/AuthButton';
import { FormTextField } from '@/components/auth/FormTextField';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { resolveFormError } from '@/components/auth/form-errors';
import { ApiRequestError } from '@/lib/api-client';
import { accountsStyles as styles } from './AccountsShell';
import { accountsApi, accountsQueries } from './accounts-api';

export function SnapshotForm({
  userId,
  account,
  original,
  onSaved,
  onCancel,
}: {
  userId: string;
  account: AccountDto;
  original: BalanceSnapshotDto | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const [bannerError, setBannerError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BalanceObservationInput>({
    resolver: zodResolver(balanceObservationSchema),
    defaultValues: {
      observedOn: original?.observedOn ?? indiaBusinessDate(new Date()),
      balance: original?.balance ?? '',
      notes: original?.notes ?? '',
    },
  });
  const historyKey = accountsQueries.snapshots(userId, account.id).queryKey;
  const save = useMutation({
    mutationFn: (values: BalanceObservationInput) => {
      const body = { ...values, notes: values.notes?.trim() || null };
      return original
        ? accountsApi.correctSnapshot(account.id, original.id, body)
        : accountsApi.recordSnapshot(account.id, body);
    },
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: accountsQueries.valuation(userId).queryKey });
      await queryClient.invalidateQueries({ queryKey: historyKey });
    },
  });
  const submit = handleSubmit(async (values) => {
    setBannerError(null);
    try {
      await save.mutateAsync(values);
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        switch (error.code) {
          case ACCOUNTS_ERROR_CODES.OBSERVATION_DATE_OCCUPIED:
            void queryClient.invalidateQueries({ queryKey: historyKey });
            setBannerError(
              'A balance already exists for that date. Choose another date or correct the saved snapshot in history.',
            );
            return;
          case ACCOUNTS_ERROR_CODES.OBSERVATION_NOT_CURRENT:
            void queryClient.invalidateQueries({ queryKey: historyKey });
            setBannerError(
              'This snapshot was already corrected. Return to history to open its latest version.',
            );
            return;
          case ACCOUNTS_ERROR_CODES.ACCOUNT_ARCHIVED:
            void queryClient.invalidateQueries({ queryKey: accountsQueries.list(userId).queryKey });
            break;
        }
      }
      setBannerError(resolveFormError(error, setError, ['observedOn', 'balance']) || null);
    }
  });

  return (
    <View style={styles.card}>
      <StatusBanner tone="error" message={bannerError} />
      <Controller
        control={control}
        name="observedOn"
        render={({ field }) => (
          <FormTextField
            label="Balance date"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            editable={!isSubmitting}
            autoCorrect={false}
            placeholder="YYYY-MM-DD"
            helperText="Use YYYY-MM-DD in India time."
            maxLength={10}
            errorMessage={errors.observedOn?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="balance"
        render={({ field }) => (
          <View style={styles.section}>
            <FormTextField
              label={`Balance (${account.currencyCode})`}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              editable={!isSubmitting}
              inputMode="decimal"
              autoCorrect={false}
              placeholder="0.00"
              helperText="Use a decimal point and no grouping separators."
              errorMessage={errors.balance?.message}
            />
            <AuthButton
              variant="secondary"
              label={field.value.startsWith('-') ? 'Remove minus sign' : 'Add minus sign'}
              disabled={isSubmitting}
              onPress={() =>
                field.onChange(
                  field.value.startsWith('-') ? field.value.slice(1) : `-${field.value}`,
                )
              }
            />
          </View>
        )}
      />
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
            multiline
          />
        )}
      />
      <AuthButton
        label={original ? 'Save correction' : 'Save balance'}
        loading={isSubmitting}
        onPress={() => void submit()}
      />
      <AuthButton variant="secondary" label="Cancel" disabled={isSubmitting} onPress={onCancel} />
    </View>
  );
}
