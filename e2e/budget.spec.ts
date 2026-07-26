import { expect, test } from '@playwright/test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { adminUserPath } from './admin-root';

// CI retries reuse the emulator, so each attempt starts from a clean slate.
test.beforeEach(async () => {
  const app = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `budget-wipe-${Date.now()}`);
  try {
    // Deleting the household doc recursively clears both the categories and
    // subcategories subcollections underneath it.
    await getFirestore(app).recursiveDelete(getFirestore(app).doc(`${await adminUserPath(app)}/budgets/household`));
  } finally {
    await deleteApp(app);
  }
});

test('the household budget with income and net survives an offline PWA reload and sync', async ({ page, context }) => {
  const stamp = Date.now();
  const expenseCategory = `Transportation ${stamp}`;
  const carPayment = `Car payment ${stamp}`;
  const insurance = `Insurance ${stamp}`;
  const incomeCategory = `Salary ${stamp}`;
  const paycheck = `Paycheck ${stamp}`;
  const visibleSyncStatus = (status: 'synced' | 'offline') =>
    page.locator(`[data-sync-status="${status}"]:visible`);

  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await expect(page.getByRole('button', { name: 'Budget' })).toBeVisible();
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await page.getByRole('button', { name: 'Budget' }).click();
  await expect(visibleSyncStatus('synced')).toBeVisible();

  await context.setOffline(true);

  // Add an expense category from the header button (defaults to Expense).
  await page.getByTestId('budget-add-category').click();
  await page.getByLabel('Category name').fill(expenseCategory);
  await page.getByTestId('budget-submit').click();
  const expenseCard = page.getByTestId(`budget-category-${expenseCategory}`);
  await expect(expenseCard).toBeVisible();

  // Add two subcategory lines with planned monthly amounts.
  const addLine = async (categoryName: string, lineName: string, amount: string) => {
    await page.getByTestId(`budget-add-line-${categoryName}`).click();
    await page.getByLabel('Line name').fill(lineName);
    await page.getByLabel('Monthly amount (USD)').fill(amount);
    await page.getByTestId('budget-submit').click();
  };
  await addLine(expenseCategory, carPayment, '400');
  await addLine(expenseCategory, insurance, '150');

  await expect(page.getByTestId(`budget-line-${carPayment}`)).toContainText('$400.00');
  await expect(page.getByTestId(`budget-line-${insurance}`)).toContainText('$150.00');
  await expect(page.getByTestId(`budget-subtotal-${expenseCategory}`)).toHaveText('$550.00');
  await expect(page.getByTestId('budget-total-expenses')).toHaveText('$550.00');
  // No income yet: net is negative expenses.
  await expect(page.getByTestId('budget-net')).toHaveText('-$550.00');

  // Add an income category from the Income section (pre-selects Income).
  await page.getByTestId('budget-add-income').click();
  await page.getByLabel('Category name').fill(incomeCategory);
  await page.getByTestId('budget-submit').click();
  const incomeCard = page.getByTestId(`budget-category-${incomeCategory}`);
  await expect(incomeCard).toBeVisible();
  await addLine(incomeCategory, paycheck, '5000');

  await expect(page.getByTestId('budget-total-income')).toHaveText('$5,000.00');
  await expect(page.getByTestId('budget-net')).toHaveText('+$4,450.00');
  await expect(visibleSyncStatus('offline')).toContainText(/waiting/i);

  // Everything survives a full offline reload from the PWA cache.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Budget' }).click();
  await expect(page.getByTestId('budget-total-income')).toHaveText('$5,000.00');
  await expect(page.getByTestId('budget-total-expenses')).toHaveText('$550.00');
  await expect(page.getByTestId('budget-net')).toHaveText('+$4,450.00');
  await expect(page.getByTestId(`budget-line-${carPayment}`)).toBeVisible();

  // Delete one line (two-tap confirm), and the totals drop accordingly.
  await page.getByRole('button', { name: `Delete ${insurance}`, exact: true }).click();
  await page.getByRole('button', { name: `Confirm delete ${insurance}`, exact: true }).click();
  await expect(page.getByTestId(`budget-line-${insurance}`)).toHaveCount(0);
  await expect(page.getByTestId('budget-total-expenses')).toHaveText('$400.00');
  await expect(page.getByTestId('budget-net')).toHaveText('+$4,600.00');

  // Deleting the expense category cascades to its remaining line.
  await page.getByRole('button', { name: `Delete ${expenseCategory}`, exact: true }).click();
  await page.getByRole('button', { name: `Confirm delete ${expenseCategory}`, exact: true }).click();
  await expect(expenseCard).toHaveCount(0);
  await expect(page.getByTestId('budget-total-expenses')).toHaveText('$0.00');
  await expect(page.getByTestId('budget-net')).toHaveText('+$5,000.00');

  await context.setOffline(false);
  await expect(visibleSyncStatus('synced')).toBeVisible({ timeout: 30_000 });
});

test('a category can move between the expense and income sections', async ({ page }) => {
  const stamp = Date.now();
  const categoryName = `Freelance ${stamp}`;
  const lineName = `Consulting ${stamp}`;

  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await page.getByRole('button', { name: 'Budget' }).click();

  // Created as an expense first (deliberately "wrong").
  await page.getByTestId('budget-add-category').click();
  await page.getByLabel('Category name').fill(categoryName);
  await page.getByTestId('budget-kind-expense').click();
  await page.getByTestId('budget-submit').click();
  await page.getByTestId(`budget-add-line-${categoryName}`).click();
  await page.getByLabel('Line name').fill(lineName);
  await page.getByLabel('Monthly amount (USD)').fill('900');
  await page.getByTestId('budget-submit').click();
  await expect(page.getByTestId('budget-total-expenses')).toHaveText('$900.00');
  await expect(page.getByTestId('budget-net')).toHaveText('-$900.00');

  // Edit the category and flip it to income; the money moves sections.
  await page.getByRole('button', { name: `Edit ${categoryName}`, exact: true }).click();
  await page.getByTestId('budget-kind-income').click();
  await page.getByTestId('budget-submit').click();
  await expect(page.getByTestId('budget-total-income')).toHaveText('$900.00');
  await expect(page.getByTestId('budget-total-expenses')).toHaveText('$0.00');
  await expect(page.getByTestId('budget-net')).toHaveText('+$900.00');
});
