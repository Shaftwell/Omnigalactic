import { BudgetCategory, BudgetKind, BudgetSubcategory } from '../types';

export interface BudgetCategoryRow {
  category: BudgetCategory;
  subcategories: BudgetSubcategory[]; // members, sorted for display
  subtotal: number; // sum of member amounts
}

export interface BudgetSectionSummary {
  kind: BudgetKind;
  categories: BudgetCategoryRow[]; // sorted by sortOrder then name
  total: number; // sum of every line in this section
  categoryCount: number;
  subcategoryCount: number; // only lines attached to an existing category
}

export interface BudgetSummary {
  income: BudgetSectionSummary;
  expense: BudgetSectionSummary;
  totalIncome: number;
  totalExpenses: number;
  net: number; // totalIncome - totalExpenses
}

const bySortOrderThenName = <T extends { sortOrder: number; name: string }>(a: T, b: T): number =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

const safeAmount = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/** A category's income/expense kind, defaulting to expense when unset. */
export const budgetKindForCategory = (category: BudgetCategory): BudgetKind =>
  category.kind === 'income' ? 'income' : 'expense';

/**
 * Groups subcategories under their category, splits categories into income and
 * expense sections, sums each, and computes net (income − expenses).
 * Subcategories whose categoryId matches no category are omitted (an orphan can
 * briefly exist while a category delete cascades), so totals never count a line
 * the user can no longer see.
 */
export function summarizeBudget(
  categories: BudgetCategory[],
  subcategories: BudgetSubcategory[],
): BudgetSummary {
  const byCategory = new Map<string, BudgetSubcategory[]>();
  for (const sub of subcategories) {
    if (!sub.categoryId) continue;
    const list = byCategory.get(sub.categoryId) ?? [];
    list.push(sub);
    byCategory.set(sub.categoryId, list);
  }

  const rows = [...categories]
    .sort(bySortOrderThenName)
    .map((category): BudgetCategoryRow => {
      const members = (byCategory.get(category.id ?? '') ?? []).slice().sort(bySortOrderThenName);
      const subtotal = members.reduce((sum, member) => sum + safeAmount(member.amount), 0);
      return { category, subcategories: members, subtotal };
    });

  const section = (kind: BudgetKind): BudgetSectionSummary => {
    const sectionRows = rows.filter(row => budgetKindForCategory(row.category) === kind);
    return {
      kind,
      categories: sectionRows,
      total: sectionRows.reduce((sum, row) => sum + row.subtotal, 0),
      categoryCount: sectionRows.length,
      subcategoryCount: sectionRows.reduce((sum, row) => sum + row.subcategories.length, 0),
    };
  };

  const income = section('income');
  const expense = section('expense');
  return {
    income,
    expense,
    totalIncome: income.total,
    totalExpenses: expense.total,
    net: income.total - expense.total,
  };
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** USD currency formatting for budget amounts; normalizes -0 and non-finite. */
export function formatBudgetMoney(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return usd.format(safe === 0 ? 0 : safe);
}

/** Net with an explicit sign so a surplus and a shortfall read differently. */
export function formatBudgetNet(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  if (safe > 0) return `+${formatBudgetMoney(safe)}`;
  // formatBudgetMoney already renders a leading minus for negatives.
  return formatBudgetMoney(safe);
}
