import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { authConfigured, supabase, supabaseUrl } from '../lib/supabase';
import { authErrorMessage, parseEmailVerification, validateCredentials } from '../lib/auth-helpers';
import { useFeedback } from './FeedbackProvider';

type AuthContextValue = {
  session: Session | null;
  ready: boolean;
  guest: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<boolean>;
  resendVerification: (email: string) => Promise<void>;
  verifyEmail: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterGuest: () => void;
  showSignIn: () => void;
};
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!supabase);
  const [guest, setGuest] = useState(false);
  const { notify } = useFeedback();
  const actionRef = useRef(false);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    let active = true;
    let authEventReceived = false;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      authEventReceived = true;
      if (active) { setSession(next); if (next) setGuest(false); setReady(true); }
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) notify({ type: 'error', message: 'Your saved session could not be restored. Please sign in again.' });
      if (!authEventReceived) setSession(error ? null : data.session);
      setReady(true);
    }).catch(() => {
      if (active) { setReady(true); notify({ type: 'error', message: 'Your saved session could not be restored. Please sign in again.' }); }
    });
    const refresh = (state: string) => {
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    };
    if (Platform.OS !== 'web') refresh(AppState.currentState);
    const listener = Platform.OS !== 'web' ? AppState.addEventListener('change', refresh) : null;
    return () => { active = false; subscription.unsubscribe(); listener?.remove(); if (Platform.OS !== 'web') client.auth.stopAutoRefresh(); };
  }, [notify]);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    if (actionRef.current) throw new Error('Please wait for the current account action.');
    actionRef.current = true;
    try {
      if (!supabase) throw new Error('Online accounts are not available yet.');
      return await operation();
    } catch (error) {
      const message = supabase ? authErrorMessage(error) : 'Online accounts are not available yet. You can continue without an account.';
      notify({ type: 'error', message });
      throw new Error(message);
    } finally { actionRef.current = false; }
  }, [notify]);

  const signIn = useCallback((email: string, password: string) => run(async () => {
    const validation = validateCredentials(email, password);
    if (validation) throw new Error(validation);
    const { data, error } = await supabase!.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw error;
    if (!data.session) throw new Error('No session returned.');
    setGuest(false); setSession(data.session);
    notify({ type: 'success', message: 'Signed in successfully. Welcome back!' });
  }), [notify, run]);

  const signUp = useCallback((email: string, password: string, name: string) => run(async () => {
    const validation = validateCredentials(email, password, true);
    if (validation) throw new Error(validation);
    const { data, error } = await supabase!.auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { display_name: name.trim().slice(0, 60) } } });
    if (error) throw error;
    if (data.session) {
      setGuest(false); setSession(data.session);
      notify({ type: 'success', message: 'Account created successfully. You are signed in!' });
      return true;
    }
    notify({ type: 'success', message: 'Signup request sent. Check your email to verify your account, then sign in.' });
    return false;
  }), [notify, run]);

  const resendVerification = useCallback((email: string) => run(async () => {
    const { error } = await supabase!.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
    if (error) throw error;
    notify({ type: 'success', message: 'Verification email requested. Check your inbox and spam folder.' });
  }), [notify, run]);

  const verifyEmail = useCallback((email: string, token: string) => run(async () => {
    const verification = parseEmailVerification(token, supabaseUrl);
    if (!verification) throw Object.assign(new Error('Invalid verification input.'), { code: 'invalid_verification_input' });
    const { data, error } = await supabase!.auth.verifyOtp(verification.kind === 'link'
      ? { type: 'email', token_hash: verification.tokenHash }
      : { type: 'email', email: email.trim().toLowerCase(), token: verification.token });
    if (error) throw error;
    if (!data.session) throw new Error('No session returned.');
    setGuest(false); setSession(data.session);
    notify({ type: 'success', message: 'Email verified. Your account is ready and you are signed in!' });
  }), [notify, run]);

  const signOut = useCallback(() => run(async () => {
    const { error } = await supabase!.auth.signOut({ scope: 'local' });
    if (error) {
      // The SDK can clear local credentials even when server revocation is unreachable.
      const { data, error: sessionError } = await supabase!.auth.getSession();
      if (!sessionError && !data.session) {
        setSession(null); setGuest(false);
        notify({ type: 'info', message: 'Signed out on this device. Server sign-out could not be confirmed.' });
        return;
      }
      throw error;
    }
    setSession(null); setGuest(false);
    notify({ type: 'success', message: 'Signed out successfully.' });
  }), [notify, run]);

  return <AuthContext.Provider value={{ session, ready, guest, configured: authConfigured, signIn, signUp, resendVerification, verifyEmail, signOut,
    enterGuest: () => { setGuest(true); notify({ type: 'info', message: 'Guest mode. Plans stay on this device.' }); },
    showSignIn: () => setGuest(false),
  }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
