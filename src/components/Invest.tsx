import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp, Plus, RefreshCw, Trash2, Pencil, Copy, Check, X, Settings2, Code2, ArrowUp, ArrowDown, Minus, CloudOff, ChevronRight, Tags, Scale } from 'lucide-react';
import { userRoot, db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, onSnapshot, deleteDoc, deleteField, doc, updateDoc, setDoc, writeBatch } from 'firebase/firestore';
import { AssetClassDefinition, AssetType, Holding, PortfolioSettings } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { clearSnapshotMetadata, reportSnapshotMetadata, trackWrite } from '../lib/syncStatus';
import {
  ASSET_TYPE_LABELS,
  AssetClassRow,
  assetTypeForHolding,
  computePortfolio,
  formatMoney,
  formatPct,
  formatUnits,
  HoldingRow,
  isMarketHolding,
  targetsMatchingCurrentWeights,
} from '../lib/portfolio';
import {
  DEFAULT_ASSET_CLASS_IDS,
  assetClassKey,
  assetClassCatalogReconciliation,
  assetClassDefinitionForName,
  assetClassMigrationForHolding,
  defaultAssetClassForType,
  materializeHoldingAssetClasses,
  mergeAssetClassCatalog,
  resolveAssetClass,
  validateAssetClassName,
} from '../lib/assetClasses';
import { generatePortfolioPine, PINE_MAX_HOLDINGS } from '../lib/pine';
import { fetchQuotes } from '../lib/quotes';
import { SHARED_PORTFOLIO_ID, sharedPortfolioPath } from '../lib/portfolioStorage';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Focus comparisons go through assetClassKey: a group's display spelling can
// flip between equivalent legacy spellings when values reorder, and a raw
// string match would silently drop the focus when that happens.
const isSameAssetClass = (a: string, b: string | null) =>
  b !== null && assetClassKey(a) === assetClassKey(b);

const SETTINGS_DEFAULTS: PortfolioSettings = { driftThresholdPct: 5, autoRefresh: true, refreshSec: 60 };
const REFRESH_CHOICES = [
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 300 },
];
const SYMBOL_INPUT_PATTERN = /^[A-Za-z0-9.:_!&-]{1,40}$/;
const ASSET_TYPES: AssetType[] = ['market', 'cash', 'home', 'car'];
const PORTFOLIO_COLORS = [
  '#f43f5e', // rose-500
  '#8b5cf6', // violet-500
  '#6366f1', // indigo-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#06b6d4', // cyan-500
  '#d946ef', // fuchsia-500
  '#64748b', // slate-500
] as const;
const ASSET_NAME_PLACEHOLDERS: Record<AssetType, string> = {
  market: 'Apple',
  cash: 'Checking and savings',
  home: 'Primary home equity',
  car: 'Tesla Model 3',
};

function timeAgo(iso: string | undefined): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms < 45_000) return 'just now';
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function displayNameForHolding(holding: Holding): string {
  const assetType = assetTypeForHolding(holding);
  return holding.name || (assetType === 'market' ? holding.symbol : ASSET_TYPE_LABELS[assetType]);
}

interface HoldingFormValues {
  assetType: AssetType;
  symbol: string;
  name: string;
  assetClassId: string;
  quantity: string;
  targetPct: string;
  price: string;
}

const emptyForm: HoldingFormValues = {
  assetType: 'market',
  symbol: '',
  name: '',
  assetClassId: DEFAULT_ASSET_CLASS_IDS.market,
  quantity: '',
  targetPct: '',
  price: '',
};

const formFor = (
  holding: Holding,
  assetClasses: AssetClassDefinition[],
  storedAssetClasses: AssetClassDefinition[],
): HoldingFormValues => {
  const assetType = assetTypeForHolding(holding);
  return {
    assetType,
    symbol: assetType === 'market' ? holding.symbol : '',
    name: holding.name ?? '',
    assetClassId: resolveAssetClass(holding, assetClasses, storedAssetClasses).id,
    quantity: assetType === 'market' ? String(holding.quantity) : '1',
    targetPct: String(holding.targetPct),
    price: holding.price > 0 ? String(holding.price) : '',
  };
};

// Mirrors the numeric cap in firestore.rules so an oversized value is
// rejected in the form instead of silently reverting at sync.
const MAX_NUMERIC = 1_000_000_000_000;

function validateForm(values: HoldingFormValues, assetClasses: AssetClassDefinition[]): string | null {
  if (values.assetType === 'market' && !SYMBOL_INPUT_PATTERN.test(values.symbol.trim())) {
    return 'Symbol must be 1–40 characters using letters, digits, . : _ ! & - (TradingView format, e.g. NASDAQ:AAPL).';
  }
  if (!assetClasses.some(assetClass => assetClass.id === values.assetClassId)) {
    return 'Select an asset class from the saved list.';
  }
  const quantity = values.assetType === 'market' ? Number(values.quantity) : 1;
  if (values.assetType === 'market' && (!values.quantity.trim() || !Number.isFinite(quantity) || quantity < 0 || quantity > MAX_NUMERIC)) {
    return 'Quantity must be between 0 and 1,000,000,000,000.';
  }
  const targetPct = Number(values.targetPct);
  if (!values.targetPct.trim() || !Number.isFinite(targetPct) || targetPct < 0 || targetPct > 100) return 'Target must be between 0 and 100%.';
  if (values.assetType !== 'market' && values.price.trim() === '') return 'Enter the current value for this asset.';
  if (values.price.trim() !== '') {
    const price = Number(values.price);
    if (!Number.isFinite(price) || price < 0 || price > MAX_NUMERIC) {
      return 'Price must be between 0 and 1,000,000,000,000.';
    }
  }
  return null;
}

