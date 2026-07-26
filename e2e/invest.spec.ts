import { expect, test } from '@playwright/test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { adminUserPath } from './admin-root';

const quotesPayload = (prices: Record<string, number>) => ({
  quotes: Object.fromEntries(Object.entries(prices).map(([symbol, price]) => [
    symbol,
    { price, currency: 'USD', description: symbol, source: 'tradingview', fetchedAt: new Date().toISOString() },
  ])),
  errors: {},
});

// CI retries reuse the emulator, so each attempt starts from a clean slate.
test.beforeEach(async () => {
  const app = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `invest-wipe-${Date.now()}`);
  try {
    await getFirestore(app).recursiveDelete(getFirestore(app).collection(`${await adminUserPath(app)}/portfolios`));
  } finally {
    await deleteApp(app);
  }
});

test('legacy class aliases render as one duplicate-free asset-class list', async ({ page }) => {
  const app = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `invest-seed-${Date.now()}`);
  try {
    const user = await getAuth(app).getUserByEmail('offline-e2e@example.com');
    const portfolio = getFirestore(app).collection(`users/${user.uid}/portfolios`).doc('household');
    const holdings = portfolio.collection('holdings');
    const assetClasses = portfolio.collection('assetClasses');
    const common = {
      assetType: 'market',
      quantity: 1,
      priceSource: 'manual',
      createdBy: user.uid,
      authorName: 'Offline E2E',
      createdAt: new Date().toISOString(),
    };
    await Promise.all([
      assetClasses.doc('legacy-crypto-one').set({ name: 'Cryptocurrency', normalizedName: 'cryptocurrency', isDefault: false, sortOrder: 900 }),
      assetClasses.doc('legacy-crypto-two').set({ name: 'Crypto\u200B', normalizedName: 'wrong', isDefault: false, sortOrder: 901 }),
      holdings.doc('crypto-normal').set({ ...common, symbol: 'BITSTAMP:BTCUSD', name: 'Bitcoin', price: 100, targetPct: 20, category: 'Investments', assetClass: 'Crypto' }),
      holdings.doc('crypto-invisible').set({ ...common, symbol: 'AMEX:IBIT', name: 'Bitcoin ETF', price: 200, targetPct: 20, category: 'Investments', assetClass: 'Crypto\u200B', assetClassId: 'legacy-crypto-one' }),
      holdings.doc('crypto-legacy').set({ ...common, symbol: 'NASDAQ:MSTR', name: 'Bitcoin Strategy', price: 300, targetPct: 20, category: 'Cryptocurrency', assetClass: 'Unclassified' }),
      holdings.doc('crypto-escaped').set({ ...common, symbol: 'COINBASE:SOLUSD', name: 'Escaped crypto', price: 400, targetPct: 0, category: 'Investments', assetClass: 'Crypto\\u200B', assetClassId: 'legacy-crypto-two' }),
      holdings.doc('crypto-confusable').set({ ...common, symbol: 'COINBASE:ADAUSD', name: 'Lookalike crypto', price: 500, targetPct: 0, category: 'Сrуptо', assetClass: 'Сrуptо' }),
      holdings.doc('cash-manual').set({ ...common, symbol: 'CASH', name: 'Savings', assetType: 'cash', price: 400, targetPct: 20, category: 'Cash', assetClass: 'Cash' }),
      holdings.doc('cash-quoted').set({ ...common, symbol: 'BITSTAMP:USDCUSD', name: 'USDC', quantity: 100, price: 1, targetPct: 20, category: 'Investments', assetClass: 'Cash Equivalent' }),
    ]);
  } finally {
    await deleteApp(app);
  }

  await page.route('**/api/quotes**', route => route.fulfill({ json: quotesPayload({
    'BITSTAMP:BTCUSD': 100,
    'AMEX:IBIT': 200,
    'NASDAQ:MSTR': 300,
    'COINBASE:SOLUSD': 400,
    'COINBASE:ADAUSD': 500,
    'BITSTAMP:USDCUSD': 1,
  }) }));
  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await page.getByRole('button', { name: 'Invest' }).click();

  await page.getByTestId('invest-manage-asset-classes').click();
  await expect(page.getByTestId('invest-class-option-crypto')).toHaveCount(1);
  await page.getByLabel('Add a custom class').fill('Cryptocurrency');
  await page.getByRole('button', { name: 'Add class' }).click();
  await expect(page.getByText('Crypto already exists. It has been selected instead.')).toBeVisible();
  await expect(page.getByTestId('invest-class-option-crypto')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close asset classes' }).click();

  const classes = page.locator('[data-testid^="invest-asset-class-"]');
  await expect(classes).toHaveCount(2);
  const crypto = page.getByTestId('invest-asset-class-Crypto');
  await expect(crypto).toHaveCount(1);
  await expect(crypto).toContainText('$1,500.00');
  await expect(crypto).toContainText('5 holdings');
  const cash = page.getByTestId('invest-asset-class-Cash & Cash Equivalents');
  await expect(cash).toHaveCount(1);
  await expect(cash).toContainText('$500.00');
  await expect(cash).toContainText('2 holdings');
  await expect(page.getByText('Allocation groups', { exact: true })).toHaveCount(0);

  // The read-time grouping is immediate, and the same pass repairs Firestore
  // so another browser cannot reconstruct the duplicate labels later.
  const verifyApp = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `invest-verify-${Date.now()}`);
  try {
    const repairedHoldings = getFirestore(verifyApp)
      .collection(`${await adminUserPath(verifyApp)}/portfolios`)
      .doc('household')
      .collection('holdings');
    const cryptoIds = ['crypto-normal', 'crypto-invisible', 'crypto-legacy', 'crypto-escaped', 'crypto-confusable'];
    await expect.poll(async () => {
      const documents = await Promise.all(cryptoIds.map(id => repairedHoldings.doc(id).get()));
      return documents.map(document => ({
        assetClassId: document.get('assetClassId'),
        assetClass: document.get('assetClass'),
        category: document.get('category'),
      }));
    }, { timeout: 10_000 }).toEqual(cryptoIds.map(() => ({
      assetClassId: 'crypto',
      assetClass: 'Crypto',
      category: 'Crypto',
    })));

    const classCollection = repairedHoldings.parent.collection('assetClasses');
    await expect.poll(async () => {
      const snapshot = await classCollection.get();
      return snapshot.docs.map(document => document.id).sort();
    }, { timeout: 10_000 }).toEqual([
      'cash-equivalents', 'commodity', 'crypto', 'equity', 'etf', 'fixed-income',
      'other', 'precious-metals', 'real-estate', 'stocks', 'unclassified', 'vehicle',
    ]);
  } finally {
    await deleteApp(verifyApp);
  }
});

