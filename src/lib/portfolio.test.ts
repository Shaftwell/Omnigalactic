import { describe, it, expect } from 'vitest';
import {
  computePortfolio,
  formatMoney,
  formatPct,
  formatUnits,
  targetsMatchingCurrentWeights,
} from './portfolio';
import { assetClassRepairForHolding, canonicalizeAssetClass } from './assetClasses';
import { Holding } from '../types';

const holding = (over: Partial<Holding>): Holding => ({
  symbol: 'NASDAQ:AAPL',
  quantity: 0,
  price: 0,
  targetPct: 0,
  createdBy: 'u',
  authorName: 'A',
  createdAt: '',
  ...over,
});

describe('computePortfolio', () => {
  it('computes values, weights, drift and trades for a normal portfolio', () => {
    const summary = computePortfolio([
      holding({ symbol: 'NASDAQ:AAPL', quantity: 10, price: 100, targetPct: 50 }),
      holding({ symbol: 'NASDAQ:MSFT', quantity: 5, price: 200, targetPct: 30 }),
      holding({ symbol: 'BITSTAMP:BTCUSD', quantity: 0.5, price: 2000, targetPct: 20 }),
    ]);

    expect(summary.totalValue).toBe(3000);
    expect(summary.targetTotalPct).toBe(100);
    expect(summary.unallocatedPct).toBe(0);
    expect(summary.maxAbsDriftPct).toBeCloseTo(16.6667, 3);

    const [aapl, msft, btc] = summary.rows;
    expect(aapl.value).toBe(1000);
    expect(aapl.actualPct).toBeCloseTo(33.3333, 3);
    expect(aapl.driftPct).toBeCloseTo(-16.6667, 3);
    expect(aapl.tradeValue).toBeCloseTo(500);
    expect(aapl.tradeUnits).toBeCloseTo(5);

    expect(msft.tradeValue).toBeCloseTo(-100);
    expect(msft.tradeUnits).toBeCloseTo(-0.5);

    expect(btc.driftPct).toBeCloseTo(13.3333, 3);
    expect(btc.tradeValue).toBeCloseTo(-400);
    expect(btc.tradeUnits).toBeCloseTo(-0.2);
  });

  it('preserves input order in rows', () => {
    const summary = computePortfolio([
      holding({ symbol: 'Z', quantity: 1, price: 1 }),
      holding({ symbol: 'A', quantity: 2, price: 2 }),
      holding({ symbol: 'M', quantity: 3, price: 3 }),
    ]);
    expect(summary.rows.map((r) => r.holding.symbol)).toEqual(['Z', 'A', 'M']);
  });

  it('handles an empty portfolio', () => {
    const summary = computePortfolio([]);
    expect(summary.totalValue).toBe(0);
    expect(summary.targetTotalPct).toBe(0);
    expect(summary.unallocatedPct).toBe(100);
    expect(summary.maxAbsDriftPct).toBe(0);
    expect(summary.rows).toEqual([]);
    expect(summary.assetClasses).toEqual([]);
  });

  it('uses one unified asset-class breakdown with backward-compatible defaults', () => {
    const summary = computePortfolio([
      holding({ symbol: 'NASDAQ:AAPL', quantity: 10, price: 100, targetPct: 20, category: 'Investments', assetClass: 'Equity' }),
      holding({ symbol: 'BITSTAMP:BTCUSD', quantity: 1, price: 1000, targetPct: 20, category: 'Crypto', assetClass: 'Unclassified' }),
      holding({ symbol: 'CASH', assetType: 'cash', name: 'Emergency fund', quantity: 1, price: 2000, targetPct: 20, category: 'Reserves', assetClass: 'Short-Term Reserves' }),
      holding({ symbol: 'HOME', assetType: 'home', name: 'Home equity', quantity: 1, price: 5000, targetPct: 30 }),
      holding({ symbol: 'CAR', assetType: 'car', name: 'Tesla', quantity: 1, price: 1000, targetPct: 10 }),
      holding({ symbol: 'NYSE:LEGACY', quantity: 1, price: 0, targetPct: 0 }),
    ]);

    expect(summary.totalValue).toBe(10_000);
    // The cash asset's explicit 'Short-Term Reserves' class is respected;
    // Cash & Cash Equivalents is only the DEFAULT for unclassified cash.
    expect(summary.assetClasses.map(row => row.assetClass)).toEqual([
      'Real Estate', 'Short-Term Reserves', 'Crypto', 'Equity', 'Vehicle', 'Unclassified',
    ]);
    expect(summary.assetClasses.find(row => row.assetClass === 'Equity')).toMatchObject({
      value: 1000,
      actualPct: 10,
      targetPct: 20,
      driftPct: -10,
    });
    expect(summary.assetClasses.find(row => row.assetClass === 'Short-Term Reserves')?.rows[0].holding.name)
      .toBe('Emergency fund');
    expect(summary.assetClasses.find(row => row.assetClass === 'Crypto')?.rows[0].holding.symbol)
      .toBe('BITSTAMP:BTCUSD');
  });

  it('combines Cash, Cash Equivalent, and manual cash in one class', () => {
    const summary = computePortfolio([
      holding({ symbol: 'NASDAQ:AAPL', quantity: 1, price: 2000, targetPct: 40, assetClass: 'Equity' }),
      holding({ symbol: 'BITSTAMP:USDCUSD', quantity: 1000, price: 1, targetPct: 20, assetClass: 'Cash Equivalent' }),
      holding({ symbol: 'AMEX:BIL', quantity: 10, price: 100, targetPct: 20, assetClass: ' cash & cash equivalents\u200B ' }),
      holding({ symbol: 'CASH', assetType: 'cash', quantity: 1, price: 1000, targetPct: 20, category: 'Cash', assetClass: 'Cash' }),
    ]);

    expect(summary.assetClasses.find(row => row.assetClass === 'Equity')).toMatchObject({
      value: 2000,
      targetPct: 40,
    });
    const cashEquivalent = summary.assetClasses.find(row => row.assetClass === 'Cash & Cash Equivalents');
    expect(cashEquivalent).toMatchObject({
      value: 3000,
      targetPct: 60,
    });
    expect(cashEquivalent?.actualPct).toBe(60);
    expect(cashEquivalent?.driftPct).toBe(0);
    expect(cashEquivalent?.rows).toHaveLength(3);
  });

  it('deduplicates visually identical and legacy Crypto labels', () => {
    const summary = computePortfolio([
      holding({ symbol: 'BITSTAMP:BTCUSD', quantity: 1, price: 100, targetPct: 10, assetClass: 'Crypto' }),
      holding({ symbol: 'NASDAQ:MSTR', quantity: 1, price: 200, targetPct: 20, assetClass: ' crypto ' }),
      holding({ symbol: 'AMEX:IBIT', quantity: 1, price: 300, targetPct: 30, assetClass: 'Crypto\u200B' }),
      holding({ symbol: 'COINBASE:ETHUSD', quantity: 1, price: 400, targetPct: 40, category: 'Cryptocurrency', assetClass: 'Unclassified' }),
    ]);

    expect(summary.assetClasses).toHaveLength(1);
    expect(summary.assetClasses[0]).toMatchObject({
      assetClass: 'Crypto',
      value: 1000,
      targetPct: 100,
    });
    expect(summary.assetClasses[0].rows).toHaveLength(4);
  });

  it('deduplicates escaped, full-width, and lookalike Crypto labels', () => {
    const summary = computePortfolio([
      holding({ symbol: 'A', quantity: 1, price: 100, targetPct: 20, assetClass: 'Crypto\\u200B' }),
      holding({ symbol: 'B', quantity: 1, price: 200, targetPct: 20, assetClass: 'Ｃｒｙｐｔｏ' }),
      holding({ symbol: 'C', quantity: 1, price: 300, targetPct: 20, assetClass: 'Сrуptо' }),
      holding({ symbol: 'D', quantity: 1, price: 400, targetPct: 20, assetClass: 'Cryptocurrency' }),
      holding({ symbol: 'E', quantity: 1, price: 500, targetPct: 20, assetClass: 'Digital Assets' }),
    ]);

    expect(summary.assetClasses).toHaveLength(1);
    expect(summary.assetClasses[0]).toMatchObject({
      assetClass: 'Crypto',
      value: 1500,
      targetPct: 100,
    });
    expect(summary.assetClasses[0].rows).toHaveLength(5);
  });

  it('returns the one canonical classification patch only for legacy documents', () => {
    const legacyCrypto = holding({ category: 'Cryptocurrency', assetClass: 'Unclassified' });
    const malformedCrypto = holding({ category: 'Сrуptо', assetClass: 'Crypto\\u200B' });
    const canonicalCrypto = holding({ category: 'Crypto', assetClass: 'Crypto' });
    const manualCash = holding({ assetType: 'cash', category: 'Cash', assetClass: 'Cash Equivalent' });

    expect(assetClassRepairForHolding(legacyCrypto)).toEqual({ category: 'Crypto', assetClass: 'Crypto' });
    expect(assetClassRepairForHolding(malformedCrypto)).toEqual({ category: 'Crypto', assetClass: 'Crypto' });
    expect(assetClassRepairForHolding(canonicalCrypto)).toBeNull();
    expect(assetClassRepairForHolding(manualCash)).toEqual({
      category: 'Cash & Cash Equivalents',
      assetClass: 'Cash & Cash Equivalents',
    });
    expect(canonicalizeAssetClass('Crypto\\u{200B}')).toBe('Crypto');
  });

  it('preserves accented custom labels while still folding true lookalikes', () => {
    // Diacritics are meaning, not noise: these must never become alias hits.
    expect(canonicalizeAssetClass('Öther')).toBe('Öther');
    expect(canonicalizeAssetClass('Cásh')).toBe('Cásh');
    expect(canonicalizeAssetClass('Équity')).toBe('Équity');
    // Cyrillic/Greek lookalikes of known aliases still collapse.
    expect(canonicalizeAssetClass('Сrуptо')).toBe('Crypto');
    // A repair must never rewrite an accented custom label.
    expect(assetClassRepairForHolding(holding({ category: 'Öther', assetClass: 'Öther' }))).toBeNull();
  });

  it('keeps a custom class on manual cash and repairs only the legacy mirror field', () => {
    const classifiedCash = holding({ assetType: 'cash', category: 'Short-Term Reserves', assetClass: 'Short-Term Reserves' });
    expect(assetClassRepairForHolding(classifiedCash)).toBeNull();
    const mismatchedCash = holding({ assetType: 'cash', category: 'Cash', assetClass: 'Short-Term Reserves' });
    expect(assetClassRepairForHolding(mismatchedCash)).toEqual({
      category: 'Short-Term Reserves',
      assetClass: 'Short-Term Reserves',
    });
    // Unclassified cash still defaults into the unified class.
    expect(assetClassRepairForHolding(holding({ assetType: 'cash' }))).toEqual({
      category: 'Cash & Cash Equivalents',
      assetClass: 'Cash & Cash Equivalents',
    });
  });

  it('skips repairs whose canonical label breaks the Firestore length bound', () => {
    // NFKC expands '㍿' to 株式会社 (4 chars), so 20 of them exceed 50 chars.
    const expanding = holding({ assetClass: '㍿'.repeat(20), category: 'Legacy' });
    expect(assetClassRepairForHolding(expanding)).toBeNull();
    // Read-time grouping still works even though the doc is left untouched.
    const summary = computePortfolio([expanding]);
    expect(summary.assetClasses).toHaveLength(1);
  });

  it('handles zero total value without NaN or -0', () => {
    const summary = computePortfolio([
      holding({ symbol: 'A', quantity: 0, price: 10, targetPct: 60 }),
      holding({ symbol: 'B', quantity: 5, price: 0, targetPct: 40 }),
    ]);
    expect(summary.totalValue).toBe(0);
    const [a, b] = summary.rows;
    expect(a.actualPct).toBe(0);
    expect(a.driftPct).toBe(-60);
    expect(Object.is(a.tradeValue, 0)).toBe(true);
    expect(Object.is(a.tradeUnits, 0)).toBe(true);
    expect(b.actualPct).toBe(0);
    expect(b.tradeUnits).toBeNull();
  });

  it('returns null tradeUnits for a zero-price holding in a non-empty portfolio', () => {
    const summary = computePortfolio([
      holding({ symbol: 'A', quantity: 10, price: 100, targetPct: 80 }),
      holding({ symbol: 'B', quantity: 3, price: 0, targetPct: 20 }),
    ]);
    const [a, b] = summary.rows;
    expect(b.value).toBe(0);
    expect(b.tradeValue).toBeCloseTo(200);
    expect(b.tradeUnits).toBeNull();
    expect(a.tradeUnits).toBeCloseTo(-2);
  });

  it('reports over- and under-allocated targets via unallocatedPct', () => {
    const over = computePortfolio([
      holding({ quantity: 1, price: 1, targetPct: 70 }),
      holding({ quantity: 1, price: 1, targetPct: 50 }),
    ]);
    expect(over.targetTotalPct).toBe(120);
    expect(over.unallocatedPct).toBe(-20);

    const under = computePortfolio([holding({ quantity: 1, price: 1, targetPct: 40 })]);
    expect(under.unallocatedPct).toBe(60);
  });

  it('never produces -0 in row fields', () => {
    const summary = computePortfolio([
      holding({ symbol: 'A', quantity: 2, price: 50, targetPct: 100 }),
      holding({ symbol: 'B', quantity: 0, price: 25, targetPct: 0 }),
    ]);
    for (const row of summary.rows) {
      expect(Object.is(row.actualPct, -0)).toBe(false);
      expect(Object.is(row.driftPct, -0)).toBe(false);
      expect(Object.is(row.tradeValue, -0)).toBe(false);
      expect(Object.is(row.tradeUnits, -0)).toBe(false);
    }
  });

  it('weights sum to ~100 despite floating point', () => {
    const summary = computePortfolio([
      holding({ quantity: 3.7, price: 173.13, targetPct: 33.3 }),
      holding({ quantity: 0.0421, price: 61234.55, targetPct: 33.3 }),
      holding({ quantity: 12, price: 7.77, targetPct: 33.4 }),
    ]);
    const sum = summary.rows.reduce((acc, r) => acc + r.actualPct, 0);
    expect(sum).toBeCloseTo(100, 9);
  });
});

