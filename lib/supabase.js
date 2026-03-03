// lib/supabase.js — Supabase client (service-role for server-side use only)
import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ─── Clients ────────────────────────────────────────────────────────────────

export async function getClient(clientId) {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();
  if (error) throw error;
  return data;
}

export async function getAllActiveClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('active', true);
  if (error) throw error;
  return data;
}

export async function upsertClient(config) {
  // sections_enabled: form sends strings ["1","2","3"] but DB column is int[]
  const sectionsEnabled = (config.SECTIONS_ENABLED || [1,2,3,4,5,6]).map(Number);

  // delivery_time: <input type="time"> returns "07:00" but DB stores "0700" (no colon)
  const deliveryTime = (config.DELIVERY_TIME || '0700').replace(':', '');

  const { data, error } = await supabase
    .from('clients')
    .upsert({
      email:                   config.EMAIL,
      client_name:             config.CLIENT_NAME,
      client_contact:          config.CLIENT_CONTACT,
      client_profile:          config.CLIENT_PROFILE,
      client_entities:         config.CLIENT_ENTITIES,
      region:                  config.REGION,
      news_scope:              config.NEWS_SCOPE,
      client_topics:           config.CLIENT_TOPICS,
      client_local_sources:    config.CLIENT_LOCAL_SOURCES,
      output_language:         config.OUTPUT_LANGUAGE,
      sections_enabled:        sectionsEnabled,
      view_mode:               config.VIEW_MODE,
      delivery_time:           deliveryTime,
      client_profile_refresh:  config.CLIENT_PROFILE_REFRESH,
      stories_per_section:     config.STORIES_PER_SECTION,
      lookback_hours:          config.LOOKBACK_HOURS,
      active:                  true,
      updated_at:              new Date().toISOString(),
    }, { onConflict: 'email' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Client profiles ────────────────────────────────────────────────────────

export async function getLatestProfile(clientId) {
  const { data, error } = await supabase
    .from('client_profiles')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error; // PGRST116 = no rows
  return data || null;
}

export async function saveProfile(clientId, markdown) {
  const { data, error } = await supabase
    .from('client_profiles')
    .insert({ client_id: clientId, markdown, created_at: new Date().toISOString() })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ─── Briefings ───────────────────────────────────────────────────────────────

export async function saveBriefing(clientId, html, date) {
  const { data, error } = await supabase
    .from('briefings')
    .upsert(
      {
        client_id:  clientId,
        html,
        date,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,date' }   // overwrite today's briefing on re-run
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getLatestBriefing(clientId) {
  const { data, error } = await supabase
    .from('briefings')
    .select('*')
    .eq('client_id', clientId)
    .order('date', { ascending: false })
    .limit(1)
    .single();
  if (error) throw error;
  return data;
}
