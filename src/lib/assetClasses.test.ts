import { describe, expect, it } from 'vitest';
import { AssetClassDefinition, Holding } from '../types';
import {
  SYSTEM_ASSET_CLASSES,
  assetClassCatalogReconciliation,
  assetClassDefinitionForName,
  assetClassIdForName,
  assetClassMigrationForHolding,
  materializeHoldingAssetClasses,
  mergeAssetClassCatalog,
  validateAssetClassName,
} from './assetClasses';

const holding = (over: Partial<Holding>): Holding => ({
  symbol: 'BITSTAMP:BTCUSD',
  quantity: 1,
  price: 100,
  targetPct: 10,
  createdBy: 'u',
  authorName: 'A',
  createdAt: '',
  ...over,
});

describe('asset-class catalog', () => {
  it('has stable unique IDs and normalized names for every default class', () => {
    expect(new Set(SYSTEM_ASSET_CLASSES.map(definition => definition.id)).size)
      .toBe(SYSTEM_ASSET_CLASSES.length);
    expect(new Set(SYSTEM_ASSET_CLASSES.map(definition => definition.normalizedName)).size)
      .toBe(SYSTEM_ASSET_CLASSES.length);
    expect(SYSTEM_ASSET_CLASSES.find(definition => definition.id === 'crypto')?.name).toBe('Crypto');
    expect(SYSTEM_ASSET_CLASSES.find(definition => definition.id === 'cash-equivalents')?.name)
      .toBe('Cash & Cash Equivalents');
  });

  it('maps every legacy Crypto spelling to the one permanent crypto ID', () => {
    for (const label of [
      'Crypto',
      ' crypto ',
      'Cryptocurrency',
      'Digital Assets',
      'Crypto\u200B',
      'Crypto\\u200B',
      'Ｃｒｙｐｔｏ',
      'Сrуptо',
    ]) {
      expect(assetClassIdForName(label)).toBe('crypto');
      expect(assetClassDefinitionForName(label)).toMatchObject({ id: 'crypto', name: 'Crypto' });
    }
  });

  it('deduplicates malformed stored definitions with defaults taking precedence', () => {
    const stored: AssetClassDefinition[] = [
      { id: 'random-one', name: 'Crypto', normalizedName: 'crypto', isDefault: false, sortOrder: 1 },
      { id: 'random-two', name: 'Cryptocurrency', normalizedName: 'cryptocurrency', isDefault: false, sortOrder: 2 },
      { id: 'custom-space', name: '  Venture Capital ', normalizedName: 'wrong', isDefault: false, sortOrder: 1000 },
      { id: 'custom-duplicate', name: 'venture capital', normalizedName: 'venture capital', isDefault: false, sortOrder: 1001 },
    ];

    const catalog = mergeAssetClassCatalog(stored);
    expect(catalog.filter(definition => definition.name === 'Crypto')).toHaveLength(1);
    expect(catalog.find(definition => definition.name === 'Crypto')?.id).toBe('crypto');
    expect(catalog.filter(definition => definition.name === 'Venture Capital')).toHaveLength(1);
    expect(catalog.find(definition => definition.name === 'Venture Capital')?.id)
      .toBe(assetClassIdForName('Venture Capital'));
  });

  it('repairs duplicate class documents to one deterministic ID', () => {
    const repair = assetClassCatalogReconciliation([
      {
        id: 'legacy-crypto-one',
        name: 'Cryptocurrency',
        normalizedName: 'cryptocurrency',
        isDefault: false,
        sortOrder: 900,
      },
      {
        id: 'legacy-crypto-two',
        name: 'Crypto\u200B',
        normalizedName: 'crypto hidden',
        isDefault: false,
        sortOrder: 901,
      },
    ]);

    expect(repair.upserts.some(definition => definition.id === 'crypto')).toBe(true);
    expect(repair.deleteIds).toEqual(['legacy-crypto-one', 'legacy-crypto-two']);
    expect(repair.idRemap).toEqual({
      'legacy-crypto-one': 'crypto',
      'legacy-crypto-two': 'crypto',
    });
  });

  it('migrates legacy holdings to IDs while leaving canonical holdings alone', () => {
    const catalog = mergeAssetClassCatalog([]);
    const legacy = holding({ category: 'Cryptocurrency', assetClass: 'Unclassified' });
    const canonical = holding({
      assetClassId: 'crypto',
      assetClass: 'Crypto',
      category: 'Crypto',
    });

    expect(assetClassMigrationForHolding(legacy, catalog)).toMatchObject({
      definition: { id: 'crypto', name: 'Crypto' },
      holdingPatch: { assetClassId: 'crypto', assetClass: 'Crypto', category: 'Crypto' },
    });
    expect(assetClassMigrationForHolding(canonical, catalog).holdingPatch).toBeNull();
  });

  it('trusts a referenced legacy definition over a stale holding label', () => {
    const stored: AssetClassDefinition[] = [{
      id: 'legacy-crypto',
      name: 'Cryptocurrency',
      normalizedName: 'cryptocurrency',
      isDefault: false,
      sortOrder: 900,
    }];
    const catalog = mergeAssetClassCatalog(stored);
    const stale = holding({
      assetClassId: 'legacy-crypto',
      assetClass: 'Unclassified',
      category: 'Investments',
    });

    expect(assetClassMigrationForHolding(stale, catalog, stored)).toMatchObject({
      definition: { id: 'crypto', name: 'Crypto' },
      holdingPatch: { assetClassId: 'crypto', assetClass: 'Crypto', category: 'Crypto' },
    });
  });

  it('creates one deterministic database identity for a valid custom class', () => {
    const first = assetClassDefinitionForName('Venture Capital', 'u', '2026-07-14T12:00:00.000Z');
    const second = assetClassDefinitionForName(' venture   capital ');
    expect(first.id).toBe(second.id);
    expect(first).toMatchObject({
      name: 'Venture Capital',
      normalizedName: 'venture capital',
      isDefault: false,
      createdBy: 'u',
    });
    expect(validateAssetClassName('')).toBe('Enter an asset class name.');
    expect(validateAssetClassName('x'.repeat(51))).toContain('at most 50');
  });

  it('materializes catalog names before portfolio grouping', () => {
    const catalog = mergeAssetClassCatalog([]);
    const materialized = materializeHoldingAssetClasses([
      holding({ assetClass: 'Cryptocurrency' }),
      holding({ assetClass: 'Crypto\\u200B' }),
    ], catalog);
    expect(materialized.map(item => [item.assetClassId, item.assetClass])).toEqual([
      ['crypto', 'Crypto'],
      ['crypto', 'Crypto'],
    ]);
  });
});
