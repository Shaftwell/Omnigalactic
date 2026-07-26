import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function requireFile(path) {
  if (!existsSync(path)) throw new Error(`Missing required offline artifact: ${path}`);
  return readFileSync(path, 'utf8');
}

const serviceWorker = requireFile('dist/sw.js');
const manifest = JSON.parse(requireFile('dist/manifest.webmanifest'));
const register = requireFile('dist/registerSW.js');
const firebaseSource = requireFile('src/firebase.ts');
const appEntry = requireFile('src/main.tsx');
const syncSource = requireFile('src/lib/syncStatus.ts');
const syncIndicator = requireFile('src/components/SyncStatusIndicator.tsx');
const assets = readdirSync('dist/assets');
const clientJavaScript = assets
  .filter(name => name.endsWith('.js'))
  .map(name => readFileSync(join('dist/assets', name), 'utf8'))
  .join('\n');

if (manifest.display !== 'standalone' || manifest.start_url !== '/') {
  throw new Error('PWA manifest no longer defines the installable standalone app.');
}
if (!register.includes('serviceWorker')) {
  throw new Error('Service-worker registration was not generated.');
}
for (const marker of ['controllerchange', 'registration?.update()', 'navigator.onLine']) {
  if (!appEntry.includes(marker)) {
    throw new Error(`App-shell update handling was removed: ${marker}`);
  }
}
for (const marker of ['external-images', 'googleusercontent', 'favicons']) {
  if (!serviceWorker.includes(marker)) {
    throw new Error(`Offline service worker lost runtime cache marker: ${marker}`);
  }
}
for (const marker of ['persistentLocalCache', 'CACHE_SIZE_UNLIMITED', 'persistentMultipleTabManager', 'navigator.storage?.persist']) {
  if (!firebaseSource.includes(marker)) {
    throw new Error(`Firestore offline durability marker was removed: ${marker}`);
  }
}
for (const marker of ['hasPendingWrites', 'fromCache', 'waitForPendingWrites', 'trackWrite']) {
  if (!syncSource.includes(marker)) {
    throw new Error(`Offline sync visibility marker was removed: ${marker}`);
  }
}
if (!syncIndicator.includes('data-sync-status')) {
  throw new Error('Visible offline/sync indicator was removed.');
}
if (firebaseSource.includes('testConnection()') || firebaseSource.includes('getDocFromServer')) {
  throw new Error('A forced server read returned to the offline startup path.');
}
for (const forbidden of [
  'interpretVoiceCommand',
  'GEMINI_API_KEY',
  'GoogleGenAI',
  'gemini-3-flash-preview',
  'offline-e2e@example.com',
  'demo-omnigalactic-offline',
  '127.0.0.1:8080',
  '127.0.0.1:9099',
]) {
  if (clientJavaScript.includes(forbidden)) {
    throw new Error(`Retired voice/Gemini implementation returned to the browser bundle: ${forbidden}`);
  }
}

console.log(`Offline build verified: ${assets.length} assets, installable manifest, service worker caches, persistent Firestore storage, visible sync state, no forced boot read, and no retired voice code.`);
