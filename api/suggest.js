// api/suggest.js — POST /api/suggest
// Public signup helper: given a company profile, suggests entities or topics to
// monitor. Used by the "✨ Suggest" buttons on the signup form. Output is small
// and capped to keep this unauthenticated endpoint cheap.

import { complete } from '../lib/claude.js';

export const config = { runtime: 'nodejs' };

const MAX_SUGGESTIONS = 8;

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

  const kind = type === 'topics'
    ? `specific topics, technologies, regulations, commodities, materials, or market themes this company should track. Keep them concrete and searchable (e.g. "R290 refrigerant", "BEG subsidies", "EU CBAM"). Avoid the company's own name and avoid generic words like "news" or "market".`
    : `specific named entities: competitors, major customers, suppliers, regulators, industry bodies, or notable brands/business units relevant to this company. Prefer real, well-known names in the company's region and sector. Avoid generic words.`;

  const system = `You are an intelligence-analyst assistant for Intelio, a business news-briefing service.
Given a company profile, propose a concise list of ${type} the company should monitor.
Each item is one of: ${kind}
Output ONLY a compact JSON array of ${MAX_SUGGESTIONS} short strings (each 1–4 words). No prose, no markdown fences, no object keys — just the array, e.g. ["Item one","Item two"].`;

  const user = `COMPANY: ${company}
REGION: ${region || '(unspecified)'}
PROFILE: ${description || '(none provided)'}

ALREADY ADDED (do not repeat these): ${existing.length ? existing.join(', ') : '(none)'}

Return the JSON array of suggested ${type} now.`;

  try {
    const raw = await complete(system, user, 400);
    const suggestions = parseList(raw, existing);
    return res.status(200).json({ suggestions });
  } catch (err) {
    console.error('[suggest] error:', err?.message || err);
    return res.status(500).json({ error: 'Could not generate suggestions right now.' });
  }
}

// Robustly extract a clean string array from the model output.
function parseList(raw, existing) {
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
  for (const item of arr) {
    const s = String(item || '').trim().replace(/^["'\-•\d.\s]+/, '').slice(0, 60);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}
