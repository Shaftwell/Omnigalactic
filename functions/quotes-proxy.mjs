// Local quote proxy for the Invest tab. TradingView's scanner API and Yahoo
// Finance both reject cross-origin browser requests, so the Vite dev/preview
// server fetches quotes server-side and the app calls same-origin
// /api/quotes. Production Firebase Hosting has no equivalent endpoint; the
// SPA rewrite answers with index.html and the client treats that as "live
// quotes unavailable" (manual prices and the Pine script still work).

const SCANNER_URL = 'https://scanner.tradingview.com/global/scan';
const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
// TradingView symbol grammar as accepted by the app (see firestore.rules).
const SYMBOL_PATTERN = /^[A-Z0-9.:_!&-]{1,40}$/;
const MAX_SYMBOLS = 40;
const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;

const CRYPTO_EXCHANGES = new Set([
  'BITSTAMP', 'COINBASE', 'BINANCE', 'BINANCEUS', 'KRAKEN', 'GEMINI', 'BITFINEX', 'CRYPTO', 'OKX', 'BYBIT',
]);
const US_STOCK_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'BATS', 'OTC', 'NYSEARCA', 'CBOE']);
const FX_EXCHANGES = new Set(['FX', 'FX_IDC', 'OANDA', 'FOREXCOM', 'SAXO']);
const QUOTE_CURRENCIES = ['USDT', 'USDC', 'USD', 'EUR', 'GBP', 'BTC', 'ETH'];

export function parseSymbolsParam(raw) {
  const seen = new Set();
  const symbols = [];
  const invalid = [];
  for (const part of String(raw ?? '').split(',')) {
    const symbol = part.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    (SYMBOL_PATTERN.test(symbol) ? symbols : invalid).push(symbol);
  }
  // The tail past the cap must surface as errors, never vanish silently.
  return { symbols: symbols.slice(0, MAX_SYMBOLS), invalid, dropped: symbols.slice(MAX_SYMBOLS) };
}

// Best-effort mapping from a TradingView symbol to Yahoo Finance's notation.
// Returns null when there is no confident mapping; those symbols simply
// don't get a Yahoo fallback.
export function toYahooSymbol(tvSymbol) {
  const colon = tvSymbol.indexOf(':');
  if (colon === -1) return tvSymbol;
  const exchange = tvSymbol.slice(0, colon);
  const ticker = tvSymbol.slice(colon + 1);
  if (!ticker) return null;
  if (US_STOCK_EXCHANGES.has(exchange)) {
    // Share classes: TradingView BRK.B is Yahoo BRK-B.
    return ticker.replace(/\./g, '-');
  }
  if (CRYPTO_EXCHANGES.has(exchange)) {
    for (const quote of QUOTE_CURRENCIES) {
      if (ticker.endsWith(quote) && ticker.length > quote.length) {
        const base = ticker.slice(0, -quote.length);
        // Yahoo lists stablecoin pairs under USD.
        const normalized = quote === 'USDT' || quote === 'USDC' ? 'USD' : quote;
        return `${base}-${normalized}`;
      }
    }
    return null;
  }
  if (FX_EXCHANGES.has(exchange)) {
    return /^[A-Z]{6}$/.test(ticker) ? `${ticker}=X` : null;
  }
  return null;
}

function withTimeout(fetchImpl, url, options) {
  return fetchImpl(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function fetchFromScanner(symbols, fetchImpl) {
  const response = await withTimeout(fetchImpl, SCANNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbols: { tickers: symbols, query: { types: [] } },
      columns: ['name', 'close', 'currency', 'description'],
    }),
  });
  if (!response.ok) throw new Error(`TradingView scanner responded ${response.status}`);
  const payload = await response.json();
  const quotes = {};
  for (const row of payload?.data ?? []) {
    const price = row?.d?.[1];
    // Negative closes (some futures) are rejected: the app schema requires
    // price >= 0, so such symbols surface as errors instead of bad writes.
    if (typeof row?.s !== 'string' || typeof price !== 'number' || !Number.isFinite(price) || price < 0) continue;
    quotes[row.s] = {
      price,
      currency: typeof row.d[2] === 'string' ? row.d[2] : undefined,
      description: typeof row.d[3] === 'string' ? row.d[3] : undefined,
      source: 'tradingview',
    };
  }
  return quotes;
}

