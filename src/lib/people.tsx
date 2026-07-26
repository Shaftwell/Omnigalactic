import React from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { userRoot } from '../firebase';
import { trackWrite } from './syncStatus';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// People are per-account labels for organizing tasks ("who is this for") —
// yourself, a partner, a roommate, a pet. They live in users/{uid}/people and
// every account starts with just itself.
export const DEFAULT_PERSON = 'Me';

export interface PersonDoc {
  id: string;
  name: string;
}

export interface PersonStyle {
  avatar: string;
  text: string;
  chip: string;
}

// Colors are derived from the person's name, so they are stable across
// sessions and components without a lookup table.
const PALETTE: PersonStyle[] = [
  { avatar: 'bg-indigo-500', text: 'text-indigo-400', chip: 'bg-indigo-900/30 border-indigo-500/30 text-indigo-300' },
  { avatar: 'bg-rose-500', text: 'text-rose-400', chip: 'bg-rose-900/30 border-rose-500/30 text-rose-300' },
  { avatar: 'bg-emerald-500', text: 'text-emerald-400', chip: 'bg-emerald-900/30 border-emerald-500/30 text-emerald-300' },
  { avatar: 'bg-amber-500', text: 'text-amber-400', chip: 'bg-amber-900/30 border-amber-500/30 text-amber-300' },
  { avatar: 'bg-sky-500', text: 'text-sky-400', chip: 'bg-sky-900/30 border-sky-500/30 text-sky-300' },
  { avatar: 'bg-fuchsia-500', text: 'text-fuchsia-400', chip: 'bg-fuchsia-900/30 border-fuchsia-500/30 text-fuchsia-300' },
  { avatar: 'bg-teal-500', text: 'text-teal-400', chip: 'bg-teal-900/30 border-teal-500/30 text-teal-300' },
  { avatar: 'bg-orange-500', text: 'text-orange-400', chip: 'bg-orange-900/30 border-orange-500/30 text-orange-300' },
];

function nameHash(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export const personStyle = (person: string): PersonStyle =>
  PALETTE[nameHash(person) % PALETTE.length];

/** Live per-account people list; falls back to just DEFAULT_PERSON while empty. */
export function usePeople(): { people: string[]; personDocs: PersonDoc[] } {
  const [personDocs, setPersonDocs] = React.useState<PersonDoc[]>([]);
  React.useEffect(() => {
    const q = query(collection(userRoot(), 'people'), orderBy('name', 'asc'));
    return onSnapshot(q, snapshot => {
      setPersonDocs(snapshot.docs
        .map(d => ({ id: d.id, name: String(d.data().name ?? '') }))
        .filter(p => p.name));
    }, err => console.warn('Firestore people error:', err));
  }, []);
  const people = personDocs.length ? personDocs.map(p => p.name) : [DEFAULT_PERSON];
  return { people, personDocs };
}

export function addPerson(name: string): Promise<unknown> {
  return trackWrite(addDoc(collection(userRoot(), 'people'), { name }));
}

export function removePerson(id: string): Promise<unknown> {
  return trackWrite(deleteDoc(doc(userRoot(), 'people', id)));
}

/** Tasks keep whatever assignee they were saved with; blank means the default. */
export const normalizePerson = (assignee: unknown): string =>
  typeof assignee === 'string' && assignee.trim() ? assignee : DEFAULT_PERSON;

export function PersonAvatar({ person, size = 'md' }: { person: string; size?: 'sm' | 'md' }) {
  return (
    <span className={cn(
      'rounded-full flex items-center justify-center font-black text-white shrink-0',
      personStyle(person).avatar,
      size === 'sm' ? 'w-4 h-4 text-[8px]' : 'w-6 h-6 text-[10px]'
    )}>
      {person[0]}
    </span>
  );
}
