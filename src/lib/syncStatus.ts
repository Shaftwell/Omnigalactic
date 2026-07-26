import { useSyncExternalStore } from 'react';
import type { Firestore, SnapshotMetadata } from 'firebase/firestore';
import { waitForPendingWrites } from 'firebase/firestore';

export type SyncPhase = 'offline' | 'syncing' | 'connecting' | 'synced';

export interface SyncStatus {
  phase: SyncPhase;
  label: string;
  detail: string;
  online: boolean;
  pendingWrites: number;
  hasPendingWrites: boolean;
}

interface SyncInputs {
  online: boolean;
  trackedWrites: number;
  snapshotHasPendingWrites: boolean;
  hasSnapshotSources: boolean;
  snapshotFromCache: boolean;
  checkingPreviousWrites: boolean;
}

interface SnapshotState {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

const snapshotSources = new Map<string, SnapshotState>();
const subscribers = new Set<() => void>();
let trackedWrites = 0;
let checkingPreviousWrites = false;
let online = typeof navigator === 'undefined' ? true : navigator.onLine;

export function deriveSyncStatus(inputs: SyncInputs): SyncStatus {
  const hasPendingWrites = inputs.trackedWrites > 0 || inputs.snapshotHasPendingWrites;

  if (!inputs.online) {
    const waiting = hasPendingWrites || inputs.checkingPreviousWrites;
    return {
      phase: 'offline',
      label: inputs.trackedWrites > 0
        ? `Offline · ${inputs.trackedWrites} waiting`
        : waiting ? 'Offline · changes waiting' : 'Offline · on device',
      detail: waiting
        ? 'Changes are saved on this device and will sync when a connection returns.'
        : 'Using saved device data. You can keep working without a connection.',
      online: false,
      pendingWrites: inputs.trackedWrites,
      hasPendingWrites: waiting,
    };
  }

  if (hasPendingWrites) {
    const waitingForConnection = inputs.snapshotFromCache;
    return {
      phase: 'syncing',
      label: waitingForConnection
        ? (inputs.trackedWrites > 0 ? `${inputs.trackedWrites} waiting to sync` : 'Changes waiting to sync')
        : (inputs.trackedWrites > 0 ? `Syncing · ${inputs.trackedWrites} waiting` : 'Syncing changes'),
      detail: waitingForConnection
        ? 'Changes are saved on this device while Firestore reconnects.'
        : 'Changes are saved on this device and are being confirmed by Firestore.',
      online: true,
      pendingWrites: inputs.trackedWrites,
      hasPendingWrites: true,
    };
  }

  if (inputs.checkingPreviousWrites || !inputs.hasSnapshotSources || inputs.snapshotFromCache) {
    return {
      phase: 'connecting',
      label: 'Checking sync',
      detail: 'Showing saved device data while Firestore confirms the latest version.',
      online: true,
      pendingWrites: 0,
      hasPendingWrites: false,
    };
  }

  return {
    phase: 'synced',
    label: 'Synced',
    detail: 'All visible changes have been confirmed by Firestore.',
    online: true,
    pendingWrites: 0,
    hasPendingWrites: false,
  };
}

function calculateStatus(): SyncStatus {
  const sourceStates = [...snapshotSources.values()];
  return deriveSyncStatus({
    online,
    trackedWrites,
    snapshotHasPendingWrites: sourceStates.some(source => source.hasPendingWrites),
    hasSnapshotSources: sourceStates.length > 0,
    snapshotFromCache: sourceStates.some(source => source.fromCache),
    checkingPreviousWrites,
  });
}

let currentStatus = calculateStatus();

function publish() {
  currentStatus = calculateStatus();
  subscribers.forEach(subscriber => subscriber());
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    online = true;
    publish();
  });
  window.addEventListener('offline', () => {
    online = false;
    publish();
  });
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function getSnapshot() {
  return currentStatus;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Records query metadata so cached data is never mislabeled as server-synced. */
export function reportSnapshotMetadata(source: string, metadata: SnapshotMetadata) {
  snapshotSources.set(source, {
    fromCache: metadata.fromCache,
    hasPendingWrites: metadata.hasPendingWrites,
  });
  publish();
}

export function clearSnapshotMetadata(source: string) {
  if (snapshotSources.delete(source)) publish();
}

/**
 * Keeps a local-first write visible until Firestore accepts or rejects it.
 * Callers still own error handling on the returned promise.
 */
export function trackWrite<T>(write: Promise<T>): Promise<T> {
  trackedWrites += 1;
  publish();
  return write.finally(() => {
    trackedWrites = Math.max(0, trackedWrites - 1);
    publish();
  });
}

/** Includes writes restored from IndexedDB after an offline restart. */
export function watchPreviousPendingWrites(firestore: Firestore): () => void {
  let active = true;
  checkingPreviousWrites = true;
  publish();
  waitForPendingWrites(firestore)
    .catch(() => {
      // Credential changes can cancel this waiter. Snapshot metadata and each
      // tracked write remain authoritative, so cancellation is safe to ignore.
    })
    .finally(() => {
      if (!active) return;
      checkingPreviousWrites = false;
      publish();
    });

  return () => {
    active = false;
    checkingPreviousWrites = false;
    publish();
  };
}
