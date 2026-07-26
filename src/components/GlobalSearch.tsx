import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, X, Calendar as CalendarIcon, StickyNote, ListTodo, ShoppingCart, Loader2, Wrench, Receipt } from 'lucide-react';
import { userRoot, db, handleFirestoreError, OperationType } from '../firebase';
import { collection, getDocs, getDocsFromCache } from 'firebase/firestore';
import { motion } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Event, Note, Task, ShoppingItem, List, Vendor, Purchase } from '../types';
import { formatFullToET } from '../lib/timeUtils';
import { useSettings } from '../contexts/SettingsContext';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type SearchTab = 'calendar' | 'notes' | 'tasks' | 'shopping' | 'vendors';

interface GlobalSearchProps {
  onClose: () => void;
  onNavigate: (tab: SearchTab) => void;
}

interface Result {
  key: string;
  tab: SearchTab;
  title: string;
  subtitle: string;
  icon: typeof Search;
  color: string;
}

// Cheap text normalizer for matching (handles legacy HTML notes too)
const plain = (s: string | undefined | null) =>
  (s || '').replace(/<[^>]+>/g, ' ').replace(/[#*_`>[\]]/g, ' ').replace(/\s+/g, ' ').toLowerCase();

export default function GlobalSearch({ onClose, onNavigate }: GlobalSearchProps) {
  const { timeFormat } = useSettings();
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ events: Event[]; notes: Note[]; tasks: Task[]; items: ShoppingItem[]; lists: List[]; vendors: Vendor[]; purchases: Purchase[] }>(
    { events: [], notes: [], tasks: [], items: [], lists: [], vendors: [], purchases: [] }
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      // Cache-first: every doc ever seen is in the offline cache, so search
      // answers instantly even with no/flaky signal. Only fall back to the
      // server when a collection has nothing cached (e.g. a brand-new device).
      const load = async (name: string) => {
        const cached = await getDocsFromCache(collection(userRoot(), name)).catch(() => null);
        if (cached && !cached.empty) return cached;
        return getDocs(collection(userRoot(), name));
      };
      try {
        const [ev, no, td, si, li, ve, pu] = await Promise.all([
          load('events'),
          load('notes'),
          load('todos'),
          load('shoppingItems'),
          load('lists'),
          load('vendors'),
          load('purchases'),
        ]);
        setData({
          events: ev.docs.map(d => ({ id: d.id, ...d.data() } as Event)),
          notes: no.docs.map(d => ({ id: d.id, ...d.data() } as Note)),
          tasks: td.docs.map(d => ({ id: d.id, ...d.data() } as Task)),
          items: si.docs.map(d => ({ id: d.id, ...d.data() } as ShoppingItem)),
          lists: li.docs.map(d => ({ id: d.id, ...d.data() } as List)),
          vendors: ve.docs.map(d => ({ id: d.id, ...d.data() } as Vendor)),
          purchases: pu.docs.map(d => ({ id: d.id, ...d.data() } as Purchase)),
        });
      } catch (err) {
        console.error('Search load failed:', err);
        try { handleFirestoreError(err, OperationType.LIST, 'search'); } catch (e) { /* throws */ }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = useMemo<Result[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: Result[] = [];

    for (const e of data.events) {
      if (plain(e.title).includes(needle) || plain(e.description).includes(needle) || plain(e.location).includes(needle)) {
        out.push({ key: `e-${e.id}`, tab: 'calendar', title: e.title, subtitle: `Event · ${formatFullToET(e.date, timeFormat)}`, icon: CalendarIcon, color: 'text-indigo-400' });
      }
    }
    for (const n of data.notes) {
      if (plain(n.title).includes(needle) || plain(n.content).includes(needle)) {
        out.push({ key: `n-${n.id}`, tab: 'notes', title: n.title, subtitle: 'Note', icon: StickyNote, color: 'text-amber-400' });
      }
    }
    for (const t of data.tasks) {
      if (plain(t.title).includes(needle) || plain(t.notes).includes(needle)) {
        out.push({ key: `t-${t.id}`, tab: 'tasks', title: t.title, subtitle: `Task · ${t.assignee}${t.isCompleted ? ' · done' : ''}`, icon: ListTodo, color: 'text-violet-400' });
      }
    }
    for (const l of data.lists) {
      if (plain(l.title).includes(needle)) {
        out.push({ key: `l-${l.id}`, tab: 'tasks', title: l.title, subtitle: 'List', icon: ListTodo, color: 'text-violet-400' });
      }
    }
    for (const i of data.items) {
      if (plain(i.name).includes(needle)) {
        out.push({ key: `s-${i.id}`, tab: 'shopping', title: i.name, subtitle: `Shopping · ${i.category}${i.isBought ? ' · bought' : ''}`, icon: ShoppingCart, color: 'text-emerald-400' });
      }
    }
    for (const v of data.vendors) {
      if (plain(v.name).includes(needle) || plain(v.serviceType).includes(needle) || plain(v.notes).includes(needle)) {
        out.push({ key: `v-${v.id}`, tab: 'vendors', title: v.name, subtitle: `Vendor · ${v.serviceType}`, icon: Wrench, color: 'text-orange-400' });
      }
    }
    for (const p of data.purchases) {
      if (plain(p.itemName).includes(needle) || plain(p.purchasedFrom).includes(needle) || plain(p.notes).includes(needle)) {
        out.push({ key: `p-${p.id}`, tab: 'vendors', title: p.itemName, subtitle: `Purchase${p.purchasedFrom ? ` · ${p.purchasedFrom}` : ''}`, icon: Receipt, color: 'text-orange-400' });
      }
    }
    return out.slice(0, 24);
  }, [q, data, timeFormat]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        className="relative w-full max-w-xl bg-slate-900 rounded-3xl shadow-2xl border border-slate-700/60 overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800">
          {loading ? <Loader2 className="w-5 h-5 text-indigo-400 animate-spin shrink-0" /> : <Search className="w-5 h-5 text-indigo-400 shrink-0" />}
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search events, notes, tasks, shopping…"
            className="flex-1 bg-transparent outline-none text-base text-white placeholder:text-slate-600 min-w-0"
          />
          <button onClick={onClose} className="p-1.5 hover:bg-slate-800 rounded-full shrink-0">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {q.trim() === '' ? (
            <p className="text-xs text-slate-600 text-center py-6">Type to search the whole ship</p>
          ) : results.length === 0 ? (
            <p className="text-xs text-slate-600 text-center py-6">{loading ? 'Loading…' : 'No matches found'}</p>
          ) : (
            results.map(r => (
              <button
                key={r.key}
                onClick={() => { onNavigate(r.tab); onClose(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-800/70 text-left transition-colors"
              >
                <r.icon className={cn('w-4 h-4 shrink-0', r.color)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-white truncate">{r.title}</p>
                  <p className="text-[11px] text-slate-500 truncate">{r.subtitle}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </motion.div>
    </div>
  );
}
