import { expect, test } from '@playwright/test';

test('an offline Firestore write survives a PWA reload and syncs after reconnecting', async ({ page, context }) => {
  const itemName = `Offline E2E ${Date.now()}`;
  const visibleSyncStatus = (status: 'synced' | 'offline') =>
    page.locator(`[data-sync-status="${status}"]:visible`);

  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await expect(page.getByRole('button', { name: 'Shop' })).toBeVisible();

  // Wait for the generated production service worker, then reload once online
  // so this page is controlled and can be served entirely from the PWA cache.
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));

  await page.getByRole('button', { name: 'Shop' }).click();
  await expect(visibleSyncStatus('synced')).toBeVisible();

  await context.setOffline(true);
  await expect(visibleSyncStatus('offline')).toBeVisible();

  await page.getByRole('button', { name: /Add Item/i }).click();
  await page.getByLabel('Item Name').fill(itemName);
  await page.getByRole('button', { name: 'Add to List' }).click();
  await expect(page.getByText(itemName, { exact: true })).toBeVisible();
  await expect(visibleSyncStatus('offline')).toContainText(/waiting/i);

  // The app shell, Firebase Auth session, Firestore document, and pending write
  // must all survive a complete reload with Chromium still offline.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Shop' })).toBeVisible();
  await page.getByRole('button', { name: 'Shop' }).click();
  await expect(page.getByText(itemName, { exact: true })).toBeVisible();
  await expect(visibleSyncStatus('offline')).toBeVisible();

  await context.setOffline(false);
  await expect(visibleSyncStatus('synced')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(itemName, { exact: true })).toBeVisible();
});
