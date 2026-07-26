import test, { after, before } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

// Rules contract: every account owns exactly its users/{uid} subtree, nothing
// else. Attachment metadata (files subcollections) is owner-readable but
// client-unwritable — only the /api/files function (Admin SDK) writes it.
const PROJECT_ID = 'demo-omnigalactic';
const ALICE = 'alice-uid';
const BOB = 'bob-uid';
const NOW = '2026-07-10T15:00:00.000Z';
let env;

const audit = uid => ({
  createdBy: uid,
  authorName: 'Rules Test',
  createdAt: NOW,
});

const eventFor = uid => ({
  title: 'Rules test event',
  description: '',
  location: '',
  color: 'indigo',
  date: '2026-07-10T16:00:00.000Z',
  recurrence: 'none',
  ...audit(uid),
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });
  // Seed one document of Alice's so cross-account reads have a real target,
  // plus function-owned attachment metadata for the files contract tests.
  await env.withSecurityRulesDisabled(async adminContext => {
    const db = adminContext.firestore();
    await setDoc(doc(db, `users/${ALICE}/events/seeded`), eventFor(ALICE));
    await setDoc(doc(db, `users/${ALICE}/vendors/v1`), { name: 'Vendor', serviceType: 'HVAC', ...audit(ALICE) });
    await setDoc(doc(db, `users/${ALICE}/vendors/v1/files/f1`), {
      fileName: 'warranty.pdf',
      storagePath: `userFiles/${ALICE}/vendors/v1/f1`,
      contentType: 'application/pdf',
      size: 4,
      ...audit(ALICE),
    });
  });
});

after(async () => {
  await env.cleanup();
});

const asUser = uid => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();
const asAnon = () => env.unauthenticatedContext().firestore();

test('an account reads and writes every kind of document in its own tree', async () => {
  const db = asUser(ALICE);
  await assertSucceeds(getDoc(doc(db, `users/${ALICE}/events/seeded`)));
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/todos/t1`), { title: 'Task', assignee: 'Me', isCompleted: false, ...audit(ALICE) }));
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/people/p1`), { name: 'Partner' }));
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/budgets/household/categories/c1`), { name: 'Transport', kind: 'expense', sortOrder: 1, ...audit(ALICE) }));
  await assertSucceeds(setDoc(doc(db, `users/${ALICE}/portfolios/household/holdings/h1`), { symbol: 'NASDAQ:AAPL', quantity: 1, price: 10, targetPct: 5, ...audit(ALICE) }));
  await assertSucceeds(updateDoc(doc(db, `users/${ALICE}/events/seeded`), { title: 'Renamed' }));
  await assertSucceeds(deleteDoc(doc(db, `users/${ALICE}/todos/t1`)));
});

test('accounts cannot read or write another account\'s tree', async () => {
  const db = asUser(BOB);
  await assertFails(getDoc(doc(db, `users/${ALICE}/events/seeded`)));
  await assertFails(getDocs(collection(db, `users/${ALICE}/events`)));
  await assertFails(setDoc(doc(db, `users/${ALICE}/events/intruder`), eventFor(BOB)));
  await assertFails(setDoc(doc(db, `users/${ALICE}/portfolios/household/holdings/intruder`), { symbol: 'X', quantity: 1, price: 1, targetPct: 1, ...audit(BOB) }));
  await assertFails(getDoc(doc(db, `users/${ALICE}/vendors/v1/files/f1`)));
});

test('anonymous callers can reach nothing', async () => {
  const db = asAnon();
  await assertFails(getDoc(doc(db, `users/${ALICE}/events/seeded`)));
  await assertFails(setDoc(doc(db, `users/${ALICE}/events/anon`), eventFor('anon')));
  await assertFails(setDoc(doc(db, 'anything/at-root'), { hello: 'world' }));
});

test('the bare user document is not readable or writable, even by its owner', async () => {
  const db = asUser(ALICE);
  await assertFails(getDoc(doc(db, `users/${ALICE}`)));
  await assertFails(setDoc(doc(db, `users/${ALICE}`), { note: 'no root fields' }));
});

test('attachment metadata is owner-readable but only the function may write it', async () => {
  const alice = asUser(ALICE);
  await assertSucceeds(getDoc(doc(alice, `users/${ALICE}/vendors/v1/files/f1`)));
  await assertSucceeds(getDocs(collection(alice, `users/${ALICE}/vendors/v1/files`)));
  await assertFails(setDoc(doc(alice, `users/${ALICE}/vendors/v1/files/forged`), {
    fileName: 'forged.pdf',
    storagePath: `userFiles/${ALICE}/vendors/v1/forged`,
    contentType: 'application/pdf',
    size: 1,
    ...audit(ALICE),
  }));
  await assertFails(updateDoc(doc(alice, `users/${ALICE}/vendors/v1/files/f1`), { fileName: 'renamed.pdf' }));
  await assertFails(deleteDoc(doc(alice, `users/${ALICE}/vendors/v1/files/f1`)));
  await assertFails(setDoc(doc(alice, `users/${ALICE}/purchases/p1/files/forged`), { fileName: 'x', ...audit(ALICE) }));
});

test('nothing outside users/{uid} is accessible to signed-in accounts', async () => {
  const db = asUser(ALICE);
  await assertFails(getDoc(doc(db, 'allowlist/someone@example.com')));
  await assertFails(setDoc(doc(db, 'portfolios/household/holdings/h1'), { symbol: 'X', quantity: 1, price: 1, targetPct: 1, ...audit(ALICE) }));
  await assertFails(setDoc(doc(db, 'shoppingItems/root-item'), { name: 'Milk', isBought: false, category: 'Dairy', ...audit(ALICE) }));
});
