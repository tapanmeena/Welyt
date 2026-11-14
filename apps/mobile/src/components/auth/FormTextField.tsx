import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors } from '@/theme/colors';

export interface FormTextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  errorMessage?: string | undefined;
  helperText?: string | undefined;
  isPassword?: boolean | undefined;
}

export function FormTextField({
  label,
  errorMessage,
  helperText,
  isPassword = false,
  onBlur,
  onFocus,
  ...inputProps
}: FormTextFieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const hasError = Boolean(errorMessage);

  return (
    <View style={styles.fieldWrapper}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          isFocused ? styles.inputRowFocused : null,
          hasError ? styles.inputRowError : null,
        ]}
      >
        <TextInput
          {...inputProps}
          secureTextEntry={isPassword && !isPasswordVisible}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={label}
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
          style={styles.input}
        />
        {isPassword ? (
          <Pressable
            onPress={() => setIsPasswordVisible((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
            hitSlop={8}
            style={styles.visibilityButton}
          >
            {isPasswordVisible ? (
              <EyeOff size={20} color={colors.textSecondary} />
            ) : (
              <Eye size={20} color={colors.textSecondary} />
            )}
          </Pressable>
        ) : null}
      </View>

      {errorMessage ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : helperText ? (
        <Text style={styles.helperText}>{helperText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldWrapper: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  inputRowFocused: {
    borderColor: colors.borderFocused,
    borderWidth: 1.5,
  },
  inputRowError: {
    borderColor: colors.error,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: 12,
  },
  visibilityButton: {
    marginLeft: 8,
    padding: 4,
  },
  errorText: {
    fontSize: 13,
    color: colors.error,
  },
  helperText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
