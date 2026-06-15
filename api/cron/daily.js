// api/cron/daily.js — GET /api/cron/daily (Vercel Cron, 05:00 UTC daily)
// Loops through all active clients and fires the agent runner for each.

import { supabase, getAllActiveClients } from '../../lib/supabase.js';
import { runPipelineForClient } from '../agents/runner.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  // Vercel Cron passes the secret in the Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startTime = Date.now();
  console.log('[cron/daily] Starting daily briefing run');

  // Respect the global pause toggle (admin console).
  const { data: settings } = await supabase.from('app_settings').select('daily_enabled').eq('id', 1).maybeSingle();
  if (settings && settings.daily_enabled === false) {
    console.log('[cron/daily] Daily briefings paused via admin toggle — skipping.');
    return res.status(200).json({ skipped: true, reason: 'daily briefings disabled' });
  }

  let clients;
  try {
    clients = await getAllActiveClients();
  } catch (err) {
    console.error('[cron/daily] Failed to fetch clients:', err);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  console.log(`[cron/daily] Processing ${clients.length} active clients`);

  // Run all eligible clients in PARALLEL so total time = max(individual_times) ~3 min,
  // not sum(individual_times) ~12 min which exceeds the 300s function limit.
  const eligible = clients.filter(c => {
    const ok = checkDeliveryWindow(c);
    if (!ok) console.log(`[cron/daily] Skipping ${c.client_name} (not in delivery window)`);
    return ok;
  });

  console.log(`[cron/daily] Running ${eligible.length} pipelines in parallel`);

  const settled = await Promise.allSettled(
    eligible.map(async (client) => {
      console.log(`[cron/daily] Starting pipeline for ${client.client_name}`);
      await runPipelineForClient(client.id);
      return client.id;
    })
  );

  const results = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? { clientId: eligible[i].id, status: 'success' }
      : { clientId: eligible[i].id, status: 'error', error: r.reason?.message }
  );

  const errors = results.filter(r => r.status === 'error');
  if (errors.length) console.error(`[cron/daily] ${errors.length} pipeline(s) failed:`, errors);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[cron/daily] Completed in ${elapsed}s. Results:`, results);

  return res.status(200).json({
    processed: clients.length,
    elapsed:   `${elapsed}s`,
    results,
  });
}

/**
 * Check whether this client should be delivered on the current cron run.
 * Cron fires once per day at 05:00 UTC (see vercel.json).
 *
 * NOTE ON delivery_time: honoring the per-client hour (06:30–09:00) requires an
 * hourly cron ("0 * * * *") so each run can match clients whose hour == current
 * hour. With the current once-daily cron we deliver all eligible clients on that
 * single run; precise send-time is part of the scheduling work in the user area.
 */
function checkDeliveryWindow(client) {
  if (client.view_mode === 'weekly') {
    // Weekly digest: deliver on Fridays (UTC) to match the signup UI promise.
    return new Date().getUTCDay() === 5;
  }
  return true; // daily — always run
}
