import { useMutation } from '@tanstack/react-query';
import type { DebtMode } from '@welyt/shared';
import { useRouter } from 'expo-router';
import {
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Landmark,
  LogOut,
  Scale,
  ShieldAlert,
} from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthButton } from '@/components/auth/AuthButton';
import { StatusBanner } from '@/components/auth/StatusBanner';
import { authApi } from '@/features/auth/auth-api';
import { useAuthStore } from '@/features/auth/auth-store';
import { useLogoutAllMutation, useLogoutMutation } from '@/features/auth/use-auth-mutations';
import { colors, radii } from '@/theme/colors';

const DEBT_OPTIONS: readonly {
  mode: DebtMode;
  title: string;
  description: string;
}[] = [
  {
    mode: 'remaining_emis',
    title: 'Remaining scheduled EMIs',
    description: 'Counts total remaining scheduled EMI obligations in net-worth debt.',
  },
  {
    mode: 'outstanding_principal',
    title: 'Principal-only debt',
    description: 'Counts remaining loan principal without future scheduled interest.',
  },
];

export default function HomeScreen() {
  const router = useRouter();
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
      setFeedback({ tone: 'success', text: 'Financial valuation preference saved.' });
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarBrand}>
          <View style={styles.brandMark}>
            <Image
              source={require('../../../assets/icon.png')}
              style={styles.logo}
              accessibilityLabel="Welyt logo"
            />
          </View>
          <Text style={styles.toolbarTitle} accessibilityRole="header">
            Workspace
          </Text>
        </View>
        <View style={styles.verifiedBadge}>
          <CheckCircle2 size={13} color={colors.good} strokeWidth={2} />
          <Text style={styles.verifiedText}>Verified</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.stage}>
          <View style={styles.heroCard}>
            <View style={styles.heroTop}>
              <Text style={styles.heroEyebrow}>Signed-in profile</Text>
              <Text style={styles.heroTag}>Welyt</Text>
            </View>
            <Text style={styles.heroName}>{user.name}</Text>
            <Text style={styles.heroEmail}>{user.email}</Text>
            <View style={styles.heroFooter}>
              <Text style={styles.heroFooterText}>
                {user.debtMode === 'remaining_emis'
                  ? 'Remaining scheduled EMIs · INR · Apr-Mar FY'
                  : 'Principal-only debt · INR · Apr-Mar FY'}
              </Text>
            </View>
          </View>

          {feedback ? <StatusBanner tone={feedback.tone} message={feedback.text} /> : null}

          <View style={styles.callout}>
            <Text style={styles.calloutTitle}>Make this workspace yours.</Text>
            <Text style={styles.calloutCopy}>
              Your session is encrypted on this device and synchronized with your Welyt account
              conventions.
            </Text>
          </View>

          <View style={styles.settingsGroup}>
            <Text style={styles.groupHeading}>Financial conventions</Text>
            <View style={styles.presetGrid}>
              {DEBT_OPTIONS.map((option) => {
                const selected = user.debtMode === option.mode;
                return (
                  <Pressable
                    key={option.mode}
                    accessibilityRole="radio"
                    accessibilityState={{
                      checked: selected,
                      disabled: updateDebtModeMutation.isPending,
                    }}
                    disabled={updateDebtModeMutation.isPending}
                    onPress={() => {
                      if (!selected) {
                        setFeedback(null);
                        updateDebtModeMutation.mutate(option.mode);
                      }
                    }}
                    style={[
                      styles.presetOption,
                      selected && styles.presetOptionSelected,
                      updateDebtModeMutation.isPending && styles.disabledItem,
                    ]}
                  >
                    <View style={[styles.tile, selected ? styles.tileRust : styles.tileWarm]}>
                      {option.mode === 'remaining_emis' ? (
                        <Landmark
                          size={18}
                          color={selected ? colors.tileRustFg : colors.tileWarmFg}
                          strokeWidth={1.7}
                        />
                      ) : (
                        <Scale
                          size={18}
                          color={selected ? colors.tileRustFg : colors.tileWarmFg}
                          strokeWidth={1.7}
                        />
                      )}
                    </View>
                    <View style={styles.presetText}>
                      <Text style={styles.presetTitle}>{option.title}</Text>
                      <Text style={styles.presetDescription}>{option.description}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.settingsGroup}>
            <Text style={styles.groupHeading}>Security & sessions</Text>
            <View style={styles.settingsList}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  router.push('/change-password');
                }}
                style={({ pressed }) => [styles.settingsRow, pressed && styles.rowPressed]}
              >
                <View style={[styles.tile, styles.tileNavy]}>
                  <KeyRound size={18} color={colors.tileNavyFg} strokeWidth={1.7} />
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>Change password</Text>
                  <Text style={styles.rowSubtitle}>
                    Update your password and sign out other devices.
                  </Text>
                </View>
                <ChevronRight size={16} color={colors.muted} strokeWidth={1.8} />
              </Pressable>

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
                style={({ pressed }) => [
                  styles.settingsRow,
                  styles.settingsRowLast,
                  pressed && styles.rowPressed,
                ]}
              >
                <View style={[styles.tile, styles.tileRust]}>
                  <ShieldAlert size={18} color={colors.tileRustFg} strokeWidth={1.7} />
                </View>
                <View style={styles.rowMain}>
                  <Text style={styles.rowTitle}>Sign out of all devices</Text>
                  <Text style={styles.rowSubtitle}>
                    Revoke every active session across phones and browsers.
                  </Text>
                </View>
                <ChevronRight size={16} color={colors.muted} strokeWidth={1.8} />
              </Pressable>
            </View>
          </View>

          <View style={styles.signOutBlock}>
            <AuthButton
              variant="secondary"
              label="Sign out"
              loading={logoutMutation.isPending}
              onPress={() => {
                void logoutMutation.mutateAsync();
              }}
            />
            <View style={styles.securityNote}>
              <LogOut size={14} color={colors.muted} strokeWidth={1.7} />
              <Text style={styles.securityNoteText}>
                Preferences apply across sessions without altering recorded history.
              </Text>
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
    backgroundColor: colors.cream,
  },
  toolbar: {
    minHeight: 58,
    paddingHorizontal: 18,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  toolbarBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 33,
    height: 33,
    borderRadius: 9,
    backgroundColor: colors.navy,
    overflow: 'hidden',
  },
  logo: {
    width: 33,
    height: 33,
    borderRadius: 9,
  },
  toolbarTitle: {
    fontSize: 21,
    fontWeight: '600',
    letterSpacing: -0.6,
    color: colors.ink,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radii.badge,
    backgroundColor: colors.goodBg,
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.good,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 17,
    paddingTop: 6,
    paddingBottom: 28,
  },
  stage: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: 16,
  },
  heroCard: {
    borderRadius: radii.hero,
    backgroundColor: colors.navy,
    paddingHorizontal: 18,
    paddingTop: 19,
    paddingBottom: 15,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.heroSubtle,
  },
  heroTag: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.peach,
  },
  heroName: {
    fontSize: 26,
    fontWeight: '500',
    letterSpacing: -0.9,
    color: colors.heroText,
    marginTop: 8,
  },
  heroEmail: {
    fontSize: 12,
    color: colors.heroMuted,
    marginTop: 3,
  },
  heroFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.heroDivider,
    marginTop: 14,
    paddingTop: 10,
  },
  heroFooterText: {
    fontSize: 11,
    color: colors.heroSubtle,
  },
  callout: {
    padding: 16,
    backgroundColor: colors.calloutBg,
    borderWidth: 1,
    borderColor: colors.calloutBorder,
    borderRadius: radii.list,
    gap: 6,
  },
  calloutTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.25,
    color: colors.ink,
  },
  calloutCopy: {
    fontSize: 12,
    lineHeight: 20,
    color: colors.muted,
  },
  settingsGroup: {
    gap: 9,
  },
  groupHeading: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.15,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  presetGrid: {
    gap: 10,
  },
  presetOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 15,
    borderRadius: radii.option,
    borderWidth: 1,
    borderColor: colors.controlLine,
    backgroundColor: colors.card,
  },
  presetOptionSelected: {
    borderWidth: 2,
    borderColor: colors.rust,
    padding: 14,
    backgroundColor: colors.selectedBg,
  },
  disabledItem: {
    opacity: 0.6,
  },
  presetText: {
    flex: 1,
    gap: 4,
  },
  presetTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  presetDescription: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },
  tile: {
    width: 35,
    height: 35,
    borderRadius: radii.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileWarm: {
    backgroundColor: colors.tileWarmBg,
  },
  tileRust: {
    backgroundColor: colors.tileRustBg,
  },
  tileNavy: {
    backgroundColor: colors.tileNavyBg,
  },
  settingsList: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.list,
    paddingHorizontal: 14,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: 72,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  settingsRowLast: {
    borderBottomWidth: 0,
  },
  rowPressed: {
    opacity: 0.72,
  },
  rowMain: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
  },
  rowSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  signOutBlock: {
    gap: 12,
    marginTop: 4,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 14,
  },
  securityNoteText: {
    fontSize: 11,
    lineHeight: 17,
    color: colors.muted,
    flexShrink: 1,
  },
});
