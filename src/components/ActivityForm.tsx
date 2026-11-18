import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { createId, validateActivity, type Activity, type Trip } from '../lib/trips';
import { FormDialog, FormError, FormField, FormSubmit } from './TripForm';
import { useFeedback } from '../store/FeedbackProvider';

type ActivityFormProps = {
  visible: boolean;
  trip: Trip;
  date: string;
  onClose: () => void;
  onSave: (activity: Activity) => Promise<void>;
};

function ActivityFields({ trip, date: initialDate, onSave, saving }: Pick<ActivityFormProps, 'trip' | 'date' | 'onSave'> & { saving: boolean }) {
  const { notify } = useFeedback();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState('09:00');
  const [cost, setCost] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    const draft = { title: title.trim(), date: date.trim(), time: time.trim(), cost: cost.trim() ? Number(cost) : 0 };
    const validation = validateActivity(draft, trip);
    if (validation) {
      setError(validation);
      notify({ type: 'error', message: validation });
      return;
    }
    setError(null);
    try {
      await onSave({ ...draft, id: createId(), done: false });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your activity could not be saved. Please try again.');
    }
  }

  return (
    <View style={styles.fields}>
      <View style={styles.destination}>
        <View style={styles.destinationIcon}><Ionicons name="location-outline" size={20} color="#245C44" /></View>
        <View style={styles.destinationCopy}>
          <Text style={styles.destinationName}>{trip.destination}</Text>
          <Text style={styles.tripName}>{trip.title}</Text>
        </View>
      </View>
      <FormField editable={!saving} label="Activity name" value={title} onChangeText={setTitle} placeholder="Sunrise hike, café stop, beach day…" maxLength={120} autoCapitalize="sentences" />
      <View style={styles.row}>
        <FormField editable={!saving} grow label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" maxLength={10} autoCapitalize="none" autoCorrect={false} />
        <FormField editable={!saving} grow label="Time" value={time} onChangeText={setTime} placeholder="09:00" maxLength={5} autoCapitalize="none" autoCorrect={false} />
      </View>
      <Text style={styles.hint}>Use YYYY-MM-DD and 24-hour time (HH:MM). Choose a date from {trip.startDate} to {trip.endDate}.</Text>
      <FormField editable={!saving} label="Estimated cost (₹)" value={cost} onChangeText={setCost} placeholder="0" keyboardType="decimal-pad" maxLength={12} helper="Leave empty for a free activity. You can track your planned spend in Budget." />
      <FormError message={error} />
      <FormSubmit label={saving ? 'Saving activity…' : 'Add to itinerary'} onPress={save} busy={saving} />
      <Text style={styles.footer}>The best memories start with a little idea.</Text>
    </View>
  );
}

export default function ActivityForm({ visible, trip, date, onClose, onSave }: ActivityFormProps) {
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  async function saveActivity(activity: Activity) {
    if (busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    try {
      await onSave(activity);
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }
  function close() {
    if (!busyRef.current) onClose();
  }
  return (
    <FormDialog visible={visible} title="Make a little memory" subtitle="Add something to look forward to." onClose={close} busy={saving}>
      {visible ? <ActivityFields key={`${trip.id}-${date}`} trip={trip} date={date} onSave={saveActivity} saving={saving} /> : null}
    </FormDialog>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 18 },
  destination: { backgroundColor: '#E9EFE5', borderRadius: 14, padding: 13, flexDirection: 'row', gap: 11, alignItems: 'center' },
  destinationIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  destinationCopy: { flex: 1 },
  destinationName: { color: '#1D332A', fontSize: 14, fontWeight: '600' },
  tripName: { color: '#7A867E', fontSize: 12, marginTop: 3 },
  row: { flexDirection: 'row', gap: 12 },
  hint: { color: '#7A867E', fontSize: 11, lineHeight: 17, marginTop: -10 },
  footer: { color: '#7A867E', textAlign: 'center', fontSize: 11, lineHeight: 17 },
});
