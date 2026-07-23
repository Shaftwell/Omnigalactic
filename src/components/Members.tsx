import { useState } from 'react';
import type { User } from 'firebase/auth';
import { Crown, Trash2, UserPlus, X } from 'lucide-react';
import { inviteMember, removeMember, revokeInvite, deleteSite, type Site } from '../lib/sites';

interface Props {
  site: Site;
  user: User;
  onSiteDeleted: () => void;
}

export default function Members({ site, user, onSiteDeleted }: Props) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isOwner = site.ownerUid === user.uid;

  const handleInvite = async () => {
    const value = email.trim().toLowerCase();
    if (!value || !value.includes('@')) return;
    setError(null);
    try {
      await inviteMember(site.id, value);
      setEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send invite.');
    }
  };

  const handleDeleteSite = async () => {
    if (!window.confirm(`Delete "${site.name}" and all of its content? This cannot be undone.`)) return;
    await deleteSite(site.id);
    onSiteDeleted();
  };

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm uppercase tracking-wide text-gray-400">Members</h3>
        {site.memberEmails.map((memberEmail, i) => {
          const uid = site.memberUids[i];
          const isSiteOwner = memberEmail === site.ownerEmail;
          return (
            <div key={memberEmail} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
              <span className="flex-1 truncate">{memberEmail}</span>
              {isSiteOwner && <Crown className="w-4 h-4 text-amber-400" aria-label="Owner" />}
              {isOwner && !isSiteOwner && (
                <button
                  onClick={() => removeMember(site, uid, memberEmail)}
                  className="text-gray-500 hover:text-red-400"
                  title="Remove member"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
      </section>

      {site.invitedEmails.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm uppercase tracking-wide text-gray-400">Pending invitations</h3>
          {site.invitedEmails.map(invited => (
            <div key={invited} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
              <span className="flex-1 truncate text-gray-300">{invited}</span>
              <button
                onClick={() => revokeInvite(site.id, invited)}
                className="text-gray-500 hover:text-red-400"
                title="Revoke invite"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm uppercase tracking-wide text-gray-400">Invite someone</h3>
        <p className="text-sm text-gray-400">
          Enter the Gmail / Google account email of the person you want to share this site with.
          They'll see the invitation the next time they sign in.
        </p>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleInvite()}
            placeholder="friend@gmail.com"
            type="email"
            className="flex-1 bg-white/5 rounded-xl px-4 py-3 outline-none focus:ring-2 ring-indigo-500 placeholder:text-gray-500"
          />
          <button
            onClick={handleInvite}
            className="px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 flex items-center gap-2 font-medium"
          >
            <UserPlus className="w-4 h-4" />
          </button>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </section>

      {isOwner && (
        <section className="border-t border-white/10 pt-6">
          <button
            onClick={handleDeleteSite}
            className="flex items-center gap-2 text-red-400 hover:text-red-300 text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" /> Delete this site
          </button>
        </section>
      )}
    </div>
  );
}
