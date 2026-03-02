// lib/email.js — Resend email delivery

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Use RESEND_FROM env var, or fall back to Resend's test sender (sends to verified emails only)
const FROM_ADDRESS = process.env.RESEND_FROM || 'Intelio <onboarding@resend.dev>';

/**
 * Send the daily briefing HTML email.
 * @param {string} toEmail
 * @param {string} clientName
 * @param {string} dateLabel     — e.g. "Monday, 3 March 2026"
 * @param {string} briefingHtml  — full briefing HTML
 * @param {string} briefingId    — Supabase briefing row ID (for web link)
 */
export async function sendBriefingEmail(toEmail, clientName, dateLabel, briefingHtml, briefingId) {
  const webUrl = `${process.env.APP_URL}/api/briefings/${briefingId}`;

  // Wrap briefing in a minimal email shell
  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Intelio Briefing — ${dateLabel}</title>
<style>
  body { margin: 0; padding: 0; background: #F9F8F5; font-family: 'Georgia', serif; }
  .shell { max-width: 720px; margin: 0 auto; background: #FFFFFF; }
  .email-header { background: #1A1A1A; padding: 20px 32px; }
  .email-header .logo { color: #C41E3A; font-size: 22px; font-weight: bold; letter-spacing: -0.5px; }
  .email-header .tagline { color: #888; font-size: 12px; margin-top: 2px; font-family: 'Arial', sans-serif; }
  .email-content { padding: 0; }
  .email-footer { padding: 24px 32px; background: #F9F8F5; border-top: 1px solid #E8E3DC; }
  .email-footer p { color: #888; font-size: 11px; font-family: 'Arial', sans-serif; margin: 0; line-height: 1.8; }
  .email-footer a { color: #C41E3A; text-decoration: none; }
</style>
</head>
<body>
<div class="shell">
  <div class="email-header">
    <div class="logo">Intelio.</div>
    <div class="tagline">Economic Intelligence for ${clientName} · ${dateLabel}</div>
  </div>
  <div class="email-content">
    ${briefingHtml}
  </div>
  <div class="email-footer">
    <p>
      <a href="${webUrl}">View in browser</a> &nbsp;·&nbsp;
      You are receiving this because you signed up at intelio.io.<br>
      To unsubscribe or change preferences, reply to this email.
    </p>
  </div>
</div>
</body>
</html>`;

  const { data, error } = await resend.emails.send({
    from:    FROM_ADDRESS,
    to:      toEmail,
    subject: `Intelio Briefing — ${dateLabel}`,
    html:    emailHtml,
  });

  if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
  return data;
}

/**
 * Send a simple transactional email (welcome, confirmation, etc.)
 */
export async function sendTransactional(toEmail, subject, html) {
  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to:   toEmail,
    subject,
    html,
  });
  if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
  return data;
}
