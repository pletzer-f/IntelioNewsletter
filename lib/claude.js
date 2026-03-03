// lib/claude.js — Anthropic Claude API client + agent prompt factory

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL        = 'claude-sonnet-4-6';
const MAX_TOK      = 8000;  // orchestrator & agent00
const MAX_TOK_SEC  = 1200;  // section agents 01-06: 6 × 1200 = 7200 < 8K output TPM

// Load SKILL.md once at cold-start — use import.meta.url for reliable ESM path resolution
const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = readFileSync(join(__dirname, 'SKILL.md'), 'utf-8');

// ── Extract reusable SKILL.md excerpts at cold-start ──────────────────────────

// Sections 1–2: Mission + Editorial Priority Stack (~170 tokens)
const MISSION = SKILL_MD.slice(
  SKILL_MD.indexOf('## 1. MISSION'),
  SKILL_MD.indexOf('## 3. RUNTIME INPUTS')
).trim();

// Story card format — matches the CSS classes in briefing-template.html.
// Agents must output story-lead (first story) + story-grid/story-card (subsequent stories).
const CARD_FORMAT = `Output the stories using this exact HTML structure:

FIRST story — use <article class="story-lead">:
<article class="story-lead">
  <div class="story-header">
    <div class="story-tags">
      <span class="sdot [pos|neg|neu]" title="[Positive|Negative|Neutral] signal"></span>
      <span class="story-tag">[Category / Topic]</span>
    </div>
    <span class="story-rt">[N] min read</span>
  </div>
  <h3 class="story-hl">[Specific analyst headline with number/direction]</h3>
  <p class="story-lede">[One-sentence lead: what happened and why it matters.]</p>
  <p class="story-body">[2-3 sentences: economic mechanism, data point, first/second-order effects.]</p>
  <div class="key-stat">
    <div class="ks-val">[Key number, %, or figure]</div>
    <div class="ks-lbl">[What it measures · context / date]</div>
  </div>
  <div class="impl-block">
    <button class="impl-toggle" onclick="toggleImpl(this)">
      <span class="impl-arrow">\u2192</span> Business implication
    </button>
    <div class="impl-body"><div class="impl-inner">[Client relevance: named entity + direction + horizon + watchpoint.]</div></div>
  </div>
  <a class="story-src" href="[VERIFIED URL]" target="_blank">\u2192 [Publication] · [DD Mon YYYY]</a>
</article>

SUBSEQUENT stories (2nd, 3rd, etc.) — wrap ALL in ONE <div class="story-grid">:
<div class="story-grid">
  <article class="story-card">
    <div class="story-header">
      <div class="story-tags">
        <span class="sdot [pos|neg|neu]"></span>
        <span class="story-tag">[Category]</span>
      </div>
      <span class="story-rt">[N] min</span>
    </div>
    <h3 class="story-hl">[Analyst headline]</h3>
    <p class="story-body">[2-3 sentences: fact + analysis + client relevance with named entity.]</p>
    <div class="impl-block">
      <button class="impl-toggle" onclick="toggleImpl(this)">
        <span class="impl-arrow">\u2192</span> Business implication
      </button>
      <div class="impl-body"><div class="impl-inner">[Action or watchpoint for client.]</div></div>
    </div>
    <a class="story-src" href="[VERIFIED URL]" target="_blank">\u2192 [Publication] · [DD Mon YYYY]</a>
  </article>
  [repeat <article class="story-card"> for each additional story]
</div>`;

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

// ─── Agent prompt factory ────────────────────────────────────────────────────

/**
 * Build the system prompt for any agent, injecting the SKILL.md methodology
 * and the client configuration object.
 */
function agentSystem(agentId, client) {
  const id = String(agentId).padStart(2, '0');
  return `You are Intelio AGENT ${id} — an economic intelligence analyst.

## Client
${client.client_name} | ${client.region} | ${client.output_language || 'en'}
Entities: ${(client.client_entities || []).join(', ') || 'none'}
Topics:   ${(client.client_topics || []).join(', ') || 'none'}
Stories per section: ${client.stories_per_section || 3}

## Today
${new Date().toISOString().split('T')[0]}

## Mission & editorial standards
${MISSION}

## Your section specification
${AGENT_SECTIONS[id] || ''}

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
CLIENT_ENTITIES: ${JSON.stringify(client.client_entities || [])}
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

// ─── Agent 01 — Macro & Markets ──────────────────────────────────────────────

export async function runAgent01(client, profile, searchResults) {
  const user = `You are running AGENT 01 (Macro & Markets) for ${client.client_name}.

## Monthly client profile
${profile}

## Search results for this section
${JSON.stringify(searchResults, null, 2)}

Produce ${client.stories_per_section || 3} story cards in HTML format.
Section ID: bsec-01
Section title: Macro & Markets
Use the ## Output format exactly: story-lead for the first story, story-grid/story-card for the rest.`;

  return complete(agentSystem('01', client), user, MAX_TOK_SEC);
}

