// api/cron/daily.js — GET /api/cron/daily (Vercel Cron, 05:00 UTC daily)
// Loops through all active clients and fires the agent runner for each.

import { getAllActiveClients } from '../../lib/supabase.js';
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

  let clients;
  try {
    clients = await getAllActiveClients();
  } catch (err) {
    console.error('[cron/daily] Failed to fetch clients:', err);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  console.log(`[cron/daily] Processing ${clients.length} active clients`);

  const results = [];

  // Run each client sequentially to stay within API rate limits.
  // For large scale (10+ clients), switch to batched concurrency.
  for (const client of clients) {
    const shouldRunToday = checkDeliveryWindow(client);
    if (!shouldRunToday) {
      console.log(`[cron/daily] Skipping ${client.client_name} (not in delivery window)`);
      continue;
    }

    try {
      console.log(`[cron/daily] Running pipeline for ${client.client_name}`);
      await runPipelineForClient(client.id);
      results.push({ clientId: client.id, status: 'success' });
    } catch (err) {
      console.error(`[cron/daily] Error for ${client.client_name}:`, err);
      results.push({ clientId: client.id, status: 'error', error: err.message });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[cron/daily] Completed in ${elapsed}s. Results:`, results);

  return res.status(200).json({
    processed: clients.length,
    elapsed:   `${elapsed}s`,
    results,
  });
}

/**
 * Check if this client's delivery_time falls within the current cron window.
 * Cron fires at 05:00 UTC. Client may have set a local delivery time.
 * For now, all active clients run daily (delivery time is handled by the email).
 * Extend this function to support weekly mode or timezone-aware delivery.
 */
function checkDeliveryWindow(client) {
  if (client.view_mode === 'weekly') {
    // Weekly clients: only run on Mondays (UTC)
    return new Date().getUTCDay() === 1;
  }
  return true; // daily — always run
}
