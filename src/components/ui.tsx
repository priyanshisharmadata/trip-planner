import { Feather } from '@expo/vector-icons';
import { PropsWithChildren } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { colors as c, serif } from '../lib/theme';
import { useTrips } from '../store/TripsProvider';
import { useAuth } from '../store/AuthProvider';

export function Button({ label, onPress, icon = 'plus', secondary = false, danger = false, disabled = false }: {
  label: string; onPress: () => void; icon?: React.ComponentProps<typeof Feather>['name']; secondary?: boolean; danger?: boolean; disabled?: boolean;
}) {
  const color = danger ? c.danger : secondary ? c.green : c.white;
  return <Pressable disabled={disabled} accessibilityState={{ disabled }} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.button, secondary && s.secondary, danger && s.secondary, { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
    <Feather name={icon} size={17} color={color} /><Text style={[s.buttonLabel, { color }]}>{label}</Text>
  </Pressable>;
}

export function IconButton({ name, label, onPress, danger = false }: {
  name: React.ComponentProps<typeof Feather>['name']; label: string; onPress: () => void; danger?: boolean;
}) {
  return <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [s.iconButton, { opacity: pressed ? 0.5 : 1 }]}>
    <Feather name={name} size={19} color={danger ? c.danger : c.green} />
  </Pressable>;
}

export function Frame({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  const { storageError, retrySave, needsRecovery, busy } = useTrips();
  const { session, showSignIn, signOut } = useAuth();
  return <SafeAreaView style={s.safe} edges={['top', 'bottom', 'left', 'right']}>
    <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      <View style={s.topbar}><View style={[s.header, { paddingHorizontal: width < 600 ? 22 : 40 }]}>
        <Pressable accessibilityRole="link" accessibilityLabel="Roam home" onPress={() => router.replace('/')} style={s.brand}>
          <View style={s.logo}><Feather name="compass" size={23} color={c.white} /></View>
          <Text style={s.brandText}>roam<Text style={{ color: c.orange }}>.</Text></Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={session ? 'Sign out' : 'Sign in'} disabled={busy} onPress={() => {router.replace('/'); if (session) void signOut().catch(() => {}); else showSignIn();}} style={s.row}><Feather name={session ? 'log-out' : 'user'} size={16} color={c.green} /><Text style={s.headerNote}>{session ? 'Sign out' : 'Sign in'}</Text></Pressable>
      </View></View>
      <View style={[s.content, { paddingHorizontal: width < 600 ? 22 : 40 }]}>
        {storageError && <View style={s.error}><Text style={s.errorText}>{storageError}</Text><Button disabled={busy} label={needsRecovery ? 'Back up and reset trips' : 'Retry storage'} icon="refresh-cw" secondary onPress={() => void retrySave()} /></View>}
        {children}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

export function Empty({ title, description, children }: PropsWithChildren<{title:string;description:string}>) {
  return <View style={s.empty}><View style={s.emptyIcon}><Feather name="map" size={29} color={c.green} /></View>
    <Text style={s.emptyTitle}>{title}</Text><Text style={s.emptyDescription}>{description}</Text>{children}
  </View>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg }, topbar: { borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: '#FAFBF7' },
  header: { width: '100%', maxWidth: 1160, alignSelf: 'center', height: 68, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 }, logo: { width: 37, height: 37, borderRadius: 12, backgroundColor: c.green, justifyContent: 'center', alignItems: 'center', transform: [{ rotate: '-8deg' }] },
  brandText: { color: c.ink, fontSize: 32, fontWeight: '700', letterSpacing: -1.7 }, row: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.orange }, headerNote: { color: c.muted, fontSize: 11 },
  content: { maxWidth: 1160, width: '100%', alignSelf: 'center', paddingTop: 26, paddingBottom: 32 },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 19, backgroundColor: c.green, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 46 },
  secondary: { backgroundColor: c.lightGreen }, buttonLabel: { fontSize: 13, fontWeight: '600' },
  iconButton: { height: 44, width: 44, borderRadius: 13, backgroundColor: c.white, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center' },
  footer: { marginTop: 44, paddingTop: 22, borderTopWidth: 1, borderColor: c.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, footerText: { fontSize: 11, color: c.muted },
  empty: { padding: 34, alignItems: 'center', backgroundColor: c.white, borderRadius: 18, borderWidth: 1, borderColor: c.border, gap: 14 },
  emptyIcon: { backgroundColor: c.lightGreen, padding: 18, borderRadius: 50 }, emptyTitle: { fontFamily: serif, fontSize: 26, color: c.ink, textAlign: 'center' }, emptyDescription: { color: c.muted, textAlign: 'center', lineHeight: 22, maxWidth: 350 },
  error: { padding: 16, backgroundColor: '#FFF1E8', borderRadius: 12, marginBottom: 20, gap: 12 }, errorText: { color: c.danger, lineHeight: 21 },
});

