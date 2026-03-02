// lib/search.js — Brave Search API wrapper

const BRAVE_API = 'https://api.search.brave.com/res/v1/web/search';

/**
 * Run a single Brave web search query.
 * @param {string} query
 * @param {object} opts
 * @param {number} [opts.count=10]        — results per page (max 20)
 * @param {string} [opts.country='de-DE'] — localise results
 * @param {string} [opts.freshness]       — e.g. 'pd' (past day), 'pw' (past week)
 * @returns {Promise<BraveResult[]>}
 */
export async function search(query, { count = 10, country = 'de-DE', freshness } = {}) {
  if (!process.env.BRAVE_SEARCH_API_KEY) throw new Error('Missing BRAVE_SEARCH_API_KEY');

  const params = new URLSearchParams({ q: query, count: String(count), country });
  if (freshness) params.set('freshness', freshness);

  const res = await fetch(`${BRAVE_API}?${params}`, {
    headers: {
      'Accept':              'application/json',
      'Accept-Encoding':     'gzip',
      'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brave Search error ${res.status}: ${body}`);
  }

  const json = await res.json();
  const results = (json.web?.results || []).map(r => ({
    title:       r.title,
    url:         r.url,
    description: r.description,
    age:         r.age,       // e.g. "2 hours ago"
    published:   r.published, // ISO date string when available
  }));

  return results;
}

/**
 * Run multiple queries in parallel and deduplicate by URL.
 * @param {string[]} queries
 * @param {object}   opts  — same as search()
 * @returns {Promise<BraveResult[]>}
 */
export async function multiSearch(queries, opts = {}) {
  const results = await Promise.all(queries.map(q => search(q, opts)));
  const flat = results.flat();

  // Deduplicate by URL
  const seen = new Set();
  return flat.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

/**
 * @typedef {Object} BraveResult
 * @property {string} title
 * @property {string} url
 * @property {string} description
 * @property {string} age
 * @property {string} published
 */
