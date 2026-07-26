import { expect, test } from '@playwright/test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { adminUserPath } from './admin-root';

// CI retries reuse the emulator, so each attempt starts from a clean slate.
test.beforeEach(async () => {
  const app = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `warm-wipe-${Date.now()}`);
  try {
    const db = getFirestore(app);
    const root = await adminUserPath(app);
    await Promise.all([
      db.recursiveDelete(db.collection(`${root}/shoppingItems`)),
      db.recursiveDelete(db.collection(`${root}/vendors`)),
      db.recursiveDelete(db.doc(`${root}/budgets/household`)),
    ]);
  } finally {
    await deleteApp(app);
  }
});

// The Costco regression: data written by OTHER family members while this
// device only ever sat on the Today tab must still be on the device when it
// goes offline. Before the warm-cache module, each tab's data was cached only
// while that tab was open, so a store visit found a stale or empty list.
test('tabs never opened online still show fresh household data offline', async ({ page, context }) => {
  const stamp = Date.now();
  const itemName = `Rotisserie chicken ${stamp}`;
  const vendorName = `Warm HVAC ${stamp}`;
  const budgetCategory = `Groceries ${stamp}`;
  const budgetLine = `Costco run ${stamp}`;
  const visibleSyncStatus = (status: 'synced' | 'offline') =>
    page.locator(`[data-sync-status="${status}"]:visible`);

  // Another family member's device wrote all of this while ours was closed.
  const app = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `warm-seed-${stamp}`);
  try {
    const db = getFirestore(app);
    const user = await getAuth(app).getUserByEmail('offline-e2e@example.com');
    const audit = { createdBy: user.uid, authorName: 'Family Seeder', createdAt: new Date().toISOString() };
    await Promise.all([
      db.collection(`users/${user.uid}/shoppingItems`).doc('warm-item').set({ name: itemName, isBought: false, category: 'Costco', ...audit }),
      db.collection(`users/${user.uid}/vendors`).doc('warm-vendor').set({ name: vendorName, serviceType: 'HVAC', ...audit }),
      db.doc(`users/${user.uid}/budgets/household/categories/warm-cat`).set({ name: budgetCategory, kind: 'expense', sortOrder: 10, ...audit }),
      db.doc(`users/${user.uid}/budgets/household/subcategories/warm-line`).set({ categoryId: 'warm-cat', name: budgetLine, amount: 650, sortOrder: 10, ...audit }),
    ]);
  } finally {
    await deleteApp(app);
  }

  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await expect(page.getByRole('button', { name: 'Shop' })).toBeVisible();
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));

  // Stay on Today. "Synced" now waits for the warm listeners too, so it means
  // every household collection is server-confirmed on this device.
  await expect(visibleSyncStatus('synced')).toBeVisible();

  // Belt and braces: confirm the docs are DURABLY cached, not just streamed.
  const cachedCount = (...segments: string[]) =>
    page.evaluate(args => (window as any).__omniCacheCounts(...args), segments);
  await expect.poll(() => cachedCount('shoppingItems'), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => cachedCount('vendors'), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect.poll(() => cachedCount('budgets', 'household', 'categories'), { timeout: 15_000 }).toBeGreaterThan(0);

  await context.setOffline(true);
  // Full offline reload: the cache must survive a cold start, not just a tab switch.
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'Shop' }).click();
  await expect(page.getByText(itemName, { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Vendors' }).click();
  await expect(page.getByTestId(`vendor-${vendorName}`)).toBeVisible();

  await page.getByRole('button', { name: 'Budget' }).click();
  await expect(page.getByTestId(`budget-line-${budgetLine}`)).toContainText('$650.00');
  await expect(page.getByTestId(`budget-subtotal-${budgetCategory}`)).toHaveText('$650.00');
  await expect(page.getByTestId('budget-total-expenses')).toHaveText('$650.00');

  await context.setOffline(false);
  await expect(visibleSyncStatus('synced')).toBeVisible({ timeout: 30_000 });
});

// If the durable offline store cannot be created, the app must say so while
// the user is still online — not fail silently and strand them in a store.
test('a missing IndexedDB shows a visible warning instead of failing silently', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { get: () => undefined });
  });
  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await expect(page.getByRole('button', { name: 'Shop' })).toBeVisible();
  await expect(page.getByTestId('offline-store-degraded')).toBeVisible();
  await expect(page.getByTestId('offline-store-degraded')).toContainText(/offline storage/i);
});

// If session restore ever stalls again (the in-store splash hang), the user
// must get an explanation and a retry button, not an infinite spinner.
test('a stalled session restore shows the boot watchdog instead of hanging forever', async ({ page }) => {
  await page.addInitScript(() => {
    const realOpen = indexedDB.open.bind(indexedDB);
    (indexedDB as any).open = (name: string, ...rest: unknown[]) => {
      if (String(name).includes('firebaseLocalStorage')) {
        // An IDBOpenDBRequest stand-in that never settles: the auth SDK's
        // session restore awaits it forever, reproducing the boot hang.
        return { addEventListener() {}, removeEventListener() {} };
      }
      return (realOpen as any)(name, ...rest);
    };
  });
  await page.goto('/');
  await expect(page.getByTestId('boot-watchdog')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

// The nastier real-world shape: IndexedDB EXISTS but cannot be opened (legacy
// private modes, corrupted origin storage). The Firestore SDK swallows this
// and silently runs on a memory cache; the health probe must still catch it.
test('an unusable IndexedDB is detected and reported too', async ({ page }) => {
  await page.addInitScript(() => {
    window.indexedDB.open = () => {
      throw new DOMException('An attempt was made to use an object that is not usable.', 'InvalidStateError');
    };
  });
  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await expect(page.getByRole('button', { name: 'Shop' })).toBeVisible();
  await expect(page.getByTestId('offline-store-degraded')).toBeVisible();
});
