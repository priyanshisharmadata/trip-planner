import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text } from 'react-native';

import SmartPlanner from '../components/SmartPlanner';
import { Frame } from '../components/ui';
import { colors as c } from '../lib/theme';

export default function PlanScreen() {
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
      <Frame>
        <Pressable accessibilityRole="link" accessibilityLabel="Back to trips" onPress={() => router.replace('/')} style={styles.back}>
          <Feather name="arrow-left" size={17} color={c.green} />
          <Text style={styles.backLabel}>My trips</Text>
        </Pressable>
        <SmartPlanner />
      </Frame>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  back: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'flex-start', marginBottom: 16 },
  backLabel: { color: c.green, fontSize: 13, fontWeight: '600' },
});
