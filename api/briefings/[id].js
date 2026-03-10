// api/briefings/[id].js — GET /api/briefings/:id
// Serves a stored briefing by its Supabase row ID as a full HTML page.

import { supabase } from '../../lib/supabase.js';

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id) {
    return res.status(400).send('Missing briefing ID');
  }

  const { data, error } = await supabase
    .from('briefings')
    .select('html, date, client_id')
    .eq('id', id)
    .single();

  if (error || !data) {
    return res.status(404).send('Briefing not found');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store'); // always serve fresh — same ID is re-used on same-day re-push
  return res.status(200).send(data.html);
}
