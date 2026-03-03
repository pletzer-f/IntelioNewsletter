// api/register.js — POST /api/register
// Receives signup form config, saves client to Supabase, sends welcome email,
// then kicks off an immediate Agent 00 profile generation run.

import { upsertClient } from '../lib/supabase.js';
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

    // 2. Send welcome email
    const welcomeHtml = buildWelcomeEmail(client);
    await sendTransactional(
      client.email,
      `Welcome to Intelio — your briefings are being set up`,
      welcomeHtml
    );
    console.log(`[register] Welcome email sent to ${client.email}`);

    // 3. Kick off first briefing immediately — fire-and-forget into runner's own function context.
    // runner.js has maxDuration:300 and handles Agent 00 + all 6 agents + email delivery.
    // We do NOT await this — register returns immediately so the signup form feels instant.
    const appUrl = process.env.APP_URL || `https://${process.env.VERCEL_URL}`;
    fetch(`${appUrl}/api/agents/runner`, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-cron-secret':  process.env.CRON_SECRET,
      },
      body: JSON.stringify({ clientId: client.id }),
    }).catch(err => console.warn(`[register] Runner kick-off failed for ${client.id}:`, err.message));

    console.log(`[register] Runner kicked off for ${client.id} — briefing will arrive shortly`);

    return res.status(200).json({
      success: true,
      clientId: client.id,
      message:  `Registration complete. Your first briefing is being generated and will arrive in your inbox shortly.`,
    });

  } catch (err) {
    console.error('[register] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

function buildWelcomeEmail(client) {
  const sectionCount = (client.sections_enabled || [1,2,3,4,5,6]).length;
  const deliveryFmt  = (client.delivery_time || '0700').replace(/(\d{2})(\d{2})/, '$1:$2');
  const prefsUrl     = `${process.env.APP_URL}/preferences.html?id=${client.id}`;
  const langLabel    = client.output_language === 'de' ? 'Deutsch' : 'English';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to Intelio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  body { margin: 0; padding: 0; background: #F9F8F5; font-family: 'Inter', Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { max-width: 560px; margin: 40px auto; background: #FFFFFF; border: 1px solid #E2DFD8; border-radius: 16px; overflow: hidden; }

  /* Header */
  .hd { background: #0F172A; padding: 28px 36px; display: flex; align-items: center; justify-content: space-between; }
  .hd-wordmark { font-family: 'Playfair Display', Georgia, serif; font-size: 26px; font-weight: 800; color: #F9F8F5; letter-spacing: -0.5px; }
  .hd-wordmark span { color: #C41E3A; }
  .hd-rule { width: 2px; height: 32px; background: #C41E3A; opacity: 0.6; }
  .hd-label { font-size: 11px; font-weight: 600; color: #64748B; letter-spacing: 0.08em; text-transform: uppercase; }

  /* Body */
  .bd { padding: 36px; }
  .greeting { font-family: 'Playfair Display', Georgia, serif; font-size: 22px; font-weight: 700; color: #0F172A; margin: 0 0 12px; line-height: 1.3; }
  .sub { font-size: 14.5px; color: #475569; line-height: 1.75; margin: 0 0 28px; }
  .sub strong { color: #0F172A; font-weight: 600; }

  /* Config grid */
  .config { background: #F9F8F5; border: 1px solid #E2DFD8; border-radius: 10px; padding: 20px 24px; margin-bottom: 28px; }
  .config-row { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; border-bottom: 1px solid #E2DFD8; font-size: 13px; }
  .config-row:last-child { border-bottom: none; padding-bottom: 0; }
  .config-row:first-child { padding-top: 0; }
  .config-key { color: #64748B; font-weight: 500; }
  .config-val { color: #0F172A; font-weight: 600; }

  /* Divider */
  .rule { border: none; border-top: 1px solid #E2DFD8; margin: 0 0 24px; }

  /* Footer */
  .ft { padding: 20px 36px 28px; }
  .ft p { font-size: 12px; color: #94A3B8; line-height: 1.7; margin: 0 0 8px; }
  .ft a { color: #C41E3A; text-decoration: none; }
  .ft a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="wrap">
  <div class="hd">
    <div class="hd-wordmark">Intel<span>io</span>.</div>
    <div class="hd-rule"></div>
    <div class="hd-label">Morning Briefing</div>
  </div>
  <div class="bd">
    <p class="greeting">You're all set, ${client.client_contact}.</p>
    <p class="sub">
      Your personalised briefing for <strong>${client.client_name}</strong> is being generated right now.
      Expect your first edition in your inbox <strong>within the next few minutes</strong>.
      After that, it arrives automatically every morning at <strong>${deliveryFmt} CET</strong>.
    </p>
    <div class="config">
      <div class="config-row"><span class="config-key">Company</span><span class="config-val">${client.client_name}</span></div>
      <div class="config-row"><span class="config-key">Region</span><span class="config-val">${client.region}</span></div>
      <div class="config-row"><span class="config-key">Sections</span><span class="config-val">${sectionCount} active</span></div>
      <div class="config-row"><span class="config-key">Delivery</span><span class="config-val">${deliveryFmt} CET daily</span></div>
      <div class="config-row"><span class="config-key">Language</span><span class="config-val">${langLabel}</span></div>
    </div>
  </div>
  <hr class="rule">
  <div class="ft">
    <p>Reply to this email with any questions or feedback — we read everything.</p>
    <p><a href="${prefsUrl}">Manage preferences</a> &nbsp;&middot;&nbsp; <a href="#">Unsubscribe</a></p>
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
