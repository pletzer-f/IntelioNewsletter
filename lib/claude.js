// lib/claude.js — Anthropic Claude API client + agent prompt factory

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL   = 'claude-sonnet-4-6';
const MAX_TOK = 12000;  // orchestrator & agent00 — headroom so long (esp. German) output isn't truncated

// Load SKILL.md once at cold-start — use import.meta.url for reliable ESM path resolution
const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = readFileSync(join(__dirname, 'SKILL.md'), 'utf-8');

// ── Extract reusable SKILL.md excerpts at cold-start ──────────────────────────

// Sections 1–2: Mission + Editorial Priority Stack (~170 tokens)
const MISSION = SKILL_MD.slice(
  SKILL_MD.indexOf('## 1. MISSION'),
  SKILL_MD.indexOf('## 3. RUNTIME INPUTS')
).trim();

// Sections 8–10: Orchestrator synthesis rules + output format + quality gates.
// The orchestrator only needs these (plus MISSION) — shipping the whole SKILL.md
// (~5k tokens) on every briefing was pure input-token waste.
const ORCHESTRATOR_SKILL = SKILL_MD.slice(
  SKILL_MD.indexOf('## 8. ORCHESTRATOR'),
  SKILL_MD.indexOf('## 11. DEFAULT CLIENT CONTEXT')
).trim();

// Story card format — ALL stories use the same <article class="story-lead"> structure.
// There is NO story-grid and NO story-card class — every story is full-width and identical
// in structure, ensuring a consistent visual hierarchy throughout the briefing.
const CARD_FORMAT = `Output each story using this IDENTICAL structure for EVERY story (1st, 2nd, 3rd, etc.):

IMPORTANT: ALL stories use <article class="story-lead"> — no exceptions.
Do NOT use <article class="story-card"> or <div class="story-grid"> — these are forbidden.
Do NOT add any wrapper div around the articles. Each <article> stands alone.

<article class="story-lead">
  <div class="story-header">
    <div class="story-tags">
      <span class="sdot [pos|neg|neu]" title="[Positive|Negative|Neutral] signal"></span>
      <span class="story-tag">[CATEGORY · TOPIC]</span>
    </div>
    <span class="story-rt">[N] min read</span>
  </div>
  <h3 class="story-hl">[Specific analyst headline — include a number, direction, or named market signal]</h3>
  <p class="story-lede">[One-sentence italic lead: what happened and why it matters. Include a data point.]</p>
  <p class="story-body">[2–3 sentences: economic mechanism, first/second-order effects, regional or sector context.]</p>
  <div class="key-stat">
    <div class="ks-val">[Key figure, %, or monetary value]</div>
    <div class="ks-lbl">[What it measures · source · date]</div>
  </div>
  <div class="impl-block">
    <button class="impl-toggle" onclick="toggleImpl(this)">
      <span class="impl-arrow">→</span> Business implication
    </button>
    <div class="impl-body"><div class="impl-inner">[Client relevance: named entity + direction + horizon + watchpoint. 1–2 sentences.]</div></div>
  </div>
  <a class="story-src" href="[VERIFIED URL or best-guess URL]" target="_blank">→ [Publication] · [DD Mon YYYY]</a>
</article>

[Repeat the identical <article class="story-lead"> block for every additional story. No wrappers between them.]`;

// Per-agent section descriptions from Section 7 (~150 tokens each)
const SEC7_MARKERS = [
  '### AGENT 00 - MONTHLY',
  '### AGENT 01 - MACRO',
  '### AGENT 02 - CORE',
  '### AGENT 03 - PRIVATE',
  '### AGENT 04 - END-MARKET',
  '### AGENT 05 - ASSETS',
  '### AGENT 06 - LOCAL',
  '### AGENT 07 - POLITICS',
  '## 8. ORCHESTRATOR',
];
const AGENT_SECTIONS = {};
for (let i = 1; i <= 7; i++) {
  const start = SKILL_MD.indexOf(SEC7_MARKERS[i]);
  const end   = SKILL_MD.indexOf(SEC7_MARKERS[i + 1]);
  AGENT_SECTIONS[String(i).padStart(2, '0')] = SKILL_MD.slice(start, end).trim();
}

// ─── Core completions ────────────────────────────────────────────────────────

/**
 * Single Claude call — returns the full text response.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @returns {Promise<string>}
 */
