import { useMutation } from '@tanstack/react-query';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyEmailInput,
} from '@welyt/shared';
import { authApi } from './auth-api';
import { useAuthStore } from './auth-store';

export function useRegisterMutation() {
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: (input: RegisterInput) => authApi.register(input),
    onSuccess: async (data) => {
      await setSession(data);
    },
  });
}

export function useLoginMutation() {
  const setSession = useAuthStore((state) => state.setSession);

  return useMutation({
    mutationFn: (input: LoginInput) => authApi.login(input),
    onSuccess: async (data) => {
      await setSession(data);
    },
  });
}

export function useVerifyEmailMutation() {
  const applyVerifiedUser = useAuthStore((state) => state.applyVerifiedUser);

  return useMutation({
    mutationFn: (input: VerifyEmailInput) => authApi.verifyEmail(input),
    onSuccess: async (data) => {
      await applyVerifiedUser(data.user, data.accessToken);
    },
  });
}

export function useResendVerificationMutation() {
  return useMutation({
    mutationFn: (email?: string) => authApi.resendVerification(email),
  });
}

export function useForgotPasswordMutation() {
  return useMutation({
    mutationFn: (input: ForgotPasswordInput) => authApi.forgotPassword(input),
  });
}

export function useResetPasswordMutation() {
  return useMutation({
    mutationFn: (input: ResetPasswordInput) => authApi.resetPassword(input),
  });
}

export function useChangePasswordMutation() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => authApi.changePassword(input),
  });
}

export function useLogoutMutation() {
  const clearSession = useAuthStore((state) => state.clearSession);

  return useMutation({
    mutationFn: async () => {
      const refreshToken = useAuthStore.getState().refreshToken;
      try {
        await authApi.logout(refreshToken);
      } catch {
        // Always clear local session even if server logout fails offline
      }
      await clearSession();
    },
  });
}

export function useLogoutAllMutation() {
  const clearSession = useAuthStore((state) => state.clearSession);

  return useMutation({
    mutationFn: async () => {
      await authApi.logoutAll();
      await clearSession();
    },
  });
}
