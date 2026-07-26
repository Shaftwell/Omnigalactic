import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteFetcher, createQuotesRequestHandler, createRateLimiter, parseSymbolsParam, requestIp, toYahooSymbol } from './quotes-proxy.mjs';

const scannerResponse = rows => ({
  ok: true,
  status: 200,
  json: async () => ({ data: rows }),
});

const yahooResponse = (price, currency = 'USD', longName = undefined) => ({
  ok: true,
  status: 200,
  json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: price, currency, longName } }] } }),
});

test('parseSymbolsParam uppercases, trims, dedupes, and separates invalid entries', () => {
  const { symbols, invalid } = parseSymbolsParam(' nasdaq:aapl , AMEX:SPY,NASDAQ:AAPL,, bad symbol ,BTC-USD');
  assert.deepEqual(symbols, ['NASDAQ:AAPL', 'AMEX:SPY', 'BTC-USD']);
  assert.deepEqual(invalid, ['BAD SYMBOL']);
});

test('parseSymbolsParam caps the batch at 40 symbols and reports the dropped tail', () => {
  const raw = Array.from({ length: 45 }, (_, i) => `NASDAQ:S${i}`).join(',');
  const { symbols, dropped } = parseSymbolsParam(raw);
  assert.equal(symbols.length, 40);
  assert.deepEqual(dropped, ['NASDAQ:S40', 'NASDAQ:S41', 'NASDAQ:S42', 'NASDAQ:S43', 'NASDAQ:S44']);
});

test('a negative close is rejected by both sources and surfaces as an error', async () => {
  const fetchQuotes = createQuoteFetcher({
    fetchImpl: async url => {
      if (url.includes('scanner')) return scannerResponse([{ s: 'NASDAQ:NEG', d: ['NEG', -37.63, 'USD', 'Negative Co'] }]);
      return yahooResponse(-37.63);
    },
  });
  const { quotes, errors } = await fetchQuotes(['NASDAQ:NEG']);
  assert.deepEqual(quotes, {});
  assert.match(errors['NASDAQ:NEG'], /no usable price/);
});

test('toYahooSymbol maps US stocks, share classes, crypto, and FX', () => {
  assert.equal(toYahooSymbol('NASDAQ:AAPL'), 'AAPL');
  assert.equal(toYahooSymbol('NYSE:BRK.B'), 'BRK-B');
  assert.equal(toYahooSymbol('BITSTAMP:BTCUSD'), 'BTC-USD');
  assert.equal(toYahooSymbol('BINANCE:ETHUSDT'), 'ETH-USD');
  assert.equal(toYahooSymbol('OANDA:EURUSD'), 'EURUSD=X');
  assert.equal(toYahooSymbol('AAPL'), 'AAPL');
  assert.equal(toYahooSymbol('LSE:VOD'), null);
  assert.equal(toYahooSymbol('BITSTAMP:USD'), null);
});

test('fetches prefixed symbols from the scanner in one batch', async () => {
  const calls = [];
  const fetchQuotes = createQuoteFetcher({
    fetchImpl: async (url, options) => {
      calls.push({ url, body: options?.body });
      return scannerResponse([
        { s: 'NASDAQ:AAPL', d: ['AAPL', 123.45, 'USD', 'Apple Inc.'] },
        { s: 'AMEX:SPY', d: ['SPY', 512.5, 'USD', 'SPDR S&P 500'] },
      ]);
    },
  });
  const { quotes, errors } = await fetchQuotes(['NASDAQ:AAPL', 'AMEX:SPY']);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /scanner\.tradingview\.com/);
  assert.deepEqual(JSON.parse(calls[0].body).symbols.tickers, ['NASDAQ:AAPL', 'AMEX:SPY']);
  assert.equal(quotes['NASDAQ:AAPL'].price, 123.45);
  assert.equal(quotes['NASDAQ:AAPL'].source, 'tradingview');
  assert.equal(quotes['AMEX:SPY'].description, 'SPDR S&P 500');
  assert.deepEqual(errors, {});
});

test('falls back to Yahoo when the scanner fails or misses a symbol', async () => {
  const urls = [];
  const fetchQuotes = createQuoteFetcher({
    fetchImpl: async url => {
      urls.push(url);
      if (url.includes('scanner')) return scannerResponse([{ s: 'NASDAQ:AAPL', d: ['AAPL', 100, 'USD', 'Apple'] }]);
      assert.match(url, /finance\.yahoo\.com\/v8\/finance\/chart\/BTC-USD/);
      return yahooResponse(65000, 'USD', 'Bitcoin USD');
    },
  });
  const { quotes, errors } = await fetchQuotes(['NASDAQ:AAPL', 'BITSTAMP:BTCUSD']);
  assert.equal(quotes['NASDAQ:AAPL'].source, 'tradingview');
  assert.equal(quotes['BITSTAMP:BTCUSD'].source, 'yahoo');
  assert.equal(quotes['BITSTAMP:BTCUSD'].price, 65000);
  assert.deepEqual(errors, {});
});

test('bare tickers skip the scanner and go straight to Yahoo', async () => {
  const urls = [];
  const fetchQuotes = createQuoteFetcher({
    fetchImpl: async url => {
      urls.push(url);
      return yahooResponse(210.1);
    },
  });
  const { quotes } = await fetchQuotes(['AAPL']);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /chart\/AAPL/);
  assert.equal(quotes['AAPL'].price, 210.1);
});