const OPUS_MODEL  = 'claude-opus-4-8';    // optional escalation for the hardest reasoning
const HAIKU_MODEL = 'claude-haiku-4-5';   // fast, cheap, mechanical fact-checking (verification pass)

export async function complete(systemPrompt, userPrompt, maxTokens = MAX_TOK, usage = null, opts = {}) {
  const wanted = opts.model || MODEL;
  const build = (model) => {
    const req = { model, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] };
    if (opts.thinking && model.startsWith('claude-opus')) req.thinking = { type: 'adaptive' };  // Opus 4.8 adaptive thinking
    return req;
  };
  let msg, usedModel = wanted;
  try {
    msg = await anthropic.messages.create(build(wanted));
  } catch (e) {
    // Resilience: if an Opus/thinking call fails (access, SDK, rate), fall back to the default
    // model rather than failing the briefing — grounding + verification still apply on Sonnet.
    if (wanted !== MODEL) {
      console.warn(`[claude] ${wanted} call failed (${e?.message || e}); retrying on ${MODEL}`);
      usedModel = MODEL;
      msg = await anthropic.messages.create(build(MODEL));
    } else {
      throw e;
    }
  }
  // Accumulate token usage for cost tracking when a collector is supplied — per model actually used.
  if (usage && msg.usage) {
    const inT  = (msg.usage.input_tokens || 0)
               + (msg.usage.cache_read_input_tokens || 0)
               + (msg.usage.cache_creation_input_tokens || 0);
    const outT = (msg.usage.output_tokens || 0);
    if (usedModel.startsWith('claude-opus')) {
      usage.opusInput  = (usage.opusInput  || 0) + inT;
      usage.opusOutput = (usage.opusOutput || 0) + outT;
    } else if (usedModel.startsWith('claude-haiku')) {
      usage.haikuInput  = (usage.haikuInput  || 0) + inT;
      usage.haikuOutput = (usage.haikuOutput || 0) + outT;
    } else {
      usage.input  = (usage.input  || 0) + inT;
      usage.output = (usage.output || 0) + outT;
    }
  }
  // With adaptive thinking the response carries thinking + text blocks — return the text block.
  const textBlock = msg.content.find(b => b.type === 'text');
  return (textBlock ? textBlock.text : msg.content[0]?.text) || '';
}

// Per-token pricing, USD. Sonnet 4.6 for most work; Opus 4.8 for accuracy-critical steps.
export const PRICE_PER_INPUT_TOKEN       = 3.00  / 1_000_000;
export const PRICE_PER_OUTPUT_TOKEN      = 15.00 / 1_000_000;
export const OPUS_PRICE_PER_INPUT_TOKEN   = 5.00  / 1_000_000;
export const OPUS_PRICE_PER_OUTPUT_TOKEN  = 25.00 / 1_000_000;
export const HAIKU_PRICE_PER_INPUT_TOKEN  = 1.00  / 1_000_000;
export const HAIKU_PRICE_PER_OUTPUT_TOKEN = 5.00  / 1_000_000;

/** USD cost from a usage accumulator carrying sonnet + opus + haiku token buckets. */
export function computeCost(usage) {
  if (!usage) return 0;
  return (usage.input       || 0) * PRICE_PER_INPUT_TOKEN
       + (usage.output      || 0) * PRICE_PER_OUTPUT_TOKEN
       + (usage.opusInput   || 0) * OPUS_PRICE_PER_INPUT_TOKEN
       + (usage.opusOutput  || 0) * OPUS_PRICE_PER_OUTPUT_TOKEN
       + (usage.haikuInput  || 0) * HAIKU_PRICE_PER_INPUT_TOKEN
       + (usage.haikuOutput || 0) * HAIKU_PRICE_PER_OUTPUT_TOKEN;
}

// ─── Client-preference directives (woven into every section agent prompt) ─────

/** Enforce output language. Without this, 'de' clients still received English. */
function langDirective(client) {
  return (client.output_language === 'de')
    ? `\n## OUTPUT LANGUAGE (MANDATORY)
Write ALL output in GERMAN — headlines, ledes, body analysis, key-stat labels, business implications, tags. Do NOT write in English. Keep proper nouns, tickers, and source/publication names in their original form.`
    : '';
}

