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

    // Verify the client exists before updating
    try {
      await getClient(id);
    } catch {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Map preferences form fields to the upsertClient shape
    // (upsertClient handles sections_enabled coercion and delivery_time formatting)
    try {
      const updated = await upsertClient({
        EMAIL:                  fields.email,
        CLIENT_NAME:            fields.client_name,
        CLIENT_CONTACT:         fields.client_contact,
        CLIENT_PROFILE:         fields.client_profile,
        CLIENT_ENTITIES:        fields.client_entities,
        REGION:                 fields.region,
        NEWS_SCOPE:             fields.news_scope,
        CLIENT_TOPICS:          fields.client_topics,
        CLIENT_LOCAL_SOURCES:   fields.client_local_sources,
        OUTPUT_LANGUAGE:        fields.output_language,
        SECTIONS_ENABLED:       fields.sections_enabled,
        VIEW_MODE:              fields.view_mode,
        DELIVERY_TIME:          fields.delivery_time,
        CLIENT_PROFILE_REFRESH: fields.client_profile_refresh,
        STORIES_PER_SECTION:    fields.stories_per_section,
        LOOKBACK_HOURS:         fields.lookback_hours,
      });
      return res.status(200).json({ success: true, client: updated });
    } catch (err) {
      console.error('[preferences] POST error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
