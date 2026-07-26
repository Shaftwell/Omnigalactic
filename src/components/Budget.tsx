import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, X, Pencil, Trash2, FolderPlus } from 'lucide-react';
import { userRoot, db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, onSnapshot, deleteDoc, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { BudgetCategory, BudgetKind, BudgetSubcategory } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { clearSnapshotMetadata, reportSnapshotMetadata, trackWrite } from '../lib/syncStatus';
import { summarizeBudget, formatBudgetMoney, formatBudgetNet, budgetKindForCategory, BudgetCategoryRow, BudgetSectionSummary } from '../lib/budget';
import { SHARED_BUDGET_ID, sharedBudgetPath } from '../lib/budgetStorage';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Mirrors the numeric cap in firestore.rules so an oversized amount is rejected
// in the form instead of silently reverting at sync.
const MAX_AMOUNT = 1_000_000_000_000;

const categoriesCol = () => collection(userRoot(), 'budgets', SHARED_BUDGET_ID, 'categories');
const subcategoriesCol = () => collection(userRoot(), 'budgets', SHARED_BUDGET_ID, 'subcategories');
const categoryDoc = (id: string) => doc(userRoot(), 'budgets', SHARED_BUDGET_ID, 'categories', id);
const subcategoryDoc = (id: string) => doc(userRoot(), 'budgets', SHARED_BUDGET_ID, 'subcategories', id);

const nextSortOrder = (items: { sortOrder: number }[]): number =>
  Math.max(0, ...items.map(item => item.sortOrder)) + 10;

type ModalState =
  | { kind: 'category'; category: BudgetCategory | null }
  | { kind: 'subcategory'; categoryId: string; subcategory: BudgetSubcategory | null };

export default function Budget() {
  const uid = auth.currentUser?.uid;
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [subcategories, setSubcategories] = useState<BudgetSubcategory[]>([]);
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [subcategoriesLoaded, setSubcategoriesLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryKind, setCategoryKind] = useState<BudgetKind>('expense');
  const [formError, setFormError] = useState<string | null>(null);
  // A single armed key ('cat:<id>' or 'sub:<id>') powers the two-tap delete
  // confirmation, matching the per-holding delete flow on the Invest tab.
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const source = 'budget-categories';
    const unsubscribe = onSnapshot(categoriesCol(), { includeMetadataChanges: true }, snapshot => {
      reportSnapshotMetadata(source, snapshot.metadata);
      setCategories(snapshot.docs.map(document => ({ id: document.id, ...document.data() } as BudgetCategory)));
      setCategoriesLoaded(true);
      setError(null);
    }, err => {
      clearSnapshotMetadata(source);
      console.error('Failed to load budget categories:', err);
      setError('Failed to load the budget. You might not have permission.');
      try {
        handleFirestoreError(err, OperationType.LIST, sharedBudgetPath('categories'));
      } catch {
        // handleFirestoreError rethrows; the error state above is already set.
      }
    });
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const source = 'budget-subcategories';
    const unsubscribe = onSnapshot(subcategoriesCol(), { includeMetadataChanges: true }, snapshot => {
      reportSnapshotMetadata(source, snapshot.metadata);
      setSubcategories(snapshot.docs.map(document => ({ id: document.id, ...document.data() } as BudgetSubcategory)));
      setSubcategoriesLoaded(true);
    }, err => {
      clearSnapshotMetadata(source);
      console.error('Failed to load budget lines:', err);
      setError('Failed to load the budget. You might not have permission.');
    });
    return () => {
      clearSnapshotMetadata(source);
      unsubscribe();
    };
  }, [uid]);

  const loaded = categoriesLoaded && subcategoriesLoaded;
  const summary = useMemo(() => summarizeBudget(categories, subcategories), [categories, subcategories]);

  const openAddCategory = (kind: BudgetKind = 'expense') => { setModal({ kind: 'category', category: null }); setCategoryKind(kind); setName(''); setAmount(''); setFormError(null); };
  const openEditCategory = (category: BudgetCategory) => { setModal({ kind: 'category', category }); setCategoryKind(budgetKindForCategory(category)); setName(category.name); setAmount(''); setFormError(null); };
  const openAddSubcategory = (categoryId: string) => { setModal({ kind: 'subcategory', categoryId, subcategory: null }); setName(''); setAmount(''); setFormError(null); };
  const openEditSubcategory = (subcategory: BudgetSubcategory) => {
    setModal({ kind: 'subcategory', categoryId: subcategory.categoryId, subcategory });
    setName(subcategory.name);
    setAmount(subcategory.amount ? String(subcategory.amount) : '');
    setFormError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid || !auth.currentUser || !modal) return;
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 100) { setFormError('Enter a name up to 100 characters.'); return; }
    const now = new Date().toISOString();
    const authorName = auth.currentUser.displayName || 'Explorer';

    if (modal.kind === 'category') {
      if (modal.category?.id) {
        trackWrite(updateDoc(categoryDoc(modal.category.id), { name: trimmedName, kind: categoryKind, updatedAt: now })).catch(err => {
          console.error('Failed to update category:', err);
          setError('Failed to save the category. You might not have permission.');
        });
      } else {
        trackWrite(addDoc(categoriesCol(), {
          name: trimmedName,
          kind: categoryKind,
          sortOrder: nextSortOrder(categories),
          createdBy: uid,
          authorName,
          createdAt: now,
        })).catch(err => {
          console.error('Failed to add category:', err);
          setError('Failed to add the category. You might not have permission.');
        });
      }
      setModal(null);
      return;
    }

    // Subcategory: a blank amount is treated as $0 so a line can be added now
    // and priced later.
    const parsedAmount = amount.trim() === '' ? 0 : Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0 || parsedAmount > MAX_AMOUNT) {
      setFormError('Enter an amount between 0 and 1,000,000,000,000.');
      return;
    }
    if (modal.subcategory?.id) {
      trackWrite(updateDoc(subcategoryDoc(modal.subcategory.id), {
        name: trimmedName,
        amount: parsedAmount,
        updatedAt: now,
      })).catch(err => {
        console.error('Failed to update line:', err);
        setError('Failed to save the line. You might not have permission.');
      });
    } else {
      const siblings = subcategories.filter(sub => sub.categoryId === modal.categoryId);
      trackWrite(addDoc(subcategoriesCol(), {
        categoryId: modal.categoryId,
        name: trimmedName,
        amount: parsedAmount,
        sortOrder: nextSortOrder(siblings),
        createdBy: uid,
        authorName,
        createdAt: now,
      })).catch(err => {
        console.error('Failed to add line:', err);
        setError('Failed to add the line. You might not have permission.');
      });
    }
    setModal(null);
  };

  // Two-tap arm shared by every delete button; a second tap within 3s commits.
  const armOrRun = (key: string, run: () => void) => {
    if (armedDelete !== key) {
      setArmedDelete(key);
      setTimeout(() => setArmedDelete(current => (current === key ? null : current)), 3000);
      return;
    }
    setArmedDelete(null);
    run();
  };

  const deleteSubcategory = (subcategory: BudgetSubcategory) => {
    if (!uid || !subcategory.id) return;
    armOrRun(`sub:${subcategory.id}`, () => {
      trackWrite(deleteDoc(subcategoryDoc(subcategory.id!))).catch(err => {
        console.error('Failed to delete line:', err);
        setError('Failed to delete the line. You might not have permission.');
      });
    });
  };

  const deleteCategory = (category: BudgetCategory) => {
    if (!uid || !category.id) return;
    armOrRun(`cat:${category.id}`, () => {
      // Firestore has no subcollection cascade; remove every line in this
      // category and the category itself in one atomic batch.
      const members = subcategories.filter(sub => sub.categoryId === category.id && sub.id);
      const batch = writeBatch(db);
      for (const member of members) batch.delete(subcategoryDoc(member.id!));
      batch.delete(categoryDoc(category.id!));
      trackWrite(batch.commit()).catch(err => {
        console.error('Failed to delete category:', err);
        setError('Failed to delete the category. You might not have permission.');
      });
    });
  };

  const modalTitle = modal
    ? modal.kind === 'category'
      ? (modal.category ? 'Edit category' : 'Add category')
      : (modal.subcategory ? 'Edit line' : 'Add line')
    : '';
  const submitLabel = modal
    ? modal.kind === 'category'
      ? (modal.category ? 'Save' : 'Add category')
      : (modal.subcategory ? 'Save' : 'Add line')
    : '';
  const parentCategoryName = modal?.kind === 'subcategory'
    ? categories.find(category => category.id === modal.categoryId)?.name ?? ''
    : '';

  const renderSection = (title: string, addTestId: string, section: BudgetSectionSummary, addKind: BudgetKind) => (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">{title}</h2>
        <button
          onClick={() => openAddCategory(addKind)}
          data-testid={addTestId}
          className="inline-flex items-center gap-1 text-xs font-bold text-teal-400 hover:text-teal-300 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add category
        </button>
      </div>
      {section.categories.length === 0 ? (
        <div className="bg-slate-900/50 border border-dashed border-slate-800 rounded-2xl p-6 text-center">
          <p className="text-slate-500 text-xs">No {title.toLowerCase()} categories yet.</p>
        </div>
      ) : (
        <div className="space-y-3 md:space-y-4">
          <AnimatePresence initial={false}>
            {section.categories.map(row => (
              <CategoryCard
                key={row.category.id}
                row={row}
                armedDelete={armedDelete}
                onAddLine={() => openAddSubcategory(row.category.id!)}
                onEditCategory={() => openEditCategory(row.category)}
                onDeleteCategory={() => deleteCategory(row.category)}
                onEditLine={openEditSubcategory}
                onDeleteLine={deleteSubcategory}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden text-slate-200">
      <header className="bg-slate-900/60 backdrop-blur-xl px-3 sm:px-4 md:px-6 py-2.5 sm:py-3 md:py-4 flex items-center justify-between gap-2 sm:gap-3 border-b border-slate-800/60 sticky top-0 z-10">
        <h1 className="flex items-center min-w-0">
          <Wallet className="text-teal-400 w-6 h-6 shrink-0" />
          <span className="sr-only">Budget</span>
        </h1>
        <button
          onClick={() => openAddCategory('expense')}
          data-testid="budget-add-category"
          className="bg-teal-600 text-white px-2.5 sm:px-3 md:px-4 py-2 rounded-xl hover:bg-teal-700 transition-colors shadow-lg shadow-teal-900/20 flex items-center gap-1 sm:gap-1.5 text-sm font-bold whitespace-nowrap"
        >
          <FolderPlus className="w-4 h-4" />
          Add<span className="hidden md:inline"> Category</span>
        </button>
      </header>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 md:p-6 space-y-4 md:space-y-6">
        {error && (
          <div className="p-4 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-sm font-medium">{error}</div>
        )}

        {/* Income · Expenses · Net */}
        <div className="grid grid-cols-3 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="min-w-0 p-3 sm:p-4 md:p-5 border-r border-slate-800">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Income</p>
            <p data-testid="budget-total-income" className="text-sm min-[360px]:text-base sm:text-xl md:text-2xl font-black text-emerald-400 tabular-nums tracking-tight truncate">{formatBudgetMoney(summary.totalIncome)}</p>
          </div>
          <div className="min-w-0 p-3 sm:p-4 md:p-5 border-r border-slate-800">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Expenses</p>
            <p data-testid="budget-total-expenses" className="text-sm min-[360px]:text-base sm:text-xl md:text-2xl font-black text-slate-100 tabular-nums tracking-tight truncate">{formatBudgetMoney(summary.totalExpenses)}</p>
          </div>
          <div className="min-w-0 p-3 sm:p-4 md:p-5">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">Net</p>
            <p data-testid="budget-net" className={cn('text-sm min-[360px]:text-base sm:text-xl md:text-2xl font-black tabular-nums tracking-tight truncate', summary.net < 0 ? 'text-rose-400' : 'text-emerald-400')}>{formatBudgetNet(summary.net)}</p>
          </div>
        </div>

        {!loaded ? (
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-8 text-center">
            <p className="text-slate-500 text-sm">Loading budget…</p>
          </div>
        ) : (
          <>
            {renderSection('Income', 'budget-add-income', summary.income, 'income')}
            {renderSection('Expenses', 'budget-add-expense', summary.expense, 'expense')}
          </>
        )}
      </div>

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
              className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl w-full max-w-md shadow-2xl safe-bottom"
            >
              <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-black text-white">{modalTitle}</h2>
                  <button type="button" onClick={() => setModal(null)} className="p-2 hover:bg-slate-800 rounded-full" aria-label="Close">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>

                {formError && (
                  <p className="p-3 bg-red-900/20 border border-red-800/50 rounded-xl text-red-400 text-xs font-medium">{formError}</p>
                )}

                {modal.kind === 'category' && (
                  <fieldset>
                    <legend className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Type</legend>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setCategoryKind('expense')}
                        data-testid="budget-kind-expense"
                        aria-pressed={categoryKind === 'expense'}
                        className={cn('px-3 py-2 rounded-xl border text-xs font-bold transition-colors', categoryKind === 'expense' ? 'bg-teal-900/30 border-teal-700 text-teal-300' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700')}
                      >
                        Expense
                      </button>
                      <button
                        type="button"
                        onClick={() => setCategoryKind('income')}
                        data-testid="budget-kind-income"
                        aria-pressed={categoryKind === 'income'}
                        className={cn('px-3 py-2 rounded-xl border text-xs font-bold transition-colors', categoryKind === 'income' ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700')}
                      >
                        Income
                      </button>
                    </div>
                  </fieldset>
                )}

                {modal.kind === 'subcategory' && parentCategoryName && (
                  <p className="text-[11px] text-slate-500 font-semibold">In {parentCategoryName}</p>
                )}

                <div>
                  <label htmlFor="budget-name" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    {modal.kind === 'category' ? 'Category name' : 'Line name'}
                  </label>
                  <input
                    id="budget-name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    autoFocus
                    placeholder={modal.kind === 'category' ? (categoryKind === 'income' ? 'Salary' : 'Transportation') : 'Car payment'}
                    maxLength={100}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-teal-700"
                  />
                </div>

                {modal.kind === 'subcategory' && (
                  <div>
                    <label htmlFor="budget-amount" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Monthly amount (USD)</label>
                    <input
                      id="budget-amount"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-teal-700"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  data-testid="budget-submit"
                  className="w-full bg-teal-600 text-white py-3 rounded-xl hover:bg-teal-700 transition-colors font-bold text-sm shadow-lg shadow-teal-900/20"
                >
                  {submitLabel}
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface CategoryCardProps {
  row: BudgetCategoryRow;
  armedDelete: string | null;
  onAddLine: () => void;
  onEditCategory: () => void;
  onDeleteCategory: () => void;
  onEditLine: (subcategory: BudgetSubcategory) => void;
  onDeleteLine: (subcategory: BudgetSubcategory) => void;
}

function CategoryCard({ row, armedDelete, onAddLine, onEditCategory, onDeleteCategory, onEditLine, onDeleteLine }: CategoryCardProps) {
  const { category, subcategories, subtotal } = row;
  const categoryArmed = armedDelete === `cat:${category.id}`;

  return (
    <motion.section
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      data-testid={`budget-category-${category.name}`}
      className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden"
    >
      <div className="px-3.5 sm:px-4 md:px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-black text-white text-sm truncate">{category.name}</h3>
          <p className="text-[10px] text-slate-500 font-semibold mt-0.5">{subcategories.length} {subcategories.length === 1 ? 'line' : 'lines'}</p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <span data-testid={`budget-subtotal-${category.name}`} className="text-sm font-black text-teal-300 tabular-nums mr-1">{formatBudgetMoney(subtotal)}</span>
          <button onClick={onEditCategory} aria-label={`Edit ${category.name}`} className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDeleteCategory}
            aria-label={categoryArmed ? `Confirm delete ${category.name}` : `Delete ${category.name}`}
            className={cn('p-1.5 rounded-lg transition-colors', categoryArmed ? 'bg-red-900/50 text-red-300' : 'text-slate-500 hover:text-red-400 hover:bg-red-900/20')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="divide-y divide-slate-800/70">
        {subcategories.length === 0 ? (
          <p className="px-4 py-3 text-[11px] text-slate-600 font-medium">No lines yet — add one below.</p>
        ) : subcategories.map(subcategory => {
          const lineArmed = armedDelete === `sub:${subcategory.id}`;
          return (
            <div
              key={subcategory.id}
              data-testid={`budget-line-${subcategory.name}`}
              className="px-3.5 sm:px-4 md:px-5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-800/30 transition-colors"
            >
              <button
                onClick={() => onEditLine(subcategory)}
                aria-label={`Edit ${subcategory.name}`}
                className="min-w-0 flex-1 text-left text-sm font-semibold text-slate-200 truncate hover:text-white transition-colors"
              >
                {subcategory.name}
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm font-black text-slate-100 tabular-nums">{formatBudgetMoney(subcategory.amount)}</span>
                <button
                  onClick={() => onDeleteLine(subcategory)}
                  aria-label={lineArmed ? `Confirm delete ${subcategory.name}` : `Delete ${subcategory.name}`}
                  className={cn('p-1.5 rounded-lg transition-colors', lineArmed ? 'bg-red-900/50 text-red-300' : 'text-slate-500 hover:text-red-400 hover:bg-red-900/20')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3.5 sm:px-4 md:px-5 py-2.5 border-t border-slate-800">
        <button
          onClick={onAddLine}
          data-testid={`budget-add-line-${category.name}`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-400 hover:text-teal-300 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Add line
        </button>
      </div>
    </motion.section>
  );
}
