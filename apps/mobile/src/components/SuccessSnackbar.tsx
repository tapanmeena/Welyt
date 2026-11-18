import { CheckCircle2 } from 'lucide-react-native';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii } from '@/theme/colors';

const DISPLAY_MS = 4_000;
const SuccessSnackbarContext = createContext<((text: string) => void) | null>(null);

export function SuccessSnackbarProvider({ children }: { children: ReactNode }) {
  const { bottom, left, right } = useSafeAreaInsets();
  const [message, setMessage] = useState<{ text: string } | null>(null);
  const showSuccess = useCallback((text: string) => setMessage({ text }), []);

  useEffect(() => {
    if (!message) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message.text);
    const timer = setTimeout(
      () => setMessage((current) => (current === message ? null : current)),
      DISPLAY_MS,
    );
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <SuccessSnackbarContext.Provider value={showSuccess}>
      <View style={styles.container}>
        {children}
        <View
          pointerEvents="none"
          style={[styles.overlay, { bottom: bottom + 12, left: left + 16, right: right + 16 }]}
        >
          <View
            role="status"
            accessibilityLiveRegion="polite"
            style={message ? styles.snackbar : undefined}
          >
            {message ? (
              <>
                <CheckCircle2 size={18} color={colors.peach} aria-hidden />
                <Text style={styles.text}>{message.text}</Text>
              </>
            ) : null}
          </View>
        </View>
      </View>
    </SuccessSnackbarContext.Provider>
  );
}

export function useSuccessSnackbar() {
  const showSuccess = useContext(SuccessSnackbarContext);
  if (!showSuccess) throw new Error('Success snackbar requires a SuccessSnackbarProvider');
  return showSuccess;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: { position: 'absolute', alignItems: 'center', zIndex: 1 },
  snackbar: {
    backgroundColor: colors.navy,
    borderRadius: radii.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: 480,
  },
  text: { color: colors.heroText, fontSize: 14, lineHeight: 20, flexShrink: 1 },
});
