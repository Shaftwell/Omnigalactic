import React, { useState, useEffect, useRef } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { doc, getDocFromServer, collection, getDocsFromCache } from 'firebase/firestore';
import { userRoot, db, auth, isOfflineStoreDegraded } from '../firebase';

interface NerdStatsProps {
  onClose: () => void;
}

interface CacheCounts {
  total: number;
  detail: string;
}

function browserName(): string {
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua)) return 'Chrome iOS';
  if (/FxiOS/.test(ua)) return 'Firefox iOS';
  if (/EdgiOS|Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && /iPhone|iPad|Macintosh/.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Unknown';
}

// label → collection path segments; the short label keys the cache summary.
const COLLECTIONS: [string, string[]][] = [
  ['ev', ['events']],
  ['td', ['todos']],
  ['no', ['notes']],
  ['li', ['lists']],
  ['sh', ['shoppingItems']],
  ['ve', ['vendors']],
  ['pu', ['purchases']],
  ['bu', ['budgets', 'household', 'categories']],
  ['bl', ['budgets', 'household', 'subcategories']],
  ['ho', ['portfolios', 'household', 'holdings']],
];

export default function NerdStats({ onClose }: NerdStatsProps) {
  const [online, setOnline] = useState(navigator.onLine);
  const [ping, setPing] = useState<string>('…');
  const [pinging, setPinging] = useState(false);
  const [swState, setSwState] = useState('checking…');
  const [cache, setCache] = useState<CacheCounts | null>(null);
  const [storagePersisted, setStoragePersisted] = useState<string>('…');
  const [fps, setFps] = useState(0);
  const frameCount = useRef(0);

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || (navigator as any).standalone === true;

  // Network status
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // FPS counter (frames rendered per second while the panel is open)
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      frameCount.current++;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const interval = window.setInterval(() => {
      setFps(frameCount.current);
      frameCount.current = 0;
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(interval);
    };
  }, []);

  // Service worker state
  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      setSwState('unsupported');
      return;
    }
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) setSwState('none');
      else if (reg.waiting) setSwState('update waiting');
      else if (reg.active) setSwState(navigator.serviceWorker.controller ? 'active' : 'active (next load)');
      else setSwState('installing');
    }).catch(() => setSwState('error'));
  }, []);

  // Round-trip latency to Firestore (forced server read, bypasses cache)
  const runPing = async () => {
    setPinging(true);
    const start = performance.now();
    try {
      await getDocFromServer(doc(userRoot(), 'test', 'connection'));
      setPing(`${Math.round(performance.now() - start)} ms`);
    } catch {
      setPing(online ? 'failed' : 'offline');
    } finally {
      setPinging(false);
    }
  };

  // Docs available in the offline cache
  const countCache = async () => {
    const counts = await Promise.all(COLLECTIONS.map(async ([, [first, ...rest]]) => {
      try {
        const snap = await getDocsFromCache(collection(userRoot(), first, ...rest));
        return snap.size;
      } catch {
        return 0;
      }
    }));
    setCache({
      total: counts.reduce((a, b) => a + b, 0),
      detail: counts.map((c, i) => `${COLLECTIONS[i][0]}:${c}`).join(' '),
    });
  };

  useEffect(() => {
    runPing();
    countCache();
    // Whether the browser has promised not to evict this origin's storage
    // (IndexedDB + service-worker caches) under storage pressure.
    navigator.storage?.persisted?.()
      .then(granted => setStoragePersisted(granted ? 'protected' : 'evictable'))
      .catch(() => setStoragePersisted('unknown'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const conn = (navigator as any).connection?.effectiveType;
  const mem = (performance as any).memory;

  const rows: [string, React.ReactNode][] = [
    ['Build', `${__APP_COMMIT__} · ${new Date(__APP_BUILT_AT__).toLocaleString()}`],
    ['Mode', `${isStandalone ? 'installed PWA' : 'browser tab'} · SW ${swState}`],
    ['Network', (
      <span className={online ? 'text-emerald-400' : 'text-amber-400'}>
        {online ? 'online' : 'OFFLINE'}{conn ? ` · ${conn}` : ''}
      </span>
    )],
    ['DB ping', (
      <span className="inline-flex items-center gap-1.5">
        <span className={ping === 'failed' ? 'text-red-400' : ping === 'offline' ? 'text-amber-400' : 'text-emerald-400'}>{ping}</span>
        <button onClick={runPing} disabled={pinging} aria-label="Re-ping" className="text-slate-500 hover:text-white disabled:opacity-40">
          <RefreshCw className={pinging ? 'w-2.5 h-2.5 animate-spin' : 'w-2.5 h-2.5'} />
        </button>
      </span>
    )],
    ['Offline store', (
      <span className={isOfflineStoreDegraded() ? 'text-red-400' : 'text-emerald-400'}>
        {isOfflineStoreDegraded() ? 'MEMORY ONLY (no offline data!)' : 'persistent'}
        <span className="text-slate-500"> · {storagePersisted}</span>
      </span>
    )],
    ['Offline cache', cache ? `${cache.total} docs (${cache.detail})` : 'counting…'],
    ['Account', auth.currentUser?.email || 'signed out'],
    ['Render', `${fps} fps · ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`],
    ...(mem ? [['JS heap', `${Math.round(mem.usedJSHeapSize / 1048576)} / ${Math.round(mem.jsHeapSizeLimit / 1048576)} MB`] as [string, React.ReactNode]] : []),
    ['Browser', `${browserName()} · ${navigator.language}`],
    ['Reminder logs', <span className="text-slate-500">GitHub → Actions → Send event reminders</span>],
  ];

  return (
    <div className="fixed top-14 left-2 right-2 sm:right-auto sm:w-[22rem] z-[70] font-mono text-[10px] leading-relaxed">
      <div className="bg-slate-950/90 backdrop-blur-md border border-slate-700/70 rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 bg-slate-900/60">
          <span className="font-black uppercase tracking-[0.2em] text-slate-400">Stats for nerds</span>
          <button onClick={onClose} aria-label="Close stats" className="p-1 hover:bg-slate-800 rounded">
            <X className="w-3 h-3 text-slate-500" />
          </button>
        </div>
        <div className="px-3 py-2 space-y-0.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <span className="text-slate-600 w-24 shrink-0">{label}</span>
              <span className="text-slate-300 min-w-0 break-all">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
