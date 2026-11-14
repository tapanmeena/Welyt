import { AlertCircle, CheckCircle2, Info } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '@/theme/colors';

interface StatusBannerProps {
  tone: 'error' | 'success' | 'info' | 'warning';
  message: string | null | undefined;
}

export function StatusBanner({ tone, message }: StatusBannerProps) {
  if (!message) {
    return null;
  }

  const iconColor =
    tone === 'error'
      ? colors.danger
      : tone === 'success'
        ? colors.good
        : tone === 'warning'
          ? colors.warn
          : colors.noticeFg;

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        tone === 'error' && styles.errorBanner,
        tone === 'success' && styles.successBanner,
        tone === 'warning' && styles.warningBanner,
        tone === 'info' && styles.infoBanner,
      ]}
    >
      <View style={styles.iconWrap}>
        {tone === 'error' || tone === 'warning' ? (
          <AlertCircle size={17} color={iconColor} strokeWidth={1.8} />
        ) : tone === 'success' ? (
          <CheckCircle2 size={17} color={iconColor} strokeWidth={1.8} />
        ) : (
          <Info size={17} color={iconColor} strokeWidth={1.8} />
        )}
      </View>
      <Text
        style={[
          styles.text,
          tone === 'error' && styles.errorText,
          tone === 'success' && styles.successText,
          tone === 'warning' && styles.warningText,
          tone === 'info' && styles.infoText,
        ]}
      >
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    borderRadius: radii.control,
    padding: 12,
  },
  iconWrap: {
    marginTop: 1,
  },
  errorBanner: {
    backgroundColor: colors.dangerBg,
  },
  successBanner: {
    backgroundColor: colors.goodBg,
  },
  warningBanner: {
    backgroundColor: colors.warnBg,
  },
  infoBanner: {
    backgroundColor: colors.noticeBg,
  },
  text: {
    flex: 1,
    fontSize: 12,
    lineHeight: 19,
  },
  errorText: {
    color: colors.danger,
  },
  successText: {
    color: colors.good,
  },
  warningText: {
    color: colors.warn,
  },
  infoText: {
    color: colors.noticeFg,
  },
});
