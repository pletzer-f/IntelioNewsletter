// lib/claude.js — Anthropic Claude API client + agent prompt factory

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL   = 'claude-sonnet-4-6';
const MAX_TOK = 8000;  // orchestrator & agent00

// Load SKILL.md once at cold-start — use import.meta.url for reliable ESM path resolution
const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = readFileSync(join(__dirname, 'SKILL.md'), 'utf-8');

// ── Extract reusable SKILL.md excerpts at cold-start ──────────────────────────

// Sections 1–2: Mission + Editorial Priority Stack (~170 tokens)
const MISSION = SKILL_MD.slice(
  SKILL_MD.indexOf('## 1. MISSION'),
  SKILL_MD.indexOf('## 3. RUNTIME INPUTS')
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
  '## 8. ORCHESTRATOR',
];
const AGENT_SECTIONS = {};
for (let i = 1; i <= 6; i++) {
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
export async function complete(systemPrompt, userPrompt, maxTokens = MAX_TOK) {
  const msg = await anthropic.messages.create({
    model:      MODEL,
    max_tokens: maxTokens,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  });
  return msg.content[0].text;
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

/** Token ceiling scaled to the requested card count (~650 tok/card + overhead), capped at 8k. */
function maxTokensFor(count) {
  return Math.min(8000, 900 + count * 650);
}

// ─── Agent prompt factory ────────────────────────────────────────────────────

/**
 * Build the system prompt for any agent, injecting the SKILL.md methodology
 * and the client configuration object.
 */
function agentSystem(agentId, client) {
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

## Output format (use exactly)
${CARD_FORMAT}

Produce ONLY valid HTML. No markdown fences. No preamble. Start directly with <article class="story-lead">.
`;
}

// ─── Agent 00 — Monthly profile ──────────────────────────────────────────────

export async function runAgent00(client, searchResults) {
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
${JSON.stringify(searchResults, null, 2)}

Produce a complete markdown profile with:
- Last updated: ${new Date().toISOString().split('T')[0]}
- Valid until: ${new Date(Date.now() + 31*24*60*60*1000).toISOString().split('T')[0]}
- All sections from the AGENT 00 deliverable spec
- Top 10 company-specific search terms
- Top 10 competitor search terms
- Section-specific query overlays for AGENTS 01-06`;

  return complete(system, user);
}

// ─── Section agents 01–06 ─────────────────────────────────────────────────────

const SECTION_META = {
  1: { title: 'Macro & Markets',              extra: 'This is the flagship section — prioritise breadth: monetary policy, inflation, FX, commodities, PMI, regional economic signals.' },
  2: { title: 'Core Industry & Operations',   extra: 'Focus on sector dynamics, competitor moves, regulation, supply chain, and technology shifts.' },
  3: { title: 'Private Equity & M&A',          extra: 'Focus on deal flow, valuation multiples, strategic transactions, and consolidation signals.' },
  4: { title: 'End-Market Demand',             extra: 'Focus on customer-side demand signals, order trends, and geographic divergence.' },
  5: { title: 'Assets, Capex & Balance Sheet', extra: 'Focus on capex economics, financing conditions, asset values, and subsidies.' },
  6: { title: 'Local Policy & Reputation',     extra: 'Focus on local policy, regulation, permits, labour/tax, and direct company mentions.' },
};

function runSectionAgent(agentId, client, profile, searchResults) {
  const id    = String(agentId).padStart(2, '0');
  const meta  = SECTION_META[agentId];
  const count = storyCount(client, agentId);

  const user = `You are running AGENT ${id} (${meta.title}) for ${client.client_name}.

## Monthly client profile
${profile}

## Search results for this section
${JSON.stringify(searchResults, null, 2)}

Produce ${count} story cards covering the most important ${meta.title} developments.
${meta.extra}
Section title: ${meta.title}
Use the ## Output format exactly: every story is an identical <article class="story-lead"> block, no wrappers.`;

  return complete(agentSystem(id, client), user, maxTokensFor(count));
}

export const runAgent01 = (client, profile, sr) => runSectionAgent(1, client, profile, sr);
export const runAgent02 = (client, profile, sr) => runSectionAgent(2, client, profile, sr);
export const runAgent03 = (client, profile, sr) => runSectionAgent(3, client, profile, sr);
export const runAgent04 = (client, profile, sr) => runSectionAgent(4, client, profile, sr);
export const runAgent05 = (client, profile, sr) => runSectionAgent(5, client, profile, sr);
export const runAgent06 = (client, profile, sr) => runSectionAgent(6, client, profile, sr);

// ─── Orchestrator — Key Themes + Executive Highlights ────────────────────────

export async function runOrchestrator(client, profile, sectionHtmls) {
  const system = `You are the Intelio orchestrator. You receive the HTML output of 6 section agents
and produce the Executive Summary block for the briefing — a ranked highlight list of the top 5 stories
plus 4 cross-sectional Key Themes. Follow SKILL.md Sections 8 and 9 exactly.${langDirective(client)}

${SKILL_MD}`;

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
  <li class="sum-item"><span class="sum-num">01</span><span class="sum-text"><strong>[Short bold title]</strong> [1-sentence fact + significance. Must include a number or data point.]</span></li>
  <li class="sum-item"><span class="sum-num">02</span><span class="sum-text"><strong>[Short bold title]</strong> [1-sentence fact + significance with number.]</span></li>
  <li class="sum-item"><span class="sum-num">03</span><span class="sum-text"><strong>[Short bold title]</strong> [1-sentence fact + significance with number.]</span></li>
  <li class="sum-item"><span class="sum-num">04</span><span class="sum-text"><strong>[Short bold title]</strong> [1-sentence fact + significance with number.]</span></li>
  <li class="sum-item"><span class="sum-num">05</span><span class="sum-text"><strong>[Short bold title]</strong> [1-sentence fact + significance with number.]</span></li>
</ul>
<div style="margin-top:28px;padding-top:22px;border-top:1px solid var(--border)">
  <h3 style="font-family:'Playfair Display',serif;font-size:17px;font-weight:700;color:var(--text);margin-bottom:14px">Key Themes</h3>
  <ol style="padding-left:18px;display:flex;flex-direction:column;gap:10px;font-size:14.5px;color:var(--text-2);line-height:1.75">
    <li>[Cross-sectional theme connecting 2+ sections — include ${client.client_name} relevance]</li>
    <li>[Cross-sectional theme]</li>
    <li>[Cross-sectional theme]</li>
    <li>[Cross-sectional theme]</li>
  </ol>
</div>

Rank the 5 highlights by Importance Score (highest = 01). Each must contain a quantitative data point.
Start output directly with <p class="summary-prep">.`;

  return complete(system, user);
}
