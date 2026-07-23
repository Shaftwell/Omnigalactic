import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { ArrowLeft, ListTodo, LogOut, Orbit, ShoppingCart, StickyNote, Users } from 'lucide-react';
import clsx from 'clsx';
import { auth, logout } from './firebase';
import { watchMyInvites, watchMySites, type Site } from './lib/sites';
import SignIn from './components/SignIn';
import SitePicker from './components/SitePicker';
import ListPanel from './components/ListPanel';
import Notes from './components/Notes';
import Members from './components/Members';

type Tab = 'tasks' | 'shopping' | 'notes' | 'members';

const TABS: { id: Tab; label: string; icon: typeof ListTodo }[] = [
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'shopping', label: 'Shopping', icon: ShoppingCart },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'members', label: 'Members', icon: Users },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [sites, setSites] = useState<Site[]>([]);
  const [invites, setInvites] = useState<Site[]>([]);
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('tasks');

  useEffect(() => onAuthStateChanged(auth, u => {
    setUser(u);
    setAuthReady(true);
    if (!u) {
      setSites([]);
      setInvites([]);
      setActiveSiteId(null);
    }
  }), []);

  useEffect(() => {
    if (!user) return;
    const stopSites = watchMySites(user, setSites);
    const stopInvites = watchMyInvites(user, setInvites);
    return () => {
      stopSites();
      stopInvites();
    };
  }, [user]);

  // Keep the active site in sync with live data (renames, membership
  // changes, deletion by the owner while we're viewing it).
  const activeSite = sites.find(s => s.id === activeSiteId) ?? null;
  useEffect(() => {
    if (activeSiteId && !activeSite) setActiveSiteId(null);
  }, [activeSiteId, activeSite]);

  if (!authReady) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <SignIn />;

  if (!activeSite) {
    return (
      <div className="h-full overflow-y-auto">
        <header className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Orbit className="w-6 h-6 text-indigo-400" /> Omnigalactic
          </div>
          <button onClick={logout} className="flex items-center gap-2 text-sm text-gray-400 hover:text-white">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </header>
        <SitePicker user={user} sites={sites} invites={invites} onOpen={site => setActiveSiteId(site.id)} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-white/10">
        <button
          onClick={() => setActiveSiteId(null)}
          className="text-gray-400 hover:text-white"
          title="All sites"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 font-bold text-lg flex-1 truncate">
          <Orbit className="w-6 h-6 text-indigo-400 shrink-0" />
          <span className="truncate">{activeSite.name}</span>
        </div>
        <nav className="flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                tab === id ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5',
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>
      </header>
      <main className="flex-1 overflow-y-auto px-6 py-6">
        {tab === 'tasks' && <ListPanel siteId={activeSite.id} kind="tasks" user={user} placeholder="Add a task…" />}
        {tab === 'shopping' && <ListPanel siteId={activeSite.id} kind="shopping" user={user} placeholder="Add an item…" />}
        {tab === 'notes' && <Notes siteId={activeSite.id} user={user} />}
        {tab === 'members' && <Members site={activeSite} user={user} onSiteDeleted={() => setActiveSiteId(null)} />}
      </main>
    </div>
  );
}
