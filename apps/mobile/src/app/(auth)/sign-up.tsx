import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterInput } from '@welyt/shared';
import { Link, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { FormTextField, type FormTextInputHandle } from '@/components/auth/FormTextField';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { resolveFormError } from '@/components/auth/form-errors';
import { useRegisterMutation } from '@/features/auth/use-auth-mutations';
import { colors } from '@/theme/colors';

export default function SignUpScreen() {
  const router = useRouter();
  const registerMutation = useRegisterMutation();
  const [bannerError, setBannerError] = useState<string | null>(null);
  const emailInputRef = useRef<FormTextInputHandle>(null);
  const passwordInputRef = useRef<FormTextInputHandle>(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setBannerError(null);
    try {
      await registerMutation.mutateAsync(values);
    } catch (error) {
      const topError = resolveFormError(error, setError, ['name', 'email', 'password']);
      setBannerError(topError || null);
    }
  });

  return (
    <AuthScreenShell
      eyebrow="Get started"
      title="Create your account"
      subtitle="Set up your Welyt credentials to start tracking your finances."
      sectionLabel="Account details"
      backLabel="Sign in"
      onBack={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/sign-in');
        }
      }}
      footer={
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Already have an account?</Text>
          <Link href="/sign-in" asChild>
            <Pressable accessibilityRole="link" hitSlop={8} style={styles.textAction}>
              <Text style={styles.linkText}>Sign in</Text>
            </Pressable>
          </Link>
        </View>
      }
    >
      <StatusBanner tone="error" message={bannerError} />

      <Controller
        control={control}
        name="name"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextField
            label="Full name"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="Aarav Sharma"
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => {
              emailInputRef.current?.focus();
            }}
            errorMessage={errors.name?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextField
            inputRef={emailInputRef}
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
            onSubmitEditing={() => {
              passwordInputRef.current?.focus();
            }}
            errorMessage={errors.email?.message}
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextField
            inputRef={passwordInputRef}
            label="Password"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="Create a strong password"
            isPassword
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            helperText="At least 8 characters, including uppercase, lowercase, and a number."
            onSubmitEditing={() => {
              void onSubmit();
            }}
            errorMessage={errors.password?.message}
          />
        )}
      />

      <AuthButton
        label="Create account"
        loading={registerMutation.isPending}
        onPress={() => {
          void onSubmit();
        }}
      />
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 12,
    color: colors.muted,
  },
  textAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  linkText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.rust,
  },
});
