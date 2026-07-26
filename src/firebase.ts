import { initializeApp, onLog } from 'firebase/app';
import { connectAuthEmulator, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { connectFirestoreEmulator, doc, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, CACHE_SIZE_UNLIMITED } from 'firebase/firestore';
import type { DocumentReference } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const useFirebaseEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
const isOfflineE2E = useFirebaseEmulators && import.meta.env.VITE_OFFLINE_E2E === 'true';
const emulatorProjectId = 'demo-omnigalactic-offline';

if (
  useFirebaseEmulators
  && typeof location !== 'undefined'
  && !['127.0.0.1', 'localhost'].includes(location.hostname)
) {
  throw new Error('Firebase emulator mode is restricted to localhost builds.');
}

const app = initializeApp(useFirebaseEmulators ? {
  ...firebaseConfig,
  projectId: emulatorProjectId,
  authDomain: `${emulatorProjectId}.firebaseapp.com`,
} : firebaseConfig);

// Best-effort request that the browser never evicts this origin's storage
// (Firestore's IndexedDB cache + the service-worker caches) under storage
// pressure. Installed home-screen apps on iOS get this protection implicitly;
// a plain Safari tab may still purge storage after ~7 days without a visit —
// see the "Offline use" section of the README.
if (typeof navigator !== 'undefined') {
  navigator.storage?.persist?.().catch(() => {});
}

// Offline-first: cache Firestore data locally so the app works with no
// signal (e.g. the shopping list inside a store) and syncs when back online.
// CACHE_SIZE_UNLIMITED disables the SDK's garbage collection (by default a
// 40 MB threshold beyond which least-recently-used docs are silently
// dropped), so once a doc has been seen it stays available offline. If
// IndexedDB is missing entirely (rare; some private modes), fall back to an
// in-memory cache so the app still runs online instead of dying at startup.
let offlineStoreDegraded = false;
const degradedSubscribers = new Set<() => void>();

function markOfflineStoreDegraded() {
  if (offlineStoreDegraded) return;
  offlineStoreDegraded = true;
  degradedSubscribers.forEach(subscriber => subscriber());
}

/**
 * True when the durable IndexedDB cache is not in effect and the app is
 * running on a memory-only cache: it still works online, but nothing survives
 * a reload and offline use will show no data. The app surfaces this loudly
 * (banner + Stats for nerds) so the failure is discovered at home, not in a
 * store with no signal.
 */
export const isOfflineStoreDegraded = () => offlineStoreDegraded;

/** Notifies once if/when the offline store degrades (useSyncExternalStore-shaped). */
export function subscribeOfflineStoreDegraded(subscriber: () => void): () => void {
  degradedSubscribers.add(subscriber);
  return () => { degradedSubscribers.delete(subscriber); };
}

// The Firestore SDK swallows most real-world IndexedDB failures (quota
// exhaustion, legacy private modes, SDK version conflicts): it logs a warning
// and silently swaps in a memory cache, so offlineCache()'s try/catch below
// never sees them. The warning log is the only app-visible trace — watch for
// it so the degradation is surfaced instead of discovered in a store.
onLog(entry => {
  const text = [entry.message, ...(entry.args ?? [])].map(String).join(' ');
  if (/falling back to memory cache|error using user provided cache/i.test(text)) {
    markOfflineStoreDegraded();
  }
}, { level: 'debug' });

// Direct health probe: catches environments where IndexedDB exists but cannot
// actually be opened (legacy private modes, corrupted origin storage) without
// depending on the SDK's log message wording.
function probeIndexedDbHealth() {
  if (typeof indexedDB === 'undefined') {
    markOfflineStoreDegraded();
    return;
  }
  try {
    const probe = indexedDB.open('omnigalactic-offline-probe');
    probe.onerror = () => markOfflineStoreDegraded();
    probe.onsuccess = () => {
      try {
        probe.result.close();
        indexedDB.deleteDatabase('omnigalactic-offline-probe');
      } catch {
        // Cleanup only; the probe already proved IndexedDB works.
      }
    };
  } catch {
    markOfflineStoreDegraded();
  }
}
if (typeof window !== 'undefined') probeIndexedDbHealth();

function offlineCache() {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    return persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
      cacheSizeBytes: CACHE_SIZE_UNLIMITED,
    });
  } catch (err) {
    console.warn('Persistent offline cache unavailable; falling back to in-memory cache.', err);
    markOfflineStoreDegraded();
    return memoryLocalCache();
  }
}

const firestoreSettings = {
  localCache: offlineCache(),
};
export const db = useFirebaseEmulators
  ? initializeFirestore(app, firestoreSettings)
  : initializeFirestore(app, firestoreSettings, firebaseConfig.firestoreDatabaseId);
// getAuth() would attach the popup/redirect resolver at startup; on iOS,
// Safari, and mobile browsers the SDK then proactively loads the Google auth
// iframe AND runs a redirect check over the network — each with a 30–60s
// timeout — BEFORE restoring the signed-in session. On hanging in-store
// connectivity that stalled the boot splash indefinitely. Initializing with
// no resolver makes session restore a pure on-device IndexedDB read; the
// resolver is supplied at the actual sign-in call instead, the only place
// it is needed.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});
export const googleProvider = new GoogleAuthProvider();

if (useFirebaseEmulators) {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

// E2E-only: lets Playwright observe what is DURABLY cached (not just what a
// live listener has seen) so offline tests can gate on real cache contents.
// Stripped from production builds by the isOfflineE2E flag.
if (isOfflineE2E && typeof window !== 'undefined') {
  (window as any).__omniCacheCounts = async (...segments: string[]) => {
    const { collection, getDocsFromCache } = await import('firebase/firestore');
    const [first, ...rest] = segments;
    try {
      return (await getDocsFromCache(collection(userRoot(), first, ...rest))).size;
    } catch {
      return -1;
    }
  };
}

// Every account gets its own private copy of the app's data, rooted at
// users/{uid}. All reads and writes go through this document reference, and
// firestore.rules only lets a signed-in user reach their own subtree.
export function userRoot(): DocumentReference {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not signed in.');
  return doc(db, 'users', uid);
}

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider, browserPopupRedirectResolver);
export const signInForOfflineTest = () => {
  if (!isOfflineE2E) throw new Error('Offline test sign-in is unavailable outside the local E2E build.');
  return signInWithEmailAndPassword(auth, 'offline-e2e@example.com', 'offline-e2e-password');
};
export const logout = () => signOut(auth);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