describe('targetsMatchingCurrentWeights', () => {
  it('sets each target to the holding’s current weight', () => {
    const targets = targetsMatchingCurrentWeights([
      holding({ id: 'a', quantity: 3, price: 1000, targetPct: 10 }), // $3000 = 60%
      holding({ id: 'b', quantity: 2, price: 1000, targetPct: 90 }), // $2000 = 40%
    ]);
    expect(targets.get('a')).toBe(60);
    expect(targets.get('b')).toBe(40);
  });

  it('drives the resulting portfolio to zero drift and a 100% target total', () => {
    const holdings = [
      holding({ id: 'a', quantity: 3.7, price: 173.13, targetPct: 12 }),
      holding({ id: 'b', quantity: 0.0421, price: 61234.55, targetPct: 71 }),
      holding({ id: 'c', quantity: 12, price: 7.77, targetPct: 4 }),
    ];
    const targets = targetsMatchingCurrentWeights(holdings);
    const applied = holdings.map(h => ({ ...h, targetPct: targets.get(h.id!)! }));
    const summary = computePortfolio(applied);
    // Sums to exactly 100 (largest-remainder), and every drift rounds to 0.0%.
    expect(summary.targetTotalPct).toBeCloseTo(100, 9);
    for (const row of summary.rows) {
      expect(formatPct(row.driftPct)).toBe('0.0%');
    }
  });

  it('splits three equal holdings so the hundredths still total 100', () => {
    const targets = targetsMatchingCurrentWeights([
      holding({ id: 'a', quantity: 1, price: 100, targetPct: 0 }),
      holding({ id: 'b', quantity: 1, price: 100, targetPct: 0 }),
      holding({ id: 'c', quantity: 1, price: 100, targetPct: 0 }),
    ]);
    const values = ['a', 'b', 'c'].map(id => targets.get(id)!);
    expect(values.reduce((sum, v) => sum + v, 0)).toBeCloseTo(100, 9);
    // Every value stays within a hundredth of the exact 33.333…% weight.
    for (const value of values) expect(Math.abs(value - 100 / 3)).toBeLessThanOrEqual(0.01);
  });

  it('includes manual assets and zero-value holdings in the match', () => {
    const targets = targetsMatchingCurrentWeights([
      holding({ id: 'stock', quantity: 1, price: 7500, targetPct: 100 }), // 75%
      holding({ id: 'home', assetType: 'home', quantity: 1, price: 2500, targetPct: 0 }), // 25%
      holding({ id: 'empty', quantity: 5, price: 0, targetPct: 40 }), // 0%
    ]);
    expect(targets.get('stock')).toBe(75);
    expect(targets.get('home')).toBe(25);
    expect(targets.get('empty')).toBe(0);
  });

  it('returns an empty map when the portfolio has no value', () => {
    expect(targetsMatchingCurrentWeights([
      holding({ id: 'a', quantity: 0, price: 100, targetPct: 50 }),
      holding({ id: 'b', quantity: 3, price: 0, targetPct: 50 }),
    ]).size).toBe(0);
    expect(targetsMatchingCurrentWeights([]).size).toBe(0);
  });

  it('omits holdings that have no id (nothing writable to match)', () => {
    const targets = targetsMatchingCurrentWeights([
      holding({ id: 'a', quantity: 1, price: 100, targetPct: 0 }),
      holding({ quantity: 1, price: 100, targetPct: 0 }),
    ]);
    // Only the id-bearing holding is returned, weighted against that same set.
    expect([...targets.keys()]).toEqual(['a']);
    expect(targets.get('a')).toBe(100);
  });
});

