import { describe, it, expect } from 'vitest';
import { summarizeBudget, formatBudgetMoney, formatBudgetNet, budgetKindForCategory } from './budget';
import { BudgetCategory, BudgetKind, BudgetSubcategory } from '../types';

const category = (over: Partial<BudgetCategory> & { id: string }): BudgetCategory => ({
  name: 'Category',
  sortOrder: 0,
  createdBy: 'u',
  authorName: 'A',
  createdAt: '',
  ...over,
});

const sub = (over: Partial<BudgetSubcategory> & { categoryId: string }): BudgetSubcategory => ({
  name: 'Line',
  amount: 0,
  sortOrder: 0,
  createdBy: 'u',
  authorName: 'A',
  createdAt: '',
  ...over,
});

describe('summarizeBudget', () => {
  it('splits income and expenses, totals each, and computes net', () => {
    const summary = summarizeBudget(
      [
        category({ id: 'salary', name: 'Salary', kind: 'income', sortOrder: 10 }),
        category({ id: 'housing', name: 'Housing', kind: 'expense', sortOrder: 10 }),
        category({ id: 'transport', name: 'Transportation', kind: 'expense', sortOrder: 20 }),
      ],
      [
        sub({ categoryId: 'salary', name: 'Paycheck', amount: 5000 }),
        sub({ categoryId: 'salary', name: 'Side gig', amount: 500 }),
        sub({ categoryId: 'housing', name: 'Mortgage', amount: 2000 }),
        sub({ categoryId: 'transport', name: 'Car payment', amount: 400 }),
      ],
    );

    expect(summary.totalIncome).toBe(5500);
    expect(summary.totalExpenses).toBe(2400);
    expect(summary.net).toBe(3100);
    expect(summary.income.categories.map(row => row.category.name)).toEqual(['Salary']);
    expect(summary.expense.categories.map(row => row.category.name)).toEqual(['Housing', 'Transportation']);
    expect(summary.income.categoryCount).toBe(1);
    expect(summary.income.subcategoryCount).toBe(2);
    expect(summary.expense.subcategoryCount).toBe(2);
  });

  it('treats a category with no kind as an expense (backward compatible)', () => {
    const summary = summarizeBudget(
      [category({ id: 'legacy', name: 'Old category' })], // no kind field
      [sub({ categoryId: 'legacy', name: 'Line', amount: 120 })],
    );
    expect(summary.expense.total).toBe(120);
    expect(summary.income.total).toBe(0);
    expect(summary.net).toBe(-120);
  });

  it('produces a negative net when expenses exceed income', () => {
    const summary = summarizeBudget(
      [
        category({ id: 'i', name: 'Income', kind: 'income' }),
        category({ id: 'e', name: 'Rent', kind: 'expense' }),
      ],
      [
        sub({ categoryId: 'i', name: 'Wages', amount: 1000 }),
        sub({ categoryId: 'e', name: 'Rent', amount: 1500 }),
      ],
    );
    expect(summary.net).toBe(-500);
  });

  it('orders subcategories within a category by sortOrder then name', () => {
    const summary = summarizeBudget(
      [category({ id: 'c', kind: 'expense', sortOrder: 0 })],
      [
        sub({ categoryId: 'c', name: 'Maintenance', amount: 50, sortOrder: 30 }),
        sub({ categoryId: 'c', name: 'Fuel', amount: 120, sortOrder: 10 }),
        sub({ categoryId: 'c', name: 'Insurance', amount: 150, sortOrder: 10 }),
      ],
    );
    expect(summary.expense.categories[0].subcategories.map(s => s.name)).toEqual(['Fuel', 'Insurance', 'Maintenance']);
  });

  it('keeps an empty category (subtotal 0) in its section', () => {
    const summary = summarizeBudget([category({ id: 'empty', name: 'Savings', kind: 'income' })], []);
    expect(summary.income.categories).toHaveLength(1);
    expect(summary.income.categories[0].subtotal).toBe(0);
    expect(summary.totalIncome).toBe(0);
    expect(summary.net).toBe(0);
  });

  it('ignores orphan lines whose category no longer exists', () => {
    const summary = summarizeBudget(
      [category({ id: 'kept', name: 'Food', kind: 'expense' })],
      [
        sub({ categoryId: 'kept', name: 'Groceries', amount: 600 }),
        sub({ categoryId: 'deleted-category', name: 'Orphan', amount: 999 }),
      ],
    );
    expect(summary.totalExpenses).toBe(600);
    expect(summary.expense.subcategoryCount).toBe(1);
  });

  it('treats negative, NaN, and missing amounts as zero in the totals', () => {
    const summary = summarizeBudget(
      [category({ id: 'c', kind: 'expense' })],
      [
        sub({ categoryId: 'c', name: 'Good', amount: 100 }),
        sub({ categoryId: 'c', name: 'Negative', amount: -50 }),
        sub({ categoryId: 'c', name: 'NaN', amount: Number.NaN }),
      ],
    );
    expect(summary.expense.categories[0].subtotal).toBe(100);
    expect(summary.totalExpenses).toBe(100);
  });

  it('handles an empty budget', () => {
    const summary = summarizeBudget([], []);
    expect(summary.income.categories).toEqual([]);
    expect(summary.expense.categories).toEqual([]);
    expect(summary.totalIncome).toBe(0);
    expect(summary.totalExpenses).toBe(0);
    expect(summary.net).toBe(0);
  });
});

describe('budgetKindForCategory', () => {
  it('returns the stored kind, defaulting missing/unknown to expense', () => {
    expect(budgetKindForCategory({ kind: 'income' } as BudgetCategory)).toBe('income');
    expect(budgetKindForCategory({ kind: 'expense' } as BudgetCategory)).toBe('expense');
    expect(budgetKindForCategory({} as BudgetCategory)).toBe('expense');
    expect(budgetKindForCategory({ kind: 'weird' as BudgetKind } as BudgetCategory)).toBe('expense');
  });
});

describe('formatBudgetMoney', () => {
  it('formats USD with a dollar sign and thousands separators', () => {
    expect(formatBudgetMoney(2550)).toBe('$2,550.00');
    expect(formatBudgetMoney(432.17)).toBe('$432.17');
  });

  it('normalizes zero, -0, and non-finite values', () => {
    expect(formatBudgetMoney(0)).toBe('$0.00');
    expect(formatBudgetMoney(-0)).toBe('$0.00');
    expect(formatBudgetMoney(Number.NaN)).toBe('$0.00');
  });
});

describe('formatBudgetNet', () => {
  it('shows an explicit sign for surplus and shortfall, and none for zero', () => {
    expect(formatBudgetNet(3100)).toBe('+$3,100.00');
    expect(formatBudgetNet(-500)).toBe('-$500.00');
    expect(formatBudgetNet(0)).toBe('$0.00');
  });
});
