import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { colors, radii } from '@/theme/colors';

interface AuthButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean | undefined;
  disabled?: boolean | undefined;
  variant?: 'primary' | 'secondary' | 'danger' | undefined;
}

export function AuthButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
}: AuthButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'primary' && pressed && !isDisabled && styles.primaryPressed,
        variant === 'secondary' && styles.secondary,
        variant === 'secondary' && pressed && !isDisabled && styles.secondaryPressed,
        variant === 'danger' && styles.danger,
        variant === 'danger' && pressed && !isDisabled && styles.dangerPressed,
        isDisabled && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={variant === 'secondary' ? colors.ink : colors.card}
        />
      ) : (
        <Text
          style={[
            styles.label,
            variant === 'secondary' ? styles.secondaryLabel : styles.lightLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 46,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primary: {
    backgroundColor: colors.rust,
  },
  primaryPressed: {
    backgroundColor: colors.rustPressed,
  },
  secondary: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.controlLine,
  },
  secondaryPressed: {
    backgroundColor: colors.sand,
  },
  danger: {
    backgroundColor: colors.danger,
  },
  dangerPressed: {
    backgroundColor: colors.dangerPressed,
  },
  disabled: {
    opacity: 0.55,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  lightLabel: {
    color: '#ffffff',
  },
  secondaryLabel: {
    color: colors.ink,
  },
});