export default function Invest() {
  const uid = auth.currentUser?.uid;
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [storedAssetClasses, setStoredAssetClasses] = useState<AssetClassDefinition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [assetClassesLoaded, setAssetClassesLoaded] = useState(false);
  const [settings, setSettings] = useState<PortfolioSettings>(SETTINGS_DEFAULTS);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<{ holding: Holding | null } | null>(null);
  const [form, setForm] = useState<HoldingFormValues>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPineOpen, setIsPineOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [quotesAvailable, setQuotesAvailable] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [quoteErrors, setQuoteErrors] = useState<Record<string, string>>({});
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [armedMatch, setArmedMatch] = useState(false);
  const [matchedFlash, setMatchedFlash] = useState(false);
  // null = the whole portfolio; a class name focuses the holdings list on it.
  const [focusedClass, setFocusedClass] = useState<string | null>(null);
  const [expandedHoldings, setExpandedHoldings] = useState<Set<string>>(() => new Set());
  const [showClassManager, setShowClassManager] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [newClassError, setNewClassError] = useState<string | null>(null);
  const migratingClassifications = useRef(new Set<string>());
  // A migration rejected by the server (rules) would fail identically forever;
  // remember it so each snapshot doesn't re-queue the same doomed write.
  const abandonedMigrations = useRef(new Set<string>());
  const reconcilingCatalog = useRef(false);
  const abandonedCatalogReconciliation = useRef(false);
  // Migrations are only issued from server-backed snapshots. A cache-only
  // snapshot can be stale (another device may have edited the class since),
  // and a migration queued offline could land much later, stomping that edit.
  const holdingsFromCache = useRef(true);
  const holdingsHavePendingWrites = useRef(false);
  const assetClassesFromCache = useRef(true);
  const assetClassesHavePendingWrites = useRef(false);
  const assetClasses = useMemo(
    () => mergeAssetClassCatalog(storedAssetClasses),
    [storedAssetClasses],
  );

  useEffect(() => {
    if (!uid) return;
    const source = 'invest-holdings';
    const unsubscribe = onSnapshot(collection(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'holdings'), { includeMetadataChanges: true }, (snapshot) => {
      reportSnapshotMetadata(source, snapshot.metadata);
      holdingsFromCache.current = snapshot.metadata.fromCache;
      holdingsHavePendingWrites.current = snapshot.metadata.hasPendingWrites;
      setHoldings(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Holding)));
      setLoaded(true);
      setError(null);
    }, (err) => {
      clearSnapshotMetadata(source);
      console.error('Firestore onSnapshot error:', err);
      setError('Failed to load your portfolio. You might not have permission.');
      try {
        handleFirestoreError(err, OperationType.LIST, sharedPortfolioPath('holdings'));
      } catch (e) {
        // handleFirestoreError throws; the error state is already set
      }
    });
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const source = 'invest-asset-classes';
    const unsubscribe = onSnapshot(
      collection(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'assetClasses'),
      { includeMetadataChanges: true },
      snapshot => {
        reportSnapshotMetadata(source, snapshot.metadata);
        assetClassesFromCache.current = snapshot.metadata.fromCache;
        assetClassesHavePendingWrites.current = snapshot.metadata.hasPendingWrites;
        setStoredAssetClasses(snapshot.docs.map(document => ({
          id: document.id,
          ...document.data(),
        } as AssetClassDefinition)));
        setAssetClassesLoaded(true);
      },
      err => {
        clearSnapshotMetadata(source);
        console.error('Failed to load asset classes:', err);
        setError('Failed to load the saved asset-class list.');
      },
    );
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, [uid]);

  // The fixed catalog is available immediately from code for offline use. Once
  // both collections are confirmed by the server, reconcile the database to
  // the deterministic one-name/one-ID catalog. This also removes legacy class
  // documents and atomically relinks any holdings that referenced them.
  useEffect(() => {
    if (!uid
      || !loaded
      || !assetClassesLoaded
      || holdingsFromCache.current
      || holdingsHavePendingWrites.current
      || assetClassesFromCache.current
      || assetClassesHavePendingWrites.current
      || reconcilingCatalog.current
      || abandonedCatalogReconciliation.current) return;
    const repair = assetClassCatalogReconciliation(storedAssetClasses);
    if (repair.upserts.length === 0 && repair.deleteIds.length === 0) return;

    reconcilingCatalog.current = true;
    const batch = writeBatch(db);
    for (const definition of repair.upserts) {
      const { id, ...data } = definition;
      batch.set(doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'assetClasses', id), data);
    }
    for (const holding of holdings) {
      if (!holding.id || !holding.assetClassId) continue;
      const canonicalId = repair.idRemap[holding.assetClassId];
      if (!canonicalId) continue;
      const definition = assetClasses.find(assetClass => assetClass.id === canonicalId);
      if (!definition) continue;
      batch.update(doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'holdings', holding.id), {
        assetClassId: definition.id,
        assetClass: definition.name,
        category: definition.name,
      });
    }
    for (const id of repair.deleteIds) {
      batch.delete(doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'assetClasses', id));
    }
    trackWrite(batch.commit())
      .catch(err => {
        abandonedCatalogReconciliation.current = true;
        console.error('Failed to reconcile asset-class catalog:', err);
        setError('The saved asset-class list could not be repaired automatically.');
      })
      .finally(() => { reconcilingCatalog.current = false; });
  }, [assetClasses, assetClassesLoaded, holdings, loaded, storedAssetClasses, uid]);

  // Replace legacy per-holding labels with one stable class reference. The
  // class definition and holding update commit atomically, so a custom class
  // can never exist only on one side of the relationship.
  useEffect(() => {
    if (!uid
      || holdingsFromCache.current
      || holdingsHavePendingWrites.current
      || assetClassesFromCache.current
      || assetClassesHavePendingWrites.current) return;
    for (const holding of holdings) {
      if (!holding.id
        || migratingClassifications.current.has(holding.id)
        || abandonedMigrations.current.has(holding.id)) continue;
      const migration = assetClassMigrationForHolding(holding, assetClasses, storedAssetClasses);
      if (!migration.holdingPatch) continue;

      migratingClassifications.current.add(holding.id);
      const batch = writeBatch(db);
      const { id: assetClassId, ...assetClassData } = migration.definition;
      batch.set(
        doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'assetClasses', assetClassId),
        assetClassData,
        { merge: true },
      );
      batch.update(
        doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'holdings', holding.id),
        migration.holdingPatch,
      );
      trackWrite(batch.commit())
        .catch(err => {
          // Offline writes queue and never reject; a rejection means the
          // server (rules) said no and a retry would fail the same way.
          abandonedMigrations.current.add(holding.id!);
          console.error('Failed to migrate holding asset class:', err);
          setError('An old asset class could not be linked automatically. Edit the asset and select its class again.');
        })
        .finally(() => migratingClassifications.current.delete(holding.id!));
    }
  }, [assetClasses, holdings, storedAssetClasses, uid]);

  useEffect(() => {
    if (!uid) return;
    const source = 'invest-settings';
    const unsubscribe = onSnapshot(doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'settings', 'general'), { includeMetadataChanges: true }, (snapshot) => {
      reportSnapshotMetadata(source, snapshot.metadata);
      const data = snapshot.data();
      setSettings(data ? { ...SETTINGS_DEFAULTS, ...data } as PortfolioSettings : SETTINGS_DEFAULTS);
    }, (err) => {
      clearSnapshotMetadata(source);
      console.error('Failed to load portfolio settings:', err);
    });
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, [uid]);

  // Sorted by value so the biggest positions lead; computePortfolio keeps
  // this order for the rendered rows.
  const summary = useMemo(() => {
    const sorted = [...holdings].sort((a, b) =>
      (b.quantity * b.price) - (a.quantity * a.price) || a.symbol.localeCompare(b.symbol));
    return computePortfolio(materializeHoldingAssetClasses(sorted, assetClasses, storedAssetClasses));
  }, [assetClasses, holdings, storedAssetClasses]);

  // A focused class can disappear (last holding deleted, class renamed);
  // fall back to the whole portfolio instead of an empty filtered view.
  useEffect(() => {
    if (focusedClass !== null && !summary.assetClasses.some(row => isSameAssetClass(row.assetClass, focusedClass))) {
      setFocusedClass(null);
    }
  }, [focusedClass, summary.assetClasses]);

  const focusedSummary = focusedClass
    ? summary.assetClasses.find(row => isSameAssetClass(row.assetClass, focusedClass)) ?? null
    : null;
  const visibleRows = focusedSummary ? focusedSummary.rows : summary.rows;

  const holdingsRef = useRef<Holding[]>(holdings);
  holdingsRef.current = holdings;
  const refreshingRef = useRef(false);

  const refreshQuotes = useCallback(async (list: Holding[]) => {
    const marketHoldings = list.filter(isMarketHolding);
    if (!uid || refreshingRef.current || marketHoldings.length === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const symbols = [...new Set(marketHoldings.map(h => h.symbol))];
      const result = await fetchQuotes(symbols);
      if (result === null) {
        // The endpoint only exists on the local dev/preview server; hosted
        // builds get manual prices + the TradingView script instead.
        setQuotesAvailable(false);
        return;
      }
      setQuotesAvailable(true);
      setQuoteErrors(result.errors);
      setLastRefreshAt(new Date().toISOString());
      const updatedAt = new Date().toISOString();
      // The fetch may take a while; only write back to holdings that still
      // exist, and skip negative prices the rules would reject.
      const stillHeld = new Set(holdingsRef.current.map(h => h.id));
      for (const holding of marketHoldings) {
        const quote = result.quotes[holding.symbol];
        if (!quote || !holding.id || !stillHeld.has(holding.id) || quote.price < 0) continue;
        if (quote.price === holding.price && holding.priceSource === 'live') continue;
        trackWrite(updateDoc(doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'holdings', holding.id), {
          price: quote.price,
          priceUpdatedAt: quote.fetchedAt,
          priceSource: 'live',
          updatedAt,
        })).catch(err => {
          if (err?.code === 'not-found') return;
          console.error('Failed to store refreshed price:', err);
          setRefreshError('A refreshed price could not be saved.');
        });
      }
    } catch (err) {
      console.error('Quote refresh failed:', err);
      // Our HTTP errors carry a friendly message (sign-in / rate-limit);
      // a bare network failure (TypeError) does not, so keep a generic hint.
      setRefreshError(
        err instanceof Error && !(err instanceof TypeError) && err.message
          ? err.message
          : 'Quote refresh failed. Check your connection and try again.',
      );
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }, [uid]);

  const didInitialRefresh = useRef(false);
  useEffect(() => {
    if (!loaded || didInitialRefresh.current || !holdings.some(isMarketHolding)) return;
    didInitialRefresh.current = true;
    refreshQuotes(holdings);
  }, [loaded, holdings, refreshQuotes]);

  useEffect(() => {
    if (!settings.autoRefresh || quotesAvailable === false) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refreshQuotes(holdingsRef.current);
    }, Math.max(15, settings.refreshSec) * 1000);
    return () => clearInterval(id);
  }, [settings.autoRefresh, settings.refreshSec, quotesAvailable, refreshQuotes]);

  const openAdd = () => {
    setForm({ ...emptyForm, assetClassId: defaultAssetClassForType('market').id });
    setFormError(null);
    setModal({ holding: null });
  };
  const openEdit = (holding: Holding) => {
    setForm(formFor(holding, assetClasses, storedAssetClasses));
    setFormError(null);
    setModal({ holding });
  };
  const selectAssetType = (assetType: AssetType) => {
    const oldClassDefaultId = DEFAULT_ASSET_CLASS_IDS[form.assetType];
    // Only prefill the new type's default when the field was untouched; an
    // explicitly chosen class survives the toggle (cash included).
    const assetClassId = !form.assetClassId || form.assetClassId === oldClassDefaultId
      ? defaultAssetClassForType(assetType).id
      : form.assetClassId;
    setForm({
      ...form,
      assetType,
      assetClassId,
      quantity: assetType === 'market' ? (form.assetType === 'market' ? form.quantity : '') : '1',
      symbol: assetType === 'market' ? (form.assetType === 'market' ? form.symbol : '') : '',
    });
    setFormError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid || !auth.currentUser) return;
    const problem = validateForm(form, assetClasses);
    if (problem) { setFormError(problem); return; }
    const selectedClass = assetClasses.find(assetClass => assetClass.id === form.assetClassId);
    if (!selectedClass) { setFormError('Select an asset class from the saved list.'); return; }

    const assetType = form.assetType;
    const isMarket = assetType === 'market';
    const symbol = isMarket ? form.symbol.trim().toUpperCase() : assetType.toUpperCase();
    const name = form.name.trim() || (isMarket ? '' : ASSET_TYPE_LABELS[assetType]);
    const parsed = {
      symbol,
      assetType,
      assetClassId: selectedClass.id,
      // Keep the names as snapshots for old offline clients. The permanent
      // source of identity is assetClassId, so spelling can no longer split a
      // class into duplicate rows.
      category: selectedClass.name,
      assetClass: selectedClass.name,
      quantity: isMarket ? Number(form.quantity) : 1,
      targetPct: Number(form.targetPct),
      price: form.price.trim() === '' ? 0 : Number(form.price),
    };
    const now = new Date().toISOString();

    if (modal?.holding?.id) {
      // Only write the price when the user actually edited the field. A live
      // refresh can update the doc while the modal is open; unconditionally
      // writing the seeded value back would revert that quote while its
      // 'live' provenance stayed on the doc.
      const originalForm = formFor(modal.holding, assetClasses, storedAssetClasses);
      const priceTouched = assetType !== originalForm.assetType || form.price.trim() !== originalForm.price;
      const { price, ...rest } = parsed;
      trackWrite(updateDoc(doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'holdings', modal.holding.id), {
        ...rest,
        ...(!isMarket || priceTouched ? { price, priceSource: 'manual' as const, priceUpdatedAt: now } : {}),
        ...(name ? { name } : modal.holding.name ? { name: deleteField() } : {}),
        updatedAt: now,
      })).catch(err => {
        console.error('Failed to update holding:', err);
        setError('Failed to update the holding. You might not have permission.');
      });
    } else {
      trackWrite(addDoc(collection(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'holdings'), {
        ...parsed,
        ...(name ? { name } : {}),
        ...(parsed.price > 0 ? { priceSource: 'manual' as const, priceUpdatedAt: now } : {}),
        createdBy: auth.currentUser.uid,
        authorName: auth.currentUser.displayName || 'Explorer',
        createdAt: now,
      })).catch(err => {
        console.error('Failed to add holding:', err);
        setError('Failed to add the holding. You might not have permission.');
      });
      // Fill in a live price right away instead of waiting for the next tick.
      if (isMarket && quotesAvailable !== false) {
        setTimeout(() => refreshQuotes(holdingsRef.current), 400);
      }
      // A class focus would hide the new holding if it belongs elsewhere;
      // always return to the whole portfolio so the addition is visible.
      setFocusedClass(null);
    }
    setModal(null);
  };

  const openClassManager = () => {
    setNewClassName('');
    setNewClassError(null);
    setShowClassManager(true);
  };

  const handleAddAssetClass = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid || !auth.currentUser) return;
    const problem = validateAssetClassName(newClassName);
    if (problem) { setNewClassError(problem); return; }

    const now = new Date().toISOString();
    const nextSortOrder = Math.max(990, ...assetClasses.map(assetClass => assetClass.sortOrder)) + 10;
    const definition = assetClassDefinitionForName(
      newClassName,
      auth.currentUser.uid,
      now,
      nextSortOrder,
    );
    const existing = assetClasses.find(assetClass => (
      assetClass.id === definition.id || assetClass.normalizedName === definition.normalizedName
    ));
    if (existing) {
      setForm(current => ({ ...current, assetClassId: existing.id }));
      setNewClassError(`${existing.name} already exists. It has been selected instead.`);
      return;
    }

    const optimistic = { ...definition, updatedAt: now };
    setStoredAssetClasses(current => [
      ...current.filter(assetClass => assetClass.id !== optimistic.id),
      optimistic,
    ]);
    setForm(current => ({ ...current, assetClassId: optimistic.id }));
    setShowClassManager(false);
    setNewClassName('');
    const { id, ...data } = optimistic;
    trackWrite(setDoc(doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'assetClasses', id), data)).catch(err => {
      console.error('Failed to add asset class:', err);
      setStoredAssetClasses(current => current.filter(assetClass => assetClass.id !== id));
      setForm(current => current.assetClassId === id
        ? { ...current, assetClassId: defaultAssetClassForType(current.assetType).id }
        : current);
      setNewClassError('The new asset class could not be saved. Please try again.');
      setShowClassManager(true);
    });
  };

  const handleDelete = (holding: Holding) => {
    if (!uid || !holding.id) return;
    if (armedDelete !== holding.id) {
      setArmedDelete(holding.id);
      setTimeout(() => setArmedDelete(current => (current === holding.id ? null : current)), 3000);
      return;
    }
    setArmedDelete(null);
    trackWrite(deleteDoc(doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'holdings', holding.id))).catch(err => {
      console.error('Failed to delete holding:', err);
      setError('Failed to delete the holding. You might not have permission.');
    });
  };

  const saveSettings = (next: PortfolioSettings) => {
    if (!uid) return;
    setSettings(next);
    trackWrite(setDoc(doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'settings', 'general'), {
      driftThresholdPct: next.driftThresholdPct,
      autoRefresh: next.autoRefresh,
      refreshSec: next.refreshSec,
      updatedAt: new Date().toISOString(),
    })).catch(err => {
      console.error('Failed to save settings:', err);
      setError('Failed to save settings. You might not have permission.');
    });
  };

  // One tap to set every holding's target to its current weight, so drift
  // resets to ~0 and targets add up to 100%. It overwrites hand-set targets,
  // so the first tap arms and the second (within 3s) commits, matching the
  // per-holding delete flow.
  const matchTargetsToCurrent = () => {
    if (!uid || summary.totalValue <= 0) return;
    if (!armedMatch) {
      setArmedMatch(true);
      setTimeout(() => setArmedMatch(false), 3000);
      return;
    }
    setArmedMatch(false);
    const targets = targetsMatchingCurrentWeights(holdings);
    if (targets.size === 0) return;
    const now = new Date().toISOString();
    const batch = writeBatch(db);
    let changed = 0;
    for (const holding of holdings) {
      if (!holding.id) continue;
      const next = targets.get(holding.id);
      if (next === undefined || next === holding.targetPct) continue;
      batch.update(doc(userRoot(), 'portfolios', SHARED_PORTFOLIO_ID, 'holdings', holding.id), {
        targetPct: next,
        updatedAt: now,
      });
      changed += 1;
    }
    setMatchedFlash(true);
    setTimeout(() => setMatchedFlash(false), 2000);
    if (changed === 0) return; // already matched — the flash still confirms it
    trackWrite(batch.commit()).catch(err => {
      console.error('Failed to match targets to current weights:', err);
      setError('Failed to update targets. You might not have permission.');
    });
  };

  const marketRows = useMemo(() => summary.rows.filter(row => isMarketHolding(row.holding)), [summary.rows]);

  const pineScript = useMemo(() => {
    if (!isPineOpen || marketRows.length === 0 || marketRows.length > PINE_MAX_HOLDINGS) return '';
    // Manual assets are not quoteable in TradingView. Normalize market target
    // weights within the market sleeve so Cash/Home/Car do not make the Pine
    // drift comparison mathematically inconsistent.
    const marketTargetTotal = marketRows.reduce((sum, row) => sum + row.holding.targetPct, 0);
    return generatePortfolioPine(
      marketRows.map(row => ({
        symbol: row.holding.symbol,
        quantity: row.holding.quantity,
        targetPct: marketTargetTotal > 0
          ? (row.holding.targetPct / marketTargetTotal) * 100
          : row.holding.targetPct,
      })),
      { driftThresholdPct: settings.driftThresholdPct },
    );
  }, [isPineOpen, marketRows, settings.driftThresholdPct]);

  const copyPine = () => {
    navigator.clipboard?.writeText(pineScript).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setCopied(false));
  };

  // Weight axis: clean 10s, wide enough for the largest bar or target tick.
  const scaleMax = useMemo(() => {
    const maxPct = summary.rows.reduce((max, row) => Math.max(max, row.actualPct, row.holding.targetPct), 0);
    return Math.min(100, Math.max(10, Math.ceil(maxPct / 10) * 10));
  }, [summary.rows]);

  // Color follows the CLASS, not its rank: assignments are first-seen and
  // never change within a session, so a price tick that reorders two classes
  // by value cannot swap every segment, swatch, and dot mid-view.
  const assignedClassColors = useRef(new Map<string, string>());
  const assetClassColors = useMemo<Record<string, string>>(() => {
    const assigned = assignedClassColors.current;
    for (const row of summary.assetClasses) {
      const key = assetClassKey(row.assetClass);
      if (!assigned.has(key)) {
        assigned.set(key, PORTFOLIO_COLORS[assigned.size % PORTFOLIO_COLORS.length]);
      }
    }
    return Object.fromEntries(summary.assetClasses.map(row => [
      row.assetClass,
      assigned.get(assetClassKey(row.assetClass)) ?? PORTFOLIO_COLORS[0],
    ]));
  }, [summary.assetClasses]);

  const targetsOff = Math.abs(summary.targetTotalPct - 100) > 0.01 && holdings.length > 0;

  return (
    <div className="flex flex-col h-full overflow-hidden text-slate-200">
      <header className="bg-slate-900/60 backdrop-blur-xl px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 md:py-4 flex items-center justify-between gap-2 sm:gap-3 border-b border-slate-800/60 sticky top-0 z-10">
        <h1 className="flex items-center min-w-0">
          <TrendingUp className="text-rose-400 w-6 h-6 shrink-0" />
          <span className="sr-only">Invest</span>
        </h1>
        <div className="flex items-center gap-1 sm:gap-2 md:gap-3 shrink-0">
          <button
            onClick={() => refreshQuotes(holdingsRef.current)}
            disabled={refreshing || marketRows.length === 0 || quotesAvailable === false}
            data-testid="invest-refresh"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
            aria-label="Refresh prices"
          >
            <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
          </button>
          <button
            onClick={() => setShowSettings(open => !open)}
            className={cn('p-2 rounded-xl transition-colors', showSettings ? 'bg-rose-900/30 text-rose-400' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800')}
            aria-label="Portfolio settings"
          >
            <Settings2 className="w-4 h-4" />
          </button>
          <button
            onClick={openClassManager}
            data-testid="invest-manage-asset-classes"
            className="bg-slate-900 border border-slate-800 text-slate-300 p-2 lg:px-3 rounded-xl hover:bg-slate-800 transition-colors flex items-center gap-1.5 text-sm font-bold whitespace-nowrap"
            aria-label="Manage asset classes"
          >
            <Tags className="w-4 h-4 text-rose-400" />
            <span className="hidden lg:inline">Asset classes</span>
          </button>
          <button
            onClick={() => setIsPineOpen(true)}
            disabled={marketRows.length === 0}
            data-testid="invest-pine-button"
            className="hidden sm:flex bg-slate-900 border border-slate-800 text-slate-300 px-3 py-2 rounded-xl hover:bg-slate-800 transition-colors items-center gap-1.5 text-sm font-bold whitespace-nowrap disabled:opacity-40"
          >
            <Code2 className="w-4 h-4 text-rose-400" />
            TradingView script
          </button>
          <button
            onClick={openAdd}
            data-testid="invest-add-holding"
            className="bg-rose-600 text-white px-2.5 sm:px-3 md:px-4 py-2 rounded-xl hover:bg-rose-700 transition-colors shadow-lg shadow-rose-900/20 flex items-center gap-1 sm:gap-1.5 text-sm font-bold whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add<span className="hidden md:inline"> Asset</span>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 space-y-4 md:space-y-6">
        {error && (
          <div className="p-4 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm font-medium">{error}</div>
        )}

        {quotesAvailable === false && (
          <div className="p-4 bg-amber-900/20 border border-amber-800/50 rounded-xl text-amber-300 text-sm font-medium flex items-start gap-3">
            <CloudOff className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Live quotes aren’t reachable right now. They need the quotes Cloud Function
              (README → Investment tracker); running locally with <code className="font-mono">npm run dev</code> also
              serves them. Prices stay editable by hand, and the TradingView script tracks live weights on tradingview.com.
            </span>
          </div>
        )}

        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 sm:p-4 grid grid-cols-1 sm:flex sm:flex-wrap items-start sm:items-center gap-x-8 gap-y-4">
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-300">
                  Drift alert
                  <DriftThresholdInput
                    value={settings.driftThresholdPct}
                    onCommit={value => saveSettings({ ...settings, driftThresholdPct: value })}
                  />
                  <span className="text-slate-500">%</span>
                </label>
                <label className="flex items-center gap-3 text-sm font-semibold text-slate-300">
                  Auto-refresh
                  <button
                    role="switch"
                    aria-checked={settings.autoRefresh}
                    onClick={() => saveSettings({ ...settings, autoRefresh: !settings.autoRefresh })}
                    className={cn('w-11 h-6 rounded-full transition-colors relative', settings.autoRefresh ? 'bg-rose-600' : 'bg-slate-700')}
                  >
                    <span className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all', settings.autoRefresh ? 'left-[22px]' : 'left-0.5')} />
                  </button>
                </label>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                  Every
                  <div className="flex bg-slate-950 p-1 rounded-xl border border-slate-800">
                    {REFRESH_CHOICES.map(choice => (
                      <button
                        key={choice.value}
                        onClick={() => saveSettings({ ...settings, refreshSec: choice.value })}
                        className={cn(
                          'px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider transition-all',
                          settings.refreshSec === choice.value ? 'bg-rose-600 text-white' : 'text-slate-500 hover:text-slate-300',
                        )}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Portfolio summary, modeled after the compact reference header. */}
        <div className="grid grid-cols-2 xl:grid-cols-4 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="min-w-0 p-3 sm:p-4 md:p-5 border-b border-r border-slate-800 xl:border-b-0">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Portfolio</p>
            <p className="text-base sm:text-lg md:text-xl font-black text-white leading-tight">My Portfolio</p>
            <p className="text-[10px] text-slate-500 font-medium mt-1">{holdings.length} {holdings.length === 1 ? 'holding' : 'holdings'} · {summary.rows.filter(r => r.value > 0).length} valued</p>
          </div>
          <div className="min-w-0 p-3 sm:p-4 md:p-5 border-b border-slate-800 xl:border-b-0 xl:border-r">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Total balance</p>
            <p data-testid="invest-total-value" className="text-base min-[360px]:text-lg sm:text-2xl md:text-3xl font-black text-white tabular-nums tracking-tight">{formatMoney(summary.totalValue)}</p>
            <p className="text-[10px] text-slate-500 font-medium mt-1">
              {refreshing ? 'Refreshing…' : lastRefreshAt ? `Quotes ${timeAgo(lastRefreshAt)}` : 'Prices as entered'}
            </p>
          </div>
          <div className="min-w-0 p-3 sm:p-4 md:p-5 border-r border-slate-800">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Targets</p>
            <p className={cn('text-xl sm:text-2xl md:text-3xl font-black tabular-nums', targetsOff ? 'text-amber-400' : 'text-white')}>{formatPct(summary.targetTotalPct)}</p>
            <p className="text-[10px] text-slate-500 font-medium mt-1">
              {targetsOff
                ? summary.unallocatedPct > 0 ? `${formatPct(summary.unallocatedPct)} unallocated` : `${formatPct(-summary.unallocatedPct)} over-allocated`
                : 'fully allocated'}
            </p>
          </div>
          <div className="min-w-0 p-3 sm:p-4 md:p-5">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Largest drift</p>
            <p className={cn('text-xl sm:text-2xl md:text-3xl font-black tabular-nums', summary.maxAbsDriftPct > settings.driftThresholdPct ? 'text-rose-400' : 'text-white')}>
              {formatPct(summary.maxAbsDriftPct)}
            </p>
            <p className="text-[10px] text-slate-500 font-medium mt-1">alert over {formatPct(settings.driftThresholdPct)}</p>
          </div>
        </div>

        {refreshError && <p className="text-xs text-amber-400 font-medium px-1">{refreshError}</p>}

        {!loaded ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 text-center">
            <p className="text-slate-500 text-sm">Loading portfolio…</p>
          </div>
        ) : summary.rows.length === 0 ? (
          <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-10 text-center space-y-3">
            <p className="text-slate-400 text-sm font-semibold">No holdings yet.</p>
            <p className="text-slate-500 text-xs max-w-md mx-auto">
              Add each asset with its TradingView symbol (like <span className="font-mono text-slate-400">NASDAQ:AAPL</span> or{' '}
              <span className="font-mono text-slate-400">BITSTAMP:BTCUSD</span>), how much you hold, and the weight you want it to be.
            </p>
            <button onClick={openAdd} className="bg-rose-600 text-white px-4 py-2 rounded-xl hover:bg-rose-700 transition-colors text-sm font-bold inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Add your first holding
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-4 items-start">
            <PortfolioOverview
              assetClasses={summary.assetClasses}
              totalValue={summary.totalValue}
              targetTotalPct={summary.targetTotalPct}
              unallocatedPct={summary.unallocatedPct}
              colors={assetClassColors}
              focusedClass={focusedClass}
              onFocusClass={setFocusedClass}
            />

            <section data-testid="invest-holdings-panel" className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden min-w-0">
              <div className="px-3.5 sm:px-4 md:px-5 py-3.5 md:py-4 border-b border-slate-800 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-black text-white text-sm truncate">
                    Holdings
                    {focusedSummary && (
                      <span className="text-slate-400"> · {focusedSummary.assetClass}</span>
                    )}
                  </h2>
                  <p className="text-[10px] text-slate-500 font-semibold mt-0.5 truncate">
                    {focusedSummary
                      ? 'Showing one asset class — use Total Portfolio to see everything'
                      : 'Tap a holding for pricing, drift, and controls'}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  {/* Match targets rewrites EVERY holding's target, so it only
                      appears in the whole-portfolio view — offering it while a
                      class is focused would silently overwrite hidden rows. */}
                  {!focusedSummary && (
                  <button
                    type="button"
                    onClick={matchTargetsToCurrent}
                    disabled={summary.totalValue <= 0}
                    data-testid="invest-match-targets"
                    title="Set every target to its current weight"
                    aria-label={armedMatch ? 'Confirm setting all targets to current weights' : 'Match targets to current weights'}
                    className={cn(
                      'px-2.5 py-1.5 rounded-lg text-[10px] font-black inline-flex items-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-800',
                      matchedFlash
                        ? 'bg-emerald-900/30 text-emerald-300'
                        : armedMatch
                          ? 'bg-amber-900/40 text-amber-200'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
                    )}
                  >
                    {matchedFlash ? <Check className="w-3 h-3" /> : <Scale className="w-3 h-3" />}
                    {matchedFlash ? 'Targets matched' : armedMatch ? 'Confirm' : 'Match targets'}
                  </button>
                  )}
                  <p className="hidden sm:block text-[10px] text-slate-500 font-semibold">
                    {focusedSummary ? `${visibleRows.length} of ${summary.rows.length}` : `${summary.rows.length} total`}
                  </p>
                </div>
              </div>
              <div className="lg:overflow-x-auto">
                <div className="lg:min-w-[760px]">
                  <div data-testid="invest-desktop-holdings-header" className="hidden lg:grid grid-cols-[minmax(290px,1.7fr)_minmax(190px,1fr)_100px_140px] gap-4 px-5 py-3 border-b border-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    <span>Holding</span>
                    <span>Current weight</span>
                    <span className="text-right">Target</span>
                    <span className="text-right">Current value</span>
                  </div>
                  <AnimatePresence initial={false}>
                    {visibleRows.map(row => {
                      const rowKey = row.holding.id ?? row.holding.symbol;
                      const storedClass = resolveAssetClass(row.holding, assetClasses, storedAssetClasses).name;
                      const classSummary = summary.assetClasses.find(assetClass => (
                        assetClassKey(assetClass.assetClass) === assetClassKey(storedClass)
                      ));
                      const rowAssetClass = classSummary?.assetClass ?? storedClass;
                      const classValue = classSummary?.value ?? 0;
                      return (
                        <HoldingTableRow
                          key={rowKey}
                          row={row}
                          assetClass={rowAssetClass}
                          color={assetClassColors[rowAssetClass] ?? PORTFOLIO_COLORS[0]}
                          classValue={classValue}
                          scaleMax={scaleMax}
                          driftThresholdPct={settings.driftThresholdPct}
                          quoteError={quoteErrors[row.holding.symbol]}
                          expanded={expandedHoldings.has(rowKey)}
                          armedDelete={armedDelete === row.holding.id}
                          onToggle={() => setExpandedHoldings(current => {
                            const next = new Set(current);
                            if (next.has(rowKey)) next.delete(rowKey);
                            else next.add(rowKey);
                            return next;
                          })}
                          onEdit={() => openEdit(row.holding)}
                          onDelete={() => handleDelete(row.holding)}
                        />
                      );
                    })}
                  </AnimatePresence>
                  <div className="hidden lg:grid grid-cols-[minmax(290px,1.7fr)_minmax(190px,1fr)_100px_140px] gap-4 px-5 py-4 border-t border-slate-700 bg-slate-950/35 text-xs font-black text-slate-200">
                    <span className="pl-8 truncate">{focusedSummary ? `${focusedSummary.assetClass} total` : 'Total'}</span>
                    <span>{focusedSummary ? formatPct(focusedSummary.actualPct) : summary.totalValue > 0 ? '100.0%' : '0.0%'}</span>
                    <span className={cn('text-right', !focusedSummary && targetsOff && 'text-amber-400')}>
                      {formatPct(focusedSummary ? focusedSummary.targetPct : summary.targetTotalPct)}
                    </span>
                    <span className="text-right text-white">{formatMoney(focusedSummary ? focusedSummary.value : summary.totalValue)}</span>
                  </div>
                  <div className="lg:hidden px-3.5 py-3.5 border-t border-slate-700 bg-slate-950/35 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-200 truncate">{focusedSummary ? `${focusedSummary.assetClass} total` : 'Total'}</p>
                      <p className={cn('text-[10px] font-semibold mt-0.5', !focusedSummary && targetsOff ? 'text-amber-400' : 'text-slate-500')}>
                        {focusedSummary
                          ? `${formatPct(focusedSummary.targetPct)} target · ${formatPct(focusedSummary.actualPct)} current`
                          : `${formatPct(summary.targetTotalPct)} target · ${summary.totalValue > 0 ? '100.0%' : '0.0%'} current`}
                      </p>
                    </div>
                    <p className="text-sm font-black text-white tabular-nums shrink-0">{formatMoney(focusedSummary ? focusedSummary.value : summary.totalValue)}</p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Mobile access to the Pine script */}
        {marketRows.length > 0 && (
          <button
            onClick={() => setIsPineOpen(true)}
            className="sm:hidden w-full bg-slate-900 border border-slate-800 text-slate-300 px-3 py-3 rounded-2xl flex items-center justify-center gap-2 text-sm font-bold"
          >
            <Code2 className="w-4 h-4 text-rose-400" /> TradingView script
          </button>
        )}
      </div>

      {/* Add / edit modal */}
      <AnimatePresence>
        {modal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setModal(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl max-h-[92dvh] sm:max-h-[90dvh] overflow-y-auto safe-bottom"
            >
              <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-black text-white">{modal.holding ? 'Edit Asset' : 'Add Asset'}</h2>
                  <button type="button" onClick={() => setModal(null)} className="p-2 hover:bg-slate-800 rounded-full" aria-label="Close">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>

                {formError && (
                  <p className="p-3 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-xs font-medium">{formError}</p>
                )}

                <fieldset>
                  <legend className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Asset type</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {ASSET_TYPES.map(assetType => (
                      <button
                        key={assetType}
                        type="button"
                        onClick={() => selectAssetType(assetType)}
                        data-testid={`asset-type-${assetType}`}
                        className={cn(
                          'px-3 py-2 rounded-xl border text-xs font-bold transition-colors',
                          form.assetType === assetType
                            ? 'bg-rose-900/30 border-rose-700 text-rose-300'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700',
                        )}
                      >
                        {ASSET_TYPE_LABELS[assetType]}
                      </button>
                    ))}
                  </div>
                </fieldset>

                {form.assetType === 'market' && (
                  <div>
                    <label htmlFor="holding-symbol" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Symbol</label>
                    <input
                      id="holding-symbol"
                      value={form.symbol}
                      onChange={e => setForm({ ...form, symbol: e.target.value })}
                      placeholder="NASDAQ:AAPL"
                      autoFocus={!modal.holding}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 font-mono uppercase placeholder:normal-case placeholder:font-sans placeholder:text-slate-600 focus:outline-none focus:border-rose-700"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">TradingView format keeps the app and your Pine script in sync.</p>
                  </div>
                )}

                <div>
                  <label htmlFor="holding-name" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    {form.assetType === 'market' ? 'Display name' : 'Asset name'} <span className="text-slate-600">(optional)</span>
                  </label>
                  <input
                    id="holding-name"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    placeholder={ASSET_NAME_PLACEHOLDERS[form.assetType]}
                    maxLength={99}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-rose-700"
                  />
                </div>

                <div>
                  <label htmlFor="holding-asset-class" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Asset class</label>
                  <div className="flex gap-2">
                    <select
                      id="holding-asset-class"
                      value={form.assetClassId}
                      onChange={e => setForm({ ...form, assetClassId: e.target.value })}
                      className="min-w-0 flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 focus:outline-none focus:border-rose-700"
                    >
                      {assetClasses.map(assetClass => (
                        <option key={assetClass.id} value={assetClass.id}>{assetClass.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={openClassManager}
                      className="shrink-0 bg-slate-950 border border-slate-800 text-slate-300 px-3 rounded-xl hover:bg-slate-800 transition-colors text-xs font-bold"
                    >
                      New class
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {form.assetType === 'cash'
                      ? 'Cash assets default into the single Cash & Cash Equivalents class.'
                      : 'Choose one saved class. Names cannot create a second Crypto entry.'}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {form.assetType === 'market' && (
                    <div>
                      <label htmlFor="holding-quantity" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Quantity</label>
                      <input
                        id="holding-quantity"
                        value={form.quantity}
                        onChange={e => setForm({ ...form, quantity: e.target.value })}
                        inputMode="decimal"
                        placeholder="10"
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-rose-700"
                      />
                    </div>
                  )}
                  <div className={cn(form.assetType !== 'market' && 'col-span-2')}>
                    <label htmlFor="holding-target" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Target %</label>
                    <input
                      id="holding-target"
                      value={form.targetPct}
                      onChange={e => setForm({ ...form, targetPct: e.target.value })}
                      inputMode="decimal"
                      placeholder="25"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-rose-700"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="holding-price" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    {form.assetType === 'market' ? 'Price (USD)' : 'Current value (USD)'}
                    {form.assetType === 'market' && <span className="text-slate-600"> (optional)</span>}
                  </label>
                  <input
                    id="holding-price"
                    value={form.price}
                    onChange={e => setForm({ ...form, price: e.target.value })}
                    inputMode="decimal"
                    placeholder={form.assetType === 'market' ? 'Auto-filled by live quotes' : 'Enter the current value'}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-rose-700"
                  />
                  {form.assetType === 'home' && (
                    <p className="text-[10px] text-slate-500 mt-1">For a net-worth allocation, enter your equity: market value minus the remaining mortgage.</p>
                  )}
                  {form.assetType === 'car' && (
                    <p className="text-[10px] text-slate-500 mt-1">Use the vehicle’s current resale value.</p>
                  )}
                </div>

                <button type="submit" className="w-full bg-rose-600 text-white py-3 rounded-xl hover:bg-rose-700 transition-colors font-bold text-sm shadow-lg shadow-rose-900/20">
                  {modal.holding ? 'Save Changes' : 'Add to Portfolio'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Portfolio-wide asset-class catalog */}
      <AnimatePresence>
        {showClassManager && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={() => setShowClassManager(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl w-full max-w-lg shadow-2xl max-h-[92dvh] sm:max-h-[90dvh] flex flex-col safe-bottom"
            >
              <div className="p-4 sm:p-6 pb-4 flex items-start justify-between gap-4 border-b border-slate-800">
                <div>
                  <h2 className="text-lg font-black text-white flex items-center gap-2">
                    <Tags className="w-5 h-5 text-rose-400" /> Asset classes
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    One saved list for the whole portfolio. Every holding references one class by ID.
                  </p>
                </div>
                <button type="button" onClick={() => setShowClassManager(false)} className="p-2 hover:bg-slate-800 rounded-full" aria-label="Close asset classes">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/50 divide-y divide-slate-800">
                  {assetClasses.map(assetClass => (
                    <div
                      key={assetClass.id}
                      data-testid={`invest-class-option-${assetClass.id}`}
                      className="px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-200 truncate">{assetClass.name}</p>
                        <p className="text-[10px] text-slate-600 font-mono truncate">{assetClass.id}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn(
                          'px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-wider',
                          assetClass.isDefault
                            ? 'bg-slate-800 text-slate-400'
                            : 'bg-rose-900/25 text-rose-300',
                        )}>
                          {assetClass.isDefault ? 'Set class' : 'Custom'}
                        </span>
                        {modal && (
                          <button
                            type="button"
                            onClick={() => {
                              setForm(current => ({ ...current, assetClassId: assetClass.id }));
                              setShowClassManager(false);
                            }}
                            className={cn(
                              'px-2.5 py-1 rounded-lg text-[10px] font-black',
                              form.assetClassId === assetClass.id
                                ? 'bg-rose-600 text-white'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
                            )}
                          >
                            {form.assetClassId === assetClass.id ? 'Selected' : 'Select'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <form onSubmit={handleAddAssetClass} className="space-y-2">
                  <label htmlFor="new-asset-class" className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Add a custom class</label>
                  <div className="flex gap-2">
                    <input
                      id="new-asset-class"
                      value={newClassName}
                      onChange={e => { setNewClassName(e.target.value); setNewClassError(null); }}
                      placeholder="For example: Venture Capital"
                      maxLength={50}
                      autoComplete="off"
                      className="min-w-0 flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-rose-700"
                    />
                    <button type="submit" className="shrink-0 bg-rose-600 text-white px-4 rounded-xl hover:bg-rose-700 transition-colors text-sm font-bold">
                      Add class
                    </button>
                  </div>
                  {newClassError && <p className="text-xs text-amber-400 font-medium">{newClassError}</p>}
                  <p className="text-[10px] text-slate-600">
                    Saved for the household under <code className="font-mono">portfolios / household / assetClasses</code>. Equivalent names reuse the existing class instead of creating a duplicate.
                  </p>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pine script modal */}
      <AnimatePresence>
        {isPineOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setIsPineOpen(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[85dvh]"
            >
              <div className="p-6 pb-4 flex items-center justify-between border-b border-slate-800">
                <div>
                  <h2 className="text-lg font-black text-white flex items-center gap-2"><Code2 className="w-5 h-5 text-rose-400" /> TradingView Pine Script</h2>
                  <p className="text-xs text-slate-500 mt-1">Open tradingview.com → any chart → Pine Editor → paste → “Add to chart”. Market targets are normalized within the market portion.</p>
                </div>
                <button onClick={() => setIsPineOpen(false)} className="p-2 hover:bg-slate-800 rounded-full" aria-label="Close">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              <div className="p-6 pt-4 flex-1 min-h-0 flex flex-col gap-3">
                {marketRows.length > PINE_MAX_HOLDINGS ? (
                  <p className="text-sm text-amber-400 font-medium">
                    TradingView allows {PINE_MAX_HOLDINGS} symbols per script; this portfolio has {marketRows.length} market investments. Trim the list to generate a script.
                  </p>
                ) : (
                  <>
                    <button
                      onClick={copyPine}
                      className={cn(
                        'self-start px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-colors',
                        copied ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white hover:bg-rose-700',
                      )}
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {copied ? 'Copied' : 'Copy script'}
                    </button>
                    <pre data-testid="invest-pine-code" className="flex-1 min-h-0 overflow-auto bg-slate-950 border border-slate-800 rounded-2xl p-4 text-[11px] leading-relaxed font-mono text-slate-300 whitespace-pre">
                      {pineScript}
                    </pre>
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Committing on blur (not per keystroke) keeps decimals typeable and avoids
// a Firestore write per digit.
function DriftThresholdInput({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    // Number('') is 0, so a cleared field must revert, not commit zero.
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 && parsed !== value) {
      onCommit(parsed);
    } else {
      setDraft(String(value));
    }
  };

  return (
    <input
      type="number"
      min={0}
      max={100}
      step={0.5}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="w-20 bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-slate-200 focus:outline-none focus:border-rose-700"
    />
  );
}

interface PortfolioOverviewProps {
  assetClasses: AssetClassRow[];
  totalValue: number;
  targetTotalPct: number;
  unallocatedPct: number;
  colors: Record<string, string>;
  // null = whole portfolio. Selection lives in Invest because it also
  // filters the Holdings panel, not just this donut.
  focusedClass: string | null;
  onFocusClass: (assetClass: string | null) => void;
}

function PortfolioOverview({
  assetClasses,
  totalValue,
  targetTotalPct,
  unallocatedPct,
  colors,
  focusedClass,
  onFocusClass,
}: PortfolioOverviewProps) {
  const selected = focusedClass
    ? assetClasses.find(row => isSameAssetClass(row.assetClass, focusedClass)) ?? null
    : null;
  // Tapping the focused class again returns to the whole portfolio.
  const toggleClass = (assetClass: string) =>
    onFocusClass(isSameAssetClass(assetClass, focusedClass) ? null : assetClass);
  const radius = 72;
  const circumference = 2 * Math.PI * radius;
  let segmentOffset = 0;

  return (
    <aside className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden xl:sticky xl:top-20">
      <div className="p-3.5 sm:p-4 md:p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h2 className="font-black text-white text-sm">Current portfolio</h2>
            <p className="text-[10px] text-slate-500 font-semibold mt-0.5">Select a class to focus its holdings</p>
          </div>
          <p className="text-xs font-black text-slate-300">{formatMoney(totalValue)}</p>
        </div>

        <div className="relative w-full max-w-[180px] sm:max-w-[230px] xl:max-w-[250px] aspect-square mx-auto" data-testid="invest-portfolio-donut">
          <svg viewBox="0 0 200 200" className="w-full h-full" role="img" aria-label="Portfolio asset class chart">
            <circle cx="100" cy="100" r={radius} fill="none" stroke="#1e293b" strokeWidth="24" />
            {assetClasses.map(row => {
              const segmentLength = Math.max(0, (row.actualPct / 100) * circumference);
              const dashOffset = -segmentOffset;
              segmentOffset += segmentLength;
              return (
                <circle
                  key={row.assetClass}
                  cx="100"
                  cy="100"
                  r={radius}
                  fill="none"
                  stroke={colors[row.assetClass] ?? PORTFOLIO_COLORS[0]}
                  strokeWidth={selected?.assetClass === row.assetClass ? 28 : 24}
                  strokeDasharray={`${segmentLength} ${Math.max(0, circumference - segmentLength)}`}
                  strokeDashoffset={dashOffset}
                  transform="rotate(-90 100 100)"
                  className="cursor-pointer transition-[stroke-width,opacity] hover:opacity-90"
                  onClick={() => toggleClass(row.assetClass)}
                >
                  <title>{row.assetClass}: {formatPct(row.actualPct)} of portfolio</title>
                </circle>
              );
            })}
          </svg>
          <div data-testid="invest-donut-center" className="absolute inset-[26%] rounded-full bg-slate-900 flex flex-col items-center justify-center text-center px-2 pointer-events-none">
            <p className="text-xs font-black text-white leading-tight line-clamp-2">{selected?.assetClass ?? 'Total portfolio'}</p>
            <p className="text-lg font-black text-slate-200 mt-1">{formatPct(selected ? selected.actualPct : totalValue > 0 ? 100 : 0)}</p>
            <p className="text-[10px] text-slate-500 font-semibold">{formatMoney(selected ? selected.value : totalValue)}</p>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-800 p-3 sm:p-4 space-y-1">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Asset classes</h3>
          <span className={cn('text-[10px] font-black', Math.abs(targetTotalPct - 100) > 0.01 ? 'text-amber-400' : 'text-emerald-400')}>
            {formatPct(targetTotalPct)} set
          </span>
        </div>
        <button
          type="button"
          data-testid="invest-total-portfolio"
          aria-current={focusedClass === null ? 'true' : undefined}
          onClick={() => onFocusClass(null)}
          className={cn(
            'w-full rounded-xl px-2.5 py-2 text-left transition-colors',
            focusedClass === null ? 'bg-slate-800/80' : 'hover:bg-slate-800/45',
          )}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="min-w-0 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-slate-500" />
              <span className="text-xs font-black text-slate-200 truncate">Total Portfolio</span>
            </span>
            <span className="text-[11px] font-black text-slate-300 shrink-0">{formatMoney(totalValue)}</span>
          </span>
          <span className="block pl-[18px] text-[9px] text-slate-500 font-semibold mt-0.5">
            Every holding in every class
          </span>
        </button>
        {assetClasses.map(row => (
            <button
              key={row.assetClass}
              type="button"
              data-testid={`invest-asset-class-${row.assetClass}`}
              aria-current={isSameAssetClass(row.assetClass, focusedClass) ? 'true' : undefined}
              onClick={() => toggleClass(row.assetClass)}
              className={cn(
                'w-full rounded-xl px-2.5 py-2 text-left transition-colors',
                isSameAssetClass(row.assetClass, focusedClass) ? 'bg-slate-800/80' : 'hover:bg-slate-800/45',
              )}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: colors[row.assetClass] ?? PORTFOLIO_COLORS[0] }} />
                  <span className="text-xs font-black text-slate-200 truncate">{row.assetClass}</span>
                </span>
                <span className="text-[11px] font-black text-slate-300 shrink-0">{formatMoney(row.value)}</span>
              </span>
              <span className="block pl-[18px] text-[9px] text-slate-500 font-semibold mt-0.5">
                {formatPct(row.actualPct)} of portfolio · {formatPct(row.targetPct)} target
              </span>
              <span className="block pl-[18px] text-[9px] text-slate-600 font-medium mt-0.5">
                {row.rows.length} {row.rows.length === 1 ? 'holding' : 'holdings'}
              </span>
            </button>
        ))}
        {Math.abs(targetTotalPct - 100) > 0.01 && (
          <p className="text-[10px] font-semibold text-amber-400/90 bg-amber-900/15 border border-amber-900/30 rounded-xl px-3 py-2 mt-3">
            {unallocatedPct > 0 ? `${formatPct(unallocatedPct)} remains unallocated.` : `Targets are ${formatPct(-unallocatedPct)} over 100%.`}
          </p>
        )}
      </div>
    </aside>
  );
}

interface HoldingTableRowProps {
  row: HoldingRow;
  assetClass: string;
  color: string;
  classValue: number;
  scaleMax: number;
  driftThresholdPct: number;
  quoteError?: string;
  expanded: boolean;
  armedDelete: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function HoldingTableRow({ row, assetClass, color, classValue, scaleMax, driftThresholdPct, quoteError, expanded, armedDelete, onToggle, onEdit, onDelete }: HoldingTableRowProps) {
  const { holding } = row;
  const isMarket = isMarketHolding(holding);
  const assetType = assetTypeForHolding(holding);
  const displayName = displayNameForHolding(holding);
  const overThreshold = Math.abs(row.driftPct) > driftThresholdPct;
  const nearThreshold = !overThreshold && Math.abs(row.driftPct) > driftThresholdPct * 0.8;
  const DriftIcon = row.driftPct > 0.05 ? ArrowUp : row.driftPct < -0.05 ? ArrowDown : Minus;
  const priceAge = timeAgo(holding.priceUpdatedAt);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      data-testid={`invest-holding-${holding.symbol}`}
      className="border-b border-slate-800 last:border-b-0"
    >
      <button
        type="button"
        data-testid={`invest-mobile-holding-${holding.symbol}`}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${displayName}`}
        className="lg:hidden w-full px-3.5 sm:px-4 py-3.5 text-left hover:bg-slate-800/30 active:bg-slate-800/45 transition-colors"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 flex items-start gap-2.5">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0 mt-1" style={{ backgroundColor: color }} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-slate-100">{displayName}</span>
              {holding.name && isMarket && (
                <span className="block truncate font-mono text-[10px] text-slate-500 font-semibold mt-0.5">{holding.symbol}</span>
              )}
              <span className="block text-[10px] text-slate-500 font-semibold mt-0.5 truncate">{assetClass}</span>
            </span>
          </span>
          <span className="shrink-0 flex items-start gap-2">
            <span className="text-right">
              <span className="block text-sm font-black text-white tabular-nums">{formatMoney(row.value)}</span>
              <span className={cn(
                'mt-1 text-[10px] font-black flex items-center justify-end gap-0.5',
                overThreshold ? 'text-rose-400' : nearThreshold ? 'text-amber-400' : 'text-emerald-400',
              )}>
                <DriftIcon className="w-3 h-3" />
                {row.driftPct >= 0 ? '+' : ''}{formatPct(row.driftPct)}
              </span>
            </span>
            <ChevronRight className={cn('w-4 h-4 mt-0.5 text-slate-500 transition-transform', expanded && 'rotate-90')} />
          </span>
        </span>
        <span className="block mt-3">
          <span className="flex items-center justify-between gap-3 text-[10px] font-bold">
            <span className="text-slate-300">{formatPct(row.actualPct)} current</span>
            <span className="text-slate-500">{formatPct(holding.targetPct)} target</span>
          </span>
          <span className="relative block h-2 mt-1.5 rounded-full bg-slate-800 overflow-hidden" role="img" aria-label={`${holding.symbol}: currently ${formatPct(row.actualPct)} of the portfolio`}>
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, (row.actualPct / scaleMax) * 100)}%`, backgroundColor: color }} />
            <span className="absolute inset-y-[-2px] w-px bg-slate-200/80" style={{ left: `${Math.min(100, (holding.targetPct / scaleMax) * 100)}%` }} />
          </span>
        </span>
      </button>

      <div className="hidden lg:grid grid-cols-[minmax(290px,1.7fr)_minmax(190px,1fr)_100px_140px] gap-4 items-center px-5 py-3.5 hover:bg-slate-800/30 transition-colors">
        <div className="min-w-0 flex items-center gap-2.5">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${displayName}`}
            className="p-1 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 shrink-0"
          >
            <ChevronRight className={cn('w-4 h-4 transition-transform', expanded && 'rotate-90')} />
          </button>
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
          <div className="min-w-0">
            <p className="truncate text-xs font-black text-slate-100">
              {displayName}
              {holding.name && isMarket && <span className="font-mono text-slate-500 font-semibold"> · {holding.symbol}</span>}
            </p>
            <p className="text-[9px] text-slate-500 font-semibold mt-0.5 truncate">{assetClass}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-12 text-right text-xs font-black text-slate-200 shrink-0">{formatPct(row.actualPct)}</span>
          <div className="relative h-3 flex-1 rounded-sm bg-slate-800" role="img" aria-label={`${holding.symbol}: currently ${formatPct(row.actualPct)} of the portfolio`}>
            <div className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.min(100, (row.actualPct / scaleMax) * 100)}%`, backgroundColor: color }} />
          </div>
        </div>
        <p className="text-right text-xs font-semibold text-slate-300">{formatPct(holding.targetPct)}</p>
        <p className="text-right text-xs font-black text-white">{formatMoney(row.value)}</p>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 sm:px-4 lg:px-14 pb-4 pt-1 bg-slate-950/25 border-t border-slate-800/70">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 py-3">
                <div>
                  <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Position</p>
                  <p className="text-[10px] text-slate-400 font-semibold mt-1">
                    {isMarket ? `${formatUnits(holding.quantity)} × ${formatMoney(holding.price)}` : `${ASSET_TYPE_LABELS[assetType]} · manual value`}
                    {isMarket && holding.priceSource === 'live' && priceAge && ` · live ${priceAge}`}
                    {isMarket && holding.priceSource === 'manual' && ' · manual price'}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Classification</p>
                  <p className="text-[10px] text-slate-400 font-semibold mt-1">{assetClass}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Class share</p>
                  <p className="text-[10px] text-slate-400 font-semibold mt-1">{formatPct(classValue > 0 ? (row.value / classValue) * 100 : 0)} of {assetClass}</p>
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-600 uppercase tracking-widest">Drift</p>
                  <p className={cn(
                    'text-[10px] font-black mt-1 flex items-center gap-1',
                    overThreshold ? 'text-rose-400' : nearThreshold ? 'text-amber-400' : 'text-emerald-400',
                  )}>
                    <DriftIcon className="w-3 h-3" />
                    {row.driftPct >= 0 ? '+' : ''}{formatPct(row.driftPct)}
                  </p>
                </div>
              </div>

              {quoteError && <p className="text-[10px] text-amber-400 font-semibold mb-2">Live quote failed; the last saved price is still shown.</p>}
              {isMarket && overThreshold && row.tradeValue !== 0 && (
                <p className="text-[10px] font-bold text-slate-300 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 mb-2">
                  {row.tradeValue > 0 ? 'Buy' : 'Sell'} about {formatMoney(Math.abs(row.tradeValue))}
                  {row.tradeUnits !== null && (
                    <span className="text-slate-500"> (~{formatUnits(Math.abs(row.tradeUnits))} {formatUnits(Math.abs(row.tradeUnits)) === '1' ? 'unit' : 'units'})</span>
                  )}
                  {' '}to reach {formatPct(holding.targetPct)}.
                </p>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button onClick={onEdit} aria-label={`Edit ${displayName}`} className="px-3 py-1.5 rounded-lg text-[10px] font-black text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors inline-flex items-center gap-1.5">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                <button
                  onClick={onDelete}
                  aria-label={armedDelete ? `Confirm delete ${displayName}` : `Delete ${displayName}`}
                  className={cn(
                    'px-3 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5 text-[10px] font-black',
                    armedDelete ? 'bg-red-900/50 text-red-300' : 'bg-red-900/20 text-red-400 hover:bg-red-900/35',
                  )}
                >
                  <Trash2 className="w-3 h-3" /> {armedDelete ? 'Confirm delete' : 'Delete'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
