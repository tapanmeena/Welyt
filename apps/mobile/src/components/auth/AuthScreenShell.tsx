import { ArrowLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii } from '@/theme/colors';

interface AuthScreenShellProps {
  eyebrow?: string | undefined;
  title: string;
  subtitle: string;
  sectionLabel?: string | undefined;
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthScreenShell({
  eyebrow = 'Welyt workspace',
  title,
  subtitle,
  sectionLabel,
  backLabel,
  onBack,
  children,
  footer,
}: AuthScreenShellProps) {
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {onBack && backLabel ? (
        <View style={styles.topBar}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <ArrowLeft size={16} color={colors.rust} strokeWidth={1.9} />
            <Text style={styles.backButtonLabel}>{backLabel}</Text>
          </Pressable>
        </View>
      ) : null}

      <KeyboardAwareScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          onBack && backLabel ? styles.scrollContentWithTopBar : null,
          { paddingBottom: Math.max(insets.bottom, 20) + 12 },
        ]}
        bottomOffset={72}
        extraKeyboardSpace={20}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stage}>
          <View style={styles.brandRow}>
            <View style={styles.brandSymbol}>
              <Image
                source={require('../../../assets/icon.png')}
                style={styles.logo}
                accessibilityLabel="Welyt logo"
              />
            </View>
            <View style={styles.brandMeta}>
              <Text style={styles.eyebrow}>{eyebrow}</Text>
              <Text style={styles.brandName}>Welyt</Text>
            </View>
          </View>

          <View style={styles.introBlock}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>

          <View style={styles.card}>
            {sectionLabel ? <Text style={styles.sectionLegend}>{sectionLabel}</Text> : null}
            <View style={styles.formBody}>{children}</View>
          </View>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 17,
    paddingTop: 20,
  },
  scrollContentWithTopBar: {
    justifyContent: 'flex-start',
    paddingTop: 8,
  },
  stage: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  topBar: {
    width: '100%',
    maxWidth: 454,
    alignSelf: 'center',
    paddingHorizontal: 17,
    paddingTop: 4,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingVertical: 6,
    gap: 6,
  },
  backButtonPressed: {
    opacity: 0.72,
  },
  backButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.rust,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
  },
  brandSymbol: {
    width: 45,
    height: 45,
    borderRadius: radii.symbol,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logo: {
    width: 45,
    height: 45,
    borderRadius: radii.symbol,
  },
  brandMeta: {
    gap: 2,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.rust,
  },
  brandName: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.45,
    color: colors.ink,
  },
  introBlock: {
    marginBottom: 17,
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.75,
    lineHeight: 29,
    color: colors.ink,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 21,
    color: colors.muted,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 17,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 14,
  },
  sectionLegend: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.muted,
    marginBottom: 2,
  },
  formBody: {
    gap: 15,
  },
  footer: {
    marginTop: 17,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    alignItems: 'center',
    gap: 6,
  },
});
