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

  // Cron now fires HOURLY (see vercel.json). Deliver each client only on their
  // scheduled slot — matched on day-of-week + hour in Europe/Vienna (CET/CEST).
  const slot  = viennaParts();
  const today = new Date().toISOString().split('T')[0];
  console.log(`[cron/daily] Vienna slot — day ${slot.dow}, hour ${String(slot.hour).padStart(2, '0')}:00`);

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
 * Per-client scheduling. Cron fires HOURLY (see vercel.json), so we match each
 * client's delivery hour (and, for weekly, day-of-week) against the current
 * wall-clock in Europe/Vienna:
 *   • daily  → delivered every day at delivery_time's hour
 *   • weekly → delivered only on delivery_dow at delivery_time's hour
 * delivery_time is stored "HHMM" (CET/CEST); we match on the hour (minutes ignored).
 */
function isDeliverySlot(client, slot) {
  const hh = parseInt(String(client.delivery_time || '0700').slice(0, 2), 10);
  if (slot.hour !== (Number.isInteger(hh) ? hh : 7)) return false;
  if (client.view_mode === 'weekly') {
    const dow = Number.isInteger(client.delivery_dow) ? client.delivery_dow : 1;
    return slot.dow === dow;
  }
  return true; // daily — every day at the chosen hour
}

/** Current day-of-week (0=Sun..6=Sat) and hour (0-23) in Europe/Vienna, DST-aware. */
function viennaParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Vienna', hour12: false, weekday: 'short', hour: '2-digit',
    }).formatToParts(date).map(p => [p.type, p.value])
  );
  const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;   // en-US hour12:false reports midnight as '24'
  return { dow: dowMap[parts.weekday] ?? 1, hour };
}
