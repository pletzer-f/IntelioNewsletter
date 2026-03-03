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

  // Wrap briefing in a minimal email shell with prominent browser CTA
  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Intelio Briefing — ${dateLabel}</title>
<style>
  body { margin: 0; padding: 0; background: #F9F8F5; font-family: 'Georgia', serif; }
  .shell { max-width: 720px; margin: 0 auto; background: #FFFFFF; }
  .email-header { background: #0F172A; padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; }
  .email-header .logo { color: #F9F8F5; font-size: 22px; font-weight: bold; letter-spacing: -0.5px; font-family: Georgia, serif; }
  .email-header .logo span { color: #C41E3A; }
  .email-header .tagline { color: #64748B; font-size: 12px; font-family: Arial, sans-serif; }
  .cta-banner { background: #F9F8F5; border-bottom: 1px solid #E2DFD8; padding: 14px 32px; display: flex; align-items: center; justify-content: space-between; }
  .cta-banner-text { font-family: Arial, sans-serif; font-size: 13px; color: #64748B; }
  .cta-btn { display: inline-block; background: #C41E3A; color: #ffffff !important; font-family: Arial, sans-serif; font-size: 13px; font-weight: bold; padding: 9px 20px; border-radius: 8px; text-decoration: none !important; white-space: nowrap; }
  .email-content { padding: 0; }
  .email-footer { padding: 24px 32px; background: #F9F8F5; border-top: 1px solid #E8E3DC; }
  .email-footer p { color: #94A3B8; font-size: 11px; font-family: Arial, sans-serif; margin: 0; line-height: 1.8; }
  .email-footer a { color: #C41E3A; text-decoration: none; }
</style>
</head>
<body>
<div class="shell">
  <div class="email-header">
    <div class="logo">Intel<span>io</span>.</div>
    <div class="tagline">${clientName} · ${dateLabel}</div>
  </div>
  <div class="cta-banner">
    <span class="cta-banner-text">Best viewed in your browser — interactive navigation, dark mode &amp; PDF export</span>
    <a href="${webUrl}" class="cta-btn">Open full briefing →</a>
  </div>
  <div class="email-content">
    ${briefingHtml}
  </div>
  <div class="email-footer">
    <p>
      <a href="${webUrl}">Open full briefing in browser</a> &nbsp;·&nbsp;
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
