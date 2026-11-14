import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/colors';

interface StatusBannerProps {
  tone: 'error' | 'success' | 'info';
  message: string | null | undefined;
}

export function StatusBanner({ tone, message }: StatusBannerProps) {
  if (!message) {
    return null;
  }

  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.banner,
        tone === 'error' && styles.errorBanner,
        tone === 'success' && styles.successBanner,
        tone === 'info' && styles.infoBanner,
      ]}
    >
      <Text
        style={[
          styles.text,
          tone === 'error' && styles.errorText,
          tone === 'success' && styles.successText,
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
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorBanner: {
    backgroundColor: colors.errorSurface,
    borderColor: colors.errorBorder,
  },
  successBanner: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  infoBanner: {
    backgroundColor: colors.peachSoft,
    borderColor: colors.peachBorder,
  },
  text: {
    fontSize: 14,
    lineHeight: 20,
  },
  errorText: {
    color: colors.error,
  },
  successText: {
    color: colors.success,
  },
  infoText: {
    color: colors.navy,
  },
});