test('portfolio weights, drift, rebalance hints, and the Pine script track live quotes', async ({ page }) => {
  let prices: Record<string, number> = { 'NASDAQ:AAPL': 200, 'AMEX:SPY': 400 };
  await page.route('**/api/quotes**', route => route.fulfill({ json: quotesPayload(prices) }));

  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await page.getByRole('button', { name: 'Invest' }).click();
  await expect(page.getByText('No holdings yet.')).toBeVisible();

  await page.getByTestId('invest-manage-asset-classes').click();
  await page.getByLabel('Add a custom class').fill('Individual Stock');
  await page.getByRole('button', { name: 'Add class' }).click();

  const addHolding = async (
    symbol: string,
    quantity: string,
    targetPct: string,
    assetClass = 'Unclassified',
  ) => {
    await page.getByTestId('invest-add-holding').click();
    await page.getByLabel('Symbol').fill(symbol);
    await page.getByRole('combobox', { name: 'Asset class', exact: true }).selectOption({ label: assetClass });
    await page.getByLabel('Quantity').fill(quantity);
    await page.getByLabel('Target %').fill(targetPct);
    await page.getByRole('button', { name: 'Add to Portfolio' }).click();
  };

  await addHolding('NASDAQ:AAPL', '10', '60', 'Individual Stock');
  await addHolding('AMEX:SPY', '5', '40', 'Cash & Cash Equivalents');

  // Quotes fill in: 10 × $200 + 5 × $400 = $4,000, an even 50/50 split.
  await expect(page.getByTestId('invest-total-value')).toHaveText('$4,000.00');
  await expect(page.getByTestId('invest-portfolio-donut')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
  const aapl = page.getByTestId('invest-holding-NASDAQ:AAPL');
  const spy = page.getByTestId('invest-holding-AMEX:SPY');
  await expect(aapl).toContainText('50.0%');
  await expect(aapl).toContainText('60.0%');
  await aapl.getByRole('button', { name: 'Expand NASDAQ:AAPL' }).click();
  await spy.getByRole('button', { name: 'Expand AMEX:SPY' }).click();
  await expect(aapl).toContainText('-10.0%');
  await expect(spy).toContainText('+10.0%');

  // Both drifts breach the default 5% threshold and suggest the exact trade.
  await expect(aapl).toContainText('Buy about $400.00 (~2 units) to reach 60.0%.');
  await expect(spy).toContainText('Sell about $400.00 (~1 unit) to reach 40.0%.');

  // A price move restores the target weights; the hints disappear.
  prices = { 'NASDAQ:AAPL': 300, 'AMEX:SPY': 400 };
  await page.getByTestId('invest-refresh').click();
  await expect(page.getByTestId('invest-total-value')).toHaveText('$5,000.00');
  await expect(aapl).toContainText('60.0%');
  await expect(aapl).toContainText('+0.0%');
  await expect(aapl).not.toContainText('Buy about');
  await expect(spy).not.toContainText('Sell about');

  // Retarget the market assets, then add manually valued assets. SPY and the
  // manual cash holding share one canonical Cash & Cash Equivalents class.
  await page.getByRole('button', { name: 'Edit NASDAQ:AAPL' }).click();
  await page.getByLabel('Target %').fill('30');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await page.getByRole('button', { name: 'Edit AMEX:SPY' }).click();
  await page.getByLabel('Target %').fill('20');
  await page.getByRole('button', { name: 'Save Changes' }).click();

  const addManualAsset = async (
    type: 'cash' | 'home' | 'car',
    name: string,
    assetClass: string,
    value: string,
    targetPct: string,
  ) => {
    await page.getByTestId('invest-add-holding').click();
    await page.getByTestId(`asset-type-${type}`).click();
    await page.getByLabel('Asset name').fill(name);
    if (type !== 'cash') {
      await page.getByRole('combobox', { name: 'Asset class', exact: true }).selectOption({ label: assetClass });
    }
    await page.getByLabel('Target %').fill(targetPct);
    await page.getByLabel('Current value (USD)').fill(value);
    await page.getByRole('button', { name: 'Add to Portfolio' }).click();
  };

  await addManualAsset('cash', 'Emergency fund', 'Cash & Cash Equivalents', '2000', '10');
  await addManualAsset('home', 'Home equity', 'Real Estate', '3000', '30');
  await addManualAsset('car', 'Tesla', 'Vehicle', '1000', '10');

  await expect(page.getByTestId('invest-total-value')).toHaveText('$11,000.00');
  await expect(page.getByText('Allocation groups', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('invest-asset-class-Individual Stock')).toContainText('$3,000.00');
  await expect(page.getByTestId('invest-asset-class-Individual Stock')).toContainText('27.3% of portfolio · 30.0% target');
  const cashEquivalent = page.getByTestId('invest-asset-class-Cash & Cash Equivalents');
  await expect(cashEquivalent).toContainText('$4,000.00');
  await expect(cashEquivalent).toContainText('2 holdings');
  await expect(cashEquivalent).toContainText('36.4% of portfolio · 30.0% target');
  await expect(spy).toContainText('Cash & Cash Equivalents');
  const manualCash = page.getByTestId('invest-holding-CASH');
  await expect(manualCash).toContainText('Emergency fund');
  await expect(manualCash).toContainText('Cash & Cash Equivalents');
  await manualCash.getByRole('button', { name: 'Expand Emergency fund' }).click();
  await expect(manualCash).toContainText('50.0% of Cash & Cash Equivalents');
  await expect(page.getByTestId('invest-asset-class-Real Estate')).toContainText('27.3% of portfolio · 30.0% target');
  await expect(page.getByTestId('invest-asset-class-Vehicle')).toContainText('9.1% of portfolio · 10.0% target');

  // The generated Pine script mirrors market holdings only; manually valued
  // Cash/Home/Car assets stay in the app portfolio and never become symbols.
  await page.getByTestId('invest-pine-button').click();
  const pine = page.getByTestId('invest-pine-code');
  await expect(pine).toContainText('//@version=6');
  await expect(pine).toContainText('request.security("NASDAQ:AAPL", timeframe.period, close)');
  await expect(pine).toContainText('request.security("AMEX:SPY", timeframe.period, close)');
  await expect(pine).toContainText('d0 = w0 - 60');
  await expect(pine).not.toContainText('request.security("CASH"');
  await expect(pine).not.toContainText('request.security("HOME"');
  await expect(pine).not.toContainText('request.security("CAR"');
});

test('an asset and its unified asset class survive an offline PWA reload and sync', async ({ page, context }) => {
  const assetName = `Offline cash ${Date.now()}`;
  const customClass = `Offline Alternatives ${Date.now()}`;
  const visibleSyncStatus = (status: 'synced' | 'offline') =>
    page.locator(`[data-sync-status="${status}"]:visible`);

  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await expect(page.getByRole('button', { name: 'Invest' })).toBeVisible();
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    return true;
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller));
  await page.getByRole('button', { name: 'Invest' }).click();
  await expect(visibleSyncStatus('synced')).toBeVisible();

  await context.setOffline(true);
  await page.getByTestId('invest-manage-asset-classes').click();
  await page.getByLabel('Add a custom class').fill(customClass);
  await page.getByRole('button', { name: 'Add class' }).click();
  await page.getByTestId('invest-manage-asset-classes').click();
  await expect(page.getByText(customClass, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close asset classes' }).click();

  await page.getByTestId('invest-add-holding').click();
  await page.getByTestId('asset-type-cash').click();
  await page.getByLabel('Asset name').fill(assetName);
  await expect(page.getByRole('combobox', { name: 'Asset class', exact: true })).toHaveValue('cash-equivalents');
  await page.getByLabel('Target %').fill('10');
  await page.getByLabel('Current value (USD)').fill('25000');
  await page.getByRole('button', { name: 'Add to Portfolio' }).click();
  await expect(page.getByTestId('invest-holding-CASH')).toContainText(assetName);
  await expect(page.getByTestId('invest-asset-class-Cash & Cash Equivalents')).toContainText('100.0% of portfolio · 10.0% target');
  await expect(visibleSyncStatus('offline')).toContainText(/waiting/i);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Invest' }).click();
  await page.getByTestId('invest-manage-asset-classes').click();
  await expect(page.getByText(customClass, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close asset classes' }).click();
  await expect(page.getByTestId('invest-holding-CASH')).toContainText(assetName);
  await expect(page.getByTestId('invest-asset-class-Cash & Cash Equivalents')).toBeVisible();

  await context.setOffline(false);
  await expect(visibleSyncStatus('synced')).toBeVisible({ timeout: 30_000 });
});

test('Match targets rewrites every target to its current weight', async ({ page }) => {
  const app = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `invest-match-${Date.now()}`);
  try {
    const user = await getAuth(app).getUserByEmail('offline-e2e@example.com');
    const holdings = getFirestore(app).collection(`users/${user.uid}/portfolios`).doc('household').collection('holdings');
    const common = {
      assetType: 'market',
      priceSource: 'manual',
      createdBy: user.uid,
      authorName: 'Offline E2E',
      createdAt: new Date().toISOString(),
    };
    await Promise.all([
      // $3,000 = 60% and $2,000 = 40%, but the saved targets are far off (25/25).
      holdings.doc('aapl').set({ ...common, symbol: 'NASDAQ:AAPL', name: 'Apple', quantity: 3, price: 1000, targetPct: 25, category: 'Equity', assetClass: 'Equity', assetClassId: 'equity' }),
      holdings.doc('spy').set({ ...common, symbol: 'AMEX:SPY', name: 'S&P 500', quantity: 2, price: 1000, targetPct: 25, category: 'ETF', assetClass: 'ETF', assetClassId: 'etf' }),
    ]);
  } finally {
    await deleteApp(app);
  }

  await page.route('**/api/quotes**', route => route.fulfill({ json: quotesPayload({ 'NASDAQ:AAPL': 1000, 'AMEX:SPY': 1000 }) }));
  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await page.getByRole('button', { name: 'Invest' }).click();

  const aapl = page.getByTestId('invest-holding-NASDAQ:AAPL');
  const spy = page.getByTestId('invest-holding-AMEX:SPY');
  await expect(page.getByTestId('invest-total-value')).toHaveText('$5,000.00');
  // Targets start well short of 100% and drift is large.
  await expect(page.getByText('50.0% unallocated')).toBeVisible();
  await aapl.getByRole('button', { name: 'Expand Apple' }).click();
  await expect(aapl).toContainText('+35.0%'); // 60.0% current − 25.0% target

  // The action overwrites hand-set targets, so it takes two taps: arm, confirm.
  const match = page.getByTestId('invest-match-targets');
  await match.click();
  await expect(match).toContainText('Confirm');
  await match.click();

  // Targets now equal current weights: zero drift, fully allocated.
  await expect(page.getByText('fully allocated')).toBeVisible();
  await expect(aapl).toContainText('+0.0%');
  await spy.getByRole('button', { name: 'Expand S&P 500' }).click();
  await expect(spy).toContainText('+0.0%');

  // The rewrite persisted to Firestore, not just the on-screen view.
  const verify = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `invest-match-verify-${Date.now()}`);
  try {
    const holdings = getFirestore(verify).collection(`${await adminUserPath(verify)}/portfolios`).doc('household').collection('holdings');
    await expect.poll(async () => (await holdings.doc('aapl').get()).get('targetPct'), { timeout: 10_000 }).toBe(60);
    await expect.poll(async () => (await holdings.doc('spy').get()).get('targetPct'), { timeout: 10_000 }).toBe(40);
  } finally {
    await deleteApp(verify);
  }
});

test('focusing an asset class filters the holdings and Total Portfolio restores them', async ({ page }) => {
  const app = initializeApp({ projectId: 'demo-omnigalactic-offline' }, `invest-focus-${Date.now()}`);
  try {
    const user = await getAuth(app).getUserByEmail('offline-e2e@example.com');
    const holdings = getFirestore(app).collection(`users/${user.uid}/portfolios`).doc('household').collection('holdings');
    const common = {
      assetType: 'market',
      priceSource: 'manual',
      createdBy: user.uid,
      authorName: 'Offline E2E',
      createdAt: new Date().toISOString(),
    };
    await Promise.all([
      holdings.doc('aapl').set({ ...common, symbol: 'NASDAQ:AAPL', name: 'Apple', quantity: 3, price: 1000, targetPct: 60, category: 'Equity', assetClass: 'Equity', assetClassId: 'equity' }),
      holdings.doc('btc').set({ ...common, symbol: 'BITSTAMP:BTCUSD', name: 'Bitcoin', quantity: 2, price: 1000, targetPct: 40, category: 'Crypto', assetClass: 'Crypto', assetClassId: 'crypto' }),
    ]);
  } finally {
    await deleteApp(app);
  }

  await page.route('**/api/quotes**', route => route.fulfill({ json: quotesPayload({ 'NASDAQ:AAPL': 1000, 'BITSTAMP:BTCUSD': 1000 }) }));
  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await page.getByRole('button', { name: 'Invest' }).click();

  const aapl = page.getByTestId('invest-holding-NASDAQ:AAPL');
  const btc = page.getByTestId('invest-holding-BITSTAMP:BTCUSD');
  const panel = page.getByTestId('invest-holdings-panel');
  const donutCenter = page.getByTestId('invest-donut-center');

  // Default view: the whole portfolio.
  await expect(aapl).toBeVisible();
  await expect(btc).toBeVisible();
  await expect(donutCenter).toContainText('Total portfolio');
  await expect(donutCenter).toContainText('$5,000.00');

  // Focus Crypto: only its holdings remain, with class totals. Match targets
  // (a portfolio-wide write) is withheld so it cannot touch hidden rows.
  await page.getByTestId('invest-asset-class-Crypto').click();
  await expect(btc).toBeVisible();
  await expect(aapl).toHaveCount(0);
  await expect(panel).toContainText('Holdings · Crypto');
  await expect(panel).toContainText('1 of 2');
  await expect(panel).toContainText('Crypto total');
  await expect(donutCenter).toContainText('Crypto');
  await expect(donutCenter).toContainText('$2,000.00');
  await expect(page.getByTestId('invest-match-targets')).toHaveCount(0);

  // Total Portfolio brings every class back.
  await page.getByTestId('invest-total-portfolio').click();
  await expect(aapl).toBeVisible();
  await expect(btc).toBeVisible();
  await expect(donutCenter).toContainText('Total portfolio');
  await expect(panel).toContainText('2 total');
  await expect(page.getByTestId('invest-match-targets')).toBeVisible();

  // Tapping the focused class again also returns to the whole portfolio.
  await page.getByTestId('invest-asset-class-Equity').click();
  await expect(btc).toHaveCount(0);
  await page.getByTestId('invest-asset-class-Equity').click();
  await expect(btc).toBeVisible();
});

test('Invest uses touch-friendly cards on a phone without changing the desktop table', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await page.getByTestId('access-command-center').click();
  await page.getByRole('button', { name: 'Invest' }).click();

  await page.getByTestId('invest-add-holding').click();
  await page.getByTestId('asset-type-cash').click();
  await page.getByLabel('Asset name').fill('Mobile emergency fund');
  await page.getByLabel('Target %').fill('100');
  await page.getByLabel('Current value (USD)').fill('25000');
  await page.getByRole('button', { name: 'Add to Portfolio' }).click();

  const mobileCard = page.getByTestId('invest-mobile-holding-CASH');
  await expect(mobileCard).toBeVisible();
  await expect(mobileCard).toContainText('Mobile emergency fund');
  await expect(mobileCard).toContainText('$25,000.00');
  await expect(mobileCard).toContainText('100.0% current');
  await expect(page.getByTestId('invest-desktop-holdings-header')).toBeHidden();

  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    panel: (() => {
      const panel = document.querySelector<HTMLElement>('[data-testid="invest-holdings-panel"]');
      return panel ? panel.scrollWidth - panel.clientWidth : 999;
    })(),
  }));
  expect(overflow.page).toBeLessThanOrEqual(1);
  expect(overflow.panel).toBeLessThanOrEqual(1);

  await mobileCard.click();
  const holding = page.getByTestId('invest-holding-CASH');
  await expect(holding.getByRole('button', { name: 'Edit Mobile emergency fund' })).toBeVisible();
  await expect(holding.getByRole('button', { name: 'Delete Mobile emergency fund' })).toBeVisible();

  // The existing dense table remains the large-screen presentation.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(mobileCard).toBeHidden();
  await expect(page.getByTestId('invest-desktop-holdings-header')).toBeVisible();
  await expect(page.getByTestId('invest-desktop-holdings-header')).toContainText('Current weight');
});
