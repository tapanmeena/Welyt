import { zodResolver } from '@hookform/resolvers/zod';
import { verifyEmailSchema, type VerifyEmailInput } from '@welyt/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { FormTextField, type FormTextInputHandle } from '@/components/auth/FormTextField';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { resolveFormError } from '@/components/auth/form-errors';
import { useAuthStore } from '@/features/auth/auth-store';
import {
  useLogoutMutation,
  useResendVerificationMutation,
  useVerifyEmailMutation,
} from '@/features/auth/use-auth-mutations';
import { colors } from '@/theme/colors';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; code?: string }>();
  const user = useAuthStore((state) => state.user);
  const isSignedIn = Boolean(user);

  const verifyMutation = useVerifyEmailMutation();
  const resendMutation = useResendVerificationMutation();
  const logoutMutation = useLogoutMutation();

  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const codeInputRef = useRef<FormTextInputHandle>(null);

  const initialEmail = user?.email ?? (typeof params.email === 'string' ? params.email : '');
  const initialCode = typeof params.code === 'string' ? params.code : '';

  const {
    control,
    getValues,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<VerifyEmailInput>({
    resolver: zodResolver(verifyEmailSchema),
    defaultValues: {
      code: initialCode,
      ...(initialEmail ? { email: initialEmail } : {}),
    },
  });

  useEffect(() => {
    if (typeof params.code === 'string' && params.code.length > 0) {
      setValue('code', params.code);
    }
    if (!user && typeof params.email === 'string' && params.email.length > 0) {
      setValue('email', params.email);
    }
  }, [params.code, params.email, setValue, user]);

  useEffect(() => {
    if (cooldownSeconds <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [cooldownSeconds]);

  const onSubmit = handleSubmit(async (values) => {
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const payload: VerifyEmailInput = user
        ? { code: values.code }
        : { code: values.code, ...(values.email ? { email: values.email } : {}) };
      await verifyMutation.mutateAsync(payload);
      if (!isSignedIn) {
        router.replace('/sign-in?verified=1');
      }
    } catch (error) {
      const topError = resolveFormError(error, setError, ['code', 'email']);
      setBannerError(topError || null);
    }
  });

  const handleResend = async () => {
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const emailArg = user?.email ?? (getValues('email')?.trim() || initialEmail || undefined);
      const response = await resendMutation.mutateAsync(emailArg);
      setBannerSuccess(response.message);
      setCooldownSeconds(60);
    } catch (error) {
      setBannerError(error instanceof Error ? error.message : 'Unable to resend code right now.');
    }
  };

  const targetEmail = user?.email ?? initialEmail;

  return (
    <AuthScreenShell
      eyebrow="Email confirmation"
      title="Verify your email"
      subtitle={
        targetEmail
          ? `Enter the 6-digit verification code sent to ${targetEmail}.`
          : 'Enter your email address and the 6-digit verification code we sent you.'
      }
      sectionLabel="Verification code"
      footer={
        isSignedIn ? (
          <Pressable
            accessibilityRole="button"
            disabled={logoutMutation.isPending}
            onPress={() => {
              void logoutMutation.mutateAsync();
            }}
            hitSlop={8}
            style={styles.textAction}
          >
            <Text style={styles.switchAccountText}>Sign out or use a different email</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="link"
            onPress={() => {
              router.replace('/sign-in');
            }}
            hitSlop={8}
            style={styles.textAction}
          >
            <Text style={styles.switchAccountText}>Back to sign in</Text>
          </Pressable>
        )
      }
    >
      <StatusBanner tone="success" message={bannerSuccess} />
      <StatusBanner tone="error" message={bannerError} />

      {!isSignedIn ? (
        <Controller
          control={control}
          name="email"
          render={({ field: { onChange, onBlur, value } }) => (
            <FormTextField
              label="Email address"
              value={value ?? ''}
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
                codeInputRef.current?.focus();
              }}
              errorMessage={errors.email?.message}
            />
          )}
        />
      ) : null}

      <Controller
        control={control}
        name="code"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextField
            inputRef={codeInputRef}
            label="6-digit verification code"
            value={value}
            onChangeText={(text) => onChange(text.replace(/\D/g, '').slice(0, 6))}
            onBlur={onBlur}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            returnKeyType="done"
            onSubmitEditing={() => {
              void onSubmit();
            }}
            errorMessage={errors.code?.message}
          />
        )}
      />

      <View style={styles.actionsGroup}>
        <AuthButton
          label="Verify email"
          loading={verifyMutation.isPending}
          onPress={() => {
            void onSubmit();
          }}
        />

        <AuthButton
          variant="secondary"
          label={
            cooldownSeconds > 0 ? `Resend code in ${cooldownSeconds}s` : 'Resend verification code'
          }
          disabled={cooldownSeconds > 0}
          loading={resendMutation.isPending}
          onPress={() => {
            void handleResend();
          }}
        />
      </View>
    </AuthScreenShell>
  );
}

const styles = StyleSheet.create({
  actionsGroup: {
    gap: 9,
  },
  textAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  switchAccountText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.rust,
  },
});
