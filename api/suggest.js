// api/suggest.js — POST /api/suggest
// Public signup helper: given a company profile, suggests entities or topics to
// monitor. Used by the "✨ Suggest" buttons on the signup form. Output is small
// and capped to keep this unauthenticated endpoint cheap.

import { complete } from '../lib/claude.js';

export const config = { runtime: 'nodejs' };

// Per-type generation targets. Items are short (1–4 words); the word cap keeps
// this unauthenticated endpoint cheap while still allowing a broad, useful set.
const LIMITS = {
  entities: { count: 16, words: 100 },
  topics:   { count: 14, words: 80 },
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: 'Invalid JSON body' }); }

  const type        = body.type === 'topics' ? 'topics' : 'entities';
  const company     = String(body.company || '').trim().slice(0, 160);
  const description = String(body.description || '').trim().slice(0, 1200);
  const region      = String(body.region || '').trim().slice(0, 80);
  const existing    = Array.isArray(body.existing)
    ? body.existing.map(s => String(s).trim()).filter(Boolean).slice(0, 40)
    : [];

  if (!company) return res.status(400).json({ error: 'A company name is required to generate suggestions.' });

  const lim = LIMITS[type];

  const kind = type === 'topics'
    ? `specific, searchable topics that mirror this business — be broad and cover several of:
  • core technologies, products, and methods the company uses or sells
  • regulations, policy, and standards that affect it
  • the market segments and end-markets it serves
  • input costs / commodities and macro themes that move its economics
Keep each item concrete and short (e.g. "real-world evidence", "GLP-1 demand", "EU CBAM", "clinical trial regulation", "R290 refrigerant"). Avoid the company's own name and generic words like "news" or "market".`
    : `specific NAMED organisations across this company's value chain. Be generous and concrete, and cover ALL of these buckets (not just competitors):
  • direct competitors / rivals
  • major CUSTOMERS and client types — e.g. for a pharma-services firm like IQVIA: large pharma such as Novartis, Eli Lilly, Pfizer, Boehringer Ingelheim, Roche
  • key suppliers and strategic partners
  • regulators, government ministries, and political / industry bodies to watch in the company's region — e.g. EMA, FDA, EU Commission, national health or finance authorities
Prefer real, well-known names relevant to the company's sector and region.`;

  const system = `You are an intelligence-analyst assistant for Intelio, a business news-briefing service.
Given a company profile, propose a BROAD, useful list of ${type} the company should monitor.
Each item is one of: ${kind}
Aim for about ${lim.count} distinct items spread across the buckets above — more is better than fewer, as long as each is genuinely relevant to THIS company.
Output ONLY a compact JSON array of short strings (each 1–4 words). No prose, no markdown fences, no object keys — just the array, e.g. ["Item one","Item two"].`;

  const user = `COMPANY: ${company}
REGION: ${region || '(unspecified)'}
PROFILE: ${description || '(none provided)'}

ALREADY ADDED (do not repeat these): ${existing.length ? existing.join(', ') : '(none)'}

Return the JSON array of suggested ${type} now.`;

  try {
    const raw = await complete(system, user, 700);
    const suggestions = parseList(raw, existing, lim);
    return res.status(200).json({ suggestions });
  } catch (err) {
    console.error('[suggest] error:', err?.message || err);
    return res.status(500).json({ error: 'Could not generate suggestions right now.' });
  }
}

// Robustly extract a clean string array from the model output, capped by count + words.
function parseList(raw, existing, lim = { count: 14, words: 100 }) {
  let arr = [];
  const text = String(raw || '').trim();
  try {
    arr = JSON.parse(text);
  } catch {
    const m = text.match(/\[[\s\S]*\]/);   // first bracketed block, if wrapped in stray prose
    if (m) { try { arr = JSON.parse(m[0]); } catch { arr = []; } }
  }
  if (!Array.isArray(arr)) arr = [];

  const seen = new Set(existing.map(s => s.toLowerCase()));
  const out = [];
  let words = 0;
  for (const item of arr) {
    const s = String(item || '').trim().replace(/^["'\-•\d.\s]+/, '').slice(0, 60);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    const w = s.split(/\s+/).filter(Boolean).length;
    if (words + w > lim.words) break;      // respect the word budget
    seen.add(key);
    out.push(s);
    words += w;
    if (out.length >= lim.count) break;
  }
  return out;
}
