// Invest is household data, just like Calendar, Notes, Shopping, and Today.
// Keep the shared document ID in one place so a future component cannot
// accidentally fall back to a signed-in user's private portfolio path.
export const SHARED_PORTFOLIO_ID = 'household';

export const sharedPortfolioPath = (...segments: string[]): string =>
  ['portfolios', SHARED_PORTFOLIO_ID, ...segments].join('/');
