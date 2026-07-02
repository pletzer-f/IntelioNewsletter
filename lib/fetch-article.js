// lib/fetch-article.js — Best-effort full-text fetch so section agents reason from
// real article content, not just search snippets (the root cause of fabricated
// figures). Every fetch is graceful: paywalls, JS shells, timeouts → null.

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|nav|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/&euro;/g, '€').replace(/&#8364;/g, '€')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetch one URL and return readable body text (capped), or null on any failure. */
export async function fetchArticleText(url, maxChars = 3500) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; IntelioBot/1.0; +https://intelio-newsletter.vercel.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') || '').includes('text/html')) return null;
    const text = htmlToText(await res.text());
    if (text.length < 250) return null;   // paywall / JS shell — not useful
    return text.slice(0, maxChars);
  } catch { return null; }
}

/**
 * Enrich the top-N search results (in place) with fetched body text, in parallel.
 * Returns the same array; the top entries gain a `.text` field where the fetch succeeded.
 */
export async function enrichWithText(results, topN = 4, maxChars = 3500) {
  if (!Array.isArray(results) || !results.length) return results;
  const top = results.slice(0, topN);
  const settled = await Promise.allSettled(top.map(r => fetchArticleText(r.url, maxChars)));
  settled.forEach((s, i) => { if (s.status === 'fulfilled' && s.value) top[i].text = s.value; });
  return results;
}

/**
 * Ensure every URL a section actually CITED has fetched article text in `results`
 * before verification. The fact-checker can only catch a wrong figure if the text
 * of the cited source is in front of it — snippets are how conflations slip through.
 * Best-effort and in place; never throws.
 */
export async function enrichCitedSources(sectionHtml, results, maxChars = 5000) {
  if (!sectionHtml || !Array.isArray(results)) return results;
  const hrefs = [...String(sectionHtml).matchAll(/class="story-src" href="([^"]+)"/g)].map(m => m[1]);
  const need = [...new Set(hrefs)].filter(u => {
    const r = results.find(x => x.url === u);
    return !r || !r.text;
  });
  if (!need.length) return results;
  const settled = await Promise.allSettled(need.map(u => fetchArticleText(u, maxChars)));
  settled.forEach((s, i) => {
    if (s.status !== 'fulfilled' || !s.value) return;
    const existing = results.find(x => x.url === need[i]);
    if (existing) existing.text = s.value;
    else results.push({ title: '(cited source)', url: need[i], description: '', text: s.value });
  });
  return results;
}
