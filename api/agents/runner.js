// api/agents/runner.js — POST /api/agents/runner
// Executes the full 6-agent daily briefing pipeline for a single client.
// Called internally by /api/cron/daily (one invocation per active client).

import { getClient, getLatestProfile, saveProfile, saveBriefing } from '../../lib/supabase.js';
import {
  runAgent00,
  runAgent01, runAgent02, runAgent03,
  runAgent04, runAgent05, runAgent06,
  runOrchestrator,
} from '../../lib/claude.js';
import { multiSearch } from '../../lib/search.js';
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
  const client = await getClient(clientId);
  console.log(`[runner] Starting pipeline for ${client.client_name} (${clientId})`);

  // Step 0: Ensure fresh monthly profile
  let profile = await getLatestProfile(clientId);
  const profileAge = profile
    ? (Date.now() - new Date(profile.created_at).getTime()) / (1000 * 60 * 60 * 24)
    : Infinity;

  if (profileAge > 31) {
    console.log(`[runner] Refreshing Agent 00 profile (age: ${Math.round(profileAge)}d)`);
    const profileQueries = [
      `${client.client_name} ${new Date().getFullYear()}`,
      `${client.region} economic outlook`,
      ...(client.client_entities || []).slice(0, 4).map(e => `${e} news`),
    ];
    const profileSearch = await multiSearch(profileQueries, { count: 10, freshness: 'pm' });
    const profileMarkdown = await runAgent00(client, profileSearch);
    const saved = await saveProfile(clientId, profileMarkdown);
    profile = saved;
  }

  const profileText = profile?.markdown || '';

  // Step 1: Build search queries per section (from the profile + client config)
  const queries = buildSectionQueries(client, profileText);

  // Step 2: Run all section searches + market tickers in parallel
  console.log(`[runner] Running parallel search for 6 sections + market tickers`);
  const [sr01, sr02, sr03, sr04, sr05, sr06, tickers] = await Promise.all([
    multiSearch(queries.agent01, { count: 8, freshness: 'pd', country: 'DE' }),
    multiSearch(queries.agent02, { count: 8, freshness: 'pw', country: 'DE' }),
    multiSearch(queries.agent03, { count: 8, freshness: 'pw', country: 'DE' }),
    multiSearch(queries.agent04, { count: 8, freshness: 'pw', country: 'DE' }),
    multiSearch(queries.agent05, { count: 8, freshness: 'pw', country: 'DE' }),
    multiSearch(queries.agent06, { count: 8, freshness: 'pd', country: 'DE' }),
    fetchMarketTickers(),
  ]);
  console.log(`[runner] Market tickers fetched: ${tickers.length} instruments`);

  // Step 3: Run all 6 section agents in parallel
  // Token budget: ~1,400 tokens/agent × 6 = ~8,400 < 10K TPM (Tier 1 safe)
  console.log(`[runner] Running 6 section agents in parallel`);
  // Defensive: DB may contain [null,null,...] from old signups that sent slug strings.
  // Filter to clean positive integers and fall back to all 6 sections if empty.
  const rawEnabled = (client.sections_enabled || []).map(Number).filter(n => n > 0 && !isNaN(n));
  const enabledSections = new Set(rawEnabled.length > 0 ? rawEnabled : [1, 2, 3, 4, 5, 6]);

  // 2,000 chars ≈ 500 tokens — gives agents solid client context within budget
  const profileExcerpt = profileText.slice(0, 2000);

  const [h01, h02, h03, h04, h05, h06] = await Promise.all([
    enabledSections.has(1) ? runAgent01(client, profileExcerpt, sr01) : Promise.resolve(''),
    enabledSections.has(2) ? runAgent02(client, profileExcerpt, sr02) : Promise.resolve(''),
    enabledSections.has(3) ? runAgent03(client, profileExcerpt, sr03) : Promise.resolve(''),
    enabledSections.has(4) ? runAgent04(client, profileExcerpt, sr04) : Promise.resolve(''),
    enabledSections.has(5) ? runAgent05(client, profileExcerpt, sr05) : Promise.resolve(''),
    enabledSections.has(6) ? runAgent06(client, profileExcerpt, sr06) : Promise.resolve(''),
  ]);

  const sectionHtmls = [h01, h02, h03, h04, h05, h06].filter(Boolean);

  // Step 4: Orchestrator — executive highlights + key themes
  console.log(`[runner] Running orchestrator`);
  const orchestratorHtml = await runOrchestrator(client, profileText, sectionHtmls);

  // Step 5: Assemble full briefing HTML
  const today = new Date().toISOString().split('T')[0];
  const briefingHtml = assembleBriefing({
    client,
    today,
    orchestratorHtml,
    sectionHtmls: { h01, h02, h03, h04, h05, h06 },
    enabledSections,
    tickers,
  });

  // Step 6: Save to Supabase
  const briefing = await saveBriefing(clientId, briefingHtml, today);
  console.log(`[runner] Briefing saved: ${briefing.id}`);

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

  await sendBriefingEmail(client.email, client.client_name, dateLabel, orchestratorHtml, briefing.id, activeSectionNames);
  console.log(`[runner] Email delivered to ${client.email}`);

  return briefing;
}
