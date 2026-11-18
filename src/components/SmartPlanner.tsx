import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  generatePlan,
  validatePlannerInput,
  type Interest,
  type PlannerInput,
  type PlannerResult,
  type StayPreference,
  type TravelPace,
} from '../lib/planner';
import { AiPlannerError, generateAiPlan, type AiPlannerResult } from '../lib/ai-planner';
import { colors as c, serif } from '../lib/theme';
import { addDays, formatCurrency, formatDateRange, localToday, type Trip } from '../lib/trips';
import { useFeedback } from '../store/FeedbackProvider';
import { useAuth } from '../store/AuthProvider';
import { useTrips } from '../store/TripsProvider';
import { FormError, FormField } from './TripForm';

type PlannerForm = Omit<PlannerInput, 'budget' | 'travelers'> & { budget: string; travelers: string };
type PlannerMode = 'offline' | 'ai';
function isAiPlan(value: PlannerResult | null): value is AiPlannerResult {
  return value !== null && 'ai' in value;
}
const interests: { value: Interest; label: string }[] = [
  { value: 'culture', label: 'Culture' }, { value: 'nature', label: 'Nature' },
  { value: 'food', label: 'Food' }, { value: 'adventure', label: 'Adventure' },
  { value: 'relaxation', label: 'Relaxation' }, { value: 'shopping', label: 'Shopping' },
];
const paces: { value: TravelPace; label: string }[] = [
  { value: 'relaxed', label: 'Relaxed' }, { value: 'balanced', label: 'Balanced' }, { value: 'packed', label: 'Packed' },
];
const stays: { value: StayPreference; label: string }[] = [
  { value: 'budget', label: 'Budget' }, { value: 'comfort', label: 'Comfort' }, { value: 'premium', label: 'Premium' },
];
const costLabels = [
  ['stay', 'Stay'], ['food', 'Food'], ['transport', 'Local transport'],
  ['activities', 'Activities'], ['contingency', 'Buffer'],
] as const;

