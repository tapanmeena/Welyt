import { CheckCircle2 } from 'lucide-react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii } from '@/theme/colors';

const DISPLAY_MS = 4_000;
const DRAG_START_DISTANCE = 8;
const DISMISS_DISTANCE = 64;
const SuccessSnackbarContext = createContext<((text: string) => void) | null>(null);

type Message = { id: number; text: string };

function SwipeableSnackbar({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  const [offset] = useState(() => new Animated.Value(0));
  const gesture = usePanGesture({
    activeOffsetX: [-DRAG_START_DISTANCE, DRAG_START_DISTANCE],
    failOffsetY: [-DRAG_START_DISTANCE, DRAG_START_DISTANCE],
    runOnJS: true,
    onUpdate: ({ translationX }) => offset.setValue(translationX),
    onDeactivate: ({ translationX, translationY, canceled }) => {
      if (
        !canceled &&
        Math.abs(translationX) >= DISMISS_DISTANCE &&
        Math.abs(translationX) > Math.abs(translationY)
      ) {
        onDismiss();
        return;
      }
      Animated.spring(offset, {
        toValue: 0,
        bounciness: 0,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    },
  });

  return (
    <GestureDetector gesture={gesture} touchAction="pan-y">
      <Animated.View style={[styles.snackbar, { transform: [{ translateX: offset }] }]}>
        <CheckCircle2 size={18} color={colors.peach} aria-hidden />
        <Text style={styles.text}>{text}</Text>
      </Animated.View>
    </GestureDetector>
  );
}

export function SuccessSnackbarProvider({ children }: { children: ReactNode }) {
  const { bottom, left, right } = useSafeAreaInsets();
  const nextId = useRef(0);
  const [message, setMessage] = useState<Message | null>(null);
  const showSuccess = useCallback((text: string) => {
    nextId.current += 1;
    setMessage({ id: nextId.current, text });
  }, []);
  const dismiss = useCallback((target: Message) => {
    setMessage((current) => (current === target ? null : current));
  }, []);

  useEffect(() => {
    if (!message) return;
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message.text);
    const timer = setTimeout(() => dismiss(message), DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [dismiss, message]);

  return (
    <SuccessSnackbarContext.Provider value={showSuccess}>
      <View style={styles.container}>
        {children}
        <View
          pointerEvents="box-none"
          style={[styles.overlay, { bottom: bottom + 12, left: left + 16, right: right + 16 }]}
        >
          <View role="status" accessibilityLiveRegion="polite" pointerEvents="box-none">
            {message ? (
              <SwipeableSnackbar
                key={message.id}
                text={message.text}
                onDismiss={() => dismiss(message)}
              />
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
