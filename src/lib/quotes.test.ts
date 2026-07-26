import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchQuotes } from './quotes';

// quotes.ts pulls the signed-in user's ID token from the Firebase auth
// singleton; the token content is irrelevant to this control-flow suite.
vi.mock('../firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'test-token' } },
}));

const jsonResponse = (body: unknown, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  headers: { get: (key: string) => (key.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body,
});

const htmlResponse = () => ({
  ok: true,
  status: 200,
  headers: { get: () => 'text/html' },
  json: async () => ({}),
});

const quoteFor = (symbol: string) => ({
  [symbol]: { price: 1, currency: 'USD', source: 'tradingview', fetchedAt: 'now' },
});

const symbols = (n: number) => Array.from({ length: n }, (_, i) => `NASDAQ:S${i}`);

afterEach(() => vi.restoreAllMocks());

describe('fetchQuotes', () => {
  it('returns null only when the endpoint is absent on the first batch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse()));
    expect(await fetchQuotes(['NASDAQ:AAPL'])).toBeNull();
  });

  it('keeps quotes from earlier batches when a later batch fails', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ quotes: quoteFor('NASDAQ:S0'), errors: {} })
        : jsonResponse({ error: 'Too many quote requests; retry shortly.' }, { ok: false, status: 429 });
    }));
    const result = await fetchQuotes(symbols(41));
    expect(result).not.toBeNull();
    expect(result!.quotes['NASDAQ:S0']).toBeDefined();
    // The throttled second batch marks its own symbols, not the first batch's.
    expect(result!.errors['NASDAQ:S40']).toMatch(/Too many quote requests/);
    expect(result!.errors['NASDAQ:S0']).toBeUndefined();
  });

  it('throws a single clear error when every batch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: 'Live quotes require signing in to the app.' }, { ok: false, status: 401 })));
    await expect(fetchQuotes(['NASDAQ:AAPL'])).rejects.toThrow(/require signing in/);
  });

  it('attaches the bearer token and merges successful batches', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ quotes: quoteFor('NASDAQ:S0'), errors: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchQuotes(['NASDAQ:AAPL']);
    expect(result?.quotes['NASDAQ:S0']).toBeDefined();
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-token');
  });
});
