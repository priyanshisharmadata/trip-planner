import { Feather } from '@expo/vector-icons';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';

type Feedback = { type: 'success' | 'error' | 'info'; message: string };
type Notice = Feedback & { id: number };
type FeedbackContextValue = {
  notify: (feedback: Feedback) => void;
  current: Notice | undefined;
  dismiss: (id: number) => void;
  setPaused: (paused: boolean) => void;
  registerOverlay: () => () => void;
};

const FeedbackContext = createContext<FeedbackContextValue | undefined>(undefined);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Notice[]>([]);
  const [overlays, setOverlays] = useState(0);
  const [paused, setPaused] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const nextId = useRef(0);
  const current = queue[0];

  const notify = useCallback((feedback: Feedback) => {
    const message = feedback.message.trim();
    if (!message) return;
    const notice = { ...feedback, message, id: ++nextId.current };
    setQueue((pending) => [...pending, notice]);
  }, []);
  const dismiss = useCallback((id: number) => {
    setQueue((pending) => pending.filter((notice) => notice.id !== id));
  }, []);
  const registerOverlay = useCallback(() => {
    setOverlays((count) => count + 1);
    return () => setOverlays((count) => count - 1);
  }, []);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (active) setScreenReader(enabled);
    }).catch(() => {});
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    const app = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => { active = false; reader.remove(); app.remove(); };
  }, []);

  useEffect(() => {
    if (current && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(current.message);
  }, [current]);

  useEffect(() => {
    // Let screen reader users dismiss at their own pace; do not consume notices in the background.
    if (!current || paused || screenReader || !foreground) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const duration = current.type === 'error' ? 8000 : 5000;
    const schedule = (timeout: number) => {
      if (active) timer = setTimeout(() => dismiss(current.id), Math.max(duration, timeout));
    };
    if (Platform.OS === 'android') {
      void AccessibilityInfo.getRecommendedTimeoutMillis(duration).then(schedule).catch(() => schedule(duration));
    } else schedule(duration);
    return () => { active = false; clearTimeout(timer); };
  }, [current, dismiss, foreground, paused, screenReader]);

  const value = useMemo(() => ({ notify, current, dismiss, setPaused, registerOverlay }), [notify, current, dismiss, registerOverlay]);
  return (
    <FeedbackContext.Provider value={value}>
      <View style={styles.root}>
        {children}
        {overlays === 0 ? <FeedbackBanner /> : null}
      </View>
    </FeedbackContext.Provider>
  );
}

function useFeedbackContext() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error('useFeedback must be used inside FeedbackProvider.');
  return context;
}

export function useFeedback(): Pick<FeedbackContextValue, 'notify'> {
  const { notify } = useFeedbackContext();
  return { notify };
}

// Native Modal uses its own window. Mount this inside a visible modal to move the banner there.
export function FeedbackOverlay() {
  const { registerOverlay } = useFeedbackContext();
  useEffect(() => registerOverlay(), [registerOverlay]);
  return <FeedbackBanner />;
}

function FeedbackBanner() {
  const { current } = useFeedbackContext();
  return current ? <FeedbackNotice current={current} /> : null;
}

function FeedbackNotice({ current }: { current: Notice }) {
  const { dismiss, setPaused } = useFeedbackContext();
  const insets = useSafeAreaInsets();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    setPaused(focused || hovered);
    return () => setPaused(false);
  }, [focused, hovered, setPaused]);

  const accent = current.type === 'error' ? colors.danger : colors.green;
  const icon = current.type === 'success' ? 'check-circle' : current.type === 'error' ? 'alert-circle' : 'info';

  return (
    <View pointerEvents="box-none" style={[styles.overlay, { top: Math.max(insets.top, 12), left: Math.max(insets.left, 12), right: Math.max(insets.right, 12) }]}>
      <View style={[styles.banner, { borderLeftColor: accent }]}>
        <Feather name={icon} size={20} color={accent} style={styles.icon} accessible={false} />
        <Text
          key={current.id}
          accessibilityRole={current.type === 'error' ? 'alert' : 'text'}
          accessibilityLiveRegion={current.type === 'error' ? 'assertive' : 'polite'}
          style={styles.message}
        >{current.message}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          onPress={() => dismiss(current.id)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          style={({ pressed }) => [styles.close, (pressed || focused) && styles.closeActive]}
        >
          <Feather name="x" size={18} color={colors.ink} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: 'absolute', alignItems: 'center', zIndex: 10000, elevation: 20 },
  banner: { width: '100%', maxWidth: 560, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 15, paddingRight: 5, paddingVertical: 7, borderRadius: 14, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, backgroundColor: colors.white, boxShadow: '0 6px 24px rgba(29, 51, 42, 0.15)' },
  icon: { flexShrink: 0 },
  message: { flex: 1, paddingVertical: 8, fontSize: 14, lineHeight: 21, color: colors.ink },
  close: { minWidth: 44, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  closeActive: { backgroundColor: colors.lightGreen },
});
