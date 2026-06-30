// api/agents/runner.js — POST /api/agents/runner
// Executes the full 6-agent daily briefing pipeline for a single client.
// Called internally by /api/cron/daily (one invocation per active client).

import { getClient, getLatestProfile, saveProfile, saveBriefing } from '../../lib/supabase.js';
import {
  runAgent00,
  runAgent01, runAgent02, runAgent03,
  runAgent04, runAgent05, runAgent06, runAgent07,
  runOrchestrator, runVerifier, computeCost,
} from '../../lib/claude.js';
import { multiSearch } from '../../lib/search.js';
import { enrichWithText } from '../../lib/fetch-article.js';
import { fetchMacroData, formatDataSheet } from '../../lib/macro-data.js';
import { sendBriefingEmail } from '../../lib/email.js';
import { fetchMarketTickers } from '../../lib/market.js';
import { buildSectionQueries } from './queries.js';
import { assembleBriefing } from './orchestrator.js';

export const config = { runtime: 'nodejs' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
  // Verify internal call (cron or admin only)
  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { clientId } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (!clientId) return res.status(400).json({ error: 'Missing clientId' });

  try {
    const briefing = await runPipelineForClient(clientId);
    return res.status(200).json({ status: 'complete', briefingId: briefing.id });
  } catch (err) {
    console.error(`[runner] Fatal error for client ${clientId}:`, err);
    return res.status(500).json({ error: err.message });
  }
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

export async function runPipelineForClient(clientId) {
  let client;
  try {
    client = await getClient(clientId);
  } catch (err) {
    throw new Error(`[Step 0/getClient] ${err.message}`);
  }
  console.log(`[runner] Starting pipeline for ${client.client_name} (${clientId})`);

  // Token accumulator — every Claude call in this pipeline adds to it, so we can
  // persist the real input/output token counts and compute cost in the admin console.
  const usage = { input: 0, output: 0, opusInput: 0, opusOutput: 0, haikuInput: 0, haikuOutput: 0 };

  // Step 0: Ensure fresh monthly profile
  let profile;
  try {
    profile = await getLatestProfile(clientId);
  } catch (err) {
    throw new Error(`[Step 0/getProfile] ${err.message}`);
  }
  const profileAge = profile
    ? (Date.now() - new Date(profile.created_at).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity;

  // Honor the client's chosen refresh cadence.
  // 'on-demand' never auto-refreshes (manual trigger only); a profile is still
  // generated on first run when none exists (profileAge === Infinity).
  const cadence = client.client_profile_refresh || 'monthly';
  const refreshThresholdDays =
    cadence === 'weekly'    ? 7   :
    cadence === 'on-demand' ? Infinity :
    /* monthly default */     31;

  if (profileAge > refreshThresholdDays) {
    console.log(`[runner] Refreshing Agent 00 profile (age: ${Math.round(profileAge)}d, cadence: ${cadence})`);
    const profileQueries = [
      `${client.client_name} ${new Date().getFullYear()}`,
      `${client.region} economic outlook`,
      ...(client.client_entities || []).slice(0, 4).map(e => `${e} news`),
    ];
    try {
      const profileSearch = await multiSearch(profileQueries, { count: 10, freshness: 'pm' });
      const profileMarkdown = await runAgent00(client, profileSearch, usage);
      const saved = await saveProfile(clientId, profileMarkdown);
      profile = saved;
    } catch (err) {
      throw new Error(`[Step 0/agent00] ${err.message}`);
    }
  }

  const profileText = profile?.markdown || '';

  // Step 1: Build search queries per section (from the profile + client config)
  const queries = buildSectionQueries(client, profileText);

  // Step 2: Run all section searches + market tickers in parallel
  console.log(`[runner] Running parallel search + market + macro ground-truth`);
  let sr01, sr02, sr03, sr04, sr05, sr06, sr07, tickers, macro;
  try {
    [sr01, sr02, sr03, sr04, sr05, sr06, sr07, tickers, macro] = await Promise.all([
      multiSearch(queries.agent01, { count: 10, freshness: 'pd', country: 'DE' }),
      multiSearch(queries.agent02, { count: 8, freshness: 'pw', country: 'DE' }),
      multiSearch(queries.agent03, { count: 8, freshness: 'pw', country: 'DE' }),
      multiSearch(queries.agent04, { count: 8, freshness: 'pw', country: 'DE' }),
      multiSearch(queries.agent05, { count: 8, freshness: 'pw', country: 'DE' }),
      multiSearch(queries.agent06, { count: 8, freshness: 'pd', country: 'DE' }),
      multiSearch(queries.agent07, { count: 8, freshness: 'pw', country: 'DE' }),
      fetchMarketTickers(),
      fetchMacroData(),   // authoritative ECB rates + euro-area inflation (graceful)
    ]);
  } catch (err) {
    throw new Error(`[Step 2/search] ${err.message}`);
  }
  console.log(`[runner] Tickers: ${tickers.length} · macro: ECB ${macro?.deposit?.value ?? 'n/a'}% / HICP ${macro?.hicp?.value ?? 'n/a'}%`);

  // Verified ground-truth figures (ECB rates, euro-area inflation, live markets) handed to agents.
  const dataSheet = formatDataSheet(macro, tickers);

  // Step 2.5: fetch full article text for the top sources per section, so agents reason
  // from real content rather than snippets. Best-effort — mutates results in place, never throws.
  console.log(`[runner] Fetching article text for top sources`);
  await Promise.allSettled([sr01, sr02, sr03, sr04, sr05, sr06, sr07].map(sr => enrichWithText(sr, 4)));

  // Step 3: Run all enabled section agents in parallel (up to 7)
  console.log(`[runner] Running section agents in parallel`);
  // Defensive: DB may contain [null,null,...] from old signups that sent slug strings.
  // Filter to clean positive integers and fall back to all 7 sections if empty.
  const rawEnabled = (client.sections_enabled || []).map(Number).filter(n => n > 0 && !isNaN(n));
  const enabledSections = new Set(rawEnabled.length > 0 ? rawEnabled : [1, 2, 3, 4, 5, 6, 7]);

  // 2,000 chars ≈ 500 tokens — gives agents solid client context within budget
  const profileExcerpt = profileText.slice(0, 2000);

  let h01, h02, h03, h04, h05, h06, h07;
  try {
    [h01, h02, h03, h04, h05, h06, h07] = await Promise.all([
      enabledSections.has(1) ? runAgent01(client, profileExcerpt, sr01, usage, dataSheet) : Promise.resolve(''),
      enabledSections.has(2) ? runAgent02(client, profileExcerpt, sr02, usage, dataSheet) : Promise.resolve(''),
      enabledSections.has(3) ? runAgent03(client, profileExcerpt, sr03, usage, dataSheet) : Promise.resolve(''),
      enabledSections.has(4) ? runAgent04(client, profileExcerpt, sr04, usage, dataSheet) : Promise.resolve(''),
      enabledSections.has(5) ? runAgent05(client, profileExcerpt, sr05, usage, dataSheet) : Promise.resolve(''),
      enabledSections.has(6) ? runAgent06(client, profileExcerpt, sr06, usage, dataSheet) : Promise.resolve(''),
      enabledSections.has(7) ? runAgent07(client, profileExcerpt, sr07, usage, dataSheet) : Promise.resolve(''),
    ]);
  } catch (err) {
    throw new Error(`[Step 3/agents] ${err.message}`);
  }

  // Step 3.5: verification pass — fact-check each section against its own sources + the verified
  // data sheet, stripping unsupported figures and fabricated URLs. Macro uses Opus + reasoning
  // (most figure-critical); the rest use Sonnet. Best-effort: a failure keeps the original section.
  console.log(`[runner] Verifying every section against its sources (Haiku)`);
  const vOpts = { model: 'claude-haiku-4-5' };   // fast, cheap, mechanical fact-check — runs on all sections
  try {
    [h01, h02, h03, h04, h05, h06, h07] = await Promise.all([
      runVerifier(client, 'Macro & Markets',           h01, sr01, dataSheet, usage, vOpts),
      runVerifier(client, 'Core Industry',             h02, sr02, dataSheet, usage, vOpts),
      runVerifier(client, 'Private Equity & M&A',      h03, sr03, dataSheet, usage, vOpts),
      runVerifier(client, 'End-Market Demand',         h04, sr04, dataSheet, usage, vOpts),
      runVerifier(client, 'Assets & Capex',            h05, sr05, dataSheet, usage, vOpts),
      runVerifier(client, 'Local Policy & Reputation', h06, sr06, dataSheet, usage, vOpts),
      runVerifier(client, 'Politics & Geopolitics',    h07, sr07, dataSheet, usage, vOpts),
    ]);
  } catch (err) {
    console.warn(`[runner] Verification pass error (non-fatal, keeping drafts): ${err.message}`);
  }

  const sectionHtmls = [h01, h02, h03, h04, h05, h06, h07].filter(Boolean);

  // Step 4: Orchestrator — executive highlights + key themes
  console.log(`[runner] Running orchestrator`);
  let orchestratorHtml;
  try {
    orchestratorHtml = await runOrchestrator(client, profileText, sectionHtmls, usage);
  } catch (err) {
    throw new Error(`[Step 4/orchestrator] ${err.message}`);
  }

  // Step 5: Assemble full briefing HTML
  const today = new Date().toISOString().split('T')[0];
  let briefingHtml;
  try {
    briefingHtml = assembleBriefing({
      client,
      today,
      orchestratorHtml,
      sectionHtmls: { h01, h02, h03, h04, h05, h06, h07 },
      enabledSections,
      tickers,
    });
  } catch (err) {
    throw new Error(`[Step 5/assemble] ${err.message}`);
  }

  // Step 6: Save to Supabase (store total tokens across model tiers + the real USD cost)
  const totalIn  = (usage.input  || 0) + (usage.opusInput  || 0) + (usage.haikuInput  || 0);
  const totalOut = (usage.output || 0) + (usage.opusOutput || 0) + (usage.haikuOutput || 0);
  const costUsd  = computeCost(usage);
  let briefing;
  try {
    briefing = await saveBriefing(clientId, briefingHtml, today, totalIn, totalOut, costUsd);
  } catch (err) {
    throw new Error(`[Step 6/save] ${err.message}`);
  }
  console.log(`[runner] Briefing saved: ${briefing.id} ($${costUsd.toFixed(4)} · in ${totalIn} / out ${totalOut} · haiku-verify ${usage.haikuInput || 0}/${usage.haikuOutput || 0})`);

  // Step 7: Send email — pass orchestratorHtml (executive summary) + section names
  // We do NOT send the full briefingHtml; the email contains the summary + a CTA link.
  const dateLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const activeSectionNames = ['Executive Summary'];
  if (enabledSections.has(1) && h01?.trim()) activeSectionNames.push('Macro & Markets');
  if (enabledSections.has(2) && h02?.trim()) activeSectionNames.push('Core Industry');
  if (enabledSections.has(3) && h03?.trim()) activeSectionNames.push('PE & M\u0026A');
  if (enabledSections.has(4) && h04?.trim()) activeSectionNames.push('End-Market Demand');
  if (enabledSections.has(5) && h05?.trim()) activeSectionNames.push('Assets & Capex');
  if (enabledSections.has(6) && h06?.trim()) activeSectionNames.push('Local Policy & Reputation');
  if (enabledSections.has(7) && h07?.trim()) activeSectionNames.push('Politics & Geopolitics');

  let emailError = null;
  try {
    await sendBriefingEmail(client.email, client.client_name, dateLabel, orchestratorHtml, briefing.id, activeSectionNames);
    console.log(`[runner] Email delivered to ${client.email}`);
  } catch (emailErr) {
    emailError = emailErr.message;
    console.error(`[runner] EMAIL FAILED for ${client.email}:`, emailErr.message);
    console.error(`[runner] Email error detail:`, JSON.stringify(emailErr));
  }

  return { ...briefing, emailError };
}
