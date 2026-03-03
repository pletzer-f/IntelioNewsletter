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
  // Deliberately broad: ECB, PMI, FX, commodities, regional macro.
  // No company-specific queries — macro is market-wide by definition.
  const agent01 = [
    `ECB interest rate decision ${month}`,
    `Eurozone inflation CPI ${month}`,
    `Eurozone PMI manufacturing services flash ${month}`,
    `TTF natural gas price Europe ${month}`,
    `EUR USD EUR CHF exchange rate ${month}`,
    `${region} economic outlook GDP ${month}`,
    `US Federal Reserve rate decision ${month}`,
    `global trade tariffs Europe impact ${month}`,
  ];

  // ── Agent 02: Core Industry & Operations ─────────────────────────────────
  // Topics = what sector the client operates in (e.g. healthcare analytics, pharma).
  // Focus on sector-wide dynamics, regulation, and competitor news — NOT client company.
  const primaryTopics = topics.length ? topics : inferTopics(client);
  const agent02 = [
    ...primaryTopics.slice(0, 3).map(t => `${t} market trends ${region} ${month}`),
    ...primaryTopics.slice(0, 2).map(t => `${t} regulation Europe ${new Date().getFullYear()}`),
    ...primaryTopics.slice(0, 2).map(t => `${t} industry outlook ${month}`),
    ...competitors.slice(0, 3).map(c => `${c} ${month}`),
  ];

  // ── Agent 03: Private Equity & M&A ────────────────────────────────────────
  const agent03 = [
    ...primaryTopics.slice(0, 2).map(t => `private equity ${t} DACH ${month}`),
    ...primaryTopics.slice(0, 2).map(t => `M&A ${t} Europe ${month}`),
    `${primaryTopics[0] || name} valuation multiples sector ${new Date().getFullYear()}`,
    ...competitors.slice(0, 2).map(c => `${c} acquisition merger ${month}`),
    `healthcare technology life sciences M&A Europe ${month}`,
  ];

  // ── Agent 04: End-Market Demand ────────────────────────────────────────────
  // Focus on sector demand drivers and customer-side indicators — not client company results.
  const agent04 = [
    ...primaryTopics.slice(0, 3).map(t => `${t} demand growth forecast ${month}`),
    `${region} healthcare pharma spending ${month}`,
    `${region} business investment sentiment ${month}`,
    ...primaryTopics.slice(0, 2).map(t => `${t} customer procurement ${month}`),
  ];

  // ── Agent 05: Assets, Capex & Balance Sheet ───────────────────────────────
  // Sector-wide capex, financing conditions, real assets — not company-specific.
  const agent05 = [
    ...primaryTopics.slice(0, 2).map(t => `${t} investment capex ${region} ${month}`),
    `financing conditions ${primaryTopics[0] || 'industry'} Europe ${month}`,
    `subsidy incentives ${primaryTopics[0] || 'life sciences'} ${region} ${new Date().getFullYear()}`,
    `${region} commercial real estate yield ${month}`,
    `European venture capital private equity fundraising ${month}`,
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
  // Infer sector topics from the client profile description.
  // IMPORTANT: the fallback must NEVER be the company name itself — that produces
  // company-specific searches rather than sector searches.
  const desc = (client.client_profile || client.client_name || '').toLowerCase();
  const guesses = [];

  // Healthcare / pharma / life sciences
  if (desc.includes('healthcare') || desc.includes('health care'))       guesses.push('healthcare services');
  if (desc.includes('pharma') || desc.includes('pharmaceutical'))        guesses.push('pharmaceutical industry');
  if (desc.includes('life science'))                                      guesses.push('life sciences');
  if (desc.includes('clinical') || desc.includes('real world evidence')) guesses.push('clinical data analytics');
  if (desc.includes('iqvia') || desc.includes('health analytics'))       guesses.push('health data analytics');
  if (desc.includes('medtech') || desc.includes('medical device'))       guesses.push('medtech medical devices');

  // Technology / software
  if (desc.includes('software') || desc.includes('saas'))               guesses.push('enterprise software');
  if (desc.includes('data analytics') || desc.includes('analytics'))     guesses.push('data analytics');
  if (desc.includes('ai') || desc.includes('artificial intelligence'))   guesses.push('artificial intelligence');
  if (desc.includes('cybersecurity') || desc.includes('security'))       guesses.push('cybersecurity');

  // Industrials / manufacturing
  if (desc.includes('heat pump') || desc.includes('wärmepumpe'))        guesses.push('heat pump');
  if (desc.includes('industrial') || desc.includes('manufacturing'))     guesses.push('industrial manufacturing');
  if (desc.includes('automotive') || desc.includes('auto'))              guesses.push('automotive industry');
  if (desc.includes('logistics') || desc.includes('supply chain'))       guesses.push('logistics supply chain');

  // Real assets / property
  if (desc.includes('real estate') || desc.includes('immobilien'))       guesses.push('commercial real estate');
  if (desc.includes('hotel') || desc.includes('tourism'))                guesses.push('tourism hospitality');

  // Energy / utilities
  if (desc.includes('energy') || desc.includes('energie'))               guesses.push('energy transition');
  if (desc.includes('renewable') || desc.includes('solar') || desc.includes('wind')) guesses.push('renewable energy');

  // Finance
  if (desc.includes('bank') || desc.includes('financial services'))      guesses.push('financial services');
  if (desc.includes('insurance') || desc.includes('versicherung'))       guesses.push('insurance industry');

  // Generic sector fallback — broad enough to generate meaningful market queries
  if (guesses.length === 0) {
    const region = client.region || 'Europe';
    guesses.push(`${region} business services`, 'professional services Europe');
  }

  return guesses;
}
