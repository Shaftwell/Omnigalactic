import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generatePortfolioPine, PINE_MAX_HOLDINGS, PineHolding } from './pine';

const sample: PineHolding[] = [
  { symbol: 'NASDAQ:AAPL', quantity: 10, targetPct: 40 },
  { symbol: 'AMEX:SPY', quantity: 5, targetPct: 35 },
  { symbol: 'BITSTAMP:BTCUSD', quantity: 0.25, targetPct: 25 },
];

const holding = (over: Partial<PineHolding>): PineHolding => ({
  symbol: 'NASDAQ:AAPL',
  quantity: 1,
  targetPct: 100,
  ...over,
});

describe('generatePortfolioPine', () => {
  it('matches the committed sample script byte-for-byte', () => {
    // vitest runs from the repo root (see vitest.config.ts).
    const committed = readFileSync(resolve('pine/portfolio-allocation.pine'), 'utf8');
    expect(generatePortfolioPine(sample)).toBe(committed);
  });

  it('throws on an empty portfolio', () => {
    expect(() => generatePortfolioPine([])).toThrow();
  });

  it('enforces the request.security budget', () => {
    expect(PINE_MAX_HOLDINGS).toBe(38);
    const many = Array.from({ length: PINE_MAX_HOLDINGS + 1 }, (_, i) =>
      holding({ symbol: `NASDAQ:S${i}`, targetPct: 0 })
    );
    expect(() => generatePortfolioPine(many)).toThrow();
    expect(() => generatePortfolioPine(many.slice(0, PINE_MAX_HOLDINGS))).not.toThrow();
  });

  it('puts //@version=6 before any code and declares a non-overlay indicator', () => {
    const lines = generatePortfolioPine(sample).split('\n');
    const versionAt = lines.indexOf('//@version=6');
    expect(versionAt).toBeGreaterThanOrEqual(0);
    for (const line of lines.slice(0, versionAt)) {
      expect(line === '' || line.startsWith('//')).toBe(true);
    }
    expect(lines[versionAt + 1]).toBe('indicator("Omnigalactic Portfolio Allocation", overlay=false)');
  });

  it('emits one request.security string-literal call per holding', () => {
    const out = generatePortfolioPine(sample);
    expect(out.match(/request\.security\(/g)).toHaveLength(sample.length);
    for (const h of sample) {
      expect(out).toContain(`request.security("${h.symbol}", timeframe.period, close)`);
    }
  });

  it('escapes quotes and backslashes in symbols and title', () => {
    const out = generatePortfolioPine([holding({ symbol: 'WE"IRD\\X' })], { title: 'My "Fund"' });
    expect(out).toContain('request.security("WE\\"IRD\\\\X", timeframe.period, close)');
    expect(out).toContain('indicator("My \\"Fund\\"", overlay=false)');
  });

  it('bakes the drift threshold into the script and its alert', () => {
    const out = generatePortfolioPine(sample);
    expect(out).toContain('driftThreshold = 5');
    expect(out).toContain('alertcondition(maxAbsDrift > driftThreshold');
    expect(out).toContain('more than 5%');
    const custom = generatePortfolioPine(sample, { driftThresholdPct: 12.5 });
    expect(custom).toContain('driftThreshold = 12.5');
    expect(custom).toContain('more than 12.5%');
  });

  it('sizes the table for header, holdings and TOTAL rows', () => {
    const out = generatePortfolioPine(sample);
    expect(out).toContain(`var table t = table.new(position.top_right, 7, ${sample.length + 2}`);
    expect(out).toContain('"TOTAL"');
    expect(out).toContain('if barstate.islast');
  });
});
