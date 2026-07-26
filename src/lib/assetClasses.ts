import { AssetClassDefinition, AssetType, Holding } from '../types';

export const SYSTEM_ASSET_CLASSES: readonly AssetClassDefinition[] = [
  { id: 'cash-equivalents', name: 'Cash & Cash Equivalents', normalizedName: 'cash and cash equivalents', isDefault: true, sortOrder: 10 },
  { id: 'stocks', name: 'Stocks', normalizedName: 'stocks', isDefault: true, sortOrder: 20 },
  { id: 'etf', name: 'ETF', normalizedName: 'etf', isDefault: true, sortOrder: 30 },
  { id: 'equity', name: 'Equity', normalizedName: 'equity', isDefault: true, sortOrder: 40 },
  { id: 'fixed-income', name: 'Fixed Income', normalizedName: 'fixed income', isDefault: true, sortOrder: 50 },
  { id: 'crypto', name: 'Crypto', normalizedName: 'crypto', isDefault: true, sortOrder: 60 },
  { id: 'commodity', name: 'Commodity', normalizedName: 'commodity', isDefault: true, sortOrder: 70 },
  { id: 'precious-metals', name: 'Precious Metals', normalizedName: 'precious metals', isDefault: true, sortOrder: 80 },
  { id: 'real-estate', name: 'Real Estate', normalizedName: 'real estate', isDefault: true, sortOrder: 90 },
  { id: 'vehicle', name: 'Vehicle', normalizedName: 'vehicle', isDefault: true, sortOrder: 100 },
  { id: 'other', name: 'Other', normalizedName: 'other', isDefault: true, sortOrder: 110 },
  { id: 'unclassified', name: 'Unclassified', normalizedName: 'unclassified', isDefault: true, sortOrder: 120 },
] as const;

export const DEFAULT_ASSET_CLASS_IDS: Record<AssetType, string> = {
  market: 'unclassified',
  cash: 'cash-equivalents',
  home: 'real-estate',
  car: 'vehicle',
};

const systemById = new Map(SYSTEM_ASSET_CLASSES.map(definition => [definition.id, definition]));
const systemByName = new Map(SYSTEM_ASSET_CLASSES.map(definition => [definition.normalizedName, definition]));

// Firestore contains labels written by several generations of the UI. Some
// values also contain copied Unicode format characters or the literal text
// "\\u200B". Strip both forms before a label can become a grouping key.
const INVISIBLE_CHARACTERS = /\p{Default_Ignorable_Code_Point}/gu;
const SINGLE_INVISIBLE_CHARACTER = /\p{Default_Ignorable_Code_Point}/u;
const ESCAPED_UNICODE_CHARACTER = /\\u(?:\{([0-9a-f]{1,6})\}|([0-9a-f]{4}))/gi;

const removeEscapedInvisibleCharacters = (value: string): string => value.replace(
  ESCAPED_UNICODE_CHARACTER,
  (match, bracedCodePoint: string | undefined, fixedCodePoint: string | undefined) => {
    const codePoint = Number.parseInt(bracedCodePoint ?? fixedCodePoint, 16);
    if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) return match;
    const character = String.fromCodePoint(codePoint);
    return SINGLE_INVISIBLE_CHARACTER.test(character) ? '' : match;
  },
);

const cleanClassLabel = (value: string): string => removeEscapedInvisibleCharacters(String(value ?? ''))
  .normalize('NFKC')
  .replace(INVISIBLE_CHARACTERS, '')
  .replace(/\s+/g, ' ')
  .trim();

export function assetClassKey(value: string): string {
  const cleaned = cleanClassLabel(value).toLocaleLowerCase('en-US');
  const semanticKey = cleaned
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return semanticKey || cleaned;
}

const CANONICAL_ASSET_CLASSES: Record<string, string> = {
  cash: 'Cash & Cash Equivalents',
  'cash equivalent': 'Cash & Cash Equivalents',
  'cash equivalents': 'Cash & Cash Equivalents',
  'cash and cash equivalent': 'Cash & Cash Equivalents',
  'cash and cash equivalents': 'Cash & Cash Equivalents',
  crypto: 'Crypto',
  cryptocurrency: 'Crypto',
  cryptocurrencies: 'Crypto',
  'digital asset': 'Crypto',
  'digital assets': 'Crypto',
  stock: 'Stocks',
  stocks: 'Stocks',
  etf: 'ETF',
  etfs: 'ETF',
  equity: 'Equity',
  equities: 'Equity',
  commodity: 'Commodity',
  commodities: 'Commodity',
  'precious metal': 'Precious Metals',
  'precious metals': 'Precious Metals',
  'real estate': 'Real Estate',
  vehicle: 'Vehicle',
  vehicles: 'Vehicle',
  car: 'Vehicle',
  cars: 'Vehicle',
  'fixed income': 'Fixed Income',
  other: 'Other',
  unclassified: 'Unclassified',
};

