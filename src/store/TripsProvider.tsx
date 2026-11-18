import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createId, seedTrips, validateActivity, validateTrip, type Activity, type ActivityDraft, type CoverKey, type Trip, type TripDraft } from '../lib/trips';
import { TripRepository, tripStorageKey } from '../lib/trip-storage';
import { useFeedback } from './FeedbackProvider';

type TripsContextValue = {
  trips: Trip[]; ready: boolean; busy: boolean; storageError: string | null; needsRecovery: boolean;
  saveTrip: (trip: Trip) => Promise<void>;
  deleteTrip: (id: string) => Promise<void>;
  addActivity: (tripId: string, activity: Activity) => Promise<void>;
  toggleActivity: (tripId: string, activityId: string) => Promise<void>;
  deleteActivity: (tripId: string, activityId: string) => Promise<void>;
  createPlannedTrip: (draft: TripDraft & { coverKey?: CoverKey }, activities: ActivityDraft[]) => Promise<Trip>;
  retrySave: () => Promise<void>;
};
const TripsContext = createContext<TripsContextValue | undefined>(undefined);

export function TripsProvider({ children, userId }: { children: ReactNode; userId: string | null }) {
  const [repository] = useState(() => new TripRepository(AsyncStorage, tripStorageKey(userId)));
  const [trips, setTrips] = useState<Trip[]>([]);
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(0);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const mounted = useRef(true);
  const retryLock = useRef(false);
  const { notify } = useFeedback();

  useEffect(() => {
    mounted.current = true;
    void repository.load(userId ? [] : seedTrips()).then(next => {
      if (!mounted.current) return;
      setTrips(next);
      notify({ type: 'success', message: 'Trips loaded successfully.' });
    }).catch(() => {
      if (!mounted.current) return;
      const message = repository.needsRecovery ? 'Saved trips could not be opened. Back up and reset to recover this account’s local trip list.' : 'Trips could not be loaded. Please retry.';
      setStorageError(message); setNeedsRecovery(repository.needsRecovery);
      notify({ type: 'error', message });
    }).finally(() => { if (mounted.current) setReady(true); });
    return () => { mounted.current = false; };
  }, [notify, repository, userId]);

  const mutate = useCallback(async (change: (current: Trip[]) => Trip[], success: string) => {
    setPending(count => count + 1);
    try {
      const next = await repository.mutate(change);
      if (mounted.current) { setTrips(next); setStorageError(null); notify({ type: 'success', message: success }); }
    } catch (error) {
      const message = error instanceof Error && /not found|unavailable|valid|within|date|name|budget|cost/i.test(error.message)
        ? error.message : 'Change could not be saved. Please try again; your saved trips are unchanged.';
      if (mounted.current) { setStorageError(message); notify({ type: 'error', message }); }
      throw new Error(message);
    } finally { if (mounted.current) setPending(count => count - 1); }
  }, [notify, repository]);

  const saveTrip = useCallback((trip: Trip) => mutate(current => {
    const validation = validateTrip(trip);
    if (validation) throw new Error(validation);
    return current.some(item => item.id === trip.id) ? current.map(item => item.id === trip.id ? trip : item) : [trip, ...current];
  }, trips.some(item => item.id === trip.id) ? 'Trip updated successfully.' : 'Trip created successfully.'), [mutate, trips]);

  const deleteTrip = useCallback((id: string) => mutate(current => {
    if (!current.some(trip => trip.id === id)) throw new Error('Trip not found.');
    return current.filter(trip => trip.id !== id);
  }, 'Trip deleted successfully.'), [mutate]);

  const addActivity = useCallback((tripId: string, activity: Activity) => mutate(current => {
    const trip = current.find(item => item.id === tripId);
    if (!trip) throw new Error('Trip not found.');
    const validation = validateActivity(activity, trip);
    if (validation) throw new Error(validation);
    return current.map(item => item.id === tripId ? { ...item, activities: [...item.activities.filter(a => a.id !== activity.id), activity] } : item);
  }, 'Activity saved successfully.'), [mutate]);

  const toggleActivity = useCallback((tripId: string, activityId: string) => mutate(current => {
    if (!current.find(trip => trip.id === tripId)?.activities.some(a => a.id === activityId)) throw new Error('Activity not found.');
    return current.map(trip => trip.id === tripId ? { ...trip, activities: trip.activities.map(a => a.id === activityId ? { ...a, done: !a.done } : a) } : trip);
  }, 'Activity updated successfully.'), [mutate]);

  const deleteActivity = useCallback((tripId: string, activityId: string) => mutate(current => {
    if (!current.find(trip => trip.id === tripId)?.activities.some(a => a.id === activityId)) throw new Error('Activity not found.');
    return current.map(trip => trip.id === tripId ? { ...trip, activities: trip.activities.filter(a => a.id !== activityId) } : trip);
  }, 'Activity deleted successfully.'), [mutate]);

  const createPlannedTrip = useCallback(async (draft: TripDraft & { coverKey?: CoverKey }, activities: ActivityDraft[]) => {
    const trip: Trip = { ...draft, id: createId('trip'), coverKey: draft.coverKey ?? 'city', activities: activities.map(activity => ({ ...activity, id: createId('activity'), done: false })) };
    await mutate(current => [trip, ...current], 'Your planned trip was saved successfully.');
    return trip;
  }, [mutate]);

  const retrySave = useCallback(async () => {
    if (retryLock.current) return;
    retryLock.current = true; setPending(count => count + 1);
    try {
      const recovered = repository.needsRecovery;
      const next = recovered ? await repository.recover() : await repository.load(userId ? [] : seedTrips());
      if (mounted.current) {
        setTrips(next); setStorageError(null); setNeedsRecovery(false);
        notify({ type: 'success', message: recovered ? 'Original data backed up. You can plan again.' : 'Trips loaded successfully. You can retry your change.' });
      }
    } catch {
      if (mounted.current) {
        const message = 'Storage is still unavailable. Your existing data has been preserved.';
        setStorageError(message); setNeedsRecovery(repository.needsRecovery); notify({ type: 'error', message });
      }
    } finally { retryLock.current = false; if (mounted.current) setPending(count => count - 1); }
  }, [notify, repository, userId]);

  return <TripsContext.Provider value={{ trips, ready, busy: pending > 0, storageError, needsRecovery, saveTrip, deleteTrip, addActivity, toggleActivity, deleteActivity, createPlannedTrip, retrySave }}>{children}</TripsContext.Provider>;
}

export function useTrips(): TripsContextValue {
  const value = useContext(TripsContext);
  if (!value) throw new Error('useTrips must be used inside TripsProvider.');
  return value;
}
