import React, { useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, deleteField, updateDoc } from 'firebase/firestore';
import { Plus, Phone, Mail, Globe, Pencil, Trash2, X, Wrench } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { userRoot, db, auth } from '../../firebase';
import { Vendor } from '../../types';
import { trackWrite } from '../../lib/syncStatus';
import AttachmentsPanel from './AttachmentsPanel';

const SUGGESTED_SERVICES = [
  'Plumbing', 'Electrical', 'HVAC', 'Lawn & Landscaping', 'Pest Control',
  'Appliance Repair', 'Roofing', 'Cleaning', 'Handyman', 'Auto', 'Other',
];

interface FormValues {
  name: string;
  serviceType: string;
  phone: string;
  email: string;
  website: string;
  notes: string;
}

const emptyForm: FormValues = { name: '', serviceType: 'Plumbing', phone: '', email: '', website: '', notes: '' };

const formFor = (v: Vendor): FormValues => ({
  name: v.name,
  serviceType: v.serviceType,
  phone: v.phone ?? '',
  email: v.email ?? '',
  website: v.website ?? '',
  notes: v.notes ?? '',
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeWebsite(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function validate(form: FormValues): string | null {
  if (!form.name.trim() || form.name.trim().length > 200) return 'Name is required (up to 200 characters).';
  if (!form.serviceType.trim() || form.serviceType.trim().length > 100) return 'Service type is required (up to 100 characters).';
  if (form.phone.trim().length > 50) return 'Phone number is too long.';
  if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) return 'Enter a valid email address, or leave it blank.';
  if (normalizeWebsite(form.website).length > 500) return 'Website URL is too long.';
  if (form.notes.length > 5000) return 'Notes are too long.';
  return null;
}

interface VendorsDirectoryProps {
  vendors: Vendor[];
  loaded: boolean;
}

export default function VendorsDirectory({ vendors, loaded }: VendorsDirectoryProps) {
  const [modal, setModal] = useState<{ vendor: Vendor | null } | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Vendor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  // Keep the open detail sheet in sync with the latest snapshot data.
  const detailVendor = detail ? vendors.find(v => v.id === detail.id) ?? null : null;

  const grouped = useMemo(() => {
    const map = new Map<string, Vendor[]>();
    for (const v of [...vendors].sort((a, b) => a.name.localeCompare(b.name))) {
      const key = v.serviceType || 'Other';
      (map.get(key) ?? map.set(key, []).get(key)!).push(v);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [vendors]);

  const openAdd = () => { setForm(emptyForm); setFormError(null); setModal({ vendor: null }); };
  const openEdit = (vendor: Vendor) => { setForm(formFor(vendor)); setFormError(null); setModal({ vendor }); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    const problem = validate(form);
    if (problem) { setFormError(problem); return; }
    const now = new Date().toISOString();
    const website = normalizeWebsite(form.website);
    const base: Record<string, unknown> = {
      name: form.name.trim(),
      serviceType: form.serviceType.trim(),
    };
    // Omit empty optionals: an empty email would fail the rules' email check.
    const optional = (v: string) => v.trim();
    if (modal?.vendor?.id) {
      trackWrite(updateDoc(doc(userRoot(), 'vendors', modal.vendor.id), {
        ...base,
        phone: optional(form.phone) || deleteField(),
        email: optional(form.email) || deleteField(),
        website: website || deleteField(),
        notes: optional(form.notes) || deleteField(),
        updatedAt: now,
      })).catch(err => handleWriteError(err));
    } else {
      trackWrite(addDoc(collection(userRoot(), 'vendors'), {
        ...base,
        ...(optional(form.phone) ? { phone: form.phone.trim() } : {}),
        ...(optional(form.email) ? { email: form.email.trim() } : {}),
        ...(website ? { website } : {}),
        ...(optional(form.notes) ? { notes: form.notes.trim() } : {}),
        createdBy: auth.currentUser.uid,
        authorName: auth.currentUser.displayName || 'Explorer',
        createdAt: now,
      })).catch(err => handleWriteError(err));
    }
    setModal(null);
  };

  const handleWriteError = (err: any) => {
    console.error('Vendor write failed:', err);
    setError('Could not save the vendor. You might not have permission.');
  };

  const handleDelete = (vendor: Vendor) => {
    if (!vendor.id) return;
    if (armedDelete !== vendor.id) {
      setArmedDelete(vendor.id);
      setTimeout(() => setArmedDelete(cur => (cur === vendor.id ? null : cur)), 3000);
      return;
    }
    setArmedDelete(null);
    setDetail(null);
    trackWrite(deleteDoc(doc(userRoot(), 'vendors', vendor.id))).catch(err => {
      console.error('Vendor delete failed:', err);
      setError('Could not delete the vendor.');
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{vendors.length} vendor{vendors.length === 1 ? '' : 's'}</p>
        <button
          onClick={openAdd}
          data-testid="vendors-add"
          className="bg-orange-600 text-white px-3 md:px-4 py-2 rounded-xl hover:bg-orange-700 transition-colors shadow-lg shadow-orange-900/20 flex items-center gap-1.5 text-sm font-bold"
        >
          <Plus className="w-4 h-4" /> Add<span className="hidden md:inline"> Vendor</span>
        </button>
      </div>

      {error && <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm">{error}</div>}

      {!loaded ? (
        <p className="text-slate-500 text-sm">Loading vendors…</p>
      ) : vendors.length === 0 ? (
        <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-10 text-center space-y-3">
          <Wrench className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-slate-400 text-sm font-semibold">No vendors yet.</p>
          <p className="text-slate-500 text-xs max-w-sm mx-auto">Add the people and companies you use — plumber, electrician, HVAC — with their contact info and documents.</p>
          <button onClick={openAdd} className="bg-orange-600 text-white px-4 py-2 rounded-xl hover:bg-orange-700 text-sm font-bold inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Add your first vendor
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([service, list]) => (
            <section key={service} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <h3 className="text-sm font-bold text-orange-400 uppercase tracking-wider">{service}</h3>
                <div className="h-px flex-1 bg-slate-800" />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                {list.map(vendor => (
                  <motion.button
                    layout
                    key={vendor.id}
                    onClick={() => setDetail(vendor)}
                    data-testid={`vendor-${vendor.name}`}
                    className="text-left bg-slate-900 border border-slate-800 rounded-2xl p-4 hover:border-slate-700 transition-colors"
                  >
                    <p className="font-black text-white text-sm truncate">{vendor.name}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-slate-400">
                      {vendor.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{vendor.phone}</span>}
                      {vendor.email && <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3" />{vendor.email}</span>}
                      {vendor.website && <span className="flex items-center gap-1"><Globe className="w-3 h-3" />Website</span>}
                    </div>
                  </motion.button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Detail sheet */}
      <AnimatePresence>
        {detailVendor && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
            onClick={() => setDetail(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md shadow-2xl max-h-[90dvh] overflow-y-auto"
            >
              <div className="p-6 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-black text-white truncate">{detailVendor.name}</h2>
                    <p className="text-xs text-orange-400 font-bold uppercase tracking-wider">{detailVendor.serviceType}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => { setDetail(null); openEdit(detailVendor); }} className="p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800" aria-label={`Edit ${detailVendor.name}`}>
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(detailVendor)}
                      className={armedDelete === detailVendor.id ? 'p-2 rounded-lg bg-red-900/40 text-red-400 text-[10px] font-bold flex items-center gap-1' : 'p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-900/20'}
                      aria-label={armedDelete === detailVendor.id ? `Confirm delete ${detailVendor.name}` : `Delete ${detailVendor.name}`}
                    >
                      <Trash2 className="w-4 h-4" />{armedDelete === detailVendor.id && 'Sure?'}
                    </button>
                    <button onClick={() => setDetail(null)} className="p-2 hover:bg-slate-800 rounded-full" aria-label="Close">
                      <X className="w-5 h-5 text-slate-400" />
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {detailVendor.phone && <a href={`tel:${detailVendor.phone}`} className="flex items-center gap-2 text-sm text-slate-200 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 hover:border-slate-700"><Phone className="w-4 h-4 text-orange-400" />{detailVendor.phone}</a>}
                  {detailVendor.email && <a href={`mailto:${detailVendor.email}`} className="flex items-center gap-2 text-sm text-slate-200 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 hover:border-slate-700 truncate"><Mail className="w-4 h-4 text-orange-400 shrink-0" /><span className="truncate">{detailVendor.email}</span></a>}
                  {detailVendor.website && <a href={detailVendor.website} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 text-sm text-slate-200 bg-slate-950/60 border border-slate-800 rounded-xl px-3 py-2 hover:border-slate-700 truncate"><Globe className="w-4 h-4 text-orange-400 shrink-0" /><span className="truncate">{detailVendor.website.replace(/^https?:\/\//, '')}</span></a>}
                </div>

                {detailVendor.notes && <p className="text-sm text-slate-300 whitespace-pre-wrap bg-slate-950/40 rounded-xl p-3 border border-slate-800">{detailVendor.notes}</p>}

                <div className="pt-2 border-t border-slate-800">
                  <AttachmentsPanel parentType="vendors" parentId={detailVendor.id!} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add / edit modal */}
      <AnimatePresence>
        {modal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
            onClick={() => setModal(null)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md shadow-2xl max-h-[90dvh] overflow-y-auto"
            >
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-black text-white">{modal.vendor ? 'Edit Vendor' : 'Add Vendor'}</h2>
                  <button type="button" onClick={() => setModal(null)} className="p-2 hover:bg-slate-800 rounded-full" aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
                </div>
                {formError && <p className="p-3 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-xs">{formError}</p>}

                <Field label="Name">
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus={!modal.vendor} placeholder="Acme Plumbing" maxLength={200} className={inputClass} />
                </Field>
                <Field label="Service type">
                  <input value={form.serviceType} onChange={e => setForm({ ...form, serviceType: e.target.value })} list="vendor-service-options" placeholder="Plumbing" maxLength={100} className={inputClass} />
                  <datalist id="vendor-service-options">{SUGGESTED_SERVICES.map(s => <option key={s} value={s} />)}</datalist>
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Phone" optional>
                    <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} inputMode="tel" placeholder="(555) 123-4567" maxLength={50} className={inputClass} />
                  </Field>
                  <Field label="Email" optional>
                    <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} inputMode="email" placeholder="hello@acme.com" maxLength={320} className={inputClass} />
                  </Field>
                </div>
                <Field label="Website" optional>
                  <input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} inputMode="url" placeholder="acmeplumbing.com" maxLength={500} className={inputClass} />
                </Field>
                <Field label="Notes" optional>
                  <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} placeholder="Account number, gate code, who to ask for…" maxLength={5000} className={`${inputClass} resize-none`} />
                </Field>

                <button type="submit" className="w-full bg-orange-600 text-white py-3 rounded-xl hover:bg-orange-700 font-bold text-sm shadow-lg shadow-orange-900/20">
                  {modal.vendor ? 'Save Changes' : 'Add to Directory'}
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
      <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
        {label}{optional && <span className="text-slate-600"> (optional)</span>}
      </span>
      {children}
    </label>
  );
}
