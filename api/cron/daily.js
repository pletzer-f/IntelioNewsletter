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

  // Cron fires once daily (see vercel.json). Weekly clients deliver only on their
  // chosen weekday; daily clients deliver every run. Weekday matched in Europe/Vienna.
  const slot  = viennaParts();
  const today = new Date().toISOString().split('T')[0];
  console.log(`[cron/daily] Vienna weekday ${slot.dow} (${today})`);

  // Run all due clients in PARALLEL so total time = max(individual_times) ~3 min,
  // not sum(individual_times) which could exceed the 300s function limit.
  const eligible = clients.filter(c => {
    const ok = isDeliverySlot(c, slot);
    if (!ok) console.log(`[cron/daily] Skipping ${c.client_name} (not their slot)`);
    return ok;
  });

  console.log(`[cron/daily] ${eligible.length} client(s) due this hour — running in parallel`);

  const settled = await Promise.allSettled(
    eligible.map(async (client) => {
      // Guard: never generate/send the same day's briefing twice (e.g. if the hour re-fires).
      const { data: existing } = await supabase
        .from('briefings').select('id').eq('client_id', client.id).eq('date', today).maybeSingle();
      if (existing) {
        console.log(`[cron/daily] ${client.client_name} already has a briefing for ${today} — skipping`);
        return client.id;
      }
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
 * Per-client scheduling. The cron fires once daily (see vercel.json):
 *   • daily  → delivered every run
 *   • weekly → delivered only on the client's chosen weekday (delivery_dow),
 *              matched against the current weekday in Europe/Vienna (DST-aware).
 * delivery_time is a preferred send time, but with a once-daily cron every
 * briefing goes out on that single morning run, so the hour is best-effort.
 */
function isDeliverySlot(client, slot) {
  if (client.view_mode === 'weekly') {
    const dow = Number.isInteger(client.delivery_dow) ? client.delivery_dow : 1;
    return slot.dow === dow;   // weekly: only on the chosen weekday
  }
  return true;                 // daily: every day
}

/** Current day-of-week (0=Sun..6=Sat) in Europe/Vienna, DST-aware. */
function viennaParts(date = new Date()) {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Vienna', weekday: 'short' })
    .formatToParts(date).find(p => p.type === 'weekday')?.value;
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { dow: dowMap[wd] ?? 1 };
}
