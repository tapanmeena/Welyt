import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@welyt/shared';
import { Link, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { FormTextField } from '@/components/auth/FormTextField';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { resolveFormError } from '@/components/auth/form-errors';
import { useLoginMutation } from '@/features/auth/use-auth-mutations';
import { colors } from '@/theme/colors';

export default function SignInScreen() {
  const params = useLocalSearchParams<{ reset?: string; verified?: string }>();
  const loginMutation = useLoginMutation();
  const [bannerError, setBannerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const infoMessage =
    params.reset === '1'
      ? 'Your password has been updated. Sign in with your new password.'
      : params.verified === '1'
        ? 'Your email address is verified. Sign in to continue.'
        : null;

  const onSubmit = handleSubmit(async (values) => {
    setBannerError(null);
    try {
      await loginMutation.mutateAsync(values);
    } catch (error) {
      const topError = resolveFormError(error, setError, ['email', 'password']);
      setBannerError(topError || null);
    }
  });

  return (
    <AuthScreenShell
      title="Welcome back"
      subtitle="Sign in to access your Welyt personal finance workspace."
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>New to Welyt?</Text>
          <Link href="/sign-up" asChild>
            <Pressable accessibilityRole="link" hitSlop={8}>
              <Text style={styles.linkText}>Create an account</Text>
            </Pressable>
          </Link>
        </View>
      }
    >
      {infoMessage && !bannerError ? <StatusBanner tone="success" message={infoMessage} /> : null}
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
            returnKeyType="next"
            errorMessage={errors.email?.message}
          />
        )}
      />

      <View style={styles.passwordGroup}>
        <Controller
          control={control}
          name="password"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextField
              label="Password"
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="Enter your password"
              isPassword
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => {
                void onSubmit();
              }}
              errorMessage={errors.password?.message}
            />
          )}
        />

        <View style={styles.forgotRow}>
          <Link href="/forgot-password" asChild>
            <Pressable accessibilityRole="link" hitSlop={8}>
              <Text style={styles.linkText}>Forgot password?</Text>
            </Pressable>
          </Link>
        </View>
      </View>

      <AuthButton
        label="Sign in"
        loading={loginMutation.isPending}
        onPress={() => {
          void onSubmit();
        }}
      />
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  passwordGroup: {
    gap: 8,
  },
  forgotRow: {
    alignItems: 'flex-end',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  linkText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.navy,
  },
});
