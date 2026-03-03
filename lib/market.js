// lib/market.js — Live market data for the briefing ticker strip
// Uses Yahoo Finance v8 chart API (no API key required).
// Called once at briefing generation time; values are baked into the static HTML.
// Fails gracefully — returns whatever tickers succeed (partial results OK).

const TICKERS = [
  { symbol: '^GDAXI',   label: 'DAX',     prefix: '',  decimals: 0 },
  { symbol: '^ATX',     label: 'ATX',     prefix: '',  decimals: 0 },
  { symbol: '^SSMI',    label: 'SMI',     prefix: '',  decimals: 0 },
  { symbol: 'EURUSD=X', label: 'EUR/USD', prefix: '',  decimals: 4 },
  { symbol: 'EURCHF=X', label: 'EUR/CHF', prefix: '',  decimals: 4 },
  { symbol: 'GC=F',     label: 'Gold',    prefix: '$', decimals: 0 },
  { symbol: 'BZ=F',     label: 'Brent',   prefix: '$', decimals: 2 },
];

async function fetchOne(ticker) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(ticker.symbol)}?interval=1d&range=2d`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IntelioBot/1.0)',
        'Accept':     'application/json',
      },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;

    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    const price = meta.regularMarketPrice;
    const prev  =
      meta.chartPreviousClose ??
      meta.previousClose ??
      meta.regularMarketPreviousClose;
    if (!prev) return null;

    const changePct = ((price - prev) / prev) * 100;
    const direction = changePct > 0.05 ? 'pos' : changePct < -0.05 ? 'neg' : 'neu';

    // Format the display value
    let formatted;
    if (ticker.decimals === 0) {
      formatted = ticker.prefix + Math.round(price).toLocaleString('en-US');
    } else {
      formatted = ticker.prefix + price.toFixed(ticker.decimals);
    }

    const changeStr = (changePct >= 0 ? '+' : '') + changePct.toFixed(2) + '%';

    return { label: ticker.label, value: formatted, change: changeStr, direction };
  } catch {
    return null; // network error / timeout — skip silently
  }
}

/**
 * Fetch all market tickers in parallel.
 * Returns an array of { label, value, change, direction } objects.
 * Any tickers that fail are silently omitted.
 */
export async function fetchMarketTickers() {
  const results = await Promise.allSettled(TICKERS.map(fetchOne));
  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}
