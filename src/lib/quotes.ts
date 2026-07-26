import { auth } from '../firebase';

export interface Quote {
  price: number;
  currency?: string;
  description?: string;
  source: 'tradingview' | 'yahoo';
  fetchedAt: string;
}

export interface QuotesResult {
  quotes: Record<string, Quote>;
  errors: Record<string, string>;
}

// The proxy caps each request at 40 symbols; bigger portfolios refresh in
// sequential batches so no holding is silently skipped.
const MAX_PER_REQUEST = 40;

// null means the /api/quotes endpoint does not exist here (production
// hosting, where the SPA rewrite answers every path with index.html), as
// opposed to a lookup that ran and failed.
export async function fetchQuotes(symbols: string[]): Promise<QuotesResult | null> {
  const merged: QuotesResult = { quotes: {}, errors: {} };
  let anySucceeded = false;
  let lastError: unknown = null;
  for (let i = 0; i < symbols.length; i += MAX_PER_REQUEST) {
    const batchSymbols = symbols.slice(i, i + MAX_PER_REQUEST);
    let batch: QuotesResult | null;
    try {
      batch = await fetchQuoteBatch(batchSymbols);
    } catch (err) {
      // One failing batch must not discard batches already fetched; record
      // it against its own symbols and keep the rest.
      lastError = err;
      const message = err instanceof Error && err.message ? err.message : 'Quote lookup failed';
      for (const symbol of batchSymbols) merged.errors[symbol] = message;
      continue;
    }
    if (batch === null) {
      // The endpoint isn't served here (production SPA fallback). Decisive
      // only before any batch has succeeded.
      if (!anySucceeded) return null;
      continue;
    }
    anySucceeded = true;
    Object.assign(merged.quotes, batch.quotes);
    Object.assign(merged.errors, batch.errors);
  }
  // A total failure still throws so the caller can surface one clear message.
  if (!anySucceeded && lastError) throw lastError;
  return merged;
}

async function fetchQuoteBatch(symbols: string[]): Promise<QuotesResult | null> {
  if (symbols.length === 0) return { quotes: {}, errors: {} };
  const params = new URLSearchParams({ symbols: symbols.join(',') });
  const headers: Record<string, string> = { Accept: 'application/json' };
  // The deployed quotes function refuses anonymous callers; the SDK serves
  // this from its token cache, so no extra network round-trip in the norm.
  const idToken = await auth.currentUser?.getIdToken().catch(() => undefined);
  if (idToken) headers.Authorization = `Bearer ${idToken}`;
  const response = await fetch(`/api/quotes?${params}`, { headers });
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `Quote lookup failed (${response.status})`);
  }
  const body = await response.json();
  return { quotes: body.quotes ?? {}, errors: body.errors ?? {} };
}