// A small, deliberately conservative confusable map is used only while
// matching the known aliases above. It catches labels such as "Сrуptо" that
// look exactly like "Crypto" but contain Cyrillic or Greek letters. Custom
// class names keep their original script and are never transliterated.
const ALIAS_CONFUSABLES: Record<string, string> = {
  '\u0421': 'c', '\u0441': 'c', '\u03F9': 'c', '\u03F2': 'c',
  '\u041A': 'k', '\u043A': 'k', '\u039A': 'k', '\u03BA': 'k',
  '\u0420': 'p', '\u0440': 'p', '\u03A1': 'p', '\u03C1': 'p',
  '\u0422': 't', '\u0442': 't', '\u03A4': 't', '\u03C4': 't',
  '\u041E': 'o', '\u043E': 'o', '\u039F': 'o', '\u03BF': 'o',
  '\u0423': 'y', '\u0443': 'y', '\u03A5': 'y', '\u03C5': 'y',
};

// Confusable folding only — no diacritic stripping. NFKD + mark removal
// would turn accented labels a user typed on purpose ("Öther", "Cásh") into
// alias hits and the migration would then rewrite them permanently.
const canonicalAliasKey = (value: string): string =>
  [...assetClassKey(value)]
    .map(character => ALIAS_CONFUSABLES[character] ?? character)
    .join('');

const GENERIC_LEGACY_CLASS_KEYS = new Set(['investment', 'investments', 'market', 'portfolio', 'assets']);

export function canonicalizeAssetClass(value: string): string {
  const cleaned = cleanClassLabel(value);
  return CANONICAL_ASSET_CLASSES[canonicalAliasKey(cleaned)] ?? cleaned;
}

export function assetClassForHolding(holding: Holding): string {
  const assetType = holding.assetType ?? 'market';

  // An explicitly stored class always wins — including on manually valued
  // Cash assets, which merely DEFAULT into the unified cash class below.
  const explicitClass = canonicalizeAssetClass(holding.assetClass ?? '');
  if (explicitClass && assetClassKey(explicitClass) !== 'unclassified') return explicitClass;

  // `category` was the original classification field. Use a meaningful legacy
  // value when no specific asset class was saved, but ignore old umbrella
  // defaults so "Investments" does not replace the honest "Unclassified".
  const legacyClass = canonicalizeAssetClass(holding.category ?? '');
  if (legacyClass && !GENERIC_LEGACY_CLASS_KEYS.has(assetClassKey(legacyClass))) return legacyClass;

  return explicitClass || defaultAssetClassForType(assetType).name;
}

export interface AssetClassRepair {
  assetClass: string;
  category: string;
}

export const MAX_ASSET_CLASS_LENGTH = 50;

// Kept as a compatibility helper for older tests/callers. Current clients use
// assetClassMigrationForHolding so the stable ID is repaired at the same time.
export function assetClassRepairForHolding(holding: Holding): AssetClassRepair | null {
  const assetClass = assetClassForHolding(holding);
  if (!assetClass || assetClass.length > MAX_ASSET_CLASS_LENGTH) return null;
  if (holding.assetClass === assetClass && holding.category === assetClass) return null;
  return { assetClass, category: assetClass };
}

export function assetClassIdForName(value: string): string {
  const canonicalName = canonicalizeAssetClass(value);
  const normalizedName = assetClassKey(canonicalName);
  const system = systemByName.get(normalizedName);
  if (system) return system.id;
  // encodeURIComponent makes punctuation and slashes safe in a Firestore
  // document ID while preserving a deterministic one-name/one-ID mapping.
  return `custom-${encodeURIComponent(normalizedName)}`;
}

