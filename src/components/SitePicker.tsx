import { useState } from 'react';
import type { User } from 'firebase/auth';
import { Plus, Rocket, Mail } from 'lucide-react';
import { acceptInvite, createSite, type Site } from '../lib/sites';

interface Props {
  user: User;
  sites: Site[];
  invites: Site[];
  onOpen: (site: Site) => void;
}

export default function SitePicker({ user, sites, invites, onOpen }: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      await createSite(user, name || `${user.displayName?.split(' ')[0] ?? 'My'}'s Site`);
      setName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create site.');
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = async (site: Site) => {
    setError(null);
    try {
      await acceptInvite(site, user);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept invite.');
    }
  };

  return (
    <div className="max-w-lg mx-auto py-12 px-6 flex flex-col gap-8">
      <h2 className="text-2xl font-bold">Welcome, {user.displayName ?? user.email}</h2>

      {invites.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm uppercase tracking-wide text-gray-400 flex items-center gap-2">
            <Mail className="w-4 h-4" /> Invitations
          </h3>
          {invites.map(site => (
            <div key={site.id} className="flex items-center justify-between bg-white/5 rounded-xl px-4 py-3">
              <div>
                <div className="font-medium">{site.name}</div>
                <div className="text-sm text-gray-400">from {site.ownerEmail}</div>
              </div>
              <button
                onClick={() => handleAccept(site)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
              >
                Accept
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm uppercase tracking-wide text-gray-400 flex items-center gap-2">
          <Rocket className="w-4 h-4" /> Your sites
        </h3>
        {sites.length === 0 && (
          <p className="text-gray-400 text-sm">No sites yet — create your first one below.</p>
        )}
        {sites.map(site => (
          <button
            key={site.id}
            onClick={() => onOpen(site)}
            className="text-left bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3 transition-colors"
          >
            <div className="font-medium">{site.name}</div>
            <div className="text-sm text-gray-400">
              {site.memberEmails.length} member{site.memberEmails.length === 1 ? '' : 's'}
              {site.ownerUid === user.uid ? ' · you own this' : ''}
            </div>
          </button>
        ))}
      </section>

      <section className="flex gap-2">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="New site name"
          className="flex-1 bg-white/5 rounded-xl px-4 py-3 outline-none focus:ring-2 ring-indigo-500 placeholder:text-gray-500"
        />
        <button
          onClick={handleCreate}
          disabled={busy}
          className="px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 flex items-center gap-2 font-medium"
        >
          <Plus className="w-4 h-4" /> Create
        </button>
      </section>

      {error && <p className="text-red-400 text-sm">{error}</p>}
    </div>
  );
}