/** Bias story selection/synthesis toward the client's preferred outlets, away from any blacklist. */
function sourceDirective(client) {
  const prefs = [
    ...String(client.client_local_sources || '').split(',').map(s => s.trim()).filter(Boolean),
    ...(client.client_priority_sources || []),
  ].filter((v, i, a) => a.indexOf(v) === i).slice(0, 12);
  const blacklist = (client.client_source_blacklist || []).filter(Boolean);

  let s = '';
  if (prefs.length) {
    s += `\n## SOURCE PREFERENCES
This client prefers these outlets. When several sources cover the same event, prioritise, cite, and corroborate with these first and treat them as higher-trust: ${prefs.join(', ')}.`;
  }
  if (blacklist.length) {
    s += `\nNever cite or rely on these outlets: ${blacklist.join(', ')}.`;
  }
  return s;
}

/** Match the analytical lens to the client's chosen news scope. */
function scopeDirective(client) {
  const s = client.news_scope || 'both';
  if (s === 'regional') {
    return `\n## GEOGRAPHIC LENS
Focus on ${client.region}. Prioritise regional and local developments; include global items only where they transmit directly to this region.`;
  }
  if (s === 'global') {
    return `\n## GEOGRAPHIC LENS
Focus on global and cross-border macro/market developments; include local items only where materially significant.`;
  }
  return `\n## GEOGRAPHIC LENS
Balance ${client.region} regional depth with global context.`;
}

/** How many story cards a section should produce, from the client's depth setting. */
function storyCount(client, agentId) {
  const base = Number(client.stories_per_section) > 0 ? Number(client.stories_per_section) : 3;
  // Agent 01 (Macro & Markets) is the flagship breadth section — a little larger.
  return agentId === 1 ? base + 2 : base;
}

/** Token ceiling scaled to the requested card count, capped at 16k.
 *  German cards run ~1,000–1,200 output tokens each; the old ~650/card ceiling
 *  truncated most sections mid-story. ~1,500/card gives comfortable headroom
 *  (you only pay for tokens actually generated, so the higher ceiling is free). */
function maxTokensFor(count) {
  return Math.min(16000, 2000 + count * 1500);
}

// ─── Agent prompt factory ────────────────────────────────────────────────────

/**
 * Build the system prompt for any agent, injecting the SKILL.md methodology
 * and the client configuration object.
 */
function agentSystem(agentId, client, dataSheet = '') {
  const id = String(agentId).padStart(2, '0');
  const isReputationAgent = id === '06';
  return `You are Intelio AGENT ${id} — an economic intelligence analyst.

## Client context (for implication framing only)
${client.client_name} | ${client.region} | ${client.output_language || 'en'}
Entities: ${(client.client_entities || []).join(', ') || 'none'}
Topics:   ${(client.client_topics || []).join(', ') || 'none'}

## Today
${new Date().toISOString().split('T')[0]}

## Mission & editorial standards
${MISSION}

## Your section specification
${AGENT_SECTIONS[id] || ''}

## CRITICAL EDITORIAL RULE — Market-first intelligence
${isReputationAgent
  ? `Agent 06 covers company-specific news, policy, and reputation. You MAY write stories directly about ${client.client_name} and its entities.`
  : `Stories MUST describe what is happening in the ECONOMY, MARKET, or INDUSTRY — NOT what is happening at ${client.client_name}.

- Headlines and body text are written from a macro/sector analyst perspective
- "${client.client_name}" MUST NOT appear in any headline or story body paragraph
- All mention of the client company belongs ONLY inside <div class="impl-body"> Business Implication
- When a search result references ${client.client_name} directly, extract the underlying MARKET SIGNAL and write the story about that sector trend — put the client connection in the implication block
- Example wrong: "${client.client_name} reports 12% revenue growth"
- Example right: "Healthcare Analytics Revenue Grows 12% as Real-World Evidence Demand Surges" → Implication: "[${client.client_name}]: revenue tailwind from accelerating RWE adoption; watch pricing pressure as competition intensifies"
- At most 1 story per section may reference the client company, and only if it is genuinely market-moving news`
}
${scopeDirective(client)}${sourceDirective(client)}${langDirective(client)}
${dataSheet ? `\n${dataSheet}\n` : ''}
## ACCURACY & SOURCING — NON-NEGOTIABLE
- Every number, %, rate, monetary value, date, or named statistic MUST appear verbatim in the SEARCH RESULTS, the article \`text\` fields, or the VERIFIED FIGURES above. NEVER invent, estimate, round-from-memory, or extrapolate a figure.
- For the ECB policy rate, euro-area inflation, and any market level: use ONLY the VERIFIED FIGURES values and cite their named source. If a figure you want is not provided, write the story qualitatively and OMIT the key-stat — do NOT guess.
- The <div class="key-stat"> block is OPTIONAL. Include it only when you have a verified figure with a real source; otherwise omit the entire key-stat block. A story with no number is acceptable.
- Source links: the href MUST be a URL copied EXACTLY from the provided search results. NEVER construct, complete, shorten, or guess a URL (e.g. do not invent an "ecb.europa.eu/press/…" link). If you have no real URL for a story, omit the <a class="story-src"> link.
- NEVER mention internal working material in the output text: do not write "Verified-Daten", "VERIFIED FIGURES", "Suchergebnisse", "search results", or similar. Attribute figures to their real named source (e.g. "ECB Data Portal", "Eurostat") or simply "Marktdaten".
- SOURCE QUALITY: do not cite Wikipedia or state-controlled outlets (e.g. TASS, RT, Xinhua) as a named source in prose or as the story-src link. If such a result carries a genuinely useful fact, attribute the underlying primary source it reports on, or state the fact without a named attribution.
- FORWARD-LOOKING CLAIMS: never assert or "signal" a future policy move, forecast, or trend reversal (e.g. an expected rate cut) unless a provided source explicitly states it — and then attribute it to that source. Do not upgrade "could" into "expected".
- Prefer fewer, fully-grounded stories over padding with unverified claims. If the sources are thin, write fewer cards.

## Output format (use exactly)
${CARD_FORMAT}

Produce ONLY valid HTML. No markdown fences. No preamble. Start directly with <article class="story-lead">.
`;
}

