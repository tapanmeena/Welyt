import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordSchema, type ResetPasswordInput } from '@welyt/shared';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text } from 'react-native';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { FormTextField } from '@/components/auth/FormTextField';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { resolveFormError } from '@/components/auth/form-errors';
import { useResetPasswordMutation } from '@/features/auth/use-auth-mutations';
import { colors } from '@/theme/colors';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; code?: string; sent?: string }>();
  const resetMutation = useResetPasswordMutation();
  const [bannerError, setBannerError] = useState<string | null>(null);

  const initialEmail = typeof params.email === 'string' ? params.email : '';
  const initialCode = typeof params.code === 'string' ? params.code : '';

  const {
    control,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      email: initialEmail,
      code: initialCode,
      newPassword: '',
    },
  });

  useEffect(() => {
    if (typeof params.email === 'string' && params.email.length > 0) {
      setValue('email', params.email);
    }
    if (typeof params.code === 'string' && params.code.length > 0) {
      setValue('code', params.code);
    }
  }, [params.code, params.email, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setBannerError(null);
    try {
      await resetMutation.mutateAsync(values);
      router.replace('/sign-in?reset=1');
    } catch (error) {
      const topError = resolveFormError(error, setError, ['email', 'code', 'newPassword']);
      setBannerError(topError || null);
    }
  });

  return (
    <AuthScreenShell
      title="Choose a new password"
      subtitle="Enter the 6-digit reset code from your email along with your new password."
      footer={
        <Link href="/sign-in" asChild>
          <Pressable accessibilityRole="link" hitSlop={8}>
            <Text style={styles.linkText}>Back to sign in</Text>
          </Pressable>
        </Link>
      }
    >
      {params.sent === '1' && !bannerError ? (
        <StatusBanner
          tone="info"
          message="If an account matches that email, a 6-digit reset code is on its way."
        />
      ) : null}
      <StatusBanner tone="error" message={bannerError} />

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextField
            label="Email address"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            errorMessage={errors.email?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="code"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextField
            label="6-digit reset code"
            value={value}
            onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, 6))}
            onBlur={onBlur}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            errorMessage={errors.code?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="newPassword"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextField
            label="New password"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="Enter a strong new password"
            isPassword
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            helperText="At least 8 characters, including uppercase, lowercase, and a number."
            returnKeyType="go"
            onSubmitEditing={() => {
              void onSubmit();
            }}
            errorMessage={errors.newPassword?.message}
          />
        )}
      />

      <AuthButton
        label="Update password"
        loading={resetMutation.isPending}
        onPress={() => {
          void onSubmit();
        }}
      />
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  linkText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
});
