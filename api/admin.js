// api/admin.js — Internal admin endpoints
// Auth: admin Supabase session (Authorization: Bearer <token>, email in public.admins)
//       OR secret === CRON_SECRET (automation / back-compat).
// GET  → clients + global settings + admins
// PUT  → update one client's settings
// POST → action dispatch: push | toggle_active | create_client | delete_client
//                          | set_settings | add_admin | remove_admin

import { supabase } from '../lib/supabase.js';
import { runPipelineForClient } from './agents/runner.js';
import { getUserFromRequest } from './_auth.js';
import { PRICE_PER_INPUT_TOKEN, PRICE_PER_OUTPUT_TOKEN } from '../lib/claude.js';

export const config = { runtime: 'nodejs' };

function bodyOf(req) {
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); }
  catch { return {}; }
}

async function isAdmin(req) {
  const user = await getUserFromRequest(req);
  if (user?.email) {
    const { data } = await supabase.from('admins').select('email').ilike('email', user.email).maybeSingle();
    if (data) return true;
  }
  const secret = req.query.secret || bodyOf(req).secret;
  if (secret && secret === process.env.CRON_SECRET) return true;
  return false;
}

const SLUG_TO_NUM = { macro: 1, industry: 2, pe: 3, demand: 4, assets: 5, local: 6, politics: 7 };
function normSections(arr) {
  const r = (arr || []).map(v => { const n = Number(v); if (!isNaN(n) && n > 0) return n; return SLUG_TO_NUM[v] ?? null; }).filter(n => n !== null);
  return r.length ? r : [1, 2, 3, 4, 5, 6, 7];
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }

  if (!(await isAdmin(req))) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET: clients + settings + admins ────────────────────────────────────
  if (req.method === 'GET') {
    const { data: clients, error: ce } = await supabase
      .from('clients')
      .select('id, client_name, email, delivery_time, delivery_dow, output_language, region, news_scope, view_mode, stories_per_section, client_profile, client_entities, client_topics, client_local_sources, sections_enabled, active, created_at, updated_at')
      .order('updated_at', { ascending: false });
    if (ce) return res.status(500).json({ error: ce.message });

    const { data: briefings, error: be } = await supabase
      .from('briefings').select('id, client_id, date, created_at, input_tokens, output_tokens').order('date', { ascending: false });
    if (be) return res.status(500).json({ error: be.message });

    const latest = {};
    for (const b of (briefings || [])) if (!latest[b.client_id]) latest[b.client_id] = b;

    // ── Cost overview: aggregate real token usage → USD at current model pricing ──
    const perClientCost = {};   // clientId → { cost, count }
    let totalIn = 0, totalOut = 0, costedCount = 0;
    for (const b of (briefings || [])) {
      if (b.input_tokens == null && b.output_tokens == null) continue;  // older briefings have no usage
      const inT  = b.input_tokens  || 0;
      const outT = b.output_tokens || 0;
      const cost = inT * PRICE_PER_INPUT_TOKEN + outT * PRICE_PER_OUTPUT_TOKEN;
      totalIn += inT; totalOut += outT; costedCount += 1;
      const pc = perClientCost[b.client_id] || (perClientCost[b.client_id] = { cost: 0, count: 0 });
      pc.cost += cost; pc.count += 1;
    }
    const totalCost = totalIn * PRICE_PER_INPUT_TOKEN + totalOut * PRICE_PER_OUTPUT_TOKEN;
    const costs = {
      currency:            'USD',
      model:               'claude-sonnet-4-6',
      input_per_million:   PRICE_PER_INPUT_TOKEN  * 1_000_000,
      output_per_million:  PRICE_PER_OUTPUT_TOKEN * 1_000_000,
      total_briefings:     (briefings || []).length,
      costed_briefings:    costedCount,
      total_input_tokens:  totalIn,
      total_output_tokens: totalOut,
      total_cost:          totalCost,
      avg_cost:            costedCount ? totalCost / costedCount : null,
      avg_input_tokens:    costedCount ? Math.round(totalIn  / costedCount) : null,
      avg_output_tokens:   costedCount ? Math.round(totalOut / costedCount) : null,
    };

    const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
    const result = (clients || []).map(c => {
      const pc = perClientCost[c.id];
      return {
        ...c,
        last_briefing:    latest[c.id]?.date || null,
        last_briefing_id: latest[c.id]?.id   || null,
        briefing_url:     latest[c.id]?.id ? `${appUrl}/api/briefings/${latest[c.id].id}` : null,
        avg_cost:         pc && pc.count ? pc.cost / pc.count : null,
        briefing_count:   pc ? pc.count : 0,
      };
    });

    const { data: settings } = await supabase.from('app_settings').select('daily_enabled, monthly_enabled').eq('id', 1).maybeSingle();
    const { data: admins }   = await supabase.from('admins').select('email').order('email');

    return res.status(200).json({
      clients:  result,
      settings: settings || { daily_enabled: true, monthly_enabled: true },
      admins:   (admins || []).map(a => a.email),
      costs,
    });
  }

  // ── PUT: update one client's settings ────────────────────────────────────
  if (req.method === 'PUT') {
    const { clientId, ...f } = bodyOf(req);
    if (!clientId) return res.status(400).json({ error: 'Missing clientId' });
    const u = {};
    if (f.delivery_time        !== undefined) u.delivery_time        = String(f.delivery_time).replace(':', '');
    if (f.view_mode            !== undefined) u.view_mode            = (f.view_mode === 'weekly') ? 'weekly' : 'daily';
    if (f.delivery_dow         !== undefined) { const d = Number(f.delivery_dow); if (Number.isInteger(d) && d >= 0 && d <= 6) u.delivery_dow = d; }
    if (f.output_language      !== undefined) u.output_language      = f.output_language;
    if (f.region               !== undefined) u.region               = f.region;
    if (f.stories_per_section  !== undefined) u.stories_per_section  = Number(f.stories_per_section);
    if (f.client_profile       !== undefined) u.client_profile       = f.client_profile;
    if (f.client_entities      !== undefined) u.client_entities      = f.client_entities;
    if (f.client_topics        !== undefined) u.client_topics        = f.client_topics;
    if (f.client_local_sources !== undefined) u.client_local_sources = f.client_local_sources;
    u.updated_at = new Date().toISOString();
    const { error } = await supabase.from('clients').update(u).eq('id', clientId);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ updated: true, clientId });
  }

  // ── POST: action dispatch ────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = bodyOf(req);
    const action = body.action || (body.clientId ? 'push' : null);

    if (action === 'push') {
      if (!body.clientId) return res.status(400).json({ error: 'Missing clientId' });
      try {
        const briefing = await runPipelineForClient(body.clientId);
        return res.status(200).json({ success: true, briefingId: briefing.id, emailError: briefing.emailError || null });
      } catch (err) {
        console.error('[admin] Pipeline error:', err);
        return res.status(500).json({ error: err.message || 'Pipeline failed' });
      }
    }

    if (action === 'toggle_active') {
      if (!body.clientId) return res.status(400).json({ error: 'Missing clientId' });
      const { error } = await supabase.from('clients').update({ active: !!body.active, updated_at: new Date().toISOString() }).eq('id', body.clientId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ updated: true });
    }

    if (action === 'create_client') {
      if (!body.email || !body.client_name) return res.status(400).json({ error: 'Email and company name are required.' });
      const row = {
        email:                  String(body.email).trim().toLowerCase(),
        client_name:            body.client_name,
        client_contact:         body.client_contact || null,
        client_profile:         body.client_profile || null,
        region:                 body.region || 'DACH',
        news_scope:             body.news_scope || 'both',
        output_language:        body.output_language || 'en',
        view_mode:              body.view_mode === 'weekly' ? 'weekly' : 'daily',
        delivery_time:          String(body.delivery_time || '0700').replace(':', ''),
        delivery_dow:           (() => { const d = Number(body.delivery_dow); return (Number.isInteger(d) && d >= 0 && d <= 6) ? d : 1; })(),
        client_profile_refresh: body.client_profile_refresh || 'monthly',
        stories_per_section:    Number(body.stories_per_section) || 3,
        sections_enabled:       normSections(body.sections_enabled),
        client_entities:        body.client_entities || [],
        client_topics:          body.client_topics || [],
        client_local_sources:   body.client_local_sources || null,
        active:                 true,
      };
      const { data, error } = await supabase.from('clients').upsert(row, { onConflict: 'email' }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ created: true, clientId: data.id });
    }

    if (action === 'delete_client') {
      if (!body.clientId) return res.status(400).json({ error: 'Missing clientId' });
      const { error } = await supabase.from('clients').delete().eq('id', body.clientId);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ deleted: true });
    }

    if (action === 'set_settings') {
      const u = { updated_at: new Date().toISOString() };
      if (body.daily_enabled   !== undefined) u.daily_enabled   = !!body.daily_enabled;
      if (body.monthly_enabled !== undefined) u.monthly_enabled = !!body.monthly_enabled;
      const { error } = await supabase.from('app_settings').update(u).eq('id', 1);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ updated: true });
    }

    if (action === 'add_admin') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'Missing email' });
      const { error } = await supabase.from('admins').upsert({ email }, { onConflict: 'email' });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ added: true });
    }

    if (action === 'remove_admin') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'Missing email' });
      const { error } = await supabase.from('admins').delete().eq('email', email);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ removed: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
