// api/cron/monthly.js — GET /api/cron/monthly (Vercel Cron, 04:00 UTC on 1st of month)
// Refreshes Agent 00 monthly profile for all active clients.

import { supabase, getAllActiveClients, getLatestProfile, saveProfile } from '../../lib/supabase.js';
import { runAgent00 } from '../../lib/claude.js';
import { multiSearch } from '../../lib/search.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[cron/monthly] Starting monthly profile refresh');

  // Respect the global pause toggle (admin console).
  const { data: settings } = await supabase.from('app_settings').select('monthly_enabled').eq('id', 1).maybeSingle();
  if (settings && settings.monthly_enabled === false) {
    console.log('[cron/monthly] Monthly briefings paused via admin toggle — skipping.');
    return res.status(200).json({ skipped: true, reason: 'monthly briefings disabled' });
  }

  const clients = await getAllActiveClients();
  const results = [];

  for (const client of clients) {
    try {
      console.log(`[cron/monthly] Refreshing profile for ${client.client_name}`);

      const queries = [
        `${client.client_name} ${new Date().getFullYear()} strategy`,
        `${client.region} economic outlook ${new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' })}`,
        ...(client.client_entities || []).slice(0, 4).map(e => `${e} news`),
        ...(client.client_topics   || []).slice(0, 3).map(t => `${t} ${client.region}`),
      ];

      const searchResults = await multiSearch(queries, { count: 10, freshness: 'pm' });
      const profileMarkdown = await runAgent00(client, searchResults);
      await saveProfile(client.id, profileMarkdown);

      results.push({ clientId: client.id, status: 'refreshed' });
      console.log(`[cron/monthly] Profile refreshed for ${client.client_name}`);
    } catch (err) {
      console.error(`[cron/monthly] Error for ${client.client_name}:`, err);
      results.push({ clientId: client.id, status: 'error', error: err.message });
    }
  }

  return res.status(200).json({ refreshed: results.length, results });
}
