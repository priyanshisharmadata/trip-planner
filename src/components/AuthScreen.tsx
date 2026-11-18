import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors as c, serif } from '../lib/theme';
import { authErrorMessage, parseEmailVerification, validateCredentials } from '../lib/auth-helpers';
import { supabaseUrl } from '../lib/supabase';
import { useAuth } from '../store/AuthProvider';
import { useFeedback } from '../store/FeedbackProvider';

export default function AuthScreen() {
  const { configured, signIn, signUp, resendVerification, verifyEmail, enterGuest } = useAuth();
  const { notify } = useFeedback();
  const [mode, setMode] = useState<'signin' | 'signup' | 'verify'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);

  const showError = (message: string) => { setError(message); notify({ type: 'error', message }); };
  const changeMode = (next: typeof mode) => {
    if (locked.current) return;
    setMode(next); setError(null); setPassword(''); setConfirmation(''); setToken('');
  };
  async function submit(resend = false) {
    if (locked.current || !configured) return;
    const validation = mode === 'verify'
      ? !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? 'Enter a valid email address.' : !resend && !parseEmailVerification(token, supabaseUrl) ? authErrorMessage({ code: 'invalid_verification_input' }) : null
      : validateCredentials(email, password, mode === 'signup');
    if (validation) { showError(validation); return; }
    if (mode === 'signup' && !name.trim()) { showError('Enter your name.'); return; }
    if (mode === 'signup' && password !== confirmation) { showError('Passwords do not match.'); return; }
    locked.current = true; setBusy(true); setError(null);
    try {
      if (mode === 'signin') await signIn(email, password);
      else if (mode === 'signup') {
        const signedIn = await signUp(email, password, name);
        setPassword(''); setConfirmation('');
        if (!signedIn) setMode('verify');
      } else if (resend) await resendVerification(email);
      else await verifyEmail(email, token);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  }

  return <SafeAreaView style={s.safe}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.scroll}>
        <View style={s.card}>
          <View style={s.brand}><View style={s.logo}><Feather name="compass" size={25} color={c.white} /></View><Text style={s.brandName}>roam.</Text></View>
          <Text style={s.title} accessibilityRole="header">{mode === 'signup' ? 'Start your next chapter.' : mode === 'verify' ? 'Check your inbox.' : 'Welcome back.'}</Text>
          <Text style={s.subtitle}>{mode === 'signup' ? 'Create your account and start planning.' : mode === 'verify' ? 'Enter the code from your email. No code? Long-press the confirmation link in your email, choose Copy link, and paste it below to verify here.' : 'Sign in to your account. Your trip plans are saved on this device.'}</Text>
          {!configured && <View style={s.notice}><Text style={s.noticeText}>Online accounts aren’t connected yet. You can still plan without an account.</Text></View>}
          {mode === 'signup' && <View style={s.field}><Text style={s.label}>Name</Text><TextInput accessibilityLabel="Name" value={name} onChangeText={setName} editable={!busy} placeholder="Your name" placeholderTextColor={c.muted} autoComplete="name" maxLength={60} style={s.input} /></View>}
          <View style={s.field}><Text style={s.label}>Email</Text><TextInput accessibilityLabel="Email" value={email} onChangeText={setEmail} editable={!busy} placeholder="you@example.com" placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" maxLength={254} style={s.input} /></View>
          {mode === 'verify' ? <View style={s.field}><Text style={s.label}>Verification code or link</Text><TextInput accessibilityLabel="Verification code or link" value={token} onChangeText={setToken} editable={!busy} placeholder="Paste code or confirmation link" placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false} autoComplete="one-time-code" maxLength={4096} style={s.input} /><Text style={s.fieldHint}>You can also open the email link, then return here and sign in. If its browser page cannot open, try signing in anyway.</Text></View> : <>
            <View style={s.field}><Text style={s.label}>Password</Text><View style={s.password}><TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword} editable={!busy} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'} placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry={!visible} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} maxLength={128} style={[s.input, s.passwordInput]} /><Pressable accessibilityRole="button" accessibilityLabel={visible ? 'Hide password' : 'Show password'} onPress={() => setVisible(!visible)} style={s.eye}><Feather name={visible ? 'eye-off' : 'eye'} size={18} color={c.muted} /></Pressable></View></View>
            {mode === 'signup' && <View style={s.field}><Text style={s.label}>Confirm password</Text><TextInput accessibilityLabel="Confirm password" value={confirmation} onChangeText={setConfirmation} editable={!busy} placeholder="Repeat password" placeholderTextColor={c.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry={!visible} autoComplete="new-password" maxLength={128} style={s.input} /></View>}
          </>}
          {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !configured, busy }} disabled={busy || !configured} onPress={() => void submit()} style={[s.primary, (busy || !configured) && s.disabled]}>
            {busy ? <ActivityIndicator color={c.white} /> : <Text style={s.primaryText}>{mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Verify email'}</Text>}
          </Pressable>
          {mode === 'verify' && <Pressable accessibilityRole="button" disabled={busy || !configured} onPress={() => void submit(true)} style={s.link}><Text style={s.linkText}>Resend verification email</Text></Pressable>}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => changeMode(mode === 'signin' ? 'signup' : 'signin')} style={s.link}><Text style={s.linkText}>{mode === 'signin' ? 'New here? Create an account' : 'Back to sign in'}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={enterGuest} style={s.guest}><Text style={s.guestText}>Continue without account</Text><Feather name="arrow-right" size={16} color={c.muted} /></Pressable>
          <Text style={s.footnote}>Guest plans and signed-in plans are kept separate. Plans currently stay on this device.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.bg }, scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 50, paddingBottom: 40 },
  card: { width: '100%', maxWidth: 430, alignSelf: 'center', gap: 18 }, brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 }, logo: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.green, alignItems: 'center', justifyContent: 'center' }, brandName: { fontWeight: '700', fontSize: 34, letterSpacing: -1.5, color: c.ink },
  title: { fontFamily: serif, fontSize: 34, color: c.ink, letterSpacing: -1 }, subtitle: { color: c.muted, fontSize: 13, lineHeight: 21, marginBottom: 8 },
  field: { gap: 8 }, fieldHint: { color: c.muted, fontSize: 12, lineHeight: 19 }, label: { color: c.ink, fontSize: 13, fontWeight: '600' }, input: { minHeight: 50, borderWidth: 1, borderColor: c.border, borderRadius: 11, backgroundColor: c.white, paddingHorizontal: 14, color: c.ink, fontSize: 14 },
  password: { flexDirection: 'row', alignItems: 'center' }, passwordInput: { flex: 1, paddingRight: 52 }, eye: { position: 'absolute', right: 0, height: 50, width: 48, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 50, backgroundColor: c.green, alignItems: 'center', justifyContent: 'center', borderRadius: 12 }, primaryText: { color: c.white, fontSize: 14, fontWeight: '600' }, disabled: { opacity: 0.5 },
  link: { minHeight: 42, alignItems: 'center', justifyContent: 'center' }, linkText: { color: c.green, fontSize: 13, fontWeight: '600' }, guest: { minHeight: 44, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9, borderTopWidth: 1, borderColor: c.border, paddingTop: 18 }, guestText: { color: c.muted, fontSize: 13 },
  error: { color: c.danger, backgroundColor: '#FFF0E8', padding: 13, borderRadius: 10, lineHeight: 20, fontSize: 13 }, notice: { padding: 14, borderRadius: 11, backgroundColor: c.lightGreen }, noticeText: { color: c.green, fontSize: 12, lineHeight: 19 }, footnote: { textAlign: 'center', fontSize: 11, color: c.muted, lineHeight: 18 },
});
