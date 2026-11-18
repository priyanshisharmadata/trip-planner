import { useState } from 'react';
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button, Empty, Frame } from '../components/ui';
import TripForm from '../components/TripForm';
import { colors as c, covers, serif } from '../lib/theme';
import { dayCount, formatCurrency, formatDateRange, tripStatus, Trip } from '../lib/trips';
import { useTrips } from '../store/TripsProvider';

type Filter = 'all' | 'upcoming' | 'ongoing' | 'past';
const filters: { id: Filter; label: string }[] = [{ id: 'all', label: 'All trips' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'ongoing', label: 'Ongoing' }, { id: 'past', label: 'Past' }];
const statusLabels = { upcoming: 'UPCOMING', ongoing: 'ONGOING', past: 'PAST' };

export default function Home() {
  const { trips, saveTrip } = useTrips();
  const { width } = useWindowDimensions();
  const [formOpen, setFormOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const compact = width < 600;
  const columns = width >= 950 ? 3 : width >= 600 ? 2 : 1;
  const contentWidth = Math.min(width, 1160) - 2 * (compact ? 22 : 40);
  const cardWidth = (contentWidth - (columns - 1) * 18) / columns;
  const displayed = [...trips].filter(trip => (filter === 'all' || tripStatus(trip) === filter) && `${trip.title} ${trip.destination}`.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const open = (trip: Trip) => router.push({ pathname: '/trip/[id]', params: { id: trip.id } });

  return <Frame>
    <View style={s.intro}>
      <View style={s.introText}><Text style={s.heading} accessibilityRole="header">Your trips.</Text><Text style={s.subtitle}>Destinations, daily plans and budgets.</Text></View>
      <Button label={compact ? 'New trip' : 'Plan a trip'} onPress={() => setFormOpen(true)} />
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel="Smart planner" onPress={() => router.push('/plan')} style={s.smartPlanner}><View style={{ flex: 1 }}><Text style={s.smartTitle}>Let’s plan it for you.</Text><Text style={s.subtitle}>Add a budget and destination. Get a daily plan.</Text></View><Feather name="arrow-up-right" size={21} color={c.green} /></Pressable>
    <View style={[s.tools, width < 850 && s.stackedTools]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
        {filters.map(item => <Pressable key={item.id} accessibilityRole="tab" aria-selected={filter === item.id} accessibilityState={{ selected: filter === item.id }} onPress={() => setFilter(item.id)} style={[s.filter, filter === item.id && s.filterActive]}><Text style={[s.filterText, filter === item.id && s.filterTextActive]}>{item.label}</Text></Pressable>)}
      </ScrollView>
      <View style={[s.search, width < 850 && { width: '100%' }]}><Feather name="search" size={16} color={c.muted} /><TextInput accessibilityLabel="Search trips" placeholder="Search trips or places" placeholderTextColor={c.muted} value={search} onChangeText={setSearch} style={s.searchInput} />{search.length > 0 && <Pressable accessibilityLabel="Clear search" accessibilityRole="button" hitSlop={8} onPress={() => setSearch('')}><Feather name="x" size={16} color={c.muted} /></Pressable>}</View>
    </View>
    {displayed.length ? <View style={s.grid}>{displayed.map(trip => <Pressable key={trip.id} accessibilityRole="button" accessibilityLabel={`Open ${trip.title}`} onPress={() => open(trip)} style={({ pressed }) => [s.card, { width: cardWidth, opacity: pressed ? 0.8 : 1 }]}>
      <ImageBackground source={covers[trip.coverKey]} style={s.cardImage} imageStyle={{ width: '100%', height: '100%' }}>
        <View style={s.cardTag}><Text style={s.cardTagText}>{statusLabels[tripStatus(trip)]}</Text></View>
        <View style={s.daysTag}><Text style={s.daysText}>{dayCount(trip.startDate, trip.endDate)} days</Text></View>
      </ImageBackground>
      <View style={s.cardContent}><Text style={s.cardDestination}>{trip.destination}</Text><Text style={s.cardTitle} numberOfLines={2}>{trip.title}</Text>
        <View style={s.cardDate}><Feather name="calendar" size={13} color={c.muted} /><Text style={s.cardDateText}>{formatDateRange(trip.startDate, trip.endDate)}</Text></View>
        <View style={s.cardFooter}><View><Text style={s.budgetLabel}>Budget</Text><Text style={s.budget}>{formatCurrency(trip.budget)}</Text></View><Feather name="arrow-up-right" size={20} color={c.green} /></View>
      </View>
    </Pressable>)}</View> : <Empty title={search ? 'No trips found' : 'No trips yet'} description={search ? 'Try another trip name or destination.' : filter === 'all' ? 'Create a trip to start planning.' : 'No trips match this filter.'} />}
    <TripForm visible={formOpen} onClose={() => setFormOpen(false)} onSave={async trip => { await saveTrip(trip); setFormOpen(false); open(trip); }} />
  </Frame>;
}

const s = StyleSheet.create({
  smartPlanner: { padding: 18, marginBottom: 24, flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 14, backgroundColor: c.lightGreen }, smartTitle: { fontSize: 16, fontWeight: '600', color: c.green },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 26 },
  introText: { flex: 1 }, heading: { fontFamily: serif, fontSize: 36, color: c.ink, letterSpacing: -1 }, subtitle: { fontSize: 12, color: c.muted, lineHeight: 19, marginTop: 7 },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 24 }, stackedTools: { flexDirection: 'column', alignItems: 'stretch' }, filters: { gap: 5 },
  filter: { paddingHorizontal: 15, paddingVertical: 12, borderRadius: 9 }, filterActive: { backgroundColor: c.green }, filterText: { color: c.muted, fontSize: 12, fontWeight: '500' }, filterTextActive: { color: c.white },
  search: { width: 232, flexDirection: 'row', gap: 8, alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, height: 42, backgroundColor: c.white }, searchInput: { flex: 1, color: c.ink, fontSize: 12, height: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 }, card: { borderRadius: 15, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
  cardImage: { height: 158, backgroundColor: c.green, padding: 13, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardTag: { borderRadius: 5, backgroundColor: '#F8FAF1', paddingVertical: 6, paddingHorizontal: 8 }, cardTagText: { color: c.green, fontWeight: '700', fontSize: 8, letterSpacing: 1 },
  daysTag: { backgroundColor: 'rgba(20,40,28,0.55)', borderRadius: 5, padding: 6 }, daysText: { fontSize: 10, color: c.white },
  cardContent: { padding: 18 }, cardDestination: { color: c.muted, fontSize: 11, marginBottom: 7 }, cardTitle: { color: c.ink, fontFamily: serif, fontSize: 24, lineHeight: 29 },
  cardDate: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 12 }, cardDateText: { fontSize: 11, color: c.muted, flexShrink: 1 },
  cardFooter: { marginTop: 17, paddingTop: 14, borderTopWidth: 1, borderColor: c.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, budgetLabel: { fontSize: 10, color: c.muted }, budget: { fontSize: 15, color: c.ink, fontWeight: '600', marginTop: 4 },
});