describe('formatMoney', () => {
  it('formats with dollar sign and thousands separators', () => {
    expect(formatMoney(1234.56)).toBe('$1,234.56');
    expect(formatMoney(0.5)).toBe('$0.50');
  });

  it('formats negatives with a leading minus', () => {
    expect(formatMoney(-12.34)).toBe('-$12.34');
  });

  it('normalizes zero and -0', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(-0)).toBe('$0.00');
  });
});

describe('formatPct', () => {
  it('renders one decimal place', () => {
    expect(formatPct(12.3)).toBe('12.3%');
    expect(formatPct(12.36)).toBe('12.4%');
    expect(formatPct(100)).toBe('100.0%');
    expect(formatPct(-5)).toBe('-5.0%');
  });

  it('never renders -0.0%', () => {
    expect(formatPct(0)).toBe('0.0%');
    expect(formatPct(-0)).toBe('0.0%');
    expect(formatPct(-0.04)).toBe('0.0%');
  });
});

describe('formatUnits', () => {
  it('trims trailing zeros', () => {
    expect(formatUnits(1.5)).toBe('1.5');
    expect(formatUnits(2)).toBe('2');
    expect(formatUnits(0.12)).toBe('0.12');
  });

  it('rounds to 4 decimals', () => {
    expect(formatUnits(0.12345)).toBe('0.1235');
    expect(formatUnits(1.00004)).toBe('1');
    expect(formatUnits(-0.56789)).toBe('-0.5679');
  });

  it('never renders -0', () => {
    expect(formatUnits(0)).toBe('0');
    expect(formatUnits(-0)).toBe('0');
    expect(formatUnits(-0.00001)).toBe('0');
  });
});
