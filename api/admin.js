// api/admin.js — Internal admin endpoints
// GET  /api/admin?secret=XXX          → list all clients + last briefing date
// POST /api/admin { secret, clientId } → run full briefing pipeline for one client

import { supabase } from '../lib/supabase.js';
import { runPipelineForClient } from './agents/runner.js';

export const config = { runtime: 'nodejs' };

function checkSecret(secret) {
  return secret && secret === process.env.CRON_SECRET;
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // ── GET: list all clients with last briefing ─────────────────────────────
  if (req.method === 'GET') {
    const secret = req.query.secret;
    if (!checkSecret(secret)) return res.status(401).json({ error: 'Unauthorized' });

    const { data: clients, error: ce } = await supabase
      .from('clients')
      .select('id, client_name, email, delivery_time, active, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (ce) return res.status(500).json({ error: ce.message });

    // Fetch latest briefing date + id for each client
    const { data: briefings, error: be } = await supabase
      .from('briefings')
      .select('id, client_id, date, created_at')
      .order('date', { ascending: false });

    if (be) return res.status(500).json({ error: be.message });

    // Map latest briefing per client
    const latestBriefing = {};
    for (const b of (briefings || [])) {
      if (!latestBriefing[b.client_id]) latestBriefing[b.client_id] = b;
    }

    const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
    const result = (clients || []).map(c => ({
      ...c,
      last_briefing:    latestBriefing[c.id]?.date || null,
      last_briefing_id: latestBriefing[c.id]?.id   || null,
      briefing_url:     latestBriefing[c.id]?.id
        ? `${appUrl}/api/briefings/${latestBriefing[c.id].id}`
        : null,
    }));

    return res.status(200).json({ clients: result });
  }

  // ── PUT: update client settings ─────────────────────────────────────────
  if (req.method === 'PUT') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { secret, clientId, ...fields } = body || {};

    if (!checkSecret(secret)) return res.status(401).json({ error: 'Unauthorized' });
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });

    // Build update object — only include defined fields
    const update = {};
    if (fields.delivery_time       !== undefined) update.delivery_time        = String(fields.delivery_time).replace(':', '');
    if (fields.output_language     !== undefined) update.output_language      = fields.output_language;
    if (fields.region              !== undefined) update.region               = fields.region;
    if (fields.stories_per_section !== undefined) update.stories_per_section  = Number(fields.stories_per_section);
    if (fields.client_profile      !== undefined) update.client_profile       = fields.client_profile;
    if (fields.client_entities     !== undefined) update.client_entities      = fields.client_entities;
    if (fields.client_topics       !== undefined) update.client_topics        = fields.client_topics;
    if (fields.client_local_sources !== undefined) update.client_local_sources = fields.client_local_sources;
    update.updated_at = new Date().toISOString();

    const { error } = await supabase.from('clients').update(update).eq('id', clientId);
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ updated: true, clientId });
  }

  // ── POST: run full pipeline for a specific client ───────────────────────
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { secret, clientId } = body || {};

    if (!checkSecret(secret)) return res.status(401).json({ error: 'Unauthorized' });
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });

    // Run pipeline directly (imported function) — no HTTP hop.
    // Fire-and-forget via HTTP was unreliable: Vercel freezes the function
    // context after res.end(), so the outbound fetch was never sent.
    try {
      const briefing = await runPipelineForClient(clientId);
      return res.status(200).json({
        success:    true,
        briefingId: briefing.id,
        emailError: briefing.emailError || null,
      });
    } catch (err) {
      console.error('[admin] Pipeline error for', clientId, ':', err);
      return res.status(500).json({ error: err.message || 'Pipeline failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
