import { expect, test } from '@playwright/test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { adminUserPath } from './admin-root';

// CI retries reuse the emulator, so each attempt starts from a clean slate.
test.beforeEach(async () => {
  const app = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `vendors-wipe-${Date.now()}`);
  try {
    const db = getFirestore(app);
    const root = await adminUserPath(app);
    await Promise.all([
      db.recursiveDelete(db.collection(`${root}/vendors`)),
      db.recursiveDelete(db.collection(`${root}/purchases`)),
    ]);
  } finally {
    await deleteApp(app);
  }
});

test('vendors and warranty-tracked purchases survive an offline PWA reload and sync', async ({ page, context }) => {
  const vendorName = `Ace Plumbing ${Date.now()}`;
  const itemName = `Water Heater ${Date.now()}`;
  const visibleSyncStatus = (status: 'synced' | 'offline') =>
    page.locator(`[data-sync-status="${status}"]:visible`);
  // Warranty date well inside the 60-day window -> "Under warranty".
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const warrantyDate = nextYear.toISOString().slice(0, 10);

  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await expect(page.getByRole('button', { name: 'Vendors' })).toBeVisible();
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await page.getByRole('button', { name: 'Vendors' }).click();
  await expect(visibleSyncStatus('synced')).toBeVisible();

  await context.setOffline(true);

  // Add a vendor in the Directory section.
  await page.getByTestId('vendors-add').click();
  await page.getByLabel('Name').fill(vendorName);
  await page.getByLabel('Service type').fill('Plumbing');
  await page.getByLabel(/^Phone/).fill('(555) 867-5309');
  await page.getByRole('button', { name: 'Add to Directory' }).click();
  await expect(page.getByTestId(`vendor-${vendorName}`)).toBeVisible();

  // Add a purchase linked to that vendor, with a live warranty.
  await page.getByTestId('vendors-tab-purchases').click();
  await page.getByTestId('purchases-add').click();
  await page.getByLabel('Item').fill(itemName);
  await page.getByLabel('Warranty ends').fill(warrantyDate);
  await page.getByRole('combobox', { name: 'Vendor' }).selectOption({ label: vendorName });
  await page.getByRole('button', { name: 'Add to Purchases' }).click();

  const purchaseRow = page.getByTestId(`purchase-${itemName}`);
  await expect(purchaseRow).toContainText(vendorName); // linked vendor name resolves
  await expect(purchaseRow).toContainText('Under warranty');
  await expect(visibleSyncStatus('offline')).toContainText(/waiting/i);

  // Everything survives a full offline reload from the PWA cache.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Vendors' }).click();
  await expect(page.getByTestId(`vendor-${vendorName}`)).toBeVisible();
  await page.getByTestId('vendors-tab-purchases').click();
  await expect(page.getByTestId(`purchase-${itemName}`)).toContainText('Under warranty');

  await context.setOffline(false);
  await expect(visibleSyncStatus('synced')).toBeVisible({ timeout: 30_000 });
});

test('a vendor document uploads through the files API and views from its blob', async ({ page }) => {
  // The deployed /api/files function is stubbed: POST accepts the upload and,
  // as the real function would, we write the metadata doc via the Admin SDK so
  // the panel's read-only subscription shows the row. GET returns tiny bytes.
  const pngBytes = Buffer.from('89504e470d0a1a0a', 'hex'); // PNG signature stub
  let uploadedFileName = '';

  const app = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `vendors-files-${Date.now()}`);
  const db = getFirestore(app);
  const user = await getAuth(app).getUserByEmail('offline-e2e@example.com');
  const vendorRef = db.collection(`users/${user.uid}/vendors`).doc('e2e-vendor');
  await vendorRef.set({
    name: 'Document Vendor',
    serviceType: 'HVAC',
    createdBy: user.uid,
    authorName: 'Offline E2E',
    createdAt: new Date().toISOString(),
  });

  await page.route('**/api/files**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === 'POST') {
      const fileId = 'e2e-file-1';
      uploadedFileName = decodeURIComponent(url.searchParams.get('fileName') ?? '');
      // Simulate the function's server-side metadata write.
      await vendorRef.collection('files').doc(fileId).set({
        fileName: uploadedFileName,
        storagePath: `userFiles/${user.uid}/vendors/e2e-vendor/${fileId}`,
        contentType: 'image/png',
        size: pngBytes.length,
        createdBy: user.uid,
        authorName: 'Offline E2E',
        createdAt: new Date().toISOString(),
      });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ fileId, storagePath: `userFiles/${user.uid}/vendors/e2e-vendor/${fileId}`, contentType: 'image/png', size: pngBytes.length, fileName: uploadedFileName }) });
      return;
    }
    if (req.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'image/png', body: pngBytes });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  try {
    await page.goto('/');
    await page.getByTestId('access-command-center').click();
    await page.getByRole('button', { name: 'Vendors' }).click();
    await page.getByTestId('vendor-Document Vendor').click();

    await page.getByRole('button', { name: 'Upload' }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'warranty.png', mimeType: 'image/png', buffer: pngBytes });

    // The stubbed function wrote the metadata doc, so the row appears.
    await expect(page.getByText('warranty.png', { exact: true })).toBeVisible();
    expect(uploadedFileName).toBe('warranty.png');

    // View it: the client fetches bytes with the token and renders a blob: image.
    await page.getByRole('button', { name: 'View warranty.png' }).click();
    const image = page.locator('img[alt="warranty.png"]');
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('src', /^blob:/);
  } finally {
    await deleteApp(app);
  }
});
