import { useSyncExternalStore } from 'react';
import { subscribe, getState } from './syncEngine';

/** Live connection/sync state for components (Connected / Syncing / Offline / ...). */
export default function useSyncStatus() {
  return useSyncExternalStore(subscribe, getState);
}
