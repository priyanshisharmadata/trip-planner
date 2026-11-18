import { Ionicons } from '@expo/vector-icons';
import { useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addDays, createId, localToday, validateTrip, type CoverKey, type Trip } from '../lib/trips';
import { FeedbackOverlay, useFeedback } from '../store/FeedbackProvider';

type TripFormProps = {
  visible: boolean;
  initial?: Trip;
  onClose: () => void;
  onSave: (trip: Trip) => Promise<void>;
};

const covers: { key: CoverKey; label: string; icon: ComponentProps<typeof Ionicons>['name']; color: string }[] = [
  { key: 'bali', label: 'Tropical', icon: 'leaf-outline', color: '#DDE8DA' },
  { key: 'mountains', label: 'Mountains', icon: 'trail-sign-outline', color: '#E3E9ED' },
  { key: 'city', label: 'City', icon: 'business-outline', color: '#EEDFD3' },
  { key: 'beach', label: 'Beach', icon: 'sunny-outline', color: '#F3EBCF' },
];

export function FormDialog({ visible, title, subtitle, onClose, children, busy = false }: {
  visible: boolean;
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
  busy?: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
        style={[styles.backdrop, { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        <View style={styles.dialog} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.heading}>
              <Text style={styles.title} accessibilityRole="header">{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close form" accessibilityState={{ disabled: busy }} disabled={busy} onPress={onClose} style={[styles.close, busy && styles.disabled]}>
              <Ionicons name="close" size={22} color="#1D332A" />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {children}
          </ScrollView>
        </View>
        {visible ? <FeedbackOverlay /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function FormField({ label, helper, grow, ...props }: TextInputProps & { label: string; helper?: string; grow?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, grow && styles.grow]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={props.accessibilityLabel ?? label}
        placeholderTextColor="#7A867E"
        selectionColor="#245C44"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.input, focused && styles.inputFocused, props.style]}
      />
      {helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle-outline" color="#A14B34" size={19} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function FormSubmit({ label, onPress, busy = false, disabled = false }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: busy || disabled, busy }} disabled={busy || disabled} onPress={onPress} style={({ pressed }) => [styles.submit, pressed && styles.pressed, (busy || disabled) && styles.disabled]}>
      <Text style={styles.submitText}>{label}</Text>
      {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="arrow-forward" color="#FFFFFF" size={19} />}
    </Pressable>
  );
}

function TripFields({ initial, onSave, saving }: Pick<TripFormProps, 'initial' | 'onSave'> & { saving: boolean }) {
  const { notify } = useFeedback();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [destination, setDestination] = useState(initial?.destination ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? addDays(localToday(), 7));
  const [endDate, setEndDate] = useState(initial?.endDate ?? addDays(localToday(), 11));
  const [budget, setBudget] = useState(initial ? String(initial.budget) : '');
  const [coverKey, setCoverKey] = useState<CoverKey>(initial?.coverKey ?? 'bali');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    const draft = { title: title.trim(), destination: destination.trim(), startDate: startDate.trim(), endDate: endDate.trim(), budget: Number(budget) };
    const validation = !budget.trim() ? 'Add a budget in rupees. Enter 0 if you haven’t set one yet.' : validateTrip(draft);
    if (validation) {
      setError(validation);
      notify({ type: 'error', message: validation });
      return;
    }
    if (initial?.activities.some((activity) => activity.date < draft.startDate || activity.date > draft.endDate)) {
      const message = 'These dates leave an existing activity outside your trip. Keep those dates, or remove that activity first.';
      setError(message);
      notify({ type: 'error', message });
      return;
    }
    setError(null);
    try {
      await onSave({ ...draft, id: initial?.id ?? createId(), coverKey, activities: initial?.activities ?? [] });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your trip could not be saved. Please try again.');
    }
  }

  return (
    <View style={styles.fields}>
      <FormField editable={!saving} label="Trip name" placeholder="A little escape to Bali" value={title} onChangeText={setTitle} maxLength={80} autoCapitalize="sentences" />
      <FormField editable={!saving} label="Destination" placeholder="Bali, Indonesia" value={destination} onChangeText={setDestination} maxLength={100} autoCapitalize="words" />
      <View style={styles.row}>
        <FormField editable={!saving} grow label="Start date" placeholder="YYYY-MM-DD" value={startDate} onChangeText={setStartDate} maxLength={10} autoCapitalize="none" autoCorrect={false} />
        <FormField editable={!saving} grow label="End date" placeholder="YYYY-MM-DD" value={endDate} onChangeText={setEndDate} maxLength={10} autoCapitalize="none" autoCorrect={false} />
      </View>
      <Text style={styles.dateHint}>Use YYYY-MM-DD, for example {addDays(localToday(), 7)}.</Text>
      <FormField editable={!saving} label="Total budget (₹)" placeholder="25000" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" helper="Your planned spend for the whole trip." maxLength={12} />
      <View style={styles.field}>
        <Text style={styles.label}>Cover</Text>
        <View style={styles.covers}>
          {covers.map((cover) => (
            <Pressable
              key={cover.key}
              accessibilityRole="radio"
              accessibilityLabel={`${cover.label} trip cover`}
              accessibilityState={{ checked: coverKey === cover.key, disabled: saving }}
              disabled={saving}
              aria-checked={coverKey === cover.key}
              onPress={() => setCoverKey(cover.key)}
              style={[styles.cover, { backgroundColor: cover.color }, coverKey === cover.key && styles.coverSelected]}
            >
              <Ionicons name={cover.icon} size={26} color="#245C44" />
              <Text style={styles.coverLabel}>{cover.label}</Text>
              {coverKey === cover.key ? <View style={styles.check}><Ionicons name="checkmark" color="#FFFFFF" size={11} /></View> : null}
            </Pressable>
          ))}
        </View>
      </View>
      <FormError message={error} />
      <FormSubmit label={saving ? 'Saving trip…' : initial ? 'Save changes' : 'Create trip'} onPress={save} busy={saving} />
    </View>
  );
}

export default function TripForm({ visible, initial, onClose, onSave }: TripFormProps) {
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  async function saveTrip(trip: Trip) {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    try {
      await onSave(trip);
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }
  function close() {
    if (!busyRef.current) onClose();
  }
  return (
    <FormDialog visible={visible} title={initial ? 'Edit trip' : 'New trip'} subtitle="Set your destination, dates and budget." onClose={close} busy={saving}>
      {visible ? <TripFields key={initial?.id ?? 'new'} initial={initial} onSave={saveTrip} saving={saving} /> : null}
    </FormDialog>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15, 35, 26, 0.48)', paddingHorizontal: 16 },
  dialog: { backgroundColor: '#F6F7F2', borderRadius: 26, width: '100%', maxWidth: 520, maxHeight: '100%', overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 24, paddingTop: 26, paddingBottom: 22, borderBottomWidth: 1, borderBottomColor: '#E4E9E1', gap: 8 },
  heading: { flex: 1 },
  eyebrow: { color: '#7A867E', fontSize: 8, letterSpacing: 1.2, fontWeight: '700', marginBottom: 9 },
  title: { color: '#1D332A', fontSize: 25, letterSpacing: -0.8, fontWeight: '700' },
  subtitle: { color: '#7A867E', fontSize: 13, lineHeight: 19, marginTop: 7 },
  close: { width: 40, height: 40, backgroundColor: '#E9EFE5', borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  content: { padding: 24 },
  fields: { gap: 18 },
  field: { gap: 8 },
  grow: { flex: 1 },
  label: { color: '#1D332A', fontSize: 13, fontWeight: '600' },
  input: { minHeight: 48, borderWidth: 1, borderColor: '#E4E9E1', borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 13, paddingVertical: 12, fontSize: 14, color: '#1D332A' },
  inputFocused: { borderColor: '#245C44' },
  helper: { color: '#7A867E', fontSize: 11, lineHeight: 16 },
  row: { flexDirection: 'row', gap: 12 },
  dateHint: { color: '#7A867E', fontSize: 11, lineHeight: 16, marginTop: -10 },
  covers: { flexDirection: 'row', gap: 8 },
  cover: { flex: 1, minHeight: 85, borderRadius: 13, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: 7 },
  coverSelected: { borderColor: '#245C44' },
  coverLabel: { fontSize: 10, color: '#245C44', fontWeight: '600' },
  check: { position: 'absolute', top: 4, right: 4, borderRadius: 8, width: 15, height: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#245C44' },
  errorBox: { backgroundColor: '#F9E9E1', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { color: '#A14B34', fontSize: 12, lineHeight: 18, flex: 1 },
  submit: { minHeight: 52, borderRadius: 14, backgroundColor: '#245C44', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  submitText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
  footer: { color: '#7A867E', textAlign: 'center', fontSize: 11, lineHeight: 17 },
});
