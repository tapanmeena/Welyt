import { Eye, EyeOff } from 'lucide-react-native';
import { useState, type ComponentRef, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radii } from '@/theme/colors';

export type FormTextInputHandle = ComponentRef<typeof TextInput>;

export interface FormTextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  errorMessage?: string | undefined;
  helperText?: string | undefined;
  isPassword?: boolean | undefined;
  inputRef?: Ref<FormTextInputHandle> | undefined;
}

export function FormTextField({
  label,
  errorMessage,
  helperText,
  isPassword = false,
  inputRef,
  editable = true,
  blurOnSubmit,
  onBlur,
  onFocus,
  ...inputProps
}: FormTextFieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const hasError = Boolean(errorMessage);
  const resolvedBlurOnSubmit =
    blurOnSubmit ?? (inputProps.returnKeyType === 'next' ? false : undefined);

  return (
    <View style={styles.fieldWrapper}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputRow,
          !editable ? styles.inputRowReadonly : null,
          isFocused ? styles.inputRowFocused : null,
          hasError ? styles.inputRowError : null,
        ]}
      >
        <TextInput
          {...inputProps}
          ref={inputRef}
          editable={editable}
          {...(resolvedBlurOnSubmit !== undefined ? { blurOnSubmit: resolvedBlurOnSubmit } : {})}
          secureTextEntry={isPassword && !isPasswordVisible}
          placeholderTextColor={colors.muted}
          selectionColor={colors.rust}
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
              <EyeOff size={19} color={colors.muted} strokeWidth={1.7} />
            ) : (
              <Eye size={19} color={colors.muted} strokeWidth={1.7} />
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
    gap: 7,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.ink,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 47,
    borderRadius: radii.input,
    borderWidth: 1,
    borderColor: colors.controlLine,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
  },
  inputRowReadonly: {
    backgroundColor: colors.sand,
  },
  inputRowFocused: {
    borderColor: colors.rust,
    borderWidth: 2,
    paddingHorizontal: 11,
  },
  inputRowError: {
    borderColor: colors.danger,
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: colors.ink,
    paddingVertical: 11,
  },
  visibilityButton: {
    marginLeft: 8,
    minWidth: 36,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.danger,
  },
  helperText: {
    fontSize: 12,
    lineHeight: 19,
    color: colors.muted,
  },
});
