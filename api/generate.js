// api/generate.js — POST /api/generate
// On-demand briefing generation for the logged-in user.
// Auth: Supabase bearer token (Authorization: Bearer <access_token>).
// Limit: one manual run per calendar day (gated by clients.last_manual_run_at).

import { supabase } from '../lib/supabase.js';
import { getUserFromRequest } from './_auth.js';
import { runPipelineForClient } from './agents/runner.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  // Find this user's briefing config.
  const { data: client, error: ce } = await supabase
    .from('clients')
    .select('id, last_manual_run_at, active')
    .eq('user_id', user.id)
    .maybeSingle();

  if (ce) return res.status(500).json({ error: ce.message });
  if (!client) return res.status(404).json({ error: 'No briefing profile found for this account.' });

  // Enforce one manual run per calendar day (UTC).
  const now = new Date();
  const last = client.last_manual_run_at ? new Date(client.last_manual_run_at) : null;
  if (last && last.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) {
    return res.status(429).json({
      error: 'You have already generated a briefing today. Your next on-demand run is available tomorrow.',
      nextAvailable: 'tomorrow',
    });
  }

  // Claim the daily slot up-front so concurrent clicks cannot double-trigger.
  const prev = client.last_manual_run_at;
  await supabase.from('clients').update({ last_manual_run_at: now.toISOString() }).eq('id', client.id);

  try {
    const briefing = await runPipelineForClient(client.id);
    return res.status(200).json({ status: 'complete', briefingId: briefing.id });
  } catch (err) {
    // Roll back the slot so the user can retry after a failure.
    await supabase.from('clients').update({ last_manual_run_at: prev }).eq('id', client.id);
    console.error(`[generate] Pipeline failed for client ${client.id}:`, err);
    return res.status(500).json({ error: err.message });
  }
}