function Choice({ label, selected, disabled, multiple = false, onPress }: {
  label: string; selected: boolean; disabled: boolean; multiple?: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={multiple ? 'checkbox' : 'radio'}
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      disabled={disabled}
      onPress={onPress}
      style={[styles.choice, selected && styles.choiceSelected, disabled && styles.disabled]}
    >
      {selected && <Feather name="check" size={13} color={c.green} />}
      <Text style={[styles.choiceLabel, selected && styles.choiceLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

export default function SmartPlanner() {
  const { createPlannedTrip } = useTrips();
  const { notify } = useFeedback();
  const { session, showSignIn } = useAuth();
  const [form, setForm] = useState<PlannerForm>(() => ({
    destination: '', budget: '', travelers: '2', startDate: addDays(localToday(), 7), endDate: addDays(localToday(), 10),
    interests: ['culture', 'food'], pace: 'balanced', stayPreference: 'comfort',
  }));
  const [plan, setPlan] = useState<PlannerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTrip, setSavedTrip] = useState<Trip | null>(null);
  const [mode, setMode] = useState<PlannerMode>('offline');
  const [flexibility, setFlexibility] = useState<0 | 10>(10);
  const [generating, setGenerating] = useState(false);
  const [showAllSources, setShowAllSources] = useState(false);
  const [suggestionsExhausted, setSuggestionsExhausted] = useState(false);
  const saveLock = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const seenIds = useRef<string[]>([]);
  const seenNames = useRef<string[]>([]);
  const variation = useRef(0);

  useEffect(() => () => { requestRef.current?.abort(); requestRef.current = null; }, []);

  function cancelGeneration(showNotice = false) {
    const active = requestRef.current;
    requestRef.current = null;
    active?.abort();
    setGenerating(false);
    if (active && showNotice) notify({ type: 'info', message: 'Generation cancelled. You can try again or use the offline planner.' });
  }

  function invalidate() {
    cancelGeneration();
    setPlan(null); setSavedTrip(null); setError(null); setShowAllSources(false);
    seenIds.current = []; seenNames.current = []; variation.current = 0;
    setSuggestionsExhausted(false);
  }

  function update<K extends keyof PlannerForm>(key: K, value: PlannerForm[K]) {
    if (saveLock.current) return;
    setForm(current => ({ ...current, [key]: value }));
    invalidate();
  }

  function changeMode(next: PlannerMode) {
    if (saveLock.current || mode === next) return;
    invalidate(); setMode(next);
  }

  async function generate(more = false, selectedMode = mode) {
    if (saveLock.current || requestRef.current) return;
    Keyboard.dismiss();
    const input: PlannerInput = {
      ...form, destination: form.destination.trim(), startDate: form.startDate.trim(), endDate: form.endDate.trim(),
      budget: Number(form.budget), travelers: Number(form.travelers),
    };
    const validation = !form.budget.trim() ? 'Enter your total trip budget in rupees.'
      : !form.travelers.trim() ? 'Enter the number of travelers.' : validatePlannerInput(input);
    if (validation) {
      setError(validation);
      notify({ type: 'error', message: validation });
      return;
    }
    if (selectedMode === 'ai' && !session) {
      const message = 'Sign in to use the AI planner. Offline planning is available without an account.';
      setError(message); notify({ type: 'info', message }); return;
    }
    if (more && (seenIds.current.length >= 100 || seenNames.current.length >= 100 || variation.current >= 20)) {
      const message = 'You have explored the available suggestion rounds for these details. Change your dates or destination to start a new search.';
      setError(message); notify({ type: 'info', message }); return;
    }
    setError(null);
    const controller = selectedMode === 'ai' ? new AbortController() : null;
    if (controller) { requestRef.current = controller; setGenerating(true); }
    try {
      const next = controller ? await generateAiPlan(input, {
        accessToken: session!.access_token, signal: controller.signal, flexibilityPercent: flexibility,
        excludedPlaceIds: more ? seenIds.current : [], excludedPlaceNames: more ? seenNames.current : [],
        variation: more ? variation.current + 1 : 0,
      }) : generatePlan(input);
      if (controller && (controller.signal.aborted || requestRef.current !== controller)) return;
      if (isAiPlan(next)) {
        seenIds.current = [...new Set([...seenIds.current, ...next.ai.places.map(place => place.id)])];
        seenNames.current = [...new Set([...seenNames.current, ...next.ai.places.map(place => place.name)])];
        variation.current = more ? variation.current + 1 : 0;
        setSuggestionsExhausted(seenIds.current.length >= 100 || seenNames.current.length >= 100 || variation.current >= 20);
      }
      setPlan(next);
      setShowAllSources(false);
      setError(null);
      setSavedTrip(null);
      notify({ type: isAiPlan(next) && next.ai.generation === 'offline' ? 'info' : 'success', message: isAiPlan(next) && next.ai.generation === 'offline'
        ? 'AI is unavailable right now. An offline researched plan is ready with estimated costs.'
        : selectedMode === 'ai'
        ? more ? 'New suggestions ready. Review the places and estimated budget.' : 'AI suggestions ready. Review the places and estimated budget.'
        : 'Plan ready. Review the estimates before saving.' });
    } catch (cause) {
      if (controller && (controller.signal.aborted || requestRef.current !== controller)) return;
      const message = cause instanceof Error ? cause.message : 'Could not generate a plan. Check the details and try again.';
      if (cause instanceof AiPlannerError && cause.code === 'NO_NEW_SUGGESTIONS') setSuggestionsExhausted(true);
      setError(message);
      notify({ type: 'error', message });
    } finally {
      if (controller && requestRef.current === controller) { requestRef.current = null; setGenerating(false); }
    }
  }

  function useOfflinePlan() {
    if (saveLock.current) return;
    invalidate(); setMode('offline'); void generate(false, 'offline');
  }

  async function save() {
    if (!plan || saveLock.current || savedTrip || requestRef.current) return;
    saveLock.current = true;
    setSaving(true);
    setError(null);
    try {
      const trip = await createPlannedTrip(plan.draft, plan.activities);
      setSavedTrip(trip);
      router.replace({ pathname: '/trip/[id]', params: { id: trip.id } });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save this trip. Your preview is still here; please try again.';
      setError(message);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function openLink(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      notify({ type: 'error', message: 'Could not open the link. Please try again.' });
    }
  }

  const dates = plan ? Array.from(new Set(plan.activities.map(activity => activity.date))).sort() : [];
  const ai = isAiPlan(plan) ? plan.ai : null;

  function mapsLink(place: AiPlannerResult['ai']['places'][number]) {
    return <Pressable key={place.id} accessibilityRole="link" accessibilityLabel={`Open in Google Maps: ${place.name}`} onPress={() => void openLink(place.mapsUrl)} style={styles.link}>
      <Text style={styles.linkLabel}>Open in Google Maps</Text><Feather name="external-link" size={14} color={c.green} />
    </Pressable>;
  }

  return (
    <View style={styles.page}>
      <View style={styles.intro}>
        <Text style={styles.title} accessibilityRole="header">Smart planner.</Text>
        <Text style={styles.description}>Build a daily itinerary around your budget and interests.</Text>
      </View>
      <View style={styles.form}>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Planning mode</Text>
          <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Planning mode">
            <Choice label="Offline plan" selected={mode === 'offline'} disabled={saving} onPress={() => changeMode('offline')} />
            <Choice label="AI planner" selected={mode === 'ai'} disabled={saving} onPress={() => changeMode('ai')} />
          </View>
          <Text style={styles.hint}>{mode === 'ai' ? 'AI arranges researched tourist places into your itinerary. Stay suggestions are areas to explore; costs are estimates.' : 'An offline draft with estimated costs and destination templates.'}</Text>
          {mode === 'ai' && <Text style={styles.hint}>Supported destinations: Jaipur, Goa, Manali, Delhi / New Delhi, Mumbai / Bombay and Bali (Indonesia). Suggestions come from a limited list of real places.</Text>}
          {mode === 'ai' && !session && <View style={styles.notice}>
            <View style={styles.activityCopy}><Text style={styles.noticeText}>Sign in for AI suggestions. You can keep planning offline without an account.</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Sign in for AI suggestions" onPress={showSignIn} style={styles.link}><Text style={styles.linkLabel}>Sign in for AI suggestions</Text><Feather name="arrow-right" size={14} color={c.green} /></Pressable>
            </View>
          </View>}
        </View>
        <FormField label="Destination" placeholder="Goa, Jaipur, Manali…" value={form.destination} onChangeText={value => update('destination', value)} maxLength={100} autoCapitalize="words" editable={!saving} />
        <View style={styles.row}>
          <FormField grow label="Total budget (₹)" placeholder="25000" value={form.budget} onChangeText={value => update('budget', value)} keyboardType="decimal-pad" maxLength={12} editable={!saving} />
          <FormField grow label="Travelers" placeholder="2" value={form.travelers} onChangeText={value => update('travelers', value)} keyboardType="number-pad" maxLength={2} editable={!saving} />
        </View>
        <Text style={styles.hint}>Budget is for everyone together. Travel to and from the destination is not included.</Text>
        {mode === 'ai' && <View style={styles.fieldGroup}>
          <Text style={styles.label}>Budget flexibility</Text>
          <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Budget flexibility">
            <Choice label="Strict budget" selected={flexibility === 0} disabled={saving} onPress={() => { if (flexibility !== 0) { invalidate(); setFlexibility(0); } }} />
            <Choice label="Up to 10% extra" selected={flexibility === 10} disabled={saving} onPress={() => { if (flexibility !== 10) { invalidate(); setFlexibility(10); } }} />
          </View>
          <Text style={styles.hint}>{flexibility ? 'Try to stay within budget; allow up to 10% extra when needed. Any extra amount is shown clearly.' : 'Only show plans whose estimated total fits your budget.'}</Text>
        </View>}
        <View style={styles.row}>
          <FormField grow label="Start date" placeholder="YYYY-MM-DD" value={form.startDate} onChangeText={value => update('startDate', value)} autoCapitalize="none" autoCorrect={false} maxLength={10} editable={!saving} />
          <FormField grow label="End date" placeholder="YYYY-MM-DD" value={form.endDate} onChangeText={value => update('endDate', value)} autoCapitalize="none" autoCorrect={false} maxLength={10} editable={!saving} />
        </View>
        <Text style={styles.hint}>Use YYYY-MM-DD. Plan 1–14 days for up to 12 travelers.</Text>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Interests</Text>
          <View style={styles.choices}>{interests.map(item => <Choice key={item.value} label={item.label} multiple selected={form.interests.includes(item.value)} disabled={saving} onPress={() => update('interests', form.interests.includes(item.value) ? form.interests.filter(value => value !== item.value) : [...form.interests, item.value])} />)}</View>
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Pace</Text>
          <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Travel pace">{paces.map(item => <Choice key={item.value} label={item.label} selected={form.pace === item.value} disabled={saving} onPress={() => update('pace', item.value)} />)}</View>
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Stay preference</Text>
          <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Stay preference">{stays.map(item => <Choice key={item.value} label={item.label} selected={form.stayPreference === item.value} disabled={saving} onPress={() => update('stayPreference', item.value)} />)}</View>
        </View>
        {!plan && <FormError message={error} />}
        <Pressable accessibilityRole="button" accessibilityLabel="Generate plan" accessibilityState={{ disabled: saving || generating, busy: generating }} disabled={saving || generating} onPress={() => void generate()} style={({ pressed }) => [styles.primaryButton, (pressed || saving || generating) && styles.disabled]}>
          {generating ? <ActivityIndicator size="small" color={c.white} /> : <Feather name="sliders" size={17} color={c.white} />}<Text style={styles.primaryLabel}>{generating ? 'Planning your days…' : 'Generate plan'}</Text>
        </Pressable>
        {generating && <View style={styles.fieldGroup}><Text style={styles.hint}>Arranging researched places around your trip details. You can cancel or edit your details.</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel generation" onPress={() => cancelGeneration(true)} style={styles.secondaryButton}><Text style={styles.secondaryLabel}>Cancel generation</Text></Pressable></View>}
        {mode === 'ai' && error && !generating && <Pressable accessibilityRole="button" accessibilityLabel="Use offline planner" onPress={useOfflinePlan} disabled={saving} style={styles.secondaryButton}><Text style={styles.secondaryLabel}>Use offline planner</Text></Pressable>}
      </View>

      {plan && <View style={styles.result}>
        <View style={styles.resultHeader}>
          <Text style={styles.sectionTitle} accessibilityRole="header">Your plan</Text>
          <Text style={styles.description}>{plan.draft.destination} · {plan.summary.days} days · {plan.summary.travelers} {plan.summary.travelers === 1 ? 'traveler' : 'travelers'}</Text>
          <Text style={styles.hint}>{formatDateRange(plan.draft.startDate, plan.draft.endDate)}</Text>
        </View>
        {ai && <View style={styles.card}>
          <Text style={styles.cardTitle}>{ai.generation === 'offline' ? 'Offline researched plan' : 'AI itinerary'}</Text>
          {ai.generation === 'offline' && <Text style={styles.hint}>{ai.fallbackReason} This plan uses the researched place list and local estimates.</Text>}
          <Text style={styles.description}>{ai.summary}</Text>
          {ai.basis === 'curated' ? <>
            <Text style={styles.label}>Research sources</Text>
            {ai.references.map(reference => <Pressable key={reference.url} accessibilityRole="link" accessibilityLabel={reference.label} onPress={() => void openLink(reference.url)} style={styles.link}><Text style={styles.linkLabel}>{reference.label}</Text><Feather name="external-link" size={14} color={c.green} /></Pressable>)}
            <Text style={styles.hint}>These references support the place list. Google Maps links below are for navigation. No live hotel rates or crowd data are used.</Text>
          </> : <>
            <Text style={styles.label}>Place links</Text>
            {ai.places.slice(0, showAllSources ? ai.places.length : 3).map(place => <View key={place.id}><Text style={styles.hint}>{place.name}</Text>{mapsLink(place)}</View>)}
            {ai.places.length > 3 && <Pressable accessibilityRole="button" accessibilityLabel={showAllSources ? 'Show fewer place links' : 'Show all place links'} accessibilityState={{ expanded: showAllSources }} onPress={() => setShowAllSources(value => !value)} style={styles.link}><Text style={styles.linkLabel}>{showAllSources ? 'Show fewer place links' : `Show all ${ai.places.length} place links`}</Text><Feather name={showAllSources ? 'chevron-up' : 'chevron-down'} size={14} color={c.green} /></Pressable>}
            <Text style={styles.hint}>Popular places are prioritised; this is not a live crowd forecast.</Text>
          </>}
          <Pressable accessibilityRole="button" accessibilityLabel="Suggest more" accessibilityState={{ disabled: saving || generating || suggestionsExhausted, busy: generating }} disabled={saving || generating || suggestionsExhausted} onPress={() => void generate(true)} style={[styles.secondaryButton, (saving || generating || suggestionsExhausted) && styles.disabled]}>
            <Feather name="refresh-cw" size={16} color={c.green} /><Text style={styles.secondaryLabel}>Suggest more</Text>
          </Pressable>
          <Text style={styles.hint}>{suggestionsExhausted ? 'No further suggestions are available for these trip details. Try fewer days or another supported destination.' : 'Find another set from the available places with the same dates, interests and budget limit. Previously shown places are excluded.'}</Text>
        </View>}
        <View style={styles.notice}>
          <Feather name="info" color={c.green} size={17} />
          <Text style={styles.noticeText}>Times and prices are estimates, not confirmed bookings. Check opening hours, availability and current rates before you travel.</Text>
        </View>
        {plan.summary.isGeneric && <View style={styles.notice}><Feather name="map" color={c.green} size={17} /><Text style={styles.noticeText}>This destination uses a general planning template. Replace the suggested stops with places you have checked locally.</Text></View>}
        {!plan.summary.isFeasible && <View style={styles.warning} accessibilityRole="alert"><Text style={styles.warningText}>{ai ? `This estimate is ${formatCurrency(plan.summary.shortfall)} (${Math.round(plan.summary.shortfall / plan.draft.budget * 1000) / 10}%) above your budget, within your selected 10% flexibility. Choose Strict budget for a lower limit.` : `This plan is ${formatCurrency(plan.summary.shortfall)} over budget. Try a budget stay, fewer days, or a higher budget.`}</Text></View>}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Estimated budget</Text>
          {costLabels.map(([key, label]) => <View key={key} style={styles.costRow}><Text style={styles.costLabel}>{label}</Text><Text style={styles.costValue}>{formatCurrency(plan.breakdown[key])}</Text></View>)}
          <View style={[styles.costRow, styles.totalRow]}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{formatCurrency(plan.breakdown.total)}</Text></View>
          <View style={styles.costRow}><Text style={styles.costLabel}>{plan.summary.budgetRemaining < 0 ? 'Over budget' : 'Unallocated budget'}</Text><Text style={[styles.costValue, plan.summary.budgetRemaining < 0 && styles.danger]}>{formatCurrency(Math.abs(plan.summary.budgetRemaining))}</Text></View>
          <Text style={styles.hint}>Stay, meals, transport and buffer are included in the saved itinerary, so your budget stays in sync.</Text>
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.cardTitle}>Where to stay</Text>
          {plan.stays.length ? plan.stays.map((stay, index) => <View key={`${stay.area}-${index}`} style={styles.card}>
            <Text style={styles.stayTitle}>{stay.area}</Text>
            <Text style={styles.description}>{stay.type}</Text>
            <Text style={styles.stayCost}>{ai ? 'Planning allowance: ' : ''}{formatCurrency(stay.nightlyPerRoom)} / room / night</Text>
            <Text style={styles.hint}>{stay.rooms} {stay.rooms === 1 ? 'room' : 'rooms'} · {stay.nights} {stay.nights === 1 ? 'night' : 'nights'} · {formatCurrency(stay.estimatedTotal)} estimated</Text>
            <Text style={styles.hint}>{stay.note}</Text>
            {ai && <Text style={styles.hint}>{ai.places.find(place => place.mapsUrl === stay.mapsUrl)?.popularityReason}</Text>}
            <Pressable accessibilityRole="link" accessibilityLabel={ai ? `Open in Google Maps: ${stay.area}` : `Find stays in ${stay.area} on Maps`} onPress={() => void openLink(stay.mapsUrl)} style={styles.link}><Text style={styles.linkLabel}>{ai ? 'Open in Google Maps' : 'Explore on Maps'}</Text><Feather name="external-link" size={14} color={c.green} /></Pressable>
          </View>) : <Text style={styles.description}>No overnight stay needed for this day trip.</Text>}
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.cardTitle}>Daily itinerary</Text>
          {dates.map((date, index) => <View key={date} style={styles.card}>
            <View style={styles.dayHeader}><Text style={styles.dayLabel}>Day {index + 1}</Text><Text style={styles.hint}>{formatDateRange(date, date)}</Text></View>
            {plan.activities.filter(activity => activity.date === date).sort((a, b) => a.time.localeCompare(b.time)).map((activity, itemIndex) => {
              const source = activity.source ? ai?.activitySources[`${date}|${activity.time}`] : undefined;
              return <View key={`${date}-${itemIndex}`} style={styles.activity}>
              <Text style={styles.time}>{activity.time}</Text>
              <View style={styles.activityCopy}><Text style={styles.activityTitle}>{activity.title}</Text><Text style={styles.hint}>{ai ? `${formatCurrency(activity.cost)} planning allowance` : activity.cost > 0 ? formatCurrency(activity.cost) : 'Free'}</Text>
                {source && <><Text style={styles.hint}>{source.note}</Text><Text style={styles.hint}>{source.place.popularityReason}</Text>{mapsLink(source.place)}</>}
              </View>
            </View>; })}
          </View>)}
        </View>
        {ai && ai.places.some(place => place.kind === 'food') && <View style={styles.fieldGroup}>
          <Text style={styles.cardTitle}>Food suggestions</Text>
          {ai.places.filter(place => place.kind === 'food').map(place => <View key={place.id} style={styles.card}><Text style={styles.stayTitle}>{place.name}</Text><Text style={styles.description}>{place.reason}</Text><Text style={styles.hint}>{place.popularityReason}</Text>{mapsLink(place)}</View>)}
        </View>}
        {plan.summary.notes.length > 0 && <View style={styles.card}><Text style={styles.cardTitle}>Planning notes</Text>{plan.summary.notes.map((note, index) => <Text key={index} style={styles.note}>• {note}</Text>)}</View>}
        {!ai && plan.sources.length > 0 && <View style={styles.fieldGroup}><Text style={styles.label}>Destination references</Text>{plan.sources.map(source => <Pressable key={source.url} accessibilityRole="link" onPress={() => void openLink(source.url)} style={styles.link}><Text style={styles.linkLabel}>{source.label}</Text><Feather name="external-link" size={14} color={c.green} /></Pressable>)}</View>}
        <FormError message={error} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={savedTrip ? 'Open saved trip' : saving ? 'Saving trip' : 'Save this plan'}
          accessibilityState={{ disabled: saving || generating, busy: saving }}
          disabled={saving || generating}
          onPress={() => savedTrip ? router.replace({ pathname: '/trip/[id]', params: { id: savedTrip.id } }) : void save()}
          style={({ pressed }) => [styles.primaryButton, (pressed || saving || generating) && styles.disabled]}
        >
          {saving ? <ActivityIndicator size="small" color={c.white} /> : <Feather name={savedTrip ? 'arrow-right' : 'check'} size={18} color={c.white} />}
          <Text style={styles.primaryLabel}>{savedTrip ? 'Open saved trip' : saving ? 'Saving…' : 'Save this plan'}</Text>
        </Pressable>
        <Text style={styles.footer}>You can edit or remove activities after saving.</Text>
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: '100%', maxWidth: 760, alignSelf: 'center', gap: 24 },
  intro: { gap: 7 }, title: { fontFamily: serif, fontSize: 36, letterSpacing: -1, color: c.ink },
  description: { fontSize: 13, color: c.muted, lineHeight: 20 }, form: { gap: 18 }, row: { flexDirection: 'row', gap: 12 },
  hint: { fontSize: 11, lineHeight: 17, color: c.muted }, label: { fontSize: 13, fontWeight: '600', color: c.ink },
  fieldGroup: { gap: 12 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 44, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 10 },
  choiceSelected: { borderColor: c.green, backgroundColor: c.lightGreen }, choiceLabel: { fontSize: 12, color: c.muted }, choiceLabelSelected: { color: c.green, fontWeight: '600' },
  primaryButton: { minHeight: 50, padding: 14, borderRadius: 12, backgroundColor: c.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryLabel: { fontSize: 14, fontWeight: '600', color: c.white }, disabled: { opacity: 0.6 },
  secondaryButton: { minHeight: 46, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryLabel: { fontSize: 13, color: c.green, fontWeight: '600' },
  result: { gap: 20, marginTop: 8, paddingTop: 28, borderTopWidth: 1, borderTopColor: c.border }, resultHeader: { gap: 7 },
  sectionTitle: { fontFamily: serif, fontSize: 31, color: c.ink }, cardTitle: { fontSize: 16, fontWeight: '600', color: c.ink, marginBottom: 4 },
  card: { padding: 18, gap: 10, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, borderRadius: 14 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, backgroundColor: c.lightGreen, borderRadius: 12 }, noticeText: { flex: 1, color: c.green, fontSize: 12, lineHeight: 18 },
  warning: { backgroundColor: '#FFF0E5', padding: 14, borderRadius: 12 }, warningText: { color: '#97472F', fontSize: 12, lineHeight: 19 },
  costRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, costLabel: { color: c.muted, fontSize: 12 }, costValue: { color: c.ink, fontSize: 13, fontWeight: '500' },
  totalRow: { borderTopWidth: 1, borderColor: c.border, paddingTop: 12, marginTop: 3 }, totalLabel: { color: c.ink, fontSize: 14, fontWeight: '600' }, totalValue: { color: c.green, fontSize: 20, fontWeight: '600' }, danger: { color: c.danger },
  stayTitle: { color: c.ink, fontSize: 15, fontWeight: '600' }, stayCost: { color: c.ink, fontSize: 13, fontWeight: '500', marginTop: 4 },
  link: { minHeight: 44, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7 }, linkLabel: { color: c.green, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 9, borderBottomWidth: 1, borderBottomColor: c.border }, dayLabel: { color: c.green, fontSize: 14, fontWeight: '600' },
  activity: { flexDirection: 'row', gap: 13, paddingVertical: 5 }, time: { color: c.muted, fontSize: 11, width: 37, paddingTop: 3 }, activityCopy: { flex: 1, gap: 4 }, activityTitle: { color: c.ink, fontSize: 13, lineHeight: 20 },
  note: { color: c.muted, fontSize: 12, lineHeight: 19 }, footer: { color: c.muted, fontSize: 11, textAlign: 'center' },
});
