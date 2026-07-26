import React, { useState, useEffect, useRef, useSyncExternalStore, lazy, Suspense } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, logout, isOfflineStoreDegraded, subscribeOfflineStoreDegraded } from './firebase';
import { warmHouseholdCache } from './lib/warmCache';
import Auth from './components/Auth';
import StarField from './components/StarField';
import { Calendar as CalendarIcon, ShoppingCart, StickyNote, ListTodo, LogOut, User as UserIcon, Menu, X, Orbit, Clock, Sun, Search, TrendingUp, Wrench, Wallet, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { useSettings } from './contexts/SettingsContext';
import SyncStatusIndicator from './components/SyncStatusIndicator';
import { watchPreviousPendingWrites } from './lib/syncStatus';

// Each tab is code-split so the initial bundle stays small; heavy deps such as
// the markdown engine in Notes load on demand.
const Today = lazy(() => import('./components/Today'));
const Calendar = lazy(() => import('./components/Calendar'));
const ShoppingList = lazy(() => import('./components/ShoppingList'));
const Notes = lazy(() => import('./components/Notes'));
const Superlist = lazy(() => import('./components/Superlist'));
const Invest = lazy(() => import('./components/Invest'));
const Budget = lazy(() => import('./components/Budget'));
const Vendors = lazy(() => import('./components/Vendors'));
const GlobalSearch = lazy(() => import('./components/GlobalSearch'));
const NerdStats = lazy(() => import('./components/NerdStats'));

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Tab = 'today' | 'calendar' | 'shopping' | 'notes' | 'tasks' | 'invest' | 'budget' | 'vendors';

function TabLoader() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showNerdStats, setShowNerdStats] = useState(false);
  const logoTaps = useRef<number[]>([]);
  const { timeFormat, setTimeFormat } = useSettings();
  // Degradation can be detected after first render (the SDK falls back to a
  // memory cache asynchronously), so subscribe rather than read once.
  const offlineStoreDegraded = useSyncExternalStore(
    subscribeOfflineStoreDegraded,
    isOfflineStoreDegraded,
    isOfflineStoreDegraded,
  );
  // Watchdog: session restore is normally instant and fully on-device, but if
  // anything ever stalls it again the user gets an explanation and a retry
  // button instead of an infinite splash screen.
  const [bootTimedOut, setBootTimedOut] = useState(false);
  useEffect(() => {
    if (!loading) return;
    const id = window.setTimeout(() => setBootTimedOut(true), 8000);
    return () => window.clearTimeout(id);
  }, [loading]);

  // YouTube-style easter egg: triple-tap the logo for "Stats for nerds"
  const handleLogoTap = () => {
    const now = Date.now();
    logoTaps.current = [...logoTaps.current.filter(t => now - t < 800), now];
    if (logoTaps.current.length >= 3) {
      logoTaps.current = [];
      setShowNerdStats(open => !open);
    }
  };

  // Cmd/Ctrl+K opens global search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!user) return;
    return watchPreviousPendingWrites(db);
  }, [user?.uid]);

  // Keep every tab's offline cache fresh for the whole session, no matter
  // which tabs are opened. Without this, data was only cached while its own
  // tab was mounted — the "stale shopping list in the store" failure.
  useEffect(() => {
    if (!user) return;
    return warmHouseholdCache(db);
  }, [user?.uid]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center relative">
        <StarField />
        <div className="relative z-10 flex flex-col items-center gap-5">
          <div className="w-16 h-16 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/30 animate-pulse">
            <Orbit className="w-9 h-9 text-white animate-[spin_6s_linear_infinite]" />
          </div>
          <p className="text-[10px] font-black text-indigo-400 tracking-[0.3em] uppercase">Omnigalactic</p>
          {bootTimedOut && (
            <div data-testid="boot-watchdog" className="mt-2 max-w-xs text-center space-y-3">
              <p className="text-xs text-slate-400 font-medium">
                Starting is taking longer than usual. This can happen when the
                connection is spotty or the browser is busy.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors text-sm font-bold"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!user) {
    return <Auth />;
  }

  const tabs = [
    { id: 'today', label: 'Today', icon: Sun, color: 'text-sky-400', bg: 'bg-sky-900/30' },
    { id: 'shopping', label: 'Shop', icon: ShoppingCart, color: 'text-emerald-400', bg: 'bg-emerald-900/30' },
    { id: 'calendar', label: 'Calendar', icon: CalendarIcon, color: 'text-indigo-400', bg: 'bg-indigo-900/30' },
    { id: 'notes', label: 'Notes', icon: StickyNote, color: 'text-amber-400', bg: 'bg-amber-900/30' },
    { id: 'tasks', label: 'Tasks', icon: ListTodo, color: 'text-violet-400', bg: 'bg-violet-900/30' },
    { id: 'invest', label: 'Invest', icon: TrendingUp, color: 'text-rose-400', bg: 'bg-rose-900/30' },
    { id: 'budget', label: 'Budget', icon: Wallet, color: 'text-teal-400', bg: 'bg-teal-900/30' },
    { id: 'vendors', label: 'Vendors', icon: Wrench, color: 'text-orange-400', bg: 'bg-orange-900/30' },
  ];

  return (
    // fixed inset-0 (not h-dvh): iOS Safari leaves dvh stale after the
    // keyboard or toolbar animates, which floated the bottom nav mid-screen.
    // Fixed positioning always tracks the real viewport, like the starfield.
    <div className="fixed inset-0 flex overflow-hidden font-sans text-slate-200">
      <StarField />
      {/* Sidebar (Desktop) */}
      <aside className="hidden md:flex flex-col w-72 bg-slate-900/60 backdrop-blur-xl border-r border-slate-800/60 p-6 relative z-10">
        <div onClick={handleLogoTap} className="flex items-center gap-3 mb-10 px-2 group cursor-pointer select-none">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-900/40 group-hover:scale-110 transition-transform duration-300">
            <Orbit className="w-7 h-7 text-white animate-[spin_10s_linear_infinite]" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-black text-white tracking-tighter leading-none">OMNIGALACTIC</h1>
            <p className="text-[10px] font-bold text-indigo-400 tracking-[0.2em] uppercase">Mission Control</p>
          </div>
        </div>

        <button
          onClick={() => setIsSearchOpen(true)}
          className="w-full flex items-center gap-3 px-4 py-2.5 mb-4 rounded-2xl bg-slate-950/60 border border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700 transition-all text-sm font-medium"
        >
          <Search className="w-4 h-4" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="text-[9px] font-black bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 tracking-wider">⌘K</kbd>
        </button>

        <div className="mb-4">
          <SyncStatusIndicator />
        </div>

        <nav className="flex-1 space-y-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold transition-all group",
                activeTab === tab.id
                  ? `${tab.bg} ${tab.color} shadow-sm`
                  : "text-slate-500 hover:bg-slate-800 hover:text-slate-200"
              )}
            >
              <tab.icon className={cn("w-5 h-5 transition-transform group-hover:scale-110", activeTab === tab.id ? tab.color : "text-slate-400")} />
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto pt-6 border-t border-slate-800 space-y-4">
          {/* Time Format Toggle */}
          <div className="px-2">
            <div className="bg-slate-950/50 rounded-2xl p-3 border border-slate-800">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Time Format</span>
              </div>
              <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
                <button 
                  onClick={() => setTimeFormat('standard')}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all tracking-wider",
                    timeFormat === 'standard' ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  Standard
                </button>
                <button 
                  onClick={() => setTimeFormat('military')}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all tracking-wider",
                    timeFormat === 'military' ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  Military
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 px-2">
            <div className="w-10 h-10 bg-slate-800 rounded-full overflow-hidden border-2 border-slate-700 shadow-sm">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-full h-full p-2 text-slate-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{user.displayName}</p>
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Explorer</p>
            </div>
          </div>
          <button 
            onClick={logout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold text-slate-400 hover:bg-red-900/20 hover:text-red-400 transition-all group"
          >
            <LogOut className="w-5 h-5 transition-transform group-hover:-translate-x-1" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSidebarOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 md:hidden"
            />
            <motion.aside 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              className="fixed inset-y-0 left-0 w-72 bg-slate-900/90 backdrop-blur-xl z-50 p-6 flex flex-col md:hidden border-r border-slate-800/60 safe-top"
            >
              <div className="flex items-center justify-between mb-10">
                <div className="flex items-center gap-3 px-2">
                  <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-900/20">
                    <Orbit className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex flex-col">
                    <h1 className="text-lg font-black text-white tracking-tighter leading-none">OMNIGALACTIC</h1>
                    <p className="text-[8px] font-bold text-indigo-400 tracking-[0.2em] uppercase">Mission Control</p>
                  </div>
                </div>
                <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-slate-800 rounded-full">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <nav className="flex-1 space-y-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setActiveTab(tab.id as Tab);
                      setIsSidebarOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold transition-all",
                      activeTab === tab.id 
                        ? `${tab.bg} ${tab.color} shadow-sm` 
                        : "text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                    )}
                  >
                    <tab.icon className={cn("w-5 h-5", activeTab === tab.id ? tab.color : "text-slate-400")} />
                    {tab.label}
                  </button>
                ))}
              </nav>

              <div className="mt-auto pt-6 border-t border-slate-800 space-y-4">
                {/* Time Format Toggle Mobile */}
                <div className="px-2">
                  <div className="bg-slate-950/50 rounded-2xl p-3 border border-slate-800">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Time Format</span>
                    </div>
                    <div className="flex bg-slate-900 p-1 rounded-xl border border-slate-800">
                      <button 
                        onClick={() => setTimeFormat('standard')}
                        className={cn(
                          "flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all tracking-wider",
                          timeFormat === 'standard' ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        Standard
                      </button>
                      <button 
                        onClick={() => setTimeFormat('military')}
                        className={cn(
                          "flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase transition-all tracking-wider",
                          timeFormat === 'military' ? "bg-indigo-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                        )}
                      >
                        Military
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 px-2">
                  <div className="w-10 h-10 bg-slate-800 rounded-full overflow-hidden border-2 border-slate-700 shadow-sm">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt={user.displayName || ''} className="w-full h-full object-cover" />
                    ) : (
                      <UserIcon className="w-full h-full p-2 text-slate-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{user.displayName}</p>
                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Explorer</p>
                  </div>
                </div>
                <button 
                  onClick={logout}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold text-slate-400 hover:bg-red-900/20 hover:text-red-400 transition-all"
                >
                  <LogOut className="w-5 h-5" />
                  Sign Out
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Mobile Header */}
        <div className="md:hidden bg-slate-900/70 backdrop-blur-xl px-4 pb-3 safe-top flex items-center justify-between border-b border-slate-800/60 z-30">
          <button onClick={() => setIsSidebarOpen(true)} className="p-2 -ml-2 hover:bg-slate-800 rounded-full">
            <Menu className="w-5 h-5 text-slate-400" />
          </button>
          <div onClick={handleLogoTap} className="flex items-center gap-2 select-none">
            <Orbit className="w-5 h-5 text-indigo-500" />
            <h1 className="text-base font-black text-white tracking-tighter">OMNIGALACTIC</h1>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setIsSearchOpen(true)} aria-label="Search" className="p-2 hover:bg-slate-800 rounded-full">
              <Search className="w-5 h-5 text-slate-400" />
            </button>
            <SyncStatusIndicator compact />
          </div>
        </div>

        {offlineStoreDegraded && (
          <div
            data-testid="offline-store-degraded"
            className="bg-amber-900/30 border-b border-amber-800/50 px-4 py-2 flex items-start gap-2 text-amber-300 text-xs font-semibold z-20"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Offline storage isn’t working on this device, so nothing is being saved for offline use.
              Changes still sync while online. Try closing other tabs of this app or restarting the browser.
            </span>
          </div>
        )}

        <div className="flex-1 overflow-hidden relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 overflow-hidden"
            >
              <Suspense fallback={<TabLoader />}>
                {activeTab === 'today' && <Today onNavigate={tab => setActiveTab(tab)} />}
                {activeTab === 'calendar' && <Calendar />}
                {activeTab === 'shopping' && <ShoppingList />}
                {activeTab === 'notes' && <Notes />}
                {activeTab === 'tasks' && <Superlist />}
                {activeTab === 'invest' && <Invest />}
                {activeTab === 'budget' && <Budget />}
                {activeTab === 'vendors' && <Vendors />}
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden bg-slate-900/70 backdrop-blur-xl border-t border-slate-800/60 pt-1.5 flex items-center safe-bottom">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={cn(
                "flex-1 flex flex-col items-center gap-0.5 transition-all",
                activeTab === tab.id ? tab.color : "text-slate-500"
              )}
            >
              <tab.icon className={cn("w-5 h-5", activeTab === tab.id && "scale-110")} />
              <span className="text-[9px] font-bold uppercase tracking-wider">{tab.label}</span>
            </button>
          ))}
        </nav>
        <AnimatePresence>
          {isSearchOpen && (
            <Suspense fallback={null}>
              <GlobalSearch
                onClose={() => setIsSearchOpen(false)}
                onNavigate={tab => setActiveTab(tab)}
              />
            </Suspense>
          )}
        </AnimatePresence>
        {showNerdStats && (
          <Suspense fallback={null}>
            <NerdStats onClose={() => setShowNerdStats(false)} />
          </Suspense>
        )}
      </main>
    </div>
  );
}
