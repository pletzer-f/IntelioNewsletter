// lib/macro-data.js — Authoritative "ground truth" macro figures, fetched live at
// generation time so the LLM never has to guess the hard numbers (ECB rates,
// euro-area inflation). Every fetch is graceful: on failure the figure is simply
// omitted, and the cite-or-omit prompt rule then forbids the model from inventing it.

const ECB_BASE = 'https://data-api.ecb.europa.eu/service/data/FM';
const EUROSTAT = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';

// One ECB key interest rate (CSV: one header + one data row). → { value, date } | null
async function fetchEcbRate(key) {
  try {
    const res = await fetch(`${ECB_BASE}/${key}?lastNObservations=1&format=csvdata`, {
      headers: { Accept: 'text/csv' }, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const lines = (await res.text()).trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const cols = lines[0].split(',');
    const vi = cols.indexOf('OBS_VALUE');
    const ti = cols.indexOf('TIME_PERIOD');
    if (vi < 0) return null;
    const row = lines[lines.length - 1].split(',');
    const value = parseFloat(row[vi]);
    if (Number.isNaN(value)) return null;
    return { value, date: ti >= 0 ? row[ti] : null };
  } catch { return null; }
}

// Euro-area HICP, annual rate of change, all-items (Eurostat JSON-stat). → { value, period } | null
async function fetchHicp() {
  try {
    const res = await fetch(`${EUROSTAT}/prc_hicp_manr?format=JSON&coicop=CP00&geo=EA&unit=RCH_A&lastTimePeriod=1`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const value  = Object.values(j.value || {})[0];
    const period = Object.keys(j.dimension?.time?.category?.index || {})[0] || null;
    if (typeof value !== 'number') return null;
    return { value, period };
  } catch { return null; }
}

/** Fetch all authoritative macro figures in parallel. Never throws. */
export async function fetchMacroData() {
  const [deposit, mro, hicp] = await Promise.all([
    fetchEcbRate('D.U2.EUR.4F.KR.DFR.LEV'),     // deposit facility (main policy rate)
    fetchEcbRate('D.U2.EUR.4F.KR.MRR_FR.LEV'),  // main refinancing operations
    fetchHicp(),
  ]);
  return { deposit, mro, hicp };
}

/**
 * Build a compact, citeable "verified figures" block for the agent prompt.
 * `tickers` are the live market values from lib/market.js.
 */
export function formatDataSheet(macro, tickers = []) {
  const lines = [];
  if (macro?.deposit) lines.push(`- ECB deposit facility rate (the ECB's main policy rate): ${macro.deposit.value}%${macro.deposit.date ? ` (effective ${macro.deposit.date})` : ''} — source: ECB Data Portal.`);
  if (macro?.mro)     lines.push(`- ECB main refinancing operations (MRO) rate: ${macro.mro.value}%${macro.mro.date ? ` (effective ${macro.mro.date})` : ''} — source: ECB Data Portal.`);
  if (macro?.hicp)    lines.push(`- Euro-area HICP inflation, annual rate, all-items: ${macro.hicp.value}%${macro.hicp.period ? ` (period ${macro.hicp.period})` : ''} — source: Eurostat. This is the latest official figure available; state this period explicitly.`);
  for (const t of (tickers || [])) {
    if (t?.label && t?.value) lines.push(`- ${t.label}: ${t.value}${t.change ? ` (${t.change} vs previous close)` : ''} — source: market data, today.`);
  }
  if (!lines.length) return '';
  return `## VERIFIED FIGURES — authoritative ground truth
Use these EXACT values whenever the story touches them. Do NOT state a different number for any figure below, and cite the named source for it:
${lines.join('\n')}
FRESHNESS RULE: check each figure's stated period/date against today. If it lies more than ~2 months back, you may still use it but MUST label it as the last official reading (e.g. "letzter offizieller Stand: Dezember 2025") and must not present it as the current rate; where a fresher figure (e.g. a flash estimate) appears in the article material with an explicit period, prefer that and state its period.`;
}
