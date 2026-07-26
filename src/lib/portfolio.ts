import { AssetType, Holding } from '../types';
import { assetClassForHolding, assetClassKey } from './assetClasses';

export interface HoldingRow {
  holding: Holding;
  value: number;
  actualPct: number; // 0 when totalValue is 0
  driftPct: number; // actualPct - targetPct
  tradeValue: number; // + = buy, - = sell
  tradeUnits: number | null; // null when price <= 0
}

export interface PortfolioSummary {
  totalValue: number;
  targetTotalPct: number;
  unallocatedPct: number; // negative = over-allocated
  maxAbsDriftPct: number;
  rows: HoldingRow[]; // input order preserved
  assetClasses: AssetClassRow[]; // one portfolio-wide classification, largest class first
}

export interface AssetClassRow {
  assetClass: string;
  value: number;
  actualPct: number; // share of the complete portfolio
  targetPct: number; // sum of member holding targets, as a share of the portfolio
  driftPct: number;
  rows: HoldingRow[];
}

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  market: 'Market investment',
  cash: 'Cash',
  home: 'Home',
  car: 'Car',
};

export function assetTypeForHolding(holding: Holding): AssetType {
  return holding.assetType ?? 'market';
}

export function isMarketHolding(holding: Holding): boolean {
  return assetTypeForHolding(holding) === 'market';
}

const noNegZero = (n: number): number => (n === 0 ? 0 : n);

export function computePortfolio(holdings: Holding[]): PortfolioSummary {
  const totalValue = holdings.reduce((sum, h) => sum + h.quantity * h.price, 0);
  const targetTotalPct = holdings.reduce((sum, h) => sum + h.targetPct, 0);
  const rows: HoldingRow[] = holdings.map((holding) => {
    const value = holding.quantity * holding.price;
    const actualPct = totalValue > 0 ? (value / totalValue) * 100 : 0;
    const tradeValue = noNegZero((holding.targetPct / 100) * totalValue - value);
    return {
      holding,
      value,
      actualPct,
      driftPct: noNegZero(actualPct - holding.targetPct),
      tradeValue,
      tradeUnits: holding.price > 0 ? noNegZero(tradeValue / holding.price) : null,
    };
  });
  const maxAbsDriftPct = rows.reduce((max, r) => Math.max(max, Math.abs(r.driftPct)), 0);
  const assetClassMap = new Map<string, { assetClass: string; value: number; targetPct: number; rows: HoldingRow[] }>();
  for (const row of rows) {
    const assetClass = assetClassForHolding(row.holding);
    const classKey = assetClassKey(assetClass);
    const classTotals = assetClassMap.get(classKey) ?? {
      assetClass,
      value: 0,
      targetPct: 0,
      rows: [],
    };
    classTotals.value += row.value;
    classTotals.targetPct += row.holding.targetPct;
    classTotals.rows.push(row);
    assetClassMap.set(classKey, classTotals);
  }
  const assetClasses = [...assetClassMap.values()]
    .map((totals): AssetClassRow => {
      const actualPct = totalValue > 0 ? (totals.value / totalValue) * 100 : 0;
      return {
        assetClass: totals.assetClass,
        value: totals.value,
        actualPct,
        targetPct: totals.targetPct,
        driftPct: noNegZero(actualPct - totals.targetPct),
        rows: totals.rows,
      };
    })
    .sort((a, b) => b.value - a.value || a.assetClass.localeCompare(b.assetClass));
  return {
    totalValue,
    targetTotalPct,
    unallocatedPct: 100 - targetTotalPct,
    maxAbsDriftPct,
    rows,
    assetClasses,
  };
}

/**
 * Target percentages that reproduce each holding's *current* weight, so that
 * applying them drives every drift to ~0 and the target total to exactly 100%.
 * Shares are rounded to a hundredth of a percent and the rounding remainder is
 * handed to the largest-fraction holdings, so the returned set still sums to
 * exactly 100. Keyed by holding id; holdings without an id, and every holding
 * when the portfolio has no value, are omitted (there is nothing to match).
 */
export function targetsMatchingCurrentWeights(holdings: Holding[]): Map<string, number> {
  const result = new Map<string, number>();
  const withId = holdings.filter((h): h is Holding & { id: string } => Boolean(h.id));
  const totalValue = withId.reduce((sum, h) => sum + h.quantity * h.price, 0);
  if (totalValue <= 0) return result;
  // Work in hundredths of a percent (integers) so the shares sum to exactly
  // 10000 (= 100.00%) after the largest-remainder pass — leaving every drift
  // below rounding noise instead of a visible residual on one holding.
  const SCALE = 10_000;
  const parts = withId.map(h => {
    const exact = ((h.quantity * h.price) / totalValue) * SCALE;
    const units = Math.floor(exact);
    return { id: h.id, units, remainder: exact - units };
  });
  let assigned = parts.reduce((sum, p) => sum + p.units, 0);
  // Hand each leftover hundredth to the largest fractional remainder in turn.
  const byRemainder = [...parts].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; assigned < SCALE && i < byRemainder.length; i += 1, assigned += 1) {
    byRemainder[i].units += 1;
  }
  for (const part of parts) result.set(part.id, part.units / 100);
  return result;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatMoney(value: number): string {
  return usd.format(noNegZero(value));
}

export function formatPct(value: number): string {
  const s = value.toFixed(1);
  return `${s === '-0.0' ? '0.0' : s}%`;
}

/** Up to 4 decimals (rounded), trailing zeros trimmed. */
export function formatUnits(value: number): string {
  const s = value.toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}
