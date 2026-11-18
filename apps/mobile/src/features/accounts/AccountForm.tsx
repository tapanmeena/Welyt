import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ACCOUNT_KINDS,
  createAccountSchema,
  type AccountDto,
  type CreateAccountInput,
} from '@welyt/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { ActivityIndicator, Switch, Text, View } from 'react-native';
import type { z } from 'zod';
import { AuthButton } from '@/components/auth/AuthButton';
import { FormTextField } from '@/components/auth/FormTextField';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { resolveFormError } from '@/components/auth/form-errors';
import { colors } from '@/theme/colors';
import { AccountChoice, accountKindLabels, accountsStyles as styles } from './AccountsShell';
import { accountsApi, accountsQueries } from './accounts-api';

type AccountFields = z.output<typeof createAccountSchema>;

export function AccountForm({
  userId,
  account,
  onSaved,
  onCancel,
}: {
  userId: string;
  account?: AccountDto;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const currencyQuery = useQuery({ ...accountsQueries.currencies(userId), enabled: !account });
  const [bannerError, setBannerError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateAccountInput, unknown, AccountFields>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      name: account?.name ?? '',
      kind: account?.kind ?? 'bank',
      currencyCode: account?.currencyCode ?? 'INR',
      inNetWorth: account?.inNetWorth ?? true,
      purpose: account?.purpose ?? '',
      notes: account?.notes ?? '',
    },
  });
  const save = useMutation({
    mutationFn: ({ currencyCode, name, kind, inNetWorth, purpose, notes }: AccountFields) => {
      const metadata = {
        name,
        kind,
        inNetWorth,
        purpose: purpose?.trim() || null,
        notes: notes?.trim() || null,
      };
      return account
        ? accountsApi.updateAccount(account.id, metadata)
        : accountsApi.createAccount({ ...metadata, currencyCode });
    },
    onSuccess: (saved) => {
      const { queryKey } = accountsQueries.list(userId);
      queryClient.setQueryData(queryKey, (list) =>
        list?.some((item) => item.id === saved.id)
          ? list.map((item) => (item.id === saved.id ? saved : item))
          : list && [...list, saved],
      );
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const submit = handleSubmit(async (values) => {
    setBannerError(null);
    try {
      await save.mutateAsync(values);
      onSaved();
    } catch (error) {
      setBannerError(resolveFormError(error, setError, ['name', 'kind', 'currencyCode']) || null);
    }
  });

  return (
    <View style={styles.card}>
      <StatusBanner tone="error" message={bannerError} />
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <FormTextField
            label="Account name"
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            editable={!isSubmitting}
            placeholder="Everyday savings"
            errorMessage={errors.name?.message}
          />
        )}
      />
      <Controller
        control={control}
        name="kind"
        render={({ field }) => (
          <View style={styles.section}>
            <Text style={styles.label}>Account type</Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Account type"
              style={styles.choices}
            >
              {ACCOUNT_KINDS.map((kind) => (
                <AccountChoice
                  key={kind}
                  label={accountKindLabels[kind]}
                  selected={field.value === kind}
                  onPress={() => field.onChange(kind)}
                  disabled={isSubmitting}
                />
              ))}
            </View>
            <StatusBanner tone="error" message={errors.kind?.message} />
          </View>
        )}
      />
      {account ? (
        <Text style={styles.muted}>
          Currency: {account.currencyCode}. Currency cannot be changed after creation.
        </Text>
      ) : (
        <Controller
          control={control}
          name="currencyCode"
          render={({ field }) => (
            <View style={styles.section}>
              <Text style={styles.label}>Currency</Text>
              {currencyQuery.data ? (
                <>
                  <View
                    accessibilityRole="radiogroup"
                    accessibilityLabel="Currency"
                    style={styles.choices}
                  >
                    {currencyQuery.data.map((currency) => (
                      <AccountChoice
                        key={currency.code}
                        label={currency.code}
                        accessibilityLabel={`${currency.code} ${currency.name}`}
                        selected={currency.code === field.value}
                        onPress={() => field.onChange(currency.code)}
                        disabled={isSubmitting}
                      />
                    ))}
                  </View>
                  <Text style={styles.muted}>
                    {currencyQuery.data.find((currency) => currency.code === field.value)?.name}
                  </Text>
                </>
              ) : currencyQuery.isError ? (
                <>
                  <StatusBanner tone="error" message={currencyQuery.error.message} />
                  <AuthButton
                    variant="secondary"
                    label="Retry currencies"
                    loading={currencyQuery.isFetching}
                    onPress={() => void currencyQuery.refetch()}
                  />
                </>
              ) : (
                <ActivityIndicator
                  accessibilityLabel="Loading currencies"
                  color={colors.rust}
                  style={styles.loading}
                />
              )}
              <StatusBanner tone="error" message={errors.currencyCode?.message} />
            </View>
          )}
        />
      )}
      {(['purpose', 'notes'] as const).map((name) => (
        <Controller
          key={name}
          control={control}
          name={name}
          render={({ field }) => (
            <FormTextField
              label={name === 'purpose' ? 'Purpose (optional)' : 'Notes (optional)'}
              multiline={name === 'notes'}
              value={field.value ?? ''}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              editable={!isSubmitting}
            />
          )}
        />
      ))}
      <Controller
        control={control}
        name="inNetWorth"
        render={({ field }) => (
          <View style={styles.row}>
            <Text style={[styles.label, styles.grow]}>Include in INR reporting</Text>
            <Switch
              accessibilityLabel="Include in INR reporting"
              value={field.value ?? true}
              onValueChange={field.onChange}
              disabled={isSubmitting}
            />
          </View>
        )}
      />
      <AuthButton
        label={account ? 'Save changes' : 'Create account'}
        loading={isSubmitting}
        disabled={!account && !currencyQuery.data?.length}
        onPress={() => void submit()}
      />
      <AuthButton variant="secondary" label="Cancel" disabled={isSubmitting} onPress={onCancel} />
    </View>
  );
}
