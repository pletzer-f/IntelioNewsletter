// api/admin.js — Internal admin endpoints
// Auth: admin Supabase session (Authorization: Bearer <token>, email in public.admins)
//       OR x-cron-secret/secret === CRON_SECRET (automation / back-compat).
// GET  /api/admin          → list all clients + last briefing date
// PUT  /api/admin          → update client settings
// POST /api/admin          → run full briefing pipeline for one client

import { supabase } from '../lib/supabase.js';
import { runPipelineForClient } from './agents/runner.js';
import { getUserFromRequest } from './_auth.js';

export const config = { runtime: 'nodejs' };

function bodyOf(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return {}; }
}

// True if the request is from an allowlisted admin account, or carries CRON_SECRET.
async function isAdmin(req) {
  const user = await getUserFromRequest(req);
  if (user?.email) {
    const { data } = await supabase
      .from('admins')
      .select('email')
      .ilike('email', user.email)
      .maybeSingle();
    if (data) return true;
  }
  const secret = req.query.secret || bodyOf(req).secret;
  if (secret && secret === process.env.CRON_SECRET) return true;
  return false;
}

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (!(await isAdmin(req))) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET: list all clients with last briefing ─────────────────────────────
  if (req.method === 'GET') {
    const { data: clients, error: ce } = await supabase
      .from('clients')
      .select('id, client_name, email, delivery_time, output_language, region, stories_per_section, client_profile, client_entities, client_topics, client_local_sources, active, created_at, updated_at')
      .order('updated_at', { ascending: false });

    if (ce) return res.status(500).json({ error: ce.message });

    const { data: briefings, error: be } = await supabase
      .from('briefings')
      .select('id, client_id, date, created_at')
      .order('date', { ascending: false });

    if (be) return res.status(500).json({ error: be.message });

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
    const { clientId, ...fields } = bodyOf(req);
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });

    const update = {};
    if (fields.delivery_time        !== undefined) update.delivery_time        = String(fields.delivery_time).replace(':', '');
    if (fields.output_language      !== undefined) update.output_language      = fields.output_language;
    if (fields.region               !== undefined) update.region               = fields.region;
    if (fields.stories_per_section  !== undefined) update.stories_per_section  = Number(fields.stories_per_section);
    if (fields.client_profile       !== undefined) update.client_profile       = fields.client_profile;
    if (fields.client_entities      !== undefined) update.client_entities      = fields.client_entities;
    if (fields.client_topics        !== undefined) update.client_topics        = fields.client_topics;
    if (fields.client_local_sources !== undefined) update.client_local_sources = fields.client_local_sources;
    update.updated_at = new Date().toISOString();

    const { error } = await supabase.from('clients').update(update).eq('id', clientId);
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ updated: true, clientId });
  }

  // ── POST: run full pipeline for a specific client ───────────────────────
  if (req.method === 'POST') {
    const { clientId } = bodyOf(req);
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });

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
