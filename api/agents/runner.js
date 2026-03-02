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
import { buildSectionQueries } from './queries.js';
import { assembleBriefing } from './orchestrator.js';

export const config = { runtime: 'nodejs' };

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

  // Acknowledge immediately — processing happens async within the 300s window
  res.status(202).json({ status: 'accepted', clientId });

  try {
    await runPipelineForClient(clientId);
  } catch (err) {
    console.error(`[runner] Fatal error for client ${clientId}:`, err);
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

  // Step 2: Run all section searches in parallel
  console.log(`[runner] Running parallel search for 6 sections`);
  const [sr01, sr02, sr03, sr04, sr05, sr06] = await Promise.all([
    multiSearch(queries.agent01, { count: 10, freshness: 'pd', country: 'DE' }),
    multiSearch(queries.agent02, { count: 10, freshness: 'pw', country: 'DE' }),
    multiSearch(queries.agent03, { count: 10, freshness: 'pw', country: 'DE' }),
    multiSearch(queries.agent04, { count: 10, freshness: 'pw', country: 'DE' }),
    multiSearch(queries.agent05, { count: 10, freshness: 'pw', country: 'DE' }),
    multiSearch(queries.agent06, { count: 10, freshness: 'pd', country: 'DE' }),
  ]);

  // Step 3: Run all 6 section agents in parallel
  console.log(`[runner] Running 6 section agents in parallel`);
  const enabledSections = new Set(client.sections_enabled || [1,2,3,4,5,6]);

  const [h01, h02, h03, h04, h05, h06] = await Promise.all([
    enabledSections.has(1) ? runAgent01(client, profileText, sr01) : Promise.resolve(''),
    enabledSections.has(2) ? runAgent02(client, profileText, sr02) : Promise.resolve(''),
    enabledSections.has(3) ? runAgent03(client, profileText, sr03) : Promise.resolve(''),
    enabledSections.has(4) ? runAgent04(client, profileText, sr04) : Promise.resolve(''),
    enabledSections.has(5) ? runAgent05(client, profileText, sr05) : Promise.resolve(''),
    enabledSections.has(6) ? runAgent06(client, profileText, sr06) : Promise.resolve(''),
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
  });

  // Step 6: Save to Supabase
  const briefing = await saveBriefing(clientId, briefingHtml, today);
  console.log(`[runner] Briefing saved: ${briefing.id}`);

  // Step 7: Send email
  const dateLabel = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  await sendBriefingEmail(client.email, client.client_name, dateLabel, briefingHtml, briefing.id);
  console.log(`[runner] Email delivered to ${client.email}`);

  return briefing;
}
