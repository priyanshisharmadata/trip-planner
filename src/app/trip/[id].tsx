import { useRef, useState } from 'react';
import { ImageBackground, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, Empty, Frame, IconButton } from '../../components/ui';
import TripForm from '../../components/TripForm';
import ActivityForm from '../../components/ActivityForm';
import { colors as c, covers, serif } from '../../lib/theme';
import { addDays, dayCount, formatCurrency, formatDateRange, tripTotal } from '../../lib/trips';
import { useTrips } from '../../store/TripsProvider';
import { FeedbackOverlay, useFeedback } from '../../store/FeedbackProvider';

export default function TripDetails() {
  const { id } = useLocalSearchParams<{id: string}>();
  const { trips, busy, saveTrip, deleteTrip, addActivity, toggleActivity, deleteActivity } = useTrips();
  const { notify } = useFeedback();
  const trip = trips.find(t => t.id === id);
  const { width } = useWindowDimensions();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteLock = useRef(false);
  async function removeTrip() {
    if (deleteLock.current || !trip) return;
    deleteLock.current = true; setDeleting(true);
    try { await deleteTrip(trip.id); setConfirmDelete(false); router.replace('/'); }
    catch { /* The provider shows the failure; keep confirmation open for retry. */ }
    finally { deleteLock.current = false; setDeleting(false); }
  }
  if (!trip) return <Frame><Empty title="This trip isn't here" description="It may have been deleted, or this link belongs to another device."><Button label="Back to my trips" icon="arrow-left" onPress={() => router.replace('/')} /></Empty></Frame>;

  const days = Array.from({ length: dayCount(trip.startDate, trip.endDate) }, (_, i) => addDays(trip.startDate, i));
  const date = selectedDay && days.includes(selectedDay) ? selectedDay : trip.startDate;
  const activities = trip.activities.filter(a => a.date === date).sort((a,b) => a.time.localeCompare(b.time));
  const planned = tripTotal(trip);
  const remaining = Math.round((trip.budget - planned) * 100) / 100;
  const completed = trip.activities.filter(a => a.done).length;
  const wide = width >= 850;

  return <Frame>
    <View style={s.navigation}><Pressable accessibilityRole="link" onPress={() => router.replace('/')} style={s.back}><Feather name="arrow-left" size={17} color={c.green} /><Text style={s.backText}>My trips</Text></Pressable><View style={s.row}><IconButton name="edit-2" label="Edit trip" onPress={() => setEditing(true)} /><IconButton name="trash-2" label="Delete trip" danger onPress={() => setConfirmDelete(true)} /></View></View>
    <ImageBackground source={covers[trip.coverKey]} style={s.cover} imageStyle={{ borderRadius: 21, width: '100%', height: '100%' }}><LinearGradient colors={['rgba(13,34,22,0.03)','rgba(13,34,22,0.85)']} style={s.coverGradient}>
      <View><Text style={[s.title, width < 600 && {fontSize: 32}]}>{trip.title}</Text><View style={s.coverMeta}><Feather name="map-pin" size={14} color={c.white} /><Text style={s.coverText}>{trip.destination}</Text></View><View style={s.coverMeta}><Feather name="calendar" size={14} color={c.white} /><Text style={s.coverText}>{formatDateRange(trip.startDate,trip.endDate)} · {days.length} days</Text></View></View>
    </LinearGradient></ImageBackground>

    <View style={[s.columns, !wide && { flexDirection: 'column' }]}>
      <View style={s.itinerary}>
        <View style={s.sectionHead}><View><Text style={s.sectionTitle}>Itinerary</Text><Text style={s.description}>{completed} of {trip.activities.length} activities completed</Text></View><IconButton name="plus" label="Add activity" onPress={() => setAdding(true)} /></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.dayList}>
          {days.map((day,i) => <Pressable key={day} accessibilityRole="tab" accessibilityState={{selected: day === date}} aria-selected={day === date} accessibilityLabel={`Day ${i+1}, ${day}`} onPress={() => setSelectedDay(day)} style={[s.day, day === date && s.activeDay]}>
            <Text style={[s.dayLabel, day === date && {color: '#D9E8DD'}]}>DAY {i+1}</Text><Text style={[s.dayDate, day === date && {color: c.white}]}>{new Date(`${day}T12:00:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</Text>
            <View style={[s.dayDot, {backgroundColor: trip.activities.some(a => a.date === day) ? (day === date ? '#D8DDA8' : c.orange) : 'transparent'}]} />
          </Pressable>)}
        </ScrollView>
        <View style={s.dayHeading}><Text style={s.dayTitle}>{new Date(`${date}T12:00:00`).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'})}</Text><Text style={s.count}>{activities.length} {activities.length === 1 ? 'plan' : 'plans'}</Text></View>
        {activities.length ? <View style={s.activities}>{activities.map(activity => <View key={activity.id} style={[s.activity, activity.done && {backgroundColor:'#F0F4EB'}]}>
          <Pressable disabled={busy} accessibilityRole="checkbox" accessibilityState={{checked:activity.done, disabled:busy}} aria-checked={activity.done} accessibilityLabel={`Mark ${activity.title} ${activity.done ? 'incomplete' : 'complete'}`} onPress={() => void toggleActivity(trip.id,activity.id).catch(() => {})} style={[s.checkbox, activity.done && s.checked]}>{activity.done && <Feather name="check" size={15} color={c.white} />}</Pressable>
          <View style={{flex:1}}><View style={s.activityMeta}><Feather name="clock" size={11} color={c.muted} /><Text style={s.time}>{activity.time}</Text></View><Text style={[s.activityTitle, activity.done && {textDecorationLine:'line-through',color:c.muted}]}>{activity.title}</Text><Text style={s.cost}>{activity.cost === 0 && !activity.source ? 'Free' : `${formatCurrency(activity.cost)} estimated allowance`}</Text>{activity.source && <Pressable accessibilityRole="link" accessibilityLabel={`Google Maps · ${activity.source.label}`} style={{minHeight:44,justifyContent:'center'}} onPress={() => void Linking.openURL(activity.source!.url).catch(() => notify({type:'error',message:'Could not open Google Maps. Please try again.'}))}><Text style={{color:c.green,fontSize:11}}>Google Maps · {activity.source.label} ↗</Text></Pressable>}</View>
          <Pressable disabled={busy} accessibilityState={{disabled:busy}} accessibilityLabel={`Remove ${activity.title}`} accessibilityRole="button" onPress={() => void deleteActivity(trip.id,activity.id).catch(() => {})} style={s.removeActivity}><Feather name="x" size={16} color={c.muted} /></Pressable>
        </View>)}</View> : <Empty title="Nothing planned yet" description="Add an activity for this day."><Button label="Add first activity" onPress={() => setAdding(true)} /></Empty>}
        {activities.length > 0 && <Pressable accessibilityRole="button" onPress={() => setAdding(true)} style={s.addActivity}><Feather name="plus" size={17} color={c.green} /><Text style={s.addActivityText}>Add another activity</Text></Pressable>}
      </View>

      <View style={[s.sidebar, {width: wide ? 292 : '100%'}]}>
        <View style={s.budgetCard}><View style={s.budgetHeader}><View style={s.budgetIcon}><Feather name="pie-chart" size={20} color={c.green} /></View><Text style={s.budgetTitle}>Budget</Text></View>
          <Text style={s.smallLabel}>TOTAL BUDGET</Text><Text style={s.budgetAmount}>{formatCurrency(trip.budget)}</Text>
          <View accessibilityRole="progressbar" accessibilityLabel="Budget allocated" accessibilityValue={{min:0,max:100,now:trip.budget > 0 ? Math.min(100, Math.round(planned/trip.budget*100)) : planned > 0 ? 100 : 0}} style={s.progress}><View style={[s.progressFill,{width:`${trip.budget > 0 ? Math.min(100,planned/trip.budget*100) : planned > 0 ? 100 : 0}%`,backgroundColor:remaining < 0 ? c.danger : c.green}]} /></View>
          <View style={s.budgetLine}><Text style={s.budgetLabel}>Activities planned</Text><Text style={s.budgetValue}>{formatCurrency(planned)}</Text></View><View style={s.budgetLine}><Text style={[s.budgetLabel,remaining < 0 && {color:c.danger}]}>{remaining < 0 ? 'Over budget' : 'Remaining'}</Text><Text style={[s.budgetValue,{color:remaining < 0 ? c.danger : c.green}]}>{formatCurrency(Math.abs(remaining))}</Text></View>
          <Text style={s.budgetNote}>Estimates in INR. Add stays, travel and meals as activities to include them here.</Text>
        </View>
      </View>
    </View>
    <TripForm visible={editing} initial={trip} onClose={() => setEditing(false)} onSave={async updated => {await saveTrip(updated);setEditing(false);}} />
    <ActivityForm visible={adding} trip={trip} date={date} onClose={() => setAdding(false)} onSave={async activity => {await addActivity(trip.id,activity);setSelectedDay(activity.date);setAdding(false);}} />
    <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => {if (!deleteLock.current) setConfirmDelete(false);}}><View style={s.modalOverlay}>{confirmDelete && <FeedbackOverlay />}<View style={s.confirmCard} accessibilityViewIsModal><View style={s.deleteIcon}><Feather name="trash-2" size={25} color={c.danger} /></View><Text style={s.confirmTitle}>Delete this trip?</Text><Text style={s.confirmText}>“{trip.title}” and all its activities will be removed from this device. This cannot be undone.</Text><View style={s.confirmActions}><Button disabled={deleting} label="Keep trip" secondary icon="arrow-left" onPress={() => setConfirmDelete(false)} /><Button disabled={deleting} label={deleting ? 'Deleting…' : 'Delete trip'} danger icon="trash-2" onPress={() => void removeTrip()} /></View></View></View></Modal>
  </Frame>;
}

const s = StyleSheet.create({
  row: {flexDirection:'row',alignItems:'center',gap:10}, navigation:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:20},back:{flexDirection:'row',alignItems:'center',gap:9,minHeight:44},backText:{color:c.green,fontSize:13,fontWeight:'600'},
  cover:{height:235,backgroundColor:c.green,borderRadius:21,overflow:'hidden'},coverGradient:{flex:1,padding:24,justifyContent:'flex-end'},travelTag:{alignSelf:'flex-start',flexDirection:'row',alignItems:'center',gap:7,padding:9,paddingHorizontal:12,borderRadius:20,backgroundColor:'rgba(255,255,255,0.17)'},travelTagText:{color:c.white,fontSize:9,letterSpacing:1.5},title:{fontFamily:serif,fontSize:40,letterSpacing:-1,color:c.white},coverMeta:{flexDirection:'row',gap:8,alignItems:'center',marginTop:10},coverText:{color:'#E9EDE4',fontSize:12,flexShrink:1},
  columns:{flexDirection:'row',gap:32,marginTop:34},itinerary:{flex:1,minWidth:0},sidebar:{gap:18},sectionHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10,marginBottom:23},sectionTitle:{fontFamily:serif,fontSize:29,color:c.ink,letterSpacing:-0.6},description:{fontSize:11,color:c.muted,marginTop:6,lineHeight:18},
  dayList:{gap:9,paddingBottom:5},day:{minWidth:78,borderRadius:13,backgroundColor:c.white,paddingHorizontal:16,paddingTop:14,paddingBottom:8,alignItems:'center',borderWidth:1,borderColor:c.border},activeDay:{backgroundColor:c.green,borderColor:c.green},dayLabel:{fontSize:8,letterSpacing:1.3,color:c.muted,fontWeight:'600'},dayDate:{fontSize:14,fontWeight:'600',color:c.ink,marginTop:7},dayDot:{height:4,width:4,borderRadius:3,marginTop:7},dayHeading:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:25,marginBottom:16},dayTitle:{color:c.ink,fontSize:12,fontWeight:'600'},count:{color:c.muted,fontSize:11},
  activities:{gap:12},activity:{flexDirection:'row',alignItems:'center',gap:13,padding:18,backgroundColor:c.white,borderRadius:14,borderWidth:1,borderColor:c.border},checkbox:{height:26,width:26,borderRadius:9,borderWidth:1.5,borderColor:'#C3D0BE',alignItems:'center',justifyContent:'center'},checked:{backgroundColor:c.green,borderColor:c.green},activityMeta:{flexDirection:'row',alignItems:'center',gap:5},time:{color:c.muted,fontSize:10},activityTitle:{color:c.ink,fontWeight:'600',fontSize:14,lineHeight:21,marginTop:5},cost:{color:c.muted,fontSize:10,marginTop:6},removeActivity:{height:36,width:32,alignItems:'center',justifyContent:'center'},addActivity:{flexDirection:'row',gap:8,alignItems:'center',justifyContent:'center',borderRadius:13,padding:17,marginTop:14,borderWidth:1,borderColor:'#C8D6C2',borderStyle:'dashed'},addActivityText:{fontSize:11,color:c.green},
  budgetCard:{backgroundColor:c.white,borderRadius:17,borderWidth:1,borderColor:c.border,padding:22},budgetHeader:{flexDirection:'row',alignItems:'center',gap:10,marginBottom:25},budgetIcon:{width:36,height:36,borderRadius:11,backgroundColor:c.lightGreen,alignItems:'center',justifyContent:'center'},budgetTitle:{fontFamily:serif,fontSize:21,color:c.ink},smallLabel:{fontSize:8,letterSpacing:1.5,color:c.muted},budgetAmount:{fontSize:32,letterSpacing:-1,color:c.ink,marginTop:7,fontWeight:'600'},progress:{height:7,borderRadius:5,backgroundColor:c.lightGreen,marginTop:18,marginBottom:19,overflow:'hidden'},progressFill:{height:7,borderRadius:5},budgetLine:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:13},budgetLabel:{fontSize:11,color:c.muted},budgetValue:{fontSize:12,fontWeight:'600',color:c.ink},budgetNote:{fontSize:10,color:c.muted,lineHeight:17,borderTopWidth:1,borderColor:c.border,paddingTop:15,marginTop:4},
  progressCard:{backgroundColor:c.lightGreen,borderRadius:17,padding:22},progressTitle:{fontSize:12,fontWeight:'600',color:c.green},progressNumber:{fontSize:35,fontWeight:'600',color:c.ink,marginTop:17},progressTotal:{fontSize:22,fontWeight:'400',color:c.muted},tip:{padding:15,flexDirection:'row',gap:12},tipText:{fontFamily:serif,color:c.muted,fontSize:16,lineHeight:24,flex:1},
  modalOverlay:{flex:1,backgroundColor:'rgba(16,35,25,0.5)',padding:22,alignItems:'center',justifyContent:'center'},confirmCard:{backgroundColor:c.white,borderRadius:23,padding:26,width:'100%',maxWidth:440,gap:16},deleteIcon:{width:52,height:52,borderRadius:17,backgroundColor:'#FFF0E9',alignItems:'center',justifyContent:'center'},confirmTitle:{fontFamily:serif,fontSize:29,color:c.ink},confirmText:{color:c.muted,fontSize:13,lineHeight:22},confirmActions:{flexDirection:'row',flexWrap:'wrap',justifyContent:'flex-end',gap:10,marginTop:5},
});