async function fetchFromYahoo(symbol, fetchImpl) {
  const yahooSymbol = toYahooSymbol(symbol);
  if (!yahooSymbol) throw new Error('No Yahoo Finance mapping for this symbol');
  let lastError;
  for (const host of YAHOO_HOSTS) {
    try {
      const response = await withTimeout(
        fetchImpl,
        `${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Omnigalactic quote proxy)' } },
      );
      if (!response.ok) throw new Error(`Yahoo Finance responded ${response.status}`);
      const payload = await response.json();
      const meta = payload?.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
        throw new Error('Yahoo Finance returned no usable price');
      }
      return {
        price,
        currency: typeof meta.currency === 'string' ? meta.currency : undefined,
        description: typeof meta.longName === 'string' ? meta.longName
          : typeof meta.shortName === 'string' ? meta.shortName : undefined,
        source: 'yahoo',
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('Yahoo Finance lookup failed');
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createQuoteFetcher({ fetchImpl = fetch, now = Date.now } = {}) {
  const cache = new Map();

  return async function fetchQuotes(symbols) {
    const quotes = {};
    const errors = {};
    const stale = [];
    for (const symbol of symbols) {
      const cached = cache.get(symbol);
      if (cached && now() - cached.at < CACHE_TTL_MS) {
        quotes[symbol] = cached.quote;
      } else {
        stale.push(symbol);
      }
    }

    // The scanner resolves whole batches of exchange-prefixed symbols in one
    // request; bare tickers lack the exchange it requires and go straight to
    // the Yahoo fallback.
    const prefixed = stale.filter(symbol => symbol.includes(':'));
    if (prefixed.length > 0) {
      try {
        const scannerQuotes = await fetchFromScanner(prefixed, fetchImpl);
        for (const [symbol, quote] of Object.entries(scannerQuotes)) quotes[symbol] = quote;
      } catch (error) {
        // Fall through: every symbol the scanner missed gets a Yahoo attempt.
        console.warn('TradingView scanner request failed:', error?.message ?? error);
      }
    }

    const missing = stale.filter(symbol => !quotes[symbol]);
    await mapWithConcurrency(missing, 4, async symbol => {
      try {
        quotes[symbol] = await fetchFromYahoo(symbol, fetchImpl);
      } catch (error) {
        errors[symbol] = error?.message ?? String(error);
      }
    });

    const fetchedAt = new Date(now()).toISOString();
    for (const symbol of stale) {
      if (!quotes[symbol]) continue;
      quotes[symbol] = { ...quotes[symbol], fetchedAt };
      cache.set(symbol, { at: now(), quote: quotes[symbol] });
    }
    return { quotes, errors };
  };
}

// Fixed-window rate limiter. In-memory and therefore per-instance, which is
// the intended precision here: the deployed function caps at 2 instances, so
// the effective ceiling is at most double the configured limit.
export function createRateLimiter({ limit = 30, windowMs = 60_000, now = Date.now, maxKeys = 10_000 } = {}) {
  const buckets = new Map();
  return function take(key) {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket || t - bucket.start >= windowMs) {
      if (!bucket && buckets.size >= maxKeys) {
        for (const [staleKey, stale] of buckets) {
          if (t - stale.start >= windowMs) buckets.delete(staleKey);
        }
        if (buckets.size >= maxKeys) buckets.clear();
      }
      bucket = { start: t, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((bucket.start + windowMs - t) / 1000)) };
    }
    return { allowed: true };
  };
}

// Rate-limit key derived from the client IP. A caller can prepend arbitrary
// values to X-Forwarded-For, but Google's front end appends the real
// connecting IP to the RIGHT, so the last hop is the one an attacker cannot
// forge. Keying on split(',')[0] (the left) would let a flood rotate the
// spoofed first hop and never share a bucket.
export const requestIp = req => {
  const hops = String(req.headers?.['x-forwarded-for'] ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
  return hops[hops.length - 1] || req.socket?.remoteAddress || 'unknown';
};

export function createQuotesRequestHandler(options = {}) {
  const fetchQuotes = createQuoteFetcher(options);
  const take = createRateLimiter(options.rateLimit);
  const keyForRequest = options.keyForRequest ?? requestIp;

  return async function handleQuotesRequest(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { symbols, invalid, dropped } = parseSymbolsParam(url.searchParams.get('symbols'));
    const respond = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(body));
    };

    const key = keyForRequest(req);
    if (!key) {
      // A falsy key would collapse every caller into one shared bucket;
      // treat it as a wiring error rather than silently degrading.
      respond(500, { error: 'Quote proxy misconfigured.' });
      return;
    }
    const verdict = take(key);
    if (!verdict.allowed) {
      res.setHeader('Retry-After', String(verdict.retryAfterSec));
      respond(429, { error: 'Too many quote requests; retry shortly.' });
      return;
    }

    if (symbols.length === 0) {
      respond(400, { error: 'Provide ?symbols= as a comma-separated list of TradingView symbols.' });
      return;
    }
    try {
      const { quotes, errors } = await fetchQuotes(symbols);
      for (const symbol of invalid) errors[symbol] = 'Not a valid TradingView symbol';
      for (const symbol of dropped) errors[symbol] = `Too many symbols in one request (limit ${MAX_SYMBOLS})`;
      respond(200, { quotes, errors });
    } catch (error) {
      respond(502, { error: error?.message ?? 'Quote lookup failed' });
    }
  };
}

// Vite plugin: exposes /api/quotes on both `vite dev` and `vite preview`.
export function quotesProxyPlugin() {
  const handler = createQuotesRequestHandler();
  // No implicit return: Vite invokes a configure*Server hook's return value
  // as a post hook, and middlewares.use() returns the connect app.
  const mount = server => {
    server.middlewares.use('/api/quotes', (req, res) => {
      handler(req, res).catch(error => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: error?.message ?? 'Quote proxy crashed' }));
      });
    });
  };
  return {
    name: 'omnigalactic-quotes-proxy',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}