export function assetClassDefinitionForName(
  value: string,
  createdBy?: string,
  createdAt?: string,
  sortOrder = 1000,
): AssetClassDefinition {
  const name = canonicalizeAssetClass(value);
  const normalizedName = assetClassKey(name);
  const system = systemByName.get(normalizedName);
  if (system) return system;
  return {
    id: assetClassIdForName(name),
    name,
    normalizedName,
    isDefault: false,
    sortOrder,
    ...(createdBy ? { createdBy } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

export function validateAssetClassName(value: string): string | null {
  const name = canonicalizeAssetClass(value);
  if (!name) return 'Enter an asset class name.';
  if (name.length > MAX_ASSET_CLASS_LENGTH) {
    return `Asset class names can be at most ${MAX_ASSET_CLASS_LENGTH} characters.`;
  }
  return null;
}

// Defaults always win. Stored custom definitions are also deduplicated by
// normalized name, so even a malformed database cannot produce two Crypto
// rows or two visually equivalent custom classes.
export function mergeAssetClassCatalog(stored: AssetClassDefinition[]): AssetClassDefinition[] {
  const byNormalizedName = new Map<string, AssetClassDefinition>(
    SYSTEM_ASSET_CLASSES.map(definition => [definition.normalizedName, definition]),
  );

  for (const storedDefinition of [...stored].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
    const name = canonicalizeAssetClass(storedDefinition.name ?? '');
    const normalizedName = assetClassKey(name);
    if (!name || name.length > MAX_ASSET_CLASS_LENGTH || byNormalizedName.has(normalizedName)) continue;
    const definition = assetClassDefinitionForName(
      name,
      storedDefinition.createdBy,
      storedDefinition.createdAt,
      storedDefinition.sortOrder,
    );
    byNormalizedName.set(normalizedName, {
      ...definition,
      updatedAt: storedDefinition.updatedAt,
    });
  }

  return [...byNormalizedName.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export interface AssetClassCatalogReconciliation {
  upserts: AssetClassDefinition[];
  deleteIds: string[];
  idRemap: Record<string, string>;
}

function hasCanonicalFields(
  stored: AssetClassDefinition | undefined,
  canonical: AssetClassDefinition,
): boolean {
  return stored?.name === canonical.name
    && stored.normalizedName === canonical.normalizedName
    && stored.isDefault === canonical.isDefault
    && stored.sortOrder === canonical.sortOrder;
}

/**
 * Produces the writes needed to turn any legacy/malformed catalog into the
 * deterministic one-name/one-ID model. The caller deliberately decides when
 * it is safe to execute these writes (the app waits for a server snapshot).
 */
export function assetClassCatalogReconciliation(
  stored: AssetClassDefinition[],
): AssetClassCatalogReconciliation {
  const catalog = mergeAssetClassCatalog(stored);
  const storedById = new Map(stored.map(definition => [definition.id, definition]));
  const canonicalByName = new Map(
    catalog.map(definition => [definition.normalizedName, definition]),
  );
  const upserts = catalog.filter(definition => (
    !hasCanonicalFields(storedById.get(definition.id), definition)
  ));
  const deleteIds: string[] = [];
  const idRemap: Record<string, string> = {};

  for (const definition of stored) {
    const name = canonicalizeAssetClass(definition.name ?? '');
    const canonical = canonicalByName.get(assetClassKey(name));
    if (!canonical || definition.id === canonical.id) continue;
    deleteIds.push(definition.id);
    idRemap[definition.id] = canonical.id;
  }

  return { upserts, deleteIds, idRemap };
}

export function resolveAssetClass(
  holding: Holding,
  catalog: AssetClassDefinition[],
  storedDefinitions: AssetClassDefinition[] = catalog,
): AssetClassDefinition {
  const byId = new Map(catalog.map(definition => [definition.id, definition]));
  if (holding.assetClassId && byId.has(holding.assetClassId)) {
    return byId.get(holding.assetClassId)!;
  }

  // A pre-catalog or malformed document may use a non-canonical ID. Its
  // definition is stronger evidence than stale mirrored text on the holding;
  // resolve through its name before the reconciliation batch deletes it.
  if (holding.assetClassId) {
    const storedDefinition = storedDefinitions.find(definition => definition.id === holding.assetClassId);
    if (storedDefinition?.name) {
      const deterministicId = assetClassIdForName(storedDefinition.name);
      return byId.get(deterministicId)
        ?? assetClassDefinitionForName(storedDefinition.name);
    }
  }

  const legacyName = assetClassForHolding(holding);
  const deterministicId = assetClassIdForName(legacyName);
  return byId.get(deterministicId) ?? assetClassDefinitionForName(legacyName);
}

export function materializeHoldingAssetClasses(
  holdings: Holding[],
  catalog: AssetClassDefinition[],
  storedDefinitions: AssetClassDefinition[] = catalog,
): Holding[] {
  return holdings.map(holding => {
    const definition = resolveAssetClass(holding, catalog, storedDefinitions);
    return {
      ...holding,
      assetClassId: definition.id,
      assetClass: definition.name,
    };
  });
}

export interface AssetClassMigration {
  definition: AssetClassDefinition;
  holdingPatch: {
    assetClassId: string;
    assetClass: string;
    category: string;
  } | null;
}

export function assetClassMigrationForHolding(
  holding: Holding,
  catalog: AssetClassDefinition[],
  storedDefinitions: AssetClassDefinition[] = catalog,
): AssetClassMigration {
  const definition = resolveAssetClass(holding, catalog, storedDefinitions);
  const holdingPatch = holding.assetClassId === definition.id
    && holding.assetClass === definition.name
    && holding.category === definition.name
    ? null
    : {
        assetClassId: definition.id,
        assetClass: definition.name,
        category: definition.name,
      };
  return { definition, holdingPatch };
}

export function defaultAssetClassForType(assetType: AssetType): AssetClassDefinition {
  const id = DEFAULT_ASSET_CLASS_IDS[assetType];
  const definition = systemById.get(id);
  if (!definition) throw new Error(`Missing system asset class: ${id}`);
  return definition;
}