// ─── Agent 02 — Core Industry & Operations ───────────────────────────────────

export async function runAgent02(client, profile, searchResults) {
  const user = `You are running AGENT 02 (Core Industry & Operations) for ${client.client_name}.

## Monthly client profile
${profile}

## Search results for this section
${JSON.stringify(searchResults, null, 2)}

Produce ${client.stories_per_section || 3} story cards in HTML format.
Section ID: bsec-02
Section title: Core Industry & Operations
Use the ## Output format exactly: story-lead for the first story, story-grid/story-card for the rest.`;

  return complete(agentSystem('02', client), user, MAX_TOK_SEC);
}

// ─── Agent 03 — Private Equity & M&A ─────────────────────────────────────────

export async function runAgent03(client, profile, searchResults) {
  const user = `You are running AGENT 03 (Private Equity & M&A) for ${client.client_name}.

## Monthly client profile
${profile}

## Search results for this section
${JSON.stringify(searchResults, null, 2)}

Produce ${client.stories_per_section || 3} story cards in HTML format.
Section ID: bsec-03
Section title: Private Equity & M&A
Use the ## Output format exactly: story-lead for the first story, story-grid/story-card for the rest.`;

  return complete(agentSystem('03', client), user, MAX_TOK_SEC);
}

// ─── Agent 04 — End-Market Demand ────────────────────────────────────────────

export async function runAgent04(client, profile, searchResults) {
  const user = `You are running AGENT 04 (End-Market Demand) for ${client.client_name}.

## Monthly client profile
${profile}

## Search results for this section
${JSON.stringify(searchResults, null, 2)}

Produce ${client.stories_per_section || 3} story cards in HTML format.
Section ID: bsec-04
Section title: End-Market Demand
Use the ## Output format exactly: story-lead for the first story, story-grid/story-card for the rest.`;

  return complete(agentSystem('04', client), user, MAX_TOK_SEC);
}

// ─── Agent 05 — Assets, Capex & Balance Sheet ────────────────────────────────

export async function runAgent05(client, profile, searchResults) {
  const user = `You are running AGENT 05 (Assets, Capex & Balance Sheet) for ${client.client_name}.

## Monthly client profile
${profile}

## Search results for this section
${JSON.stringify(searchResults, null, 2)}

Produce ${client.stories_per_section || 3} story cards in HTML format.
Section ID: bsec-05
Section title: Assets, Capex & Balance Sheet
Use the ## Output format exactly: story-lead for the first story, story-grid/story-card for the rest.`;

  return complete(agentSystem('05', client), user, MAX_TOK_SEC);
}

// ─── Agent 06 — Local Policy & Reputation ────────────────────────────────────

export async function runAgent06(client, profile, searchResults) {
  const user = `You are running AGENT 06 (Local Policy & Reputation) for ${client.client_name}.

## Monthly client profile
${profile}

## Search results for this section
${JSON.stringify(searchResults, null, 2)}

Produce ${client.stories_per_section || 3} story cards in HTML format.
Section ID: bsec-06
Section title: Local Policy & Reputation
Use the ## Output format exactly: story-lead for the first story, story-grid/story-card for the rest.`;

  return complete(agentSystem('06', client), user, MAX_TOK_SEC);
}

// ─── Orchestrator — Key Themes + Executive Highlights ────────────────────────

export async function runOrchestrator(client, profile, sectionHtmls) {
  const system = `You are the Intelio orchestrator. You receive the HTML output of 6 section agents
and produce the Executive Summary block for the briefing — a ranked highlight list of the top 5 stories
plus 4 cross-sectional Key Themes. Follow SKILL.md Sections 8 and 9 exactly.

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

<p class="summary-prep">Compiled ${timeCET} CET \u00B7 ${today} \u00B7 Sources: [comma-separated list of main publications used across all sections]</p>
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
    <li>[Cross-sectional theme connecting 2+ sections \u2014 include ${client.client_name} relevance]</li>
    <li>[Cross-sectional theme]</li>
    <li>[Cross-sectional theme]</li>
    <li>[Cross-sectional theme]</li>
  </ol>
</div>

Rank the 5 highlights by Importance Score (highest = 01). Each must contain a quantitative data point.
Start output directly with <p class="summary-prep">.`;

  return complete(system, user);
}