// ─── Agent 00 — Monthly profile ──────────────────────────────────────────────

export async function runAgent00(client, searchResults, usage = null) {
  const system = `You are the Intelio strategic intelligence analyst running AGENT 00 (monthly profile refresh).
Your output is a structured markdown document that will be saved as the client's monthly intelligence profile.
Base your analysis on the search results provided. Follow the AGENT 00 deliverable spec from SKILL.md.

${SKILL_MD}`;

  const user = `Generate the monthly client intelligence profile for:

CLIENT_NAME: ${client.client_name}
REGION: ${client.region}
NEWS_SCOPE: ${client.news_scope || 'both'}
CLIENT_ENTITIES: ${JSON.stringify(client.client_entities || [])}
CLIENT_TOPICS: ${JSON.stringify(client.client_topics || [])}
PREFERRED_SOURCES: ${client.client_local_sources || '(none provided)'}
CLIENT_PROFILE: ${client.client_profile || '(none provided)'}

## Search results (use these as your primary evidence base)
${JSON.stringify(searchResults)}

Produce a complete markdown profile with:
- Last updated: ${new Date().toISOString().split('T')[0]}
- Valid until: ${new Date(Date.now() + 31*24*60*60*1000).toISOString().split('T')[0]}
- All sections from the AGENT 00 deliverable spec
- Top 10 company-specific search terms
- Top 10 competitor search terms
- Section-specific query overlays for AGENTS 01-06`;

  return complete(system, user, MAX_TOK, usage);
}

// ─── Section agents 01–07 ─────────────────────────────────────────────────────

const SECTION_META = {
  1: { title: 'Macro & Markets',              extra: 'This is the flagship section — prioritise breadth: monetary policy, inflation, FX, commodities, PMI, regional economic signals.' },
  2: { title: 'Core Industry & Operations',   extra: 'Focus on sector dynamics, competitor moves, regulation, supply chain, and technology shifts.' },
  3: { title: 'Private Equity & M&A',          extra: 'Focus on deal flow, valuation multiples, strategic transactions, and consolidation signals.' },
  4: { title: 'End-Market Demand',             extra: 'Focus on customer-side demand signals, order trends, and geographic divergence.' },
  5: { title: 'Assets, Capex & Balance Sheet', extra: 'Focus on capex economics, financing conditions, asset values, and subsidies.' },
  6: { title: 'Local Policy & Reputation',     extra: 'Focus on local policy, regulation, permits, labour/tax, and direct company mentions.' },
  7: { title: 'Politics & Geopolitics',        extra: 'Focus on government & elections, the legislative/regulatory agenda, EU policy, and trade/geopolitical developments — selected by relevance to the client’s region(s) and sector. Name the political actors, parties, and bodies involved; keep the client connection in the implication block.' },
};

