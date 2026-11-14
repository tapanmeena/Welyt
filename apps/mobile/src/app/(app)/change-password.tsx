import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, type ChangePasswordInput } from '@welyt/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, Text } from 'react-native';
import { AuthButton } from '@/components/auth/AuthButton';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { FormTextField } from '@/components/auth/FormTextField';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { resolveFormError } from '@/components/auth/form-errors';
import { useChangePasswordMutation } from '@/features/auth/use-auth-mutations';
import { colors } from '@/theme/colors';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const changePasswordMutation = useChangePasswordMutation();
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setBannerError(null);
    setBannerSuccess(null);
    try {
      const result = await changePasswordMutation.mutateAsync(values);
      reset();
      setBannerSuccess(result.message);
    } catch (error) {
      const topError = resolveFormError(error, setError, ['currentPassword', 'newPassword']);
      setBannerError(topError || null);
    }
  });

  return (
    <AuthScreenShell
      title="Change password"
      subtitle="Enter your current password and choose a strong new password."
      footer={
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/');
            }
          }}
          hitSlop={8}
        >
          <Text style={styles.linkText}>Back to workspace</Text>
        </Pressable>
      }
    >
      <StatusBanner tone="success" message={bannerSuccess} />
      <StatusBanner tone="error" message={bannerError} />

      <Controller
        control={control}
        name="currentPassword"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormTextField
            label="Current password"
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            placeholder="Enter your current password"
            isPassword
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="password"
            textContentType="password"
            errorMessage={errors.currentPassword?.message}
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
        label="Save new password"
        loading={changePasswordMutation.isPending}
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
