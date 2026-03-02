// api/register.js — POST /api/register
// Receives signup form config, saves client to Supabase, sends welcome email,
// then kicks off an immediate Agent 00 profile generation run.

import { upsertClient, saveProfile, getLatestProfile } from '../lib/supabase.js';
import { runAgent00 } from '../lib/claude.js';
import { multiSearch } from '../lib/search.js';
import { sendTransactional } from '../lib/email.js';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Basic required field validation
  const required = ['EMAIL', 'CLIENT_NAME', 'CLIENT_CONTACT'];
  for (const field of required) {
    if (!body[field]) {
      return res.status(400).json({ error: `Missing required field: ${field}` });
    }
  }

  try {
    // 1. Save / update client in Supabase
    const client = await upsertClient(body);
    console.log(`[register] Upserted client: ${client.id} (${client.email})`);

    // 2. Check if we need an Agent 00 profile (new client or stale > 31 days)
    const existingProfile = await getLatestProfile(client.id);
    const profileAge = existingProfile
      ? (Date.now() - new Date(existingProfile.created_at).getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;

    if (profileAge > 31) {
      console.log(`[register] Running Agent 00 for ${client.client_name} (profile age: ${Math.round(profileAge)} days)`);

      // Build initial search queries for Agent 00
      const entities   = (client.client_entities || []).join(' ');
      const queries = [
        `${client.client_name} ${new Date().getFullYear()}`,
        `${client.region} business outlook ${new Date().getFullYear()}`,
        ...(client.client_topics || []).slice(0, 3).map(t => `${t} ${client.region} ${new Date().getFullYear()}`),
        ...(client.client_entities || []).slice(0, 3).map(e => `${e} news ${new Date().getFullYear()}`),
      ].filter(Boolean);

      const searchResults = await multiSearch(queries, {
        count:     10,
        freshness: 'pm', // past month
        country:   'de-DE',
      });

      const profileMarkdown = await runAgent00(client, searchResults);
      await saveProfile(client.id, profileMarkdown);
      console.log(`[register] Agent 00 profile saved for ${client.id}`);
    }

    // 3. Send welcome email
    const welcomeHtml = buildWelcomeEmail(client);
    await sendTransactional(
      client.email,
      `Welcome to Intelio — your briefings are being set up`,
      welcomeHtml
    );
    console.log(`[register] Welcome email sent to ${client.email}`);

    return res.status(200).json({
      success: true,
      clientId: client.id,
      message:  `Registration complete. Your first briefing will arrive at ${client.delivery_time} tomorrow.`,
    });

  } catch (err) {
    console.error('[register] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

function buildWelcomeEmail(client) {
  const sections = (client.sections_enabled || [1,2,3,4,5,6])
    .map(n => sectionName(n)).join(', ');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><style>
  body { font-family: Georgia, serif; background: #F9F8F5; margin: 0; padding: 32px 16px; }
  .card { max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #E8E3DC;
          border-radius: 12px; overflow: hidden; }
  .hd { background: #1A1A1A; padding: 24px 32px; }
  .hd .logo { color: #C41E3A; font-size: 22px; font-weight: bold; }
  .bd { padding: 32px; }
  .bd h2 { font-size: 20px; margin: 0 0 16px; }
  .bd p  { color: #555; font-size: 14px; line-height: 1.7; margin: 0 0 12px; font-family: Arial, sans-serif; }
  .pill { display: inline-block; background: #F9F8F5; border: 1px solid #E8E3DC; border-radius: 20px;
          padding: 4px 12px; font-size: 12px; color: #444; margin: 2px; font-family: Arial, sans-serif; }
  .cta { display: inline-block; background: #C41E3A; color: #fff; text-decoration: none;
         padding: 12px 24px; border-radius: 8px; font-size: 14px; margin-top: 20px;
         font-family: Arial, sans-serif; }
</style></head>
<body>
<div class="card">
  <div class="hd"><div class="logo">Intelio.</div></div>
  <div class="bd">
    <h2>You're all set, ${client.client_contact}.</h2>
    <p>Your personalised briefing for <strong>${client.client_name}</strong> is being configured.
    Your first edition will arrive at <strong>${client.delivery_time || '07:00'}</strong> tomorrow.</p>
    <p>
      <span class="pill">Region: ${client.region}</span>
      <span class="pill">Sections: ${sections}</span>
      <span class="pill">Mode: ${client.view_mode}</span>
      <span class="pill">Language: ${client.output_language}</span>
    </p>
    <p>If you have questions, simply reply to this email.</p>
    <a class="cta" href="${process.env.APP_URL}">View sample briefing</a>
  </div>
</div>
</body>
</html>`;
}

function sectionName(n) {
  return {
    1: 'Macro',
    2: 'Industry',
    3: 'M&A',
    4: 'Demand',
    5: 'Assets',
    6: 'Policy',
  }[n] || `Section ${n}`;
}