function runSectionAgent(agentId, client, profile, searchResults, usage = null, dataSheet = '', opts = {}) {
  const id    = String(agentId).padStart(2, '0');
  const meta  = SECTION_META[agentId];
  const count = storyCount(client, agentId);

  const user = `You are running AGENT ${id} (${meta.title}) for ${client.client_name}.

## Monthly client profile
${profile}

## Search results for this section
Each result has title, url, description, and — where available — a "text" field with the
fetched article body. PREFER the "text" field for any figure; treat title/description as a
headline hint only. Use a number ONLY if it appears in this material or the VERIFIED FIGURES.
${JSON.stringify(searchResults)}

Produce up to ${count} story cards on the most important ${meta.title} developments — but only as many as the sources genuinely support (fewer, fully-grounded cards beat padded ones).
${meta.extra}
Section title: ${meta.title}
Use the ## Output format exactly: every story is an identical <article class="story-lead"> block, no wrappers.`;

  const maxTok = opts.maxTokens || maxTokensFor(count);
  return complete(agentSystem(id, client, dataSheet), user, maxTok, usage, opts);
}

// Model mix (quality-first, per client decision 2026-07-02): sections generate on
// Sonnet 4.6 (grounded by the VERIFIED FIGURES sheet + cite-or-omit rules); every
// section is then fact-checked by OPUS 4.8 with adaptive thinking (runVerifier /
// runner Step 3.5) — verification is where the strongest model has the most leverage
// (cross-source conflation, inverted conclusions, misattribution). The Executive
// Summary gets its own Opus cross-check (runSummaryVerifier / Step 4.5).
// complete() auto-falls back to Sonnet if an Opus call fails, so a briefing never breaks.
export const runAgent01 = (client, profile, sr, usage, ds) => runSectionAgent(1, client, profile, sr, usage, ds);
export const runAgent02 = (client, profile, sr, usage, ds) => runSectionAgent(2, client, profile, sr, usage, ds);
export const runAgent03 = (client, profile, sr, usage, ds) => runSectionAgent(3, client, profile, sr, usage, ds);
export const runAgent04 = (client, profile, sr, usage, ds) => runSectionAgent(4, client, profile, sr, usage, ds);
export const runAgent05 = (client, profile, sr, usage, ds) => runSectionAgent(5, client, profile, sr, usage, ds);
export const runAgent06 = (client, profile, sr, usage, ds) => runSectionAgent(6, client, profile, sr, usage, ds);
export const runAgent07 = (client, profile, sr, usage, ds) => runSectionAgent(7, client, profile, sr, usage, ds);

/**
 * Fact-check + correct one section's HTML against its sources and the verified data sheet.
 * Strips unsupported figures and fabricated source URLs. Best-effort: returns the original
 * HTML on any failure or implausible output, so it can never break the briefing.
 */
