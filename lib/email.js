// lib/email.js — Resend email delivery

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Use RESEND_FROM env var, or fall back to Resend's test sender (sends to verified emails only)
const FROM_ADDRESS = process.env.RESEND_FROM || 'Intelio <onboarding@resend.dev>';

/**
 * Send the daily briefing email — clean summary with CTA to full browser version.
 * @param {string} toEmail
 * @param {string} clientName
 * @param {string} dateLabel        — e.g. "Monday, 3 March 2026"
 * @param {string} orchestratorHtml — executive summary HTML from the orchestrator
 * @param {string} briefingId       — Supabase briefing row ID (for web link)
 * @param {string[]} sectionNames   — list of active section names (e.g. ['Executive Summary', 'Macro & Markets'])
 */
export async function sendBriefingEmail(toEmail, clientName, dateLabel, orchestratorHtml, briefingId, sectionNames = []) {
  const webUrl = `${process.env.APP_URL}/api/briefings/${briefingId}`;

  // Section pills for the email
  const sectionPills = sectionNames.slice(1).map(name =>
    `<span style="display:inline-block;background:#F3F0EB;color:#475569;font-size:11px;font-weight:600;padding:4px 11px;border-radius:20px;font-family:Arial,sans-serif;margin:3px 4px 3px 0;white-space:nowrap;">${name}</span>`
  ).join('');

  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Intelio Briefing — ${dateLabel}</title>
<style>
  body { margin: 0; padding: 0; background: #F9F8F5; font-family: 'Georgia', serif; }
  .shell { max-width: 680px; margin: 0 auto; background: #FFFFFF; }

  /* Header */
  .email-header { background: #0F172A; padding: 22px 32px; display: flex; align-items: center; justify-content: space-between; }
  .logo { color: #F9F8F5; font-size: 22px; font-weight: bold; letter-spacing: -0.5px; font-family: Georgia, serif; }
  .logo span { color: #C41E3A; }
  .header-meta { color: #64748B; font-size: 12px; font-family: Arial, sans-serif; text-align: right; line-height: 1.5; }

  /* Summary area */
  .summary-area { padding: 28px 32px 20px; border-bottom: 1px solid #E2DFD8; }
  .summary-label { font-family: Arial, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8; margin-bottom: 14px; }

  /* Summary content styling — matches briefing template */
  .summary-area .summary-prep {
    font-family: 'Courier New', monospace; font-size: 10px; color: #94A3B8;
    letter-spacing: 0.04em; margin-bottom: 18px; line-height: 1.6;
  }
  .summary-area .sum-list { list-style: none; padding: 0; margin: 0; }
  .summary-area .sum-item {
    display: flex; gap: 12px; align-items: baseline;
    padding: 10px 0; border-bottom: 1px solid #F3F0EB; font-size: 14px; line-height: 1.65;
  }
  .summary-area .sum-item:last-child { border-bottom: none; }
  .summary-area .sum-num {
    font-family: Georgia, serif; font-size: 17px; font-weight: 700;
    color: #C41E3A; flex-shrink: 0; width: 28px;
  }
  .summary-area .sum-text { color: #1E293B; font-family: Arial, sans-serif; }
  .summary-area .sum-text strong { color: #0F172A; }
  /* Key Themes block */
  .summary-area ol { padding-left: 18px; color: #475569; font-family: Arial, sans-serif; font-size: 13.5px; line-height: 1.75; }

  /* Sections list */
  .sections-area { padding: 20px 32px; background: #F9F8F5; border-bottom: 1px solid #E2DFD8; }
  .sections-label { font-family: Arial, sans-serif; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8; margin-bottom: 10px; }

  /* CTA */
  .cta-area { padding: 28px 32px; text-align: center; }
  .cta-btn { display: inline-block; background: #C41E3A; color: #ffffff !important; font-family: Arial, sans-serif; font-size: 15px; font-weight: bold; padding: 14px 32px; border-radius: 8px; text-decoration: none !important; }
  .cta-sub { color: #94A3B8; font-family: Arial, sans-serif; font-size: 12px; margin-top: 10px; }

  /* Footer */
  .email-footer { padding: 20px 32px; background: #F9F8F5; border-top: 1px solid #E2DFD8; }
  .email-footer p { color: #94A3B8; font-size: 11px; font-family: Arial, sans-serif; margin: 0; line-height: 1.8; }
  .email-footer a { color: #C41E3A; text-decoration: none; }
</style>
</head>
<body>
<div class="shell">

  <!-- Header -->
  <div class="email-header">
    <div class="logo">Intel<span>io</span>.</div>
    <div class="header-meta">
      ${clientName}<br>${dateLabel}
    </div>
  </div>

  <!-- Executive Summary -->
  <div class="summary-area">
    <div class="summary-label">Executive Summary</div>
    ${orchestratorHtml}
  </div>

  <!-- Section labels -->
  ${sectionPills ? `
  <div class="sections-area">
    <div class="sections-label">Today's briefing sections</div>
    <div>${sectionPills}</div>
  </div>` : ''}

  <!-- CTA -->
  <div class="cta-area">
    <a href="${webUrl}" class="cta-btn">Open full briefing &rarr;</a>
    <p class="cta-sub">Interactive navigation &nbsp;&middot;&nbsp; Dark mode &nbsp;&middot;&nbsp; PDF export &nbsp;&middot;&nbsp; AI chat</p>
  </div>

  <!-- Footer -->
  <div class="email-footer">
    <p>
      <a href="${webUrl}">Open in browser</a> &nbsp;&middot;&nbsp;
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
