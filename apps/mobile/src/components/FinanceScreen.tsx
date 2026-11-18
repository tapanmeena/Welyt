import { ArrowLeft } from 'lucide-react-native';
import { useContext, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WorkspaceNavigationContext } from '@/components/navigation/WorkspaceNavigation';
import { colors, radii } from '@/theme/colors';

export function FinanceScreen({
  title,
  subtitle,
  backLabel,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  backLabel?: string;
  onBack?: () => void;
  children: ReactNode;
}) {
  const tabBarVisible = useContext(WorkspaceNavigationContext)?.tabBarVisible;

  return (
    <SafeAreaView style={styles.safeArea} edges={tabBarVisible ? ['top'] : ['top', 'bottom']}>
      {onBack && backLabel ? (
        <View style={[styles.stage, styles.toolbar]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Back to ${backLabel}`}
            onPress={onBack}
            style={({ pressed }) => [styles.back, pressed && financeStyles.pressed]}
          >
            <ArrowLeft size={17} color={colors.rust} strokeWidth={1.9} />
            <Text style={styles.backText}>{backLabel}</Text>
          </Pressable>
        </View>
      ) : null}
      <KeyboardAwareScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        bottomOffset={72}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View style={styles.stage}>
          <View style={styles.intro}>
            <Text accessibilityRole="header" style={styles.title}>
              {title}
            </Text>
            {subtitle ? <Text style={financeStyles.muted}>{subtitle}</Text> : null}
          </View>
          {children}
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

export function FinanceChoice({
  label,
  selected,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.selected,
        pressed && financeStyles.pressed,
      ]}
    >
      <Text style={[styles.choiceLabel, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

export const financeStyles = StyleSheet.create({
  section: { gap: 10 },
  card: {
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    padding: 16,
    gap: 12,
  },
  heading: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  label: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.72 },
  loading: { alignItems: 'flex-start', paddingVertical: 6 },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.cream },
  scroll: { flex: 1 },
  stage: { alignSelf: 'center', width: '100%', maxWidth: 520, gap: 16 },
  toolbar: { paddingHorizontal: 17 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    minHeight: 44,
  },
  backText: { color: colors.rust, fontSize: 13, fontWeight: '700' },
  content: { paddingHorizontal: 17, paddingTop: 8, paddingBottom: 26 },
  intro: { gap: 7 },
  title: {
    color: colors.ink,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.65,
  },
  choice: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.controlLine,
    backgroundColor: colors.card,
  },
  selected: { borderColor: colors.rust, backgroundColor: colors.selectedBg },
  choiceLabel: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  selectedLabel: { color: colors.rust },
});