export async function runVerifier(client, sectionTitle, sectionHtml, searchResults, dataSheet = '', usage = null, opts = {}) {
  if (!sectionHtml || !sectionHtml.trim()) return sectionHtml;
  const system = `You are a meticulous fact-checker for an economic briefing. You receive a section's HTML, the SOURCE MATERIAL it was written from, and a VERIFIED FIGURES sheet, and you correct it so every quantitative claim and every source link is supported. Output ONLY the corrected HTML.${langDirective(client)}`;
  const user = `${dataSheet ? dataSheet + '\n\n' : ''}## SOURCE MATERIAL (what this section was written from — search results + fetched article texts)
${JSON.stringify(searchResults)}

## SECTION HTML TO CHECK (${sectionTitle})
${sectionHtml}

## RULES
- For every number / % / rate / monetary value / date in the HTML: if it is NOT supported by the SOURCE MATERIAL or the VERIFIED FIGURES, correct it to the verified value when one exists, otherwise DELETE that specific figure and its <div class="key-stat"> block. Never keep an unverified number.
- INTERPRETATION — verify each figure is used consistently with its source: correct metric, period/date, units, and direction. Catch and fix misreadings such as presenting a prior-period figure as current, a deposit rate as the "main refi" rate, month-on-month as year-on-year, a decline as a rise, or a forecast as an actual. If the wording misrepresents the source and can't be fixed from the material, remove the claim.
- USABILITY — remove vague or unsupported assertions of significance, causation, or impact that have no basis in the SOURCE MATERIAL. Keep only what the sources actually support; a shorter, fully-grounded card is the goal.
- For every <a class="story-src"> href: if that exact URL does not appear in the SOURCE MATERIAL, remove the link (keep the story text). Never keep a fabricated URL.
- ATTRIBUTION HYGIENE — if the text cites internal working material as a source (e.g. "Verified-Daten", "VERIFIED FIGURES", "laut Suchergebnissen"), rewrite that attribution to the real named source or "Marktdaten". If prose names Wikipedia or a state-controlled outlet (TASS, RT, Xinhua) as the source of a claim, re-attribute to the primary source when the material identifies one, otherwise drop the named attribution (keep the supported fact).
- FORWARD-LOOKING claims (expected rate moves, forecasts, "Zinswende"/"turnaround in sight"): keep only if a source in the SOURCE MATERIAL explicitly states them; otherwise delete or soften to what the sources actually say.
- Do NOT add new stories, headlines, or facts; do NOT rewrite correct prose. Only correct/remove unsupported or misinterpreted figures, claims, and links.
- Keep the exact structure: a sequence of <article class="story-lead"> blocks, no wrappers, no markdown fences.
- Output ONLY the corrected HTML, starting with <article. If everything already checks out, return it unchanged.`;
  try {
    const out = ((await complete(system, user, opts.maxTokens || 16000, usage, opts)) || '').trim();
    return out.startsWith('<article') ? out : sectionHtml;   // reject refusals/commentary
  } catch {
    return sectionHtml;
  }
}

/**
 * Cross-check the Executive Summary against the (already fact-checked) section
 * outputs: every figure/date/attribution must match a section verbatim, and no
 * conclusion may go beyond what the sections state. The summary is the most-read
 * block of the briefing and previously shipped unverified. Best-effort: returns
 * the original summary on any failure, so it can never break the briefing.
 */
