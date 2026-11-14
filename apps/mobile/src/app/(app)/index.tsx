import { useMutation } from '@tanstack/react-query';
import type { DebtMode } from '@welyt/shared';
import { Link } from 'expo-router';
import { CheckCircle2, KeyRound, LogOut, ShieldAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthButton } from '@/components/auth/AuthButton';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { authApi } from '@/features/auth/auth-api';
import { useAuthStore } from '@/features/auth/auth-store';
import { useLogoutAllMutation, useLogoutMutation } from '@/features/auth/use-auth-mutations';
import { colors } from '@/theme/colors';

export default function HomeScreen() {
  const user = useAuthStore((state) => state.user);
  const applyVerifiedUser = useAuthStore((state) => state.applyVerifiedUser);
  const logoutMutation = useLogoutMutation();
  const logoutAllMutation = useLogoutAllMutation();
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; text: string } | null>(
    null,
  );

  const updateDebtModeMutation = useMutation({
    mutationFn: (debtMode: DebtMode) => authApi.updateProfile({ debtMode }),
    onSuccess: async ({ user: updatedUser }) => {
      await applyVerifiedUser(updatedUser);
      setFeedback({ tone: 'success', text: 'Debt calculation preference updated.' });
    },
    onError: (error) => {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not update preference.',
      });
    },
  });

  if (!user) {
    return null;
  }

  const nextDebtMode: DebtMode =
    user.debtMode === 'remaining_emis' ? 'outstanding_principal' : 'remaining_emis';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          <View style={styles.heroCard}>
            <Image
              source={require('../../../assets/icon.png')}
              style={styles.logo}
              accessibilityLabel="Welyt logo"
            />
            <View style={styles.heroCopy}>
              <Text style={styles.greeting}>Welcome, {user.name}</Text>
              <Text style={styles.email}>{user.email}</Text>
              <View style={styles.verifiedBadge}>
                <CheckCircle2 size={15} color={colors.success} />
                <Text style={styles.verifiedText}>Email verified</Text>
              </View>
            </View>
          </View>

          {feedback ? <StatusBanner tone={feedback.tone} message={feedback.text} /> : null}

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Profile & preferences</Text>
            <View style={styles.preferenceRow}>
              <View style={styles.preferenceInfo}>
                <Text style={styles.preferenceLabel}>Debt calculation mode</Text>
                <Text style={styles.preferenceValue}>
                  {user.debtMode === 'remaining_emis' ? 'Remaining EMIs' : 'Outstanding principal'}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={updateDebtModeMutation.isPending}
                onPress={() => {
                  setFeedback(null);
                  updateDebtModeMutation.mutate(nextDebtMode);
                }}
                style={({ pressed }) => [
                  styles.chipButton,
                  pressed && styles.chipPressed,
                  updateDebtModeMutation.isPending && styles.chipDisabled,
                ]}
              >
                <Text style={styles.chipButtonText}>Switch</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Account security</Text>

            <Link href="/change-password" asChild>
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
              >
                <KeyRound size={20} color={colors.navy} />
                <View style={styles.actionCopy}>
                  <Text style={styles.actionTitle}>Change password</Text>
                  <Text style={styles.actionSubtitle}>
                    Update your password and sign out other devices
                  </Text>
                </View>
              </Pressable>
            </Link>

            <Pressable
              accessibilityRole="button"
              disabled={logoutAllMutation.isPending}
              onPress={() => {
                setFeedback(null);
                logoutAllMutation.mutate(undefined, {
                  onError: (err) => {
                    setFeedback({
                      tone: 'error',
                      text:
                        err instanceof Error ? err.message : 'Unable to revoke active sessions.',
                    });
                  },
                });
              }}
              style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
            >
              <ShieldAlert size={20} color={colors.error} />
              <View style={styles.actionCopy}>
                <Text style={styles.actionTitle}>Sign out of all devices</Text>
                <Text style={styles.actionSubtitle}>
                  Revoke every active session across phones and browsers
                </Text>
              </View>
            </Pressable>
          </View>

          <View style={styles.signOutContainer}>
            <AuthButton
              variant="secondary"
              label="Sign out"
              loading={logoutMutation.isPending}
              onPress={() => {
                void logoutMutation.mutateAsync();
              }}
            />
            <View style={styles.footerHint}>
              <LogOut size={14} color={colors.textMuted} />
              <Text style={styles.footerHintText}>Signed in securely with Welyt</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  container: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    gap: 18,
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 18,
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  greeting: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.navy,
  },
  email: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.successSurface,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.navy,
  },
  preferenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  preferenceInfo: {
    flex: 1,
    gap: 2,
  },
  preferenceLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  preferenceValue: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  chipButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.peachSoft,
    borderWidth: 1,
    borderColor: colors.peachBorder,
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipDisabled: {
    opacity: 0.5,
  },
  chipButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.navy,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  actionRowPressed: {
    opacity: 0.75,
  },
  actionCopy: {
    flex: 1,
    gap: 2,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  actionSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  signOutContainer: {
    gap: 12,
    marginTop: 4,
  },
  footerHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerHintText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
