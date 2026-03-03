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

// Section 9.2–9.3: Story card + source transparency format (~300 tokens)
const CARD_FORMAT = SKILL_MD.slice(
  SKILL_MD.indexOf('### 9.2 Story card format'),
  SKILL_MD.indexOf('## 10. QUALITY GATES')
).trim();

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

Produce ONLY valid HTML cards. No markdown fences. No preamble. Start directly with the first <div class="card">.
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
Follow the card format from SKILL.md Section 9 exactly.`;

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
Follow the card format from SKILL.md Section 9 exactly.`;

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
Follow the card format from SKILL.md Section 9 exactly.`;

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
Follow the card format from SKILL.md Section 9 exactly.`;

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
Follow the card format from SKILL.md Section 9 exactly.`;

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
Follow the card format from SKILL.md Section 9 exactly.`;

  return complete(agentSystem('06', client), user, MAX_TOK_SEC);
}

// ─── Orchestrator — Key Themes + Executive Highlights ────────────────────────

export async function runOrchestrator(client, profile, sectionHtmls) {
  const system = `You are the Intelio orchestrator. You receive the HTML output of 6 section agents
and produce: (1) an Executive Highlights block ranking the top 5 stories, and (2) 4-5 Key Themes
that cross section boundaries. Follow SKILL.md Sections 8 and 9 exactly.

${SKILL_MD}`;

  const user = `Orchestrate the final briefing for ${client.client_name}.

## Section outputs
${sectionHtmls.map((h, i) => `### Agent 0${i + 1}\n${h}`).join('\n\n')}

## Monthly profile excerpt (for priority ranking)
${profile.slice(0, 2000)}

Produce:
1. An <div id="exec-highlights"> block with the top 5 stories ranked by Importance Score.
2. A <div id="key-themes"> block with 4-5 cross-sectional Key Themes.

Start your output directly with the HTML, no fences.`;

  return complete(system, user);
}
