// api/admin.js — Internal admin endpoints
// GET  /api/admin?secret=XXX          → list all clients + last briefing date
// POST /api/admin { secret, clientId } → fire-and-forget runner for one client

import { supabase } from '../lib/supabase.js';

export const config = { runtime: 'nodejs' };

function checkSecret(secret) {
  return secret && secret === process.env.CRON_SECRET;
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // ── GET: list all clients with last briefing ─────────────────────────────
  if (req.method === 'GET') {
    const secret = req.query.secret;
    if (!checkSecret(secret)) return res.status(401).json({ error: 'Unauthorized' });

    const { data: clients, error: ce } = await supabase
      .from('clients')
      .select('id, client_name, email, delivery_time, active, created_at')
      .order('created_at', { ascending: false });

    if (ce) return res.status(500).json({ error: ce.message });

    // Fetch latest briefing date for each client
    const { data: briefings, error: be } = await supabase
      .from('briefings')
      .select('client_id, date, created_at')
      .order('date', { ascending: false });

    if (be) return res.status(500).json({ error: be.message });

    // Map latest briefing per client
    const latestBriefing = {};
    for (const b of (briefings || [])) {
      if (!latestBriefing[b.client_id]) latestBriefing[b.client_id] = b;
    }

    const result = (clients || []).map(c => ({
      ...c,
      last_briefing: latestBriefing[c.id]?.date || null,
    }));

    return res.status(200).json({ clients: result });
  }

  // ── POST: trigger runner for a specific client ───────────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { secret, clientId } = body || {};

    if (!checkSecret(secret)) return res.status(401).json({ error: 'Unauthorized' });
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });

    // Fire-and-forget — runner takes ~90s so we return immediately
    const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
    fetch(`${appUrl}/api/agents/runner`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET,
      },
      body: JSON.stringify({ clientId }),
    }).catch(err => console.warn('[admin] Runner fire-and-forget error:', err));

    return res.status(200).json({ queued: true, clientId });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
