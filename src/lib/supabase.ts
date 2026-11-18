import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createClient, processLock } from '@supabase/supabase-js';
import { isPublicSupabaseConfig } from './auth-helpers';
import { createAuthFetch } from './auth-fetch';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
export const supabaseUrl = url;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
export const authConfigured = isPublicSupabaseConfig(url, key);

const nativeStorage = {
  getItem: (name: string) => SecureStore.getItemAsync(name),
  setItem: (name: string, value: string) => SecureStore.setItemAsync(name, value),
  removeItem: (name: string) => SecureStore.deleteItemAsync(name),
};

export const supabase = authConfigured ? createClient(url, key, {
  global: { fetch: createAuthFetch() },
  auth: {
    storage: Platform.OS === 'web' ? AsyncStorage : nativeStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
}) : null;
