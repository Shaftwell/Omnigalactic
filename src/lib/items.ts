import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';

// Generic helpers for a site's content subcollections (notes, tasks,
// shopping). Every document is scoped under sites/{siteId}/{kind} so the
// security rules can gate everything on site membership.
export type Kind = 'notes' | 'tasks' | 'shopping';

export interface Item {
  id: string;
  text: string;
  done?: boolean;
  body?: string;
  createdByEmail?: string;
}

export function watchItems(siteId: string, kind: Kind, cb: (items: Item[]) => void): Unsubscribe {
  const q = query(collection(db, 'sites', siteId, kind), orderBy('createdAt', 'desc'));
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Item));
  });
}

export function addItem(siteId: string, kind: Kind, data: Omit<Item, 'id'>) {
  return addDoc(collection(db, 'sites', siteId, kind), {
    ...data,
    createdAt: serverTimestamp(),
  });
}

export function updateItem(siteId: string, kind: Kind, id: string, data: Partial<Omit<Item, 'id'>>) {
  return updateDoc(doc(db, 'sites', siteId, kind, id), data);
}

export function deleteItem(siteId: string, kind: Kind, id: string) {
  return deleteDoc(doc(db, 'sites', siteId, kind, id));
}
