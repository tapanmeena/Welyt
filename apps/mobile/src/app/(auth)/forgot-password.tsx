import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@welyt/shared';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text } from 'react-native';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { FormTextField } from '@/components/auth/FormTextField';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { resolveFormError } from '@/components/auth/form-errors';
import { useForgotPasswordMutation } from '@/features/auth/use-auth-mutations';
import { colors } from '@/theme/colors';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const forgotMutation = useForgotPasswordMutation();
  const [bannerError, setBannerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setBannerError(null);
    try {
      await forgotMutation.mutateAsync(values);
      router.push({
        pathname: '/reset-password',
        params: { email: values.email, sent: '1' },
      });
    } catch (error) {
      const topError = resolveFormError(error, setError, ['email']);
      setBannerError(topError || null);
    }
  });

  return (
    <AuthScreenShell
      eyebrow="Account recovery"
      title="Reset your password"
      subtitle="Enter your account email and we will send you a 6-digit password reset code."
      sectionLabel="Recovery email"
      backLabel="Sign in"
      onBack={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/sign-in');
        }
      }}
      footer={
        <Link href="/sign-in" asChild>
          <Pressable accessibilityRole="link" hitSlop={8} style={styles.textAction}>
            <Text style={styles.linkText}>Back to sign in</Text>
          </Pressable>
        </Link>
      }
    >
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
            returnKeyType="send"
            onSubmitEditing={() => {
              void onSubmit();
            }}
            errorMessage={errors.email?.message}
          />
        )}
      />

      <AuthButton
        label="Send reset code"
        loading={forgotMutation.isPending}
        onPress={() => {
          void onSubmit();
        }}
      />
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  textAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  linkText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.rust,
  },
});