test('reports per-symbol errors instead of failing the whole batch', async () => {
  const fetchQuotes = createQuoteFetcher({
    fetchImpl: async url => {
      if (url.includes('scanner')) throw new Error('offline');
      return { ok: false, status: 429, json: async () => ({}) };
    },
  });
  const { quotes, errors } = await fetchQuotes(['NASDAQ:AAPL', 'LSE:VOD']);
  assert.deepEqual(quotes, {});
  assert.match(errors['NASDAQ:AAPL'], /429/);
  assert.match(errors['LSE:VOD'], /No Yahoo Finance mapping/);
});

test('serves repeat requests from the cache inside the TTL and refetches after it', async () => {
  let calls = 0;
  let clock = 1_000_000;
  const fetchQuotes = createQuoteFetcher({
    fetchImpl: async () => {
      calls += 1;
      return scannerResponse([{ s: 'NASDAQ:AAPL', d: ['AAPL', 100 + calls, 'USD', 'Apple'] }]);
    },
    now: () => clock,
  });
  const first = await fetchQuotes(['NASDAQ:AAPL']);
  clock += 5_000;
  const second = await fetchQuotes(['NASDAQ:AAPL']);
  assert.equal(calls, 1);
  assert.equal(second.quotes['NASDAQ:AAPL'].price, first.quotes['NASDAQ:AAPL'].price);
  clock += 60_000;
  const third = await fetchQuotes(['NASDAQ:AAPL']);
  assert.equal(calls, 2);
  assert.equal(third.quotes['NASDAQ:AAPL'].price, 102);
});

const respondVia = async (handler, url) => {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(body) { this.body = body; },
  };
  await handler({ url }, res);
  return res;
};

test('request handler returns quotes plus invalid-symbol errors as JSON', async () => {
  const handler = createQuotesRequestHandler({
    fetchImpl: async () => scannerResponse([{ s: 'NASDAQ:AAPL', d: ['AAPL', 123, 'USD', 'Apple'] }]),
  });
  const res = await respondVia(handler, '/?symbols=NASDAQ:AAPL,bad%20symbol');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const payload = JSON.parse(res.body);
  assert.equal(payload.quotes['NASDAQ:AAPL'].price, 123);
  assert.match(payload.errors['BAD SYMBOL'], /Not a valid TradingView symbol/);
});

test('request handler reports symbols beyond the 40-symbol cap as errors', async () => {
  const handler = createQuotesRequestHandler({
    fetchImpl: async (url, options) => {
      const { tickers } = JSON.parse(options.body).symbols;
      return scannerResponse(tickers.map(s => ({ s, d: [s, 100, 'USD', s] })));
    },
  });
  const raw = Array.from({ length: 41 }, (_, i) => `NASDAQ:S${i}`).join(',');
  const res = await respondVia(handler, `/?symbols=${raw}`);
  const payload = JSON.parse(res.body);
  assert.equal(Object.keys(payload.quotes).length, 40);
  assert.match(payload.errors['NASDAQ:S40'], /Too many symbols/);
});

test('request handler rejects an empty symbol list', async () => {
  const handler = createQuotesRequestHandler({ fetchImpl: async () => { throw new Error('must not fetch'); } });
  const res = await respondVia(handler, '/?symbols=');
  assert.equal(res.statusCode, 400);
});

test('requestIp trusts the appended last X-Forwarded-For hop, not the spoofable first', () => {
  // Client sends "1.1.1.1"; Google appends the real IP at the end.
  assert.equal(requestIp({ headers: { 'x-forwarded-for': '1.1.1.1, 203.0.113.9' } }), '203.0.113.9');
  // A flood rotating the leftmost value still lands in the same bucket.
  assert.equal(requestIp({ headers: { 'x-forwarded-for': '9.9.9.9, 203.0.113.9' } }), '203.0.113.9');
  assert.equal(requestIp({ headers: {}, socket: { remoteAddress: '10.0.0.2' } }), '10.0.0.2');
  assert.equal(requestIp({ headers: {} }), 'unknown');
});

test('handler rejects a request whose rate-limit key is missing', async () => {
  const handler = createQuotesRequestHandler({
    fetchImpl: async () => { throw new Error('must not fetch'); },
    keyForRequest: () => undefined,
  });
  const res = await respondVia(handler, '/?symbols=NASDAQ:AAPL');
  assert.equal(res.statusCode, 500);
});

test('rate limiter allows a full window, then rejects with a retry hint, then resets', () => {
  let clock = 1_000_000;
  const take = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => clock });
  assert.equal(take('a').allowed, true);
  assert.equal(take('a').allowed, true);
  assert.equal(take('a').allowed, true);
  const rejected = take('a');
  assert.equal(rejected.allowed, false);
  assert.ok(rejected.retryAfterSec >= 1 && rejected.retryAfterSec <= 60);
  // Other keys are unaffected, and the window rolls over cleanly.
  assert.equal(take('b').allowed, true);
  clock += 60_000;
  assert.equal(take('a').allowed, true);
});

test('request handler returns 429 with Retry-After once a caller exceeds the limit', async () => {
  const handler = createQuotesRequestHandler({
    fetchImpl: async () => scannerResponse([{ s: 'NASDAQ:AAPL', d: ['AAPL', 100, 'USD', 'Apple'] }]),
    rateLimit: { limit: 2, windowMs: 60_000 },
    keyForRequest: () => 'same-user',
  });
  assert.equal((await respondVia(handler, '/?symbols=NASDAQ:AAPL')).statusCode, 200);
  assert.equal((await respondVia(handler, '/?symbols=NASDAQ:AAPL')).statusCode, 200);
  const limited = await respondVia(handler, '/?symbols=NASDAQ:AAPL');
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers['retry-after']) >= 1);
  assert.match(JSON.parse(limited.body).error, /Too many quote requests/);
});
