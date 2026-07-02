// api/preferences.js — GET + POST /api/preferences
// Allows clients to load and update their briefing preferences.
// Auth: client UUID in query/body — same low-friction pattern as the briefing viewer.

import { getClient, upsertClient } from '../lib/supabase.js';

export const config = { runtime: 'nodejs' };

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  // ── GET — load current preferences ────────────────────────────────────────
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    try {
      const client = await getClient(id);
      return res.status(200).json({ client });
    } catch (err) {
      console.error('[preferences] GET error:', err.message);
      return res.status(404).json({ error: 'Client not found' });
    }
  }

  // ── POST — save updated preferences ───────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const { id, ...fields } = body;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    // Load the existing row — both to verify the client exists and to merge:
    // upsertClient writes a FULL row (missing fields fall to defaults), so any
    // field the form didn't send must be backfilled from the current record.
    let existing;
    try {
      existing = await getClient(id);
    } catch {
      return res.status(404).json({ error: 'Client not found' });
    }

    const pick = (sent, current) => (sent !== undefined ? sent : current);

    try {
      const updated = await upsertClient({
        // Email is the upsert key. It is NEVER taken from the request:
        // changing it here would create a second client row (upsert on email)
        // and let anyone with a UUID re-point the record. Account email
        // changes go through Supabase Auth / the admin console.
        EMAIL:                  existing.email,
        CLIENT_NAME:            pick(fields.client_name,            existing.client_name),
        CLIENT_CONTACT:         pick(fields.client_contact,         existing.client_contact),
        CLIENT_PROFILE:         pick(fields.client_profile,         existing.client_profile),
        CLIENT_ENTITIES:        pick(fields.client_entities,        existing.client_entities),
        REGION:                 pick(fields.region,                 existing.region),
        NEWS_SCOPE:             pick(fields.news_scope,             existing.news_scope),
        CLIENT_TOPICS:          pick(fields.client_topics,          existing.client_topics),
        CLIENT_LOCAL_SOURCES:   pick(fields.client_local_sources,   existing.client_local_sources),
        OUTPUT_LANGUAGE:        pick(fields.output_language,        existing.output_language),
        SECTIONS_ENABLED:       pick(fields.sections_enabled,       existing.sections_enabled),
        VIEW_MODE:              pick(fields.view_mode,              existing.view_mode),
        DELIVERY_TIME:          pick(fields.delivery_time,          existing.delivery_time),
        DELIVERY_DOW:           pick(fields.delivery_dow,           existing.delivery_dow),
        CLIENT_PROFILE_REFRESH: pick(fields.client_profile_refresh, existing.client_profile_refresh),
        STORIES_PER_SECTION:    pick(fields.stories_per_section,    existing.stories_per_section),
        LOOKBACK_HOURS:         pick(fields.lookback_hours,         existing.lookback_hours),
        ACTIVE:                 existing.active,
      });
      return res.status(200).json({ success: true, client: updated });
    } catch (err) {
      console.error('[preferences] POST error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
