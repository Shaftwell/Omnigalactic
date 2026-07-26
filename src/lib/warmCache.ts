import { collection, onSnapshot } from 'firebase/firestore';
import type { Firestore, SnapshotMetadata } from 'firebase/firestore';
import { userRoot } from '../firebase';
import { clearSnapshotMetadata, reportSnapshotMetadata } from './syncStatus';

// Every household collection the tabs read. Firestore only keeps the offline
// cache fresh for queries with ACTIVE listeners, and each tab subscribes only
// while it is open — so before this module existed, a device that sat on the
// Today tab all week walked into the store with a stale Shopping list and no
// Budget/Vendors data at all. Warming one listener per collection at boot
// makes ANY app-open refresh EVERY tab's data, and reporting the snapshots
// into the sync indicator makes "Synced" mean "this whole household dataset
// is on this device — safe to go offline."
const HOUSEHOLD_COLLECTIONS: string[][] = [
  ['events'],
  ['todos'],
  ['lists'],
  ['notes'],
  ['shoppingItems'],
  ['vendors'],
  ['purchases'],
  ['people'],
  ['budgets', 'household', 'categories'],
  ['budgets', 'household', 'subcategories'],
  ['portfolios', 'household', 'holdings'],
  ['portfolios', 'household', 'assetClasses'],
  ['portfolios', 'household', 'settings'],
];

/**
 * Starts a background listener on every household collection so the offline
 * cache stays complete and fresh for the whole session, regardless of which
 * tabs are visited. Listener errors clear their sync-status source and are
 * otherwise swallowed: a warm listener failing (e.g. revoked access) must
 * never break the tab the user is actually looking at.
 */
export function warmHouseholdCache(db: Firestore): () => void {
  const unsubscribes = HOUSEHOLD_COLLECTIONS.map(segments => {
    const source = `warm-${segments.join('/')}`;
    const [first, ...rest] = segments;
    // Register as unconfirmed BEFORE subscribing: a listener whose first event
    // is still in flight would otherwise be invisible to the indicator, letting
    // "Synced" appear while some collections have never reached this device.
    // Only the fromCache/hasPendingWrites fields are read by the status store.
    reportSnapshotMetadata(source, { fromCache: true, hasPendingWrites: false } as SnapshotMetadata);
    return onSnapshot(
      collection(userRoot(), first, ...rest),
      { includeMetadataChanges: true },
      snapshot => reportSnapshotMetadata(source, snapshot.metadata),
      error => {
        console.warn(`Warm cache listener failed (${source}):`, error);
        clearSnapshotMetadata(source);
      },
    );
  });
  return () => {
    for (const segments of HOUSEHOLD_COLLECTIONS) clearSnapshotMetadata(`warm-${segments.join('/')}`);
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
