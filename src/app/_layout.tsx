import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TripsProvider, useTrips } from '../store/TripsProvider';
import { colors } from '../lib/theme';
import { AuthProvider, useAuth } from '../store/AuthProvider';
import { FeedbackProvider } from '../store/FeedbackProvider';
import AuthScreen from '../components/AuthScreen';

function Screens() {
  const { ready } = useTrips();
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.green} size="large" accessibilityLabel="Loading your trips" /></View>;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />;
}

function AuthenticatedApp() {
  const { ready, session, guest } = useAuth();
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.green} accessibilityLabel="Restoring your session" /></View>;
  if (!session && !guest) return <AuthScreen />;
  return <TripsProvider key={session?.user.id ?? 'guest'} userId={session?.user.id ?? null}><Screens /></TripsProvider>;
}

export default function RootLayout() {
  return <SafeAreaProvider><FeedbackProvider><AuthProvider><StatusBar style="dark" /><AuthenticatedApp /></AuthProvider></FeedbackProvider></SafeAreaProvider>;
}
