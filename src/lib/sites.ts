import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../firebase';

// A "site" is one user's Omnigalactic workspace. The owner creates it,
// members share it, and invitedEmails holds pending invitations keyed by
// the invitee's Google account email.
export interface Site {
  id: string;
  name: string;
  ownerUid: string;
  ownerEmail: string;
  memberUids: string[];
  memberEmails: string[];
  invitedEmails: string[];
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function watchMySites(user: User, cb: (sites: Site[]) => void): Unsubscribe {
  const q = query(collection(db, 'sites'), where('memberUids', 'array-contains', user.uid));
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Site));
  });
}

export function watchMyInvites(user: User, cb: (sites: Site[]) => void): Unsubscribe {
  const email = normalizeEmail(user.email ?? '');
  if (!email) {
    cb([]);
    return () => {};
  }
  const q = query(collection(db, 'sites'), where('invitedEmails', 'array-contains', email));
  return onSnapshot(q, snap => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Site));
  });
}

export function createSite(user: User, name: string) {
  const email = normalizeEmail(user.email ?? '');
  return addDoc(collection(db, 'sites'), {
    name: name.trim() || 'My Site',
    ownerUid: user.uid,
    ownerEmail: email,
    memberUids: [user.uid],
    memberEmails: [email],
    invitedEmails: [],
    createdAt: serverTimestamp(),
  });
}

export function inviteMember(siteId: string, email: string) {
  return updateDoc(doc(db, 'sites', siteId), {
    invitedEmails: arrayUnion(normalizeEmail(email)),
  });
}

export function revokeInvite(siteId: string, email: string) {
  return updateDoc(doc(db, 'sites', siteId), {
    invitedEmails: arrayRemove(normalizeEmail(email)),
  });
}

// An invited user accepts by moving themselves from invitedEmails to the
// member lists. firestore.rules only allows exactly this transition for
// non-members whose Google email is on the invite list.
export function acceptInvite(site: Site, user: User) {
  const email = normalizeEmail(user.email ?? '');
  return updateDoc(doc(db, 'sites', site.id), {
    memberUids: arrayUnion(user.uid),
    memberEmails: arrayUnion(email),
    invitedEmails: arrayRemove(email),
  });
}

export function removeMember(site: Site, uid: string, email: string) {
  return updateDoc(doc(db, 'sites', site.id), {
    memberUids: arrayRemove(uid),
    memberEmails: arrayRemove(normalizeEmail(email)),
  });
}

export function renameSite(siteId: string, name: string) {
  return updateDoc(doc(db, 'sites', siteId), { name: name.trim() });
}

export function deleteSite(siteId: string) {
  return deleteDoc(doc(db, 'sites', siteId));
}
