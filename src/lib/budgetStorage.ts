// Budget lives in the account's own data tree like Invest and Vendors.
// Keep the shared namespace ID in one place so a future component cannot
// accidentally write to a per-user path. Categories and subcategories live in
// sibling subcollections under this single household document.
export const SHARED_BUDGET_ID = 'household';

export const sharedBudgetPath = (...segments: string[]): string =>
  ['budgets', SHARED_BUDGET_ID, ...segments].join('/');