export async function runSummaryVerifier(client, summaryHtml, sectionHtmls, usage = null, opts = {}) {
  if (!summaryHtml || !summaryHtml.trim()) return summaryHtml;
  const system = `You are a meticulous cross-checker for an executive briefing. You receive the Executive Summary HTML and the fact-checked SECTION OUTPUTS it was synthesized from, and you correct the summary so it is fully supported by the sections. Output ONLY the corrected HTML.${langDirective(client)}`;
  const user = `## FACT-CHECKED SECTION OUTPUTS (ground truth for the summary)
${sectionHtmls.map((h, i) => `### Section ${i + 1}\n${h}`).join('\n\n')}

## EXECUTIVE SUMMARY TO CHECK
${summaryHtml}

## RULES
- Every number, %, rate, monetary value, and date in the summary MUST appear in the sections with the same value. Correct any mismatch to the section value; if a claim has no basis in any section, remove that claim.
- Every attribution must stay paired with its own claim exactly as in the sections — fix source tags that drifted onto a different claim (e.g. a data-portal tag attached to an official's forecast).
- Remove or soften any forward-looking conclusion (an expected policy move, "turnaround in sight", a projected trend) that no section explicitly states with a source; preserve the sections' hedges.
- Do NOT add new stories, themes, or facts; do NOT rewrite prose that is already correct; keep the exact HTML structure (<p class="summary-prep">, the sum-list items, the Key Themes block).
- Output ONLY the corrected HTML, starting with <p class="summary-prep">. If everything already checks out, return it unchanged.`;
  try {
    const out = ((await complete(system, user, opts.maxTokens || 8000, usage, opts)) || '').trim();
    return out.startsWith('<p') ? out : summaryHtml;   // reject refusals/commentary
  } catch {
    return summaryHtml;
  }
}

// ─── Orchestrator — Key Themes + Executive Highlights ────────────────────────

export async function runOrchestrator(client, profile, sectionHtmls, usage = null) {
  const system = `You are the Intelio orchestrator. You receive the HTML output of up to 7 section agents
and produce the Executive Summary block for the briefing — a ranked list of the top 7 stories
(each a concise, CEO-level analysis of at most 3 sentences) plus 4–5 cross-sectional Key Themes.
Follow the synthesis rules below exactly.${langDirective(client)}

${MISSION}

${ORCHESTRATOR_SKILL}`;

  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const timeCET = new Date().toLocaleTimeString('de-AT', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna',
  });

  const user = `Orchestrate the final briefing for ${client.client_name}.

## Section outputs
${sectionHtmls.map((h, i) => `### Agent 0${i + 1}\n${h}`).join('\n\n')}

## Monthly profile excerpt (for priority ranking)
${profile.slice(0, 2000)}

Produce the Executive Summary section content. Output ONLY this exact HTML structure — no markdown fences, no preamble:

<p class="summary-prep">Compiled ${timeCET} CET · ${today} · Sources: [comma-separated list of main publications used across all sections]</p>
<ul class="sum-list">
  <li class="sum-item"><span class="sum-num">01</span><span class="sum-text"><strong>[Short bold title]</strong> [2–3 full sentences: (1) what happened, with a specific figure AND a date; (2) the economic mechanism behind it; (3) the first- or second-order effect / why it matters.]</span></li>
  <li class="sum-item"><span class="sum-num">02</span><span class="sum-text"><strong>[Short bold title]</strong> [2–3 full sentences: figure + date, mechanism, effect.]</span></li>
  <li class="sum-item"><span class="sum-num">03</span><span class="sum-text"><strong>[Short bold title]</strong> [2–3 full sentences: figure + date, mechanism, effect.]</span></li>
  <li class="sum-item"><span class="sum-num">04</span><span class="sum-text"><strong>[Short bold title]</strong> [2–3 full sentences: figure + date, mechanism, effect.]</span></li>
  <li class="sum-item"><span class="sum-num">05</span><span class="sum-text"><strong>[Short bold title]</strong> [2–3 full sentences: figure + date, mechanism, effect.]</span></li>
  <li class="sum-item"><span class="sum-num">06</span><span class="sum-text"><strong>[Short bold title]</strong> [2–3 full sentences: figure + date, mechanism, effect.]</span></li>
  <li class="sum-item"><span class="sum-num">07</span><span class="sum-text"><strong>[Short bold title]</strong> [2–3 full sentences: figure + date, mechanism, effect.]</span></li>
</ul>
<div style="margin-top:28px;padding-top:22px;border-top:1px solid var(--border)">
  <h3 style="font-family:'Playfair Display',serif;font-size:17px;font-weight:700;color:var(--text);margin-bottom:14px">Key Themes</h3>
  <ul style="margin:0;padding-left:20px;font-size:14.5px;color:var(--text-2);line-height:1.7">
    <li style="margin-bottom:11px"><strong style="color:var(--text)">[Theme label]</strong> — [1–2 sentences: how this theme connects 2+ sections and what it means for ${client.client_name}.]</li>
    <li style="margin-bottom:11px"><strong style="color:var(--text)">[Theme label]</strong> — [1–2 sentences.]</li>
    <li style="margin-bottom:11px"><strong style="color:var(--text)">[Theme label]</strong> — [1–2 sentences.]</li>
    <li style="margin-bottom:11px"><strong style="color:var(--text)">[Theme label]</strong> — [1–2 sentences.]</li>
    <li style="margin-bottom:11px"><strong style="color:var(--text)">[5th theme — include only if genuinely distinct]</strong> — [1–2 sentences.]</li>
  </ul>
</div>

Rank the 7 highlights by Importance Score (highest = 01). RULES: every highlight is AT MOST 3 sentences — tight, information-dense, CEO-level prose (no filler) — and covers a DISTINCT story (no repeats). ACCURACY: use ONLY figures, rates, and dates that already appear in the section outputs above (those have been fact-checked) — copy them exactly and NEVER introduce a new or different number, rate, or date. Keep each figure paired with ITS OWN attribution from the section — do not move a figure under a different source's name. Do NOT add forward-looking conclusions of your own (e.g. "Zinswende in Sicht", an expected rate cut): synthesize only what the sections state, with their hedges intact. Include a figure where the section provides one; if a story has no verified figure, write the highlight without one rather than inventing it. Produce 4–5 Key Themes, each a well-described bullet (bold label + 1–2 sentences) connecting at least 2 sections.
Start output directly with <p class="summary-prep">.`;

  return complete(system, user, MAX_TOK, usage);
}
