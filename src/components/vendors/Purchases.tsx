import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, deleteField, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { Plus, Pencil, Trash2, X, ShieldCheck, ShieldAlert, ShieldX, Receipt, Link2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { userRoot, db, auth, handleFirestoreError, OperationType } from '../../firebase';
import { Purchase, Vendor } from '../../types';
import { clearSnapshotMetadata, reportSnapshotMetadata, trackWrite } from '../../lib/syncStatus';
import { WarrantyStatus, daysUntil, warrantyStatus } from '../../lib/warranty';
import AttachmentsPanel from './AttachmentsPanel';

interface FormValues {
  itemName: string;
  vendorId: string;
  purchasedFrom: string;
  purchaseDate: string;
  price: string;
  warrantyExpires: string;
  notes: string;
}

const todayISO = (): string => {
  // Local date-only string for the date input default.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyForm = (): FormValues => ({ itemName: '', vendorId: '', purchasedFrom: '', purchaseDate: todayISO(), price: '', warrantyExpires: '', notes: '' });

const formFor = (p: Purchase): FormValues => ({
  itemName: p.itemName,
  vendorId: p.vendorId ?? '',
  purchasedFrom: p.purchasedFrom ?? '',
  purchaseDate: p.purchaseDate,
  price: p.price != null ? String(p.price) : '',
  warrantyExpires: p.warrantyExpires ?? '',
  notes: p.notes ?? '',
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NUMERIC = 1_000_000_000_000;

function validate(form: FormValues): string | null {
  if (!form.itemName.trim() || form.itemName.trim().length > 200) return 'Item name is required (up to 200 characters).';
  if (!DATE_PATTERN.test(form.purchaseDate)) return 'A purchase date is required.';
  if (form.purchasedFrom.length > 200) return 'Purchased-from is too long.';
  if (form.price.trim()) {
    const n = Number(form.price);
    if (!Number.isFinite(n) || n < 0 || n > MAX_NUMERIC) return 'Enter a valid price, or leave it blank.';
  }
  if (form.warrantyExpires && !DATE_PATTERN.test(form.warrantyExpires)) return 'Enter a valid warranty date, or leave it blank.';
  if (form.notes.length > 5000) return 'Notes are too long.';
  return null;
}

const BADGE: Record<WarrantyStatus, { label: (d: number | null) => string; className: string; Icon: typeof ShieldCheck } | null> = {
  none: null,
  active: { label: () => 'Under warranty', className: 'text-emerald-400 bg-emerald-900/30 border-emerald-800/50', Icon: ShieldCheck },
  expiring: { label: d => (d != null ? `Expires in ${d}d` : 'Expiring soon'), className: 'text-amber-400 bg-amber-900/30 border-amber-800/50', Icon: ShieldAlert },
  expired: { label: () => 'Expired', className: 'text-rose-400 bg-rose-900/30 border-rose-800/50', Icon: ShieldX },
};

function WarrantyBadge({ warrantyExpires }: { warrantyExpires?: string }) {
  const today = new Date();
  const status = warrantyStatus(warrantyExpires, today);
  const badge = BADGE[status];
  if (!badge) return null;
  const { Icon } = badge;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.className}`}>
      <Icon className="w-3 h-3" />{badge.label(daysUntil(warrantyExpires, today))}
    </span>
  );
}

interface PurchasesProps {
  vendors: Vendor[];
}

export default function Purchases({ vendors }: PurchasesProps) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [modal, setModal] = useState<{ purchase: Purchase | null } | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Purchase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  React.useEffect(() => {
    const source = 'purchases';
    const q = query(collection(userRoot(), 'purchases'), orderBy('purchaseDate', 'desc'));
    const unsubscribe = onSnapshot(q, { includeMetadataChanges: true }, snapshot => {
      reportSnapshotMetadata(source, snapshot.metadata);
      setPurchases(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Purchase)));
      setLoaded(true);
      setError(null);
    }, err => {
      clearSnapshotMetadata(source);
      console.error('Failed to load purchases:', err);
      setError('Failed to load purchases. You might not have permission.');
      try { handleFirestoreError(err, OperationType.LIST, 'purchases'); } catch { /* state already set */ }
    });
    return () => { clearSnapshotMetadata(source); unsubscribe(); };
  }, []);

  const vendorName = useMemo(() => {
    const map = new Map(vendors.map(v => [v.id, v.name]));
    return (id?: string) => (id ? map.get(id) : undefined);
  }, [vendors]);

  const detailPurchase = detail ? purchases.find(p => p.id === detail.id) ?? null : null;

  const openAdd = () => { setForm(emptyForm()); setFormError(null); setModal({ purchase: null }); };
  const openEdit = (purchase: Purchase) => { setForm(formFor(purchase)); setFormError(null); setModal({ purchase }); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    const problem = validate(form);
    if (problem) { setFormError(problem); return; }
    const now = new Date().toISOString();
    const base: Record<string, unknown> = {
      itemName: form.itemName.trim(),
      purchaseDate: form.purchaseDate,
    };
    const hasPrice = form.price.trim() !== '';
    if (modal?.purchase?.id) {
      trackWrite(updateDoc(doc(userRoot(), 'purchases', modal.purchase.id), {
        ...base,
        vendorId: form.vendorId || deleteField(),
        purchasedFrom: form.purchasedFrom.trim() || deleteField(),
        price: hasPrice ? Number(form.price) : deleteField(),
        warrantyExpires: form.warrantyExpires || deleteField(),
        notes: form.notes.trim() || deleteField(),
        updatedAt: now,
      })).catch(handleWriteError);
    } else {
      trackWrite(addDoc(collection(userRoot(), 'purchases'), {
        ...base,
        ...(form.vendorId ? { vendorId: form.vendorId } : {}),
        ...(form.purchasedFrom.trim() ? { purchasedFrom: form.purchasedFrom.trim() } : {}),
        ...(hasPrice ? { price: Number(form.price) } : {}),
        ...(form.warrantyExpires ? { warrantyExpires: form.warrantyExpires } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        createdBy: auth.currentUser.uid,
        authorName: auth.currentUser.displayName || 'Explorer',
        createdAt: now,
      })).catch(handleWriteError);
    }
    setModal(null);
  };

  const handleWriteError = (err: any) => {
    console.error('Purchase write failed:', err);
    setError('Could not save the purchase. You might not have permission.');
  };

  const handleDelete = (purchase: Purchase) => {
    if (!purchase.id) return;
    if (armedDelete !== purchase.id) {
      setArmedDelete(purchase.id);
      setTimeout(() => setArmedDelete(cur => (cur === purchase.id ? null : cur)), 3000);
      return;
    }
    setArmedDelete(null);
    setDetail(null);
    trackWrite(deleteDoc(doc(userRoot(), 'purchases', purchase.id))).catch(err => {
      console.error('Purchase delete failed:', err);
      setError('Could not delete the purchase.');
    });
  };

  const formatPrice = (n?: number) => (n == null ? null : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{purchases.length} purchase{purchases.length === 1 ? '' : 's'}</p>
        <button onClick={openAdd} data-testid="purchases-add" className="bg-orange-600 text-white px-3 md:px-4 py-2 rounded-xl hover:bg-orange-700 transition-colors shadow-lg shadow-orange-900/20 flex items-center gap-1.5 text-sm font-bold">
          <Plus className="w-4 h-4" /> Add<span className="hidden md:inline"> Purchase</span>
        </button>
      </div>

      {error && <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm">{error}</div>}

      {!loaded ? (
        <p className="text-slate-500 text-sm">Loading purchases…</p>
      ) : purchases.length === 0 ? (
        <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <Receipt className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-slate-400 text-sm font-semibold">No purchases yet.</p>
          <p className="text-slate-500 text-xs max-w-sm mx-auto">Log appliances and big purchases with their warranty dates and receipts so you always know what's still covered.</p>
          <button onClick={openAdd} className="bg-orange-600 text-white px-4 py-2 rounded-xl hover:bg-orange-700 text-sm font-bold inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Add your first purchase
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {purchases.map(purchase => (
            <motion.button
              layout
              key={purchase.id}
              onClick={() => setDetail(purchase)}
              data-testid={`purchase-${purchase.itemName}`}
              className="w-full text-left bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-colors flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-black text-white text-sm truncate">{purchase.itemName}</p>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {purchase.purchaseDate}
                  {(vendorName(purchase.vendorId) || purchase.purchasedFrom) && <span> · {vendorName(purchase.vendorId) ?? purchase.purchasedFrom}</span>}
                  {formatPrice(purchase.price) && <span> · {formatPrice(purchase.price)}</span>}
                </p>
              </div>
              <WarrantyBadge warrantyExpires={purchase.warrantyExpires} />
            </motion.button>
          ))}
        </div>
      )}

      {/* Detail sheet */}
      <AnimatePresence>
        {detailPurchase && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setDetail(null)}>
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} onClick={e => e.stopPropagation()} className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md shadow-2xl max-h-[90dvh] overflow-y-auto">
              <div className="p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-white truncate">{detailPurchase.itemName}</h2>
                    <div className="mt-1"><WarrantyBadge warrantyExpires={detailPurchase.warrantyExpires} /></div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => { setDetail(null); openEdit(detailPurchase); }} className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800" aria-label={`Edit ${detailPurchase.itemName}`}><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(detailPurchase)} className={armedDelete === detailPurchase.id ? 'p-2 rounded-lg bg-red-900/40 text-red-400 text-[10px] font-bold flex items-center gap-1' : 'p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-900/20'} aria-label={armedDelete === detailPurchase.id ? `Confirm delete ${detailPurchase.itemName}` : `Delete ${detailPurchase.itemName}`}><Trash2 className="w-4 h-4" />{armedDelete === detailPurchase.id && 'Sure?'}</button>
                    <button onClick={() => setDetail(null)} className="p-2 hover:bg-slate-800 rounded-full" aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
                  </div>
                </div>

                <dl className="space-y-1.5 text-sm">
                  <Row label="Purchased" value={detailPurchase.purchaseDate} />
                  {(vendorName(detailPurchase.vendorId) || detailPurchase.purchasedFrom) && (
                    <Row label="From" value={<span className="flex items-center gap-1">{vendorName(detailPurchase.vendorId) && <Link2 className="w-3 h-3 text-orange-400" />}{vendorName(detailPurchase.vendorId) ?? detailPurchase.purchasedFrom}</span>} />
                  )}
                  {formatPrice(detailPurchase.price) && <Row label="Price" value={formatPrice(detailPurchase.price)!} />}
                  {detailPurchase.warrantyExpires && <Row label="Warranty ends" value={detailPurchase.warrantyExpires} />}
                </dl>

                {detailPurchase.notes && <p className="text-sm text-slate-300 whitespace-pre-wrap bg-slate-950/40 rounded-xl p-3 border border-slate-800">{detailPurchase.notes}</p>}

                <div className="pt-2 border-t border-slate-800">
                  <AttachmentsPanel parentType="purchases" parentId={detailPurchase.id!} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add / edit modal */}
      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4" onClick={() => setModal(null)}>
            <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} onClick={e => e.stopPropagation()} className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md shadow-2xl max-h-[90dvh] overflow-y-auto">
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-black text-white">{modal.purchase ? 'Edit Purchase' : 'Add Purchase'}</h2>
                  <button type="button" onClick={() => setModal(null)} className="p-2 hover:bg-slate-800 rounded-full" aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
                </div>
                {formError && <p className="p-3 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-xs">{formError}</p>}

                <Field label="Item">
                  <input value={form.itemName} onChange={e => setForm({ ...form, itemName: e.target.value })} autoFocus={!modal.purchase} placeholder="LG Refrigerator" maxLength={200} className={inputClass} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Purchase date">
                    <input type="date" value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label="Price" optional>
                    <input value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} inputMode="decimal" placeholder="1299.00" className={inputClass} />
                  </Field>
                </div>
                <Field label="Vendor" optional>
                  <select aria-label="Vendor" value={form.vendorId} onChange={e => setForm({ ...form, vendorId: e.target.value })} className={inputClass}>
                    <option value="">— Not linked —</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </Field>
                {!form.vendorId && (
                  <Field label="Purchased from" optional>
                    <input value={form.purchasedFrom} onChange={e => setForm({ ...form, purchasedFrom: e.target.value })} placeholder="Best Buy" maxLength={200} className={inputClass} />
                  </Field>
                )}
                <Field label="Warranty ends" optional>
                  <input type="date" value={form.warrantyExpires} onChange={e => setForm({ ...form, warrantyExpires: e.target.value })} className={inputClass} />
                </Field>
                <Field label="Notes" optional>
                  <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Model / serial number, extended warranty details…" maxLength={5000} className={`${inputClass} resize-none`} />
                </Field>

                <button type="submit" className="w-full bg-orange-600 text-white py-3 rounded-xl hover:bg-orange-700 font-bold text-sm shadow-lg shadow-orange-900/20">
                  {modal.purchase ? 'Save Changes' : 'Add to Purchases'}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const inputClass = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-orange-700';

// The label wraps its control so getByLabel and assistive tech resolve it.
function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">{label}{optional && <span className="text-slate-600"> (optional)</span>}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-slate-950/40 border border-slate-800 rounded-xl px-3 py-2">
      <dt className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{label}</dt>
      <dd className="text-slate-200 font-semibold text-right">{value}</dd>
    </div>
  );
}
