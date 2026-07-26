import React, { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { Wrench } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { userRoot, db, auth, handleFirestoreError, OperationType } from '../firebase';
import { Vendor } from '../types';
import { clearSnapshotMetadata, reportSnapshotMetadata } from '../lib/syncStatus';
import VendorsDirectory from './vendors/VendorsDirectory';
import Purchases from './vendors/Purchases';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Section = 'directory' | 'purchases';

export default function Vendors() {
  const [section, setSection] = useState<Section>('directory');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vendors load once at the tab level so the purchases section can link to
  // and name them without a second subscription.
  useEffect(() => {
    if (!auth.currentUser) return;
    const source = 'vendors';
    const unsubscribe = onSnapshot(collection(userRoot(), 'vendors'), { includeMetadataChanges: true }, snapshot => {
      reportSnapshotMetadata(source, snapshot.metadata);
      setVendors(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Vendor)));
      setLoaded(true);
      setError(null);
    }, err => {
      clearSnapshotMetadata(source);
      console.error('Failed to load vendors:', err);
      setError('Failed to load vendors. You might not have permission.');
      try { handleFirestoreError(err, OperationType.LIST, 'vendors'); } catch { /* state already set */ }
    });
    return () => { clearSnapshotMetadata(source); unsubscribe(); };
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden text-slate-200">
      <header className="bg-slate-900/60 backdrop-blur-xl px-4 md:px-6 py-3 md:py-4 flex items-center justify-between gap-3 border-b border-slate-800/60 sticky top-0 z-10">
        <h1 className="flex items-center gap-2 min-w-0">
          <Wrench className="text-orange-400 w-6 h-6 shrink-0" />
          <span className="sr-only">Preferred Vendors</span>
        </h1>
        <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
          {(['directory', 'purchases'] as Section[]).map(id => (
            <button
              key={id}
              onClick={() => setSection(id)}
              data-testid={`vendors-tab-${id}`}
              className={cn(
                'px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all',
                section === id ? 'bg-orange-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {id === 'directory' ? 'Directory' : 'Purchases'}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {error && <div className="mb-4 p-3 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm">{error}</div>}
        {section === 'directory'
          ? <VendorsDirectory vendors={vendors} loaded={loaded} />
          : <Purchases vendors={vendors} />}
      </div>
    </div>
  );
}
