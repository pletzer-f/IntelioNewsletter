// api/agents/queries.js — Search query builder per section agent
// Takes the client config + monthly profile text and returns targeted search queries
// that align with SKILL.md's 60% client-specific / 40% sector baseline rule.

/**
 * Build search query arrays for all 6 section agents.
 * @param {object} client  — Supabase client row
 * @param {string} profile — monthly profile markdown text
 * @returns {{ agent01: string[], agent02: string[], ..., agent06: string[] }}
 */
export function buildSectionQueries(client, profile) {
  const name     = client.client_name;
  const region   = client.region || 'Austria Germany DACH';
  const entities = client.client_entities || [];
  const topics   = client.client_topics   || [];
  const month    = new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' });

  // Extract competitor list from profile (lines containing "competitor" or a list after "Competitor map")
  const competitors = extractCompetitors(profile).slice(0, 5);

  // ── Agent 01: Macro & Markets ────────────────────────────────────────────
  const agent01 = [
    `ECB interest rate decision ${month}`,
    `Eurozone inflation CPI ${month}`,
    `Eurozone PMI manufacturing services flash ${month}`,
    `TTF natural gas price Europe ${month}`,
    `EUR USD exchange rate ${month}`,
    `${region} economic outlook ${month}`,
    ...entities.slice(0, 2).map(e => `${e} market conditions ${month}`),
  ];

  // ── Agent 02: Core Industry & Operations ─────────────────────────────────
  const primaryTopics = topics.length ? topics : inferTopics(client);
  const agent02 = [
    ...primaryTopics.slice(0, 3).map(t => `${t} market ${region} ${month}`),
    ...primaryTopics.slice(0, 2).map(t => `${t} regulation DACH ${new Date().getFullYear()}`),
    ...competitors.slice(0, 3).map(c => `${c} ${month}`),
    ...entities.slice(0, 2).map(e => `${e} operations ${month}`),
  ];

  // ── Agent 03: Private Equity & M&A ────────────────────────────────────────
  const agent03 = [
    ...primaryTopics.slice(0, 2).map(t => `private equity ${t} DACH ${month}`),
    ...primaryTopics.slice(0, 2).map(t => `M&A ${t} Europe ${month}`),
    `${primaryTopics[0] || name} valuation multiples ${new Date().getFullYear()}`,
    ...competitors.slice(0, 2).map(c => `${c} acquisition merger ${month}`),
    `${name} acquisition investment ${month}`,
  ];

  // ── Agent 04: End-Market Demand ────────────────────────────────────────────
  const agent04 = [
    ...primaryTopics.slice(0, 3).map(t => `${t} demand indicators ${month}`),
    `${region} consumer business demand ${month}`,
    ...entities.slice(0, 3).map(e => `${e} demand orders ${month}`),
    ...(client.client_local_sources || []).slice(0, 2).map(s => `site:${s} ${name}`),
  ];

  // ── Agent 05: Assets, Capex & Balance Sheet ───────────────────────────────
  const agent05 = [
    ...primaryTopics.slice(0, 2).map(t => `${t} investment capex ${region} ${month}`),
    `financing conditions ${primaryTopics[0] || 'industry'} Europe ${month}`,
    `subsidy incentives ${primaryTopics[0] || 'energy'} ${region} ${new Date().getFullYear()}`,
    `${region} real estate commercial yield ${month}`,
    ...entities.slice(0, 2).map(e => `${e} investment expansion ${month}`),
  ];

  // ── Agent 06: Local Policy & Reputation ───────────────────────────────────
  const agent06 = [
    `"${name}" ${month}`,
    ...entities.map(e => `"${e}" ${month}`).slice(0, 3),
    `${region} business policy regulation ${month}`,
    `Austria Germany SME tax labor ${month}`,
    ...primaryTopics.slice(0, 2).map(t => `${t} policy ${region} ${month}`),
  ];

  return { agent01, agent02, agent03, agent04, agent05, agent06 };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractCompetitors(profileText) {
  const match = profileText.match(/competitor[s\s:]+([^\n#]+(\n[-*]\s+[^\n]+)*)/i);
  if (!match) return [];
  return match[0]
    .split(/[\n,;]/)
    .map(s => s.replace(/^[-*\s]+/, '').trim())
    .filter(s => s.length > 2 && s.length < 60)
    .slice(0, 8);
}

function inferTopics(client) {
  // Fall back to guessing topics from the description or entity list
  const desc = (client.client_profile || '').toLowerCase();
  const guesses = [];
  if (desc.includes('heat pump') || desc.includes('wärmepumpe')) guesses.push('heat pump');
  if (desc.includes('real estate') || desc.includes('immobilien'))  guesses.push('real estate');
  if (desc.includes('hotel') || desc.includes('tourism'))           guesses.push('tourism hospitality');
  if (desc.includes('energy') || desc.includes('energie'))         guesses.push('energy');
  if (desc.includes('industrial') || desc.includes('manufacturing'))guesses.push('industrial manufacturing');
  if (guesses.length === 0) guesses.push(client.client_name); // last resort
  return guesses;
}
