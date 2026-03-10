// api/agents/orchestrator.js — HTML assembly for the final briefing
// Loads CSS/JS from briefing-template.html at cold-start for design system consistency.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load the design system template once at cold-start ─────────────────────
const templateHtml = readFileSync(
  join(__dirname, '../../briefing-app/briefing-template.html'), 'utf-8'
);

// Extract the full <style> block (complete CSS design system)
const TEMPLATE_STYLE = templateHtml.slice(
  templateHtml.indexOf('<style>'),
  templateHtml.indexOf('</style>') + '</style>'.length
);

// Extract the <script> block content, then strip the two hardcoded SECTION_IDS /
// SECTION_NAMES declarations so we can inject our own dynamic values instead.
const rawScriptContent = templateHtml.slice(
  templateHtml.indexOf('<script>') + '<script>'.length,
  templateHtml.lastIndexOf('</script>')
);
const TEMPLATE_SCRIPT = rawScriptContent
  .replace(/^\s*const SECTION_IDS\s*=.*;\s*$/m, '')
  .replace(/^\s*const SECTION_NAMES\s*=.*;\s*$/m, '');

// ── Section definitions (maps agent IDs to nav slugs/labels) ───────────────
const SECTION_DEFS = [
  { slug: 'macro',    name: 'Macro & Markets',           agent: 1 },
  { slug: 'industry', name: 'Core Industry',             agent: 2 },
  { slug: 'pe',       name: 'PE & M\u0026A',             agent: 3 },
  { slug: 'demand',   name: 'End-Market Demand',         agent: 4 },
  { slug: 'assets',   name: 'Assets & Capex',            agent: 5 },
  { slug: 'local',    name: 'Local Policy & Reputation', agent: 6 },
];

// ── Main assembly function ──────────────────────────────────────────────────

/**
 * Assembles the complete Intelio briefing HTML from agent section outputs.
 * Uses CSS + JS extracted from briefing-template.html so the generated briefing
 * always matches the designed brand identity.
 */
export function assembleBriefing({ client, today, orchestratorHtml, sectionHtmls, enabledSections, tickers = [] }) {
  const { h01, h02, h03, h04, h05, h06 } = sectionHtmls;
  const appUrl = process.env.APP_URL || '';
  const htmlByAgent = { 1: h01, 2: h02, 3: h03, 4: h04, 5: h05, 6: h06 };

  const dateLabel = new Date(today).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const timeCET = new Date().toLocaleTimeString('de-AT', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Vienna',
  });

  // Determine which agent sections have content and are enabled
  const activeSections = SECTION_DEFS.filter(s => {
    const html = htmlByAgent[s.agent];
    return enabledSections.has(s.agent) && html && html.trim().length > 0;
  });

  // Summary is always first; enabled agent sections follow
  const allSections = [
    { slug: 'summary', name: 'Executive Summary' },
    ...activeSections,
  ];

  // Dynamic SECTION_IDS / SECTION_NAMES injected into the template script
  const SECTION_IDS_JSON   = JSON.stringify(allSections.map(s => s.slug));
  const SECTION_NAMES_JSON = JSON.stringify(allSections.map(s => s.name));

  // ── Nav pills ─────────────────────────────────────────────────────────────
  const navPills = allSections.map((s, i) =>
    `<button class="nav-pill${i === 0 ? ' active' : ''}" data-sec="${s.slug}">${s.name}</button>`
  ).join('\n      ');

  // ── Summary section (orchestrator output) ─────────────────────────────────
  const summarySection = `
    <section class="bsec active" id="summary">
      <div class="sec-head">
        <div class="sec-title-row">
          <h2 class="sec-title">Executive Summary</h2>
          <div class="sec-meta"><span>${timeCET} CET</span></div>
        </div>
        <div class="sec-rule"></div>
      </div>
      <div class="summary-card">
        ${orchestratorHtml}
      </div>
    </section>`;

  // ── Agent sections ────────────────────────────────────────────────────────
  const agentSections = activeSections.map((s, i) => {
    const html = htmlByAgent[s.agent];
    return `
    <section class="bsec" id="${s.slug}">
      <div class="sec-head">
        <div class="sec-title-row">
          <div>
            <div class="sec-label-badge">Section ${i + 2} of ${allSections.length}</div>
            <h2 class="sec-title">${s.name}</h2>
          </div>
        </div>
        <div class="sec-rule"></div>
      </div>
      ${html}
    </section>`;
  }).join('\n');

  // ── Assemble full page ────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="${client.output_language || 'en'}" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Intelio \u00B7 ${client.client_name} \u00B7 ${dateLabel}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=JetBrains+Mono:wght@400;500;600&family=Playfair+Display:ital,wght@0,700;0,800;1,700&display=swap" rel="stylesheet">
  ${TEMPLATE_STYLE}
  <style>
    /* ── Chat FAB ─────────────────────────────────────────────────────── */
    .chat-fab {
      position: fixed; bottom: 36px; right: 36px;
      width: 50px; height: 50px;
      background: var(--accent, #C41E3A); border: none; border-radius: 50%;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 16px rgba(196,30,58,0.35); z-index: 700;
      transition: transform 0.22s, box-shadow 0.22s;
    }
    .chat-fab:hover { transform: translateY(-2px) scale(1.06); box-shadow: 0 8px 28px rgba(196,30,58,0.45); }
    .chat-fab-icon { font-size: 18px; color: #fff; line-height: 1; }

    /* ── Chat Panel ───────────────────────────────────────────────────── */
    .chat-panel {
      position: fixed; top: 0; left: 0;
      width: 400px; max-width: 90vw; height: 100vh;
      background: var(--surface, #fff);
      border-right: 1px solid var(--border, #E2DFD8);
      box-shadow: 4px 0 32px rgba(15,23,42,0.12);
      display: flex; flex-direction: column;
      z-index: 900;
      transform: translateX(-100%);
      transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
    }
    .chat-panel.open { transform: translateX(0); }

    .chat-panel-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 20px; background: var(--ink, #0F172A);
      border-bottom: 1px solid rgba(255,255,255,0.06); flex-shrink: 0;
    }
    .chat-head-left { display: flex; align-items: center; gap: 10px; }
    .chat-head-logo { font-family: 'Playfair Display', Georgia, serif; font-size: 18px; font-weight: 800; color: #F9F8F5; }
    .chat-head-logo span { color: #C41E3A; }
    .chat-head-title { font-size: 11px; font-weight: 600; color: #64748B; letter-spacing: 0.08em; text-transform: uppercase; margin-top: 2px; }
    .chat-close-btn { background: none; border: none; color: #64748B; cursor: pointer; font-size: 18px; padding: 4px 6px; line-height: 1; border-radius: 4px; transition: color 0.15s, background 0.15s; }
    .chat-close-btn:hover { color: #F9F8F5; background: rgba(255,255,255,0.08); }

    .chat-body { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
    .chat-empty { margin: auto; text-align: center; color: var(--muted, #94A3B8); font-size: 13.5px; line-height: 1.65; padding: 32px 16px; }
    .chat-empty-icon { font-size: 26px; margin-bottom: 10px; color: var(--accent, #C41E3A); }

    .chat-msg { display: flex; flex-direction: column; gap: 3px; }
    .chat-msg.user { align-items: flex-end; }
    .chat-msg.ai   { align-items: flex-start; }
    .chat-bubble { max-width: 86%; padding: 10px 14px; border-radius: 14px; font-size: 13.5px; line-height: 1.6; }
    .chat-msg.user .chat-bubble { background: var(--accent, #C41E3A); color: #fff; border-bottom-right-radius: 4px; }
    .chat-msg.ai   .chat-bubble { background: var(--surface-2, #F9F8F5); color: var(--ink, #0F172A); border: 1px solid var(--border, #E2DFD8); border-bottom-left-radius: 4px; }
    .chat-msg-time { font-size: 10px; color: var(--muted, #94A3B8); padding: 0 4px; }

    .chat-typing { padding: 10px 14px; background: var(--surface-2, #F9F8F5); border: 1px solid var(--border, #E2DFD8); border-radius: 14px; border-bottom-left-radius: 4px; display: inline-flex; align-items: center; gap: 5px; }
    .chat-dot { width: 6px; height: 6px; background: var(--muted, #94A3B8); border-radius: 50%; animation: chatDot 1.2s infinite; }
    .chat-dot:nth-child(2) { animation-delay: 0.2s; }
    .chat-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes chatDot { 0%,80%,100% { transform: scale(0.6); opacity: 0.3; } 40% { transform: scale(1); opacity: 1; } }

    .chat-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 20px; }
    .chat-chip.success { background: #DCFCE7; color: #16A34A; border: 1px solid #86EFAC; }
    .chat-chip.error   { background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; }

    .chat-foot { padding: 14px 20px 20px; border-top: 1px solid var(--border, #E2DFD8); display: flex; gap: 10px; align-items: flex-end; flex-shrink: 0; }
    .chat-input { flex: 1; resize: none; border: 1px solid var(--border, #E2DFD8); border-radius: 10px; padding: 10px 14px; font-family: 'Inter', sans-serif; font-size: 13.5px; line-height: 1.5; color: var(--ink, #0F172A); background: var(--surface, #fff); outline: none; transition: border-color 0.2s; }
    .chat-input:focus { border-color: var(--accent, #C41E3A); }
    .chat-input.shake { animation: chatShake 0.35s ease; }
    @keyframes chatShake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
    .chat-send { width: 40px; height: 40px; border-radius: 50%; background: var(--accent, #C41E3A); border: none; color: #fff; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.15s, transform 0.15s; }
    .chat-send:hover:not(:disabled) { background: #A01830; transform: scale(1.06); }
    .chat-send:disabled { background: var(--border, #E2DFD8); cursor: not-allowed; color: var(--muted, #94A3B8); }
    .chat-panel-foot { padding: 10px 20px; border-top: 1px solid var(--border, #E2DFD8); flex-shrink: 0; }
    .chat-clear-btn { background: none; border: none; font-size: 12px; color: var(--muted, #94A3B8); cursor: pointer; padding: 4px 0; transition: color 0.15s; }
    .chat-clear-btn:hover { color: #DC2626; }

    .chat-panel { pointer-events: none; }
    .chat-panel.open { pointer-events: auto; }
    @media print { .chat-fab, .chat-panel { display: none !important; } }
    @media (max-width: 600px) { .chat-panel { width: 100%; } .chat-fab { bottom: 20px; right: 20px; } }

    /* ── Section top padding (tab-based layout — one section at a time) ── */
    .bsec { padding-top: 48px; }

    /* ── Prevent layout leak from unclosed AI-generated divs ──────────
       Template .story-header is display:flex — if the AI forgets to close
       it, ALL subsequent story content becomes flex items in a horizontal
       row. Fix: force .story-header to display:block (with inline children)
       and add overflow-x:hidden on containers as backstop. */
    .story-header {
      display: block !important;
      overflow: hidden !important;
      margin-bottom: 14px !important;
    }
    .story-header .story-tags {
      display: inline-flex !important;
      align-items: center !important;
      gap: 9px !important;
    }
    .story-header .story-rt {
      float: right !important;
      margin-top: 2px !important;
    }
    .content { overflow-x: hidden !important; }
    .bsec    { overflow-x: hidden !important; }
    /* Section label badge shown above each non-summary section */
    .sec-label-badge {
      display: inline-flex; align-items: center; gap: 6px;
      background: var(--accent-dim); color: var(--accent);
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; padding: 4px 10px; border-radius: 20px;
      margin-bottom: 6px; font-family: 'Inter', sans-serif;
    }

    /* ── Mobile nav button (hidden on desktop) ───────────────────────── */
    .mob-sec-btn { display: none; }

    /* ── Mobile bottom-sheet drawer ──────────────────────────────────── */
    .mob-sec-drawer {
      display: none; position: fixed; inset: 0;
      background: rgba(15,23,42,0.5); z-index: 800;
      align-items: flex-end; -webkit-tap-highlight-color: transparent;
    }
    .mob-sec-drawer.open { display: flex; }

    .mob-sec-sheet {
      width: 100%; max-height: 80vh; overflow-y: auto;
      background: var(--surface); border-radius: 20px 20px 0 0;
      padding-bottom: max(env(safe-area-inset-bottom, 0px), 20px);
      animation: sheetIn 0.28s cubic-bezier(0.32,0.72,0,1);
    }
    @keyframes sheetIn { from { transform: translateY(100%); } to { transform: translateY(0); } }

    .mob-sec-sheet-head {
      position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between;
      padding: 14px 20px; border-bottom: 1px solid var(--border);
      background: var(--surface);
      font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-3);
    }
    .mob-sec-handle { width: 40px; height: 4px; background: var(--border); border-radius: 2px; }

    .mob-sec-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 17px 20px; border-bottom: 1px solid var(--border);
      cursor: pointer; transition: background 0.15s;
    }
    .mob-sec-item:last-child { border-bottom: none; }
    .mob-sec-item:active { background: var(--surface-hi); }
    .mob-sec-item.active { background: var(--accent-dim); }
    .mob-sec-item.active .mob-sec-item-name { color: var(--accent); font-weight: 700; }
    .mob-sec-item-name { font-size: 15px; font-weight: 500; color: var(--text); }
    .mob-sec-num { font-size: 11px; color: var(--text-3); font-family: 'JetBrains Mono', monospace; flex-shrink: 0; }

    @media (max-width: 768px) {
      /* Hide desktop nav pills on mobile — replaced by the bottom drawer */
      .nav-pill { display: none !important; }
      .sec-counter-wrap { display: none !important; }

      /* Show compact mobile section picker in the nav bar */
      .mob-sec-btn {
        display: flex; align-items: center; justify-content: space-between;
        flex: 1; padding: 9px 14px;
        background: var(--surface-hi); border: 1px solid var(--border);
        border-radius: 8px; cursor: pointer;
        font-family: 'Inter', sans-serif; font-size: 13px; font-weight: 600;
        color: var(--text); transition: border-color 0.18s;
      }
      .mob-sec-btn:active { border-color: var(--accent); }
      .mob-sec-chevron { font-size: 8px; color: var(--text-3); flex-shrink: 0; margin-left: 8px; }

      /* Allow impl-body to scroll on mobile (260px is too short) */
      .impl-body.open { max-height: 600px !important; overflow-y: auto !important; }
    }

    /* ── Story source — branded accent badge ─────────────────────────── */
    .story-src {
      display: inline-flex !important; align-items: center !important; gap: 8px !important;
      margin-top: 12px !important; padding: 5px 12px 5px 10px !important;
      font-size: 10.5px !important; font-weight: 600 !important; letter-spacing: 0.03em !important;
      text-decoration: none !important; color: var(--text-2) !important;
      border-left: 3px solid var(--accent) !important;
      background: var(--surface-hi) !important; border-radius: 0 6px 6px 0 !important;
      transition: background 0.18s, color 0.18s !important;
    }
    .story-src::before {
      content: 'SOURCE'; font-size: 7.5px; font-weight: 800; letter-spacing: 0.14em;
      background: var(--accent); color: #fff; padding: 2px 6px; border-radius: 3px; flex-shrink: 0;
    }
    .story-src:hover { background: var(--accent-dim) !important; color: var(--accent) !important; }

    /* ── Chat — use design-system CSS vars (dark-mode safe) ─────────────── */
    /* The inline chat styles above use --ink/--surface-2/--muted which aren't in the
       briefing template. These overrides replace them with the correct variables. */
    .chat-panel { background: var(--surface); border-right-color: var(--border); }
    .chat-panel-head { background: #0F172A !important; }
    .chat-head-logo { color: #F9F8F5 !important; }
    .chat-head-title { color: rgba(255,255,255,0.38) !important; }
    .chat-close-btn { color: rgba(255,255,255,0.35) !important; }
    .chat-close-btn:hover { color: #fff !important; background: rgba(255,255,255,0.08) !important; }
    .chat-body { background: var(--surface); }
    .chat-msg.ai .chat-bubble { background: var(--surface-hi) !important; color: var(--text) !important; border-color: var(--border) !important; }
    .chat-empty { color: var(--text-3) !important; }
    .chat-empty strong { color: var(--text-2) !important; }
    .chat-typing { background: var(--surface-hi) !important; border-color: var(--border) !important; }
    .chat-dot { background: var(--text-3) !important; }
    .chat-input { background: var(--surface) !important; color: var(--text) !important; border-color: var(--border) !important; }
    .chat-input::placeholder { color: var(--text-3); }
    .chat-foot { border-top-color: var(--border); background: var(--surface); }
    .chat-msg-time { color: var(--text-3) !important; }
    .chat-clear-btn { color: var(--text-3) !important; }
    .chat-clear-btn:hover { color: #C41E3A !important; }
    .chat-panel-foot { border-top-color: var(--border); background: var(--surface); }

    /* ── Kill story-grid (template: display:grid, grid-template-columns:1fr 1fr) ── */
    .story-grid {
      display: block !important;
      grid-template-columns: none !important;
      gap: 0 !important;
      columns: auto !important;
      column-count: auto !important;
    }

    /* ── Promote story-card to story-lead styling ─────────────────────── */
    .story-card {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      float: none !important;
      position: static !important;
      background: transparent !important;
      border: none !important;
      border-radius: 0 !important;
      padding: 30px 0 !important;
      box-shadow: none !important;
      transform: none !important;
      border-bottom: 1px solid var(--border) !important;
      margin-bottom: 4px !important;
    }
    .story-card:hover { transform: none !important; box-shadow: none !important; }
    .story-card .story-hl  { font-size: 30px !important; }
    .story-card .story-body { font-size: 14.5px !important; margin-bottom: 22px !important; }
    .story-card .key-stat   { width: 100% !important; }
    .story-card .ks-val     { font-size: 38px !important; }

    /* ── Ensure ALL story articles are full-width blocks (catch-all) ─── */
    article.story-lead,
    article.story-card,
    article[class*="story"] {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      float: none !important;
      clear: both !important;
    }

    /* ── Prevent any wrapper div in sections from creating columns ───── */
    .bsec > div:not(.sec-head) {
      display: block !important;
      columns: auto !important;
      column-count: auto !important;
    }

    /* ── Save (bookmark) button on each story article ─────────────────── */
    .art-save-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; margin-top: 10px; margin-bottom: 8px;
      background: transparent; border: 1px solid var(--border);
      border-radius: 20px; cursor: pointer;
      font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 600;
      letter-spacing: 0.04em; color: var(--text-3);
      transition: all 0.18s;
    }
    .art-save-btn:hover { border-color: var(--accent); color: var(--accent); }
    .art-save-btn.saved {
      background: var(--accent-dim); border-color: var(--accent);
      color: var(--accent);
    }
    .art-save-btn .save-star { font-size: 12px; }

    /* ── Saved articles panel ─────────────────────────────────────────── */
    .saved-fab {
      position: fixed; bottom: 100px; right: 36px;
      width: 50px; height: 50px;
      background: var(--surface); border: 2px solid var(--border);
      border-radius: 50%; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 16px rgba(0,0,0,0.10); z-index: 700;
      transition: transform 0.22s, box-shadow 0.22s, border-color 0.22s;
    }
    .saved-fab:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.14); border-color: var(--accent); }
    .saved-fab-icon { font-size: 20px; color: var(--text-2); line-height: 1; }
    .saved-fab-count {
      position: absolute; top: -4px; right: -4px;
      min-width: 18px; height: 18px; border-radius: 9px;
      background: var(--accent); color: #fff;
      font-size: 10px; font-weight: 700;
      display: none; align-items: center; justify-content: center;
      padding: 0 4px;
    }
    .saved-fab-count.visible { display: flex; }

    .saved-panel {
      position: fixed; top: 0; right: 0;
      width: 420px; max-width: 94vw; height: 100vh;
      background: var(--surface);
      border-left: 1px solid var(--border);
      box-shadow: -4px 0 32px rgba(15,23,42,0.10);
      display: flex; flex-direction: column; z-index: 900;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4,0,0.2,1);
    }
    .saved-panel.open { transform: translateX(0); }

    .saved-panel-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 20px; flex-shrink: 0;
      border-bottom: 1px solid var(--border);
    }
    .saved-head-left { display: flex; align-items: center; gap: 10px; }
    .saved-head-icon { font-size: 18px; color: var(--accent); }
    .saved-head-title {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 17px; font-weight: 700; color: var(--text);
    }
    .saved-head-count {
      font-size: 11px; font-weight: 600; color: var(--text-3);
      letter-spacing: 0.06em; text-transform: uppercase; margin-top: 2px;
    }
    .saved-close-btn {
      background: none; border: none; cursor: pointer; font-size: 18px;
      color: var(--text-3); padding: 4px 6px; border-radius: 4px;
      transition: color 0.15s, background 0.15s;
    }
    .saved-close-btn:hover { color: var(--text); background: var(--surface-hi); }

    .saved-body { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 0; }
    .saved-empty {
      margin: auto; text-align: center; color: var(--text-3);
      font-size: 13.5px; line-height: 1.65; padding: 32px 16px;
    }
    .saved-empty-icon { font-size: 28px; margin-bottom: 10px; color: var(--accent); }

    .saved-item {
      padding: 16px 0; border-bottom: 1px solid var(--border);
      display: flex; flex-direction: column; gap: 6px;
    }
    .saved-item:last-child { border-bottom: none; }
    .saved-item-tag {
      font-family: 'JetBrains Mono', monospace;
      font-size: 9px; font-weight: 600; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--text-3);
    }
    .saved-item-hl {
      font-family: 'Playfair Display', Georgia, serif;
      font-size: 15px; font-weight: 700; color: var(--text);
      line-height: 1.3; letter-spacing: -0.01em;
    }
    .saved-item-body {
      font-size: 12.5px; color: var(--text-2); line-height: 1.65;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    .saved-item-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; }
    .saved-item-src { font-size: 10.5px; color: var(--text-3); font-family: 'JetBrains Mono', monospace; }
    .saved-item-remove {
      background: none; border: none; cursor: pointer; font-size: 11px;
      color: var(--text-3); padding: 3px 8px; border-radius: 4px;
      transition: color 0.15s, background 0.15s; font-family: 'Inter', sans-serif;
    }
    .saved-item-remove:hover { color: #DC2626; background: #FEF2F2; }

    .saved-panel-foot {
      padding: 12px 20px; border-top: 1px solid var(--border); flex-shrink: 0;
      display: flex; align-items: center; justify-content: space-between;
    }
    .saved-export-btn {
      background: none; border: 1px solid var(--border); border-radius: 6px;
      padding: 6px 14px; font-size: 12px; font-weight: 600; color: var(--text-2);
      cursor: pointer; font-family: 'Inter', sans-serif; transition: all 0.18s;
    }
    .saved-export-btn:hover { border-color: var(--accent); color: var(--accent); }
    .saved-clear-btn {
      background: none; border: none; font-size: 12px; color: var(--text-3);
      cursor: pointer; font-family: 'Inter', sans-serif; transition: color 0.15s;
    }
    .saved-clear-btn:hover { color: #DC2626; }

    .saved-panel { pointer-events: none; }
    .saved-panel.open { pointer-events: auto; }
    @media print { .saved-fab, .saved-panel { display: none !important; } }
    @media (max-width: 600px) { .saved-panel { width: 100%; } .saved-fab { bottom: 80px; right: 20px; } }
  </style>
</head>
<body>

  <div id="progress"></div>

  <header class="masthead">
    <div class="masthead-left">
      <span class="edition-tag">${client.client_name}</span>
    </div>
    <div class="masthead-center">
      <div class="wordmark">Intel<span class="io">io</span>.</div>
      <div class="masthead-byline">Personalised for <strong>${client.client_contact || client.client_name}</strong></div>
    </div>
    <div class="masthead-right">
      <span class="masthead-date">${dateLabel}</span>
      <button class="theme-btn" id="themeBtn" title="Switch to dark mode">\u263D</button>
      <button class="print-btn" onclick="window.print()">\u2193 Save PDF</button>
    </div>
  </header>

  <div class="signals-bar">
    <div class="signals-inner">
      ${tickers.map(t => `<div class="sig-item s-${t.direction}">
        <span class="sig-lbl">${t.label}</span>
        <span class="sig-val">${t.value}</span>
        <span class="sig-chg">${t.change}</span>
      </div>`).join('')}
      <span class="signals-ts">Generated ${timeCET} CET \u00B7 ${dateLabel}</span>
    </div>
  </div>

  <nav class="sec-nav" id="secNav">
    <div class="sec-nav-inner">
      <!-- Mobile compact section picker (hidden on desktop) -->
      <button class="mob-sec-btn" id="mobSecBtn" onclick="toggleMobNav()">
        <span id="mobSecName">Executive Summary</span>
        <span class="mob-sec-chevron">&#9660;</span>
      </button>
      ${navPills}
      <div class="sec-counter-wrap">
        <span class="sec-counter" id="secCounter">
          1&thinsp;/&thinsp;${allSections.length} &nbsp;\u00B7&nbsp; <span class="counter-name">Executive Summary</span>
        </span>
      </div>
    </div>
  </nav>

  <!-- Mobile section bottom drawer -->
  <div class="mob-sec-drawer" id="mobSecDrawer" onclick="closeMobNav()">
    <div class="mob-sec-sheet" onclick="event.stopPropagation()">
      <div class="mob-sec-sheet-head">
        <span>JUMP TO SECTION</span>
        <span class="mob-sec-handle"></span>
      </div>
      ${allSections.map((s, i) => `
      <div class="mob-sec-item${i === 0 ? ' active' : ''}" data-idx="${i}" onclick="mobNavSelect(${i})">
        <span class="mob-sec-item-name">${s.name}</span>
        <span class="mob-sec-num">${i + 1}&thinsp;/&thinsp;${allSections.length}</span>
      </div>`).join('')}
    </div>
  </div>

  <main class="content">
    ${summarySection}
    ${agentSections}
  </main>

  <!-- HIGHLIGHT TOOLTIP -->
  <div class="hl-tooltip" id="hlTooltip">
    <span class="hl-spark">\u2726</span>
    <span class="hl-label">Capture insight</span>
  </div>

  <!-- NOTEPAD FAB -->
  <button class="np-fab" id="npFab" onclick="toggleNotepad()" title="Research notes (N)">
    <span class="np-fab-icon">\u2726</span>
    <span class="np-fab-badge" id="npFabBadge">0</span>
  </button>

  <!-- NOTEPAD PANEL -->
  <aside class="np-panel" id="npPanel">
    <div class="np-panel-head">
      <div class="np-head-left">
        <span class="np-head-logo">I.</span>
        <div>
          <div class="np-head-title">Research Notes</div>
          <div class="np-head-count" id="npCount">No notes yet</div>
        </div>
      </div>
      <div class="np-head-right">
        <button class="np-export-btn" onclick="exportNotes()">\u2193 Export</button>
        <button class="np-close-btn" onclick="closeNotepad()" title="Close">\u2715</button>
      </div>
    </div>
    <div class="np-body" id="npBody">
      <div class="np-empty" id="npEmpty">
        <div class="np-empty-spark">\u2726</div>
        <p><strong>Highlight any text</strong> while reading to capture an AI-generated insight into your research notes.</p>
      </div>
    </div>
    <div class="np-panel-foot" id="npFoot" style="display:none">
      <button class="np-clear-btn" onclick="clearAllNotes()">Clear all notes</button>
    </div>
  </aside>

  <!-- CHAT FAB -->
  <button class="chat-fab" id="chatFab" onclick="toggleChat()" title="Customise next briefing (C)">
    <span class="chat-fab-icon">\u2726</span>
  </button>

  <!-- CHAT PANEL -->
  <aside class="chat-panel" id="chatPanel">
    <div class="chat-panel-head">
      <div class="chat-head-left">
        <div>
          <div class="chat-head-logo">Intel<span>io</span>.</div>
          <div class="chat-head-title">Briefing Assistant</div>
        </div>
      </div>
      <button class="chat-close-btn" onclick="toggleChat()" title="Close">\u2715</button>
    </div>
    <div class="chat-body" id="chatBody">
      <div class="chat-empty" id="chatEmpty">
        <div class="chat-empty-icon">\u2726</div>
        <p><strong>Customise your next briefing.</strong><br>Tell me what to add, remove, or focus on.</p>
      </div>
    </div>
    <div class="chat-foot">
      <textarea class="chat-input" id="chatInput" placeholder="e.g. Focus more on Austrian real estate\u2026" rows="2"></textarea>
      <button class="chat-send" id="chatSend" onclick="sendChat()">\u2192</button>
    </div>
    <div class="chat-panel-foot" id="chatFoot" style="display:none">
      <button class="chat-clear-btn" onclick="clearChatHistory()">Clear history</button>
    </div>
  </aside>

  <!-- SAVED ARTICLES FAB -->
  <button class="saved-fab" id="savedFab" onclick="toggleSaved()" title="Saved articles (B)">
    <span class="saved-fab-icon">\u2605</span>
    <span class="saved-fab-count" id="savedFabCount"></span>
  </button>

  <!-- SAVED ARTICLES PANEL -->
  <aside class="saved-panel" id="savedPanel">
    <div class="saved-panel-head">
      <div class="saved-head-left">
        <span class="saved-head-icon">\u2605</span>
        <div>
          <div class="saved-head-title">Saved Articles</div>
          <div class="saved-head-count" id="savedHeadCount">No saved articles</div>
        </div>
      </div>
      <button class="saved-close-btn" onclick="closeSaved()" title="Close">\u2715</button>
    </div>
    <div class="saved-body" id="savedBody">
      <div class="saved-empty" id="savedEmpty">
        <div class="saved-empty-icon">\u2605</div>
        <p><strong>No saved articles yet.</strong><br>Click the star on any story to save it here.</p>
      </div>
    </div>
    <div class="saved-panel-foot" id="savedPanelFoot" style="display:none">
      <button class="saved-export-btn" onclick="exportSaved()">\u2193 Export saved</button>
      <button class="saved-clear-btn" onclick="clearAllSaved()">Clear all</button>
    </div>
  </aside>

  <!-- BACK TO TOP -->
  <button class="back-top" id="backTop" onclick="scrollToContentTop()" title="Back to top">\u2191</button>

  <footer class="page-footer">
    <div class="footer-inner">
      <div class="footer-icon">I.</div>
      <div class="footer-meta">
        Morning Briefing \u00B7 ${dateLabel}<br>
        Compiled at ${timeCET} CET by parallel AI research agents \u00B7 ${activeSections.length} sections
      </div>
      <div class="footer-links">
        <a href="${appUrl}/preferences.html?id=${client.id}">Manage preferences</a>
        <a href="#">View archive</a>
        <a href="${appUrl}/admin.html">Admin ↗</a>
      </div>
    </div>
  </footer>

  <script>
    const SECTION_IDS   = ${SECTION_IDS_JSON};
    const SECTION_NAMES = ${SECTION_NAMES_JSON};
    ${TEMPLATE_SCRIPT}
  </script>

  <script>
    // ── Briefing Chat Panel ───────────────────────────────────────────
    const CHAT_CLIENT_ID = '${client.id}';
    const CHAT_STORE_KEY = 'chat_history_' + CHAT_CLIENT_ID;

    let chatOpen = false;

    function toggleChat() {
      chatOpen = !chatOpen;
      document.getElementById('chatPanel').classList.toggle('open', chatOpen);
      if (chatOpen) {
        loadChatHistory();
        setTimeout(() => document.getElementById('chatInput').focus(), 320);
      }
    }

    function loadChatHistory() {
      const msgs = JSON.parse(localStorage.getItem(CHAT_STORE_KEY) || '[]');
      if (msgs.length === 0) return;
      document.getElementById('chatEmpty').style.display = 'none';
      document.getElementById('chatFoot').style.display = '';
      const body = document.getElementById('chatBody');
      body.innerHTML = '';
      msgs.forEach(m => appendMessage(m.role, m.text, m.time, false));
      body.scrollTop = body.scrollHeight;
    }

    function appendMessage(role, text, time, save = true) {
      const body = document.getElementById('chatBody');
      document.getElementById('chatEmpty').style.display = 'none';
      const wrapper = document.createElement('div');
      wrapper.className = 'chat-msg ' + role;
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      bubble.textContent = text;
      const ts = document.createElement('div');
      ts.className = 'chat-msg-time';
      ts.textContent = time || new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      wrapper.appendChild(bubble);
      wrapper.appendChild(ts);
      body.appendChild(wrapper);
      body.scrollTop = body.scrollHeight;
      if (save) {
        const msgs = JSON.parse(localStorage.getItem(CHAT_STORE_KEY) || '[]');
        msgs.push({ role, text, time: ts.textContent });
        localStorage.setItem(CHAT_STORE_KEY, JSON.stringify(msgs.slice(-40)));
        document.getElementById('chatFoot').style.display = '';
      }
    }

    function appendChip(type, text) {
      const body = document.getElementById('chatBody');
      const wrapper = document.createElement('div');
      wrapper.className = 'chat-msg ai';
      const chip = document.createElement('span');
      chip.className = 'chat-chip ' + type;
      chip.textContent = text;
      wrapper.appendChild(chip);
      body.appendChild(wrapper);
      body.scrollTop = body.scrollHeight;
    }

    function showTyping() {
      const body = document.getElementById('chatBody');
      const wrapper = document.createElement('div');
      wrapper.className = 'chat-msg ai';
      wrapper.id = 'chatTyping';
      const dots = document.createElement('div');
      dots.className = 'chat-typing';
      dots.innerHTML = '<span class="chat-dot"></span><span class="chat-dot"></span><span class="chat-dot"></span>';
      wrapper.appendChild(dots);
      body.appendChild(wrapper);
      body.scrollTop = body.scrollHeight;
    }

    function removeTyping() {
      const el = document.getElementById('chatTyping');
      if (el) el.remove();
    }

    async function sendChat() {
      const input = document.getElementById('chatInput');
      const sendBtn = document.getElementById('chatSend');
      const msg = input.value.trim();
      if (!msg) {
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 400);
        return;
      }
      appendMessage('user', msg);
      input.value = '';
      input.disabled = true;
      sendBtn.disabled = true;
      sendBtn.textContent = '\u27F3';
      showTyping();
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: CHAT_CLIENT_ID, message: msg }),
        });
        const data = await res.json();
        removeTyping();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        appendMessage('ai', data.reply);
        if (data.saved) {
          setTimeout(() => appendChip('success', '\u2713 Saved \u2014 your next briefing will reflect this'), 350);
        }
      } catch (err) {
        removeTyping();
        appendChip('error', '\u26A0 Something went wrong \u2014 please try again');
      } finally {
        input.disabled = false;
        sendBtn.disabled = false;
        sendBtn.textContent = '\u2192';
        input.focus();
      }
    }

    function clearChatHistory() {
      localStorage.removeItem(CHAT_STORE_KEY);
      const body = document.getElementById('chatBody');
      body.innerHTML = '<div class="chat-empty" id="chatEmpty"><div class="chat-empty-icon">\u2726</div><p><strong>Customise your next briefing.</strong><br>Tell me what to add, remove, or focus on.</p></div>';
      document.getElementById('chatFoot').style.display = 'none';
    }

    // ── CONTINUOUS SCROLL — override template's tab-switch with smooth scroll ──
    // Placed here (before the IIFE) so even if the IIFE throws, nav still works.
    window.showSection = function(newIdx) {
      if (newIdx < 0 || newIdx >= SECTION_IDS.length) return;
      const el = document.getElementById(SECTION_IDS[newIdx]);
      if (!el) return;
      const mastH  = document.querySelector('.masthead')?.offsetHeight  || 0;
      const sigH   = document.querySelector('.signals-bar')?.offsetHeight || 0;
      const navH   = document.querySelector('.sec-nav')?.offsetHeight   || 0;
      const offset = mastH + sigH + navH + 12;
      const y = el.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
      currentIdx = newIdx;
      updateUI();
      _updateMobNav(newIdx);
    };
    // Replace each nav pill with a CLONE (strips all template addEventListener listeners)
    // then attach a fresh click handler for smooth-scroll. This is the only reliable
    // way to remove event listeners added by the template script.
    try {
      document.querySelectorAll('.nav-pill[data-sec]').forEach(function(pill) {
        var fresh = pill.cloneNode(true);
        fresh.addEventListener('click', function() {
          var idx = SECTION_IDS.indexOf(this.dataset.sec);
          if (idx !== -1) window.showSection(idx);
        });
        if (pill.parentNode) pill.parentNode.replaceChild(fresh, pill);
      });
    } catch (e) { console.warn('[Intelio] Nav pill setup:', e); }

    // ── Save (bookmark) articles ─────────────────────────────────────────────
    const SAVED_STORE_KEY = 'saved_articles_' + CHAT_CLIENT_ID;
    let savedOpen = false;

    // Inject save buttons onto every story article at page-load
    // Wrapped in try-catch so a failure here never blocks nav/keyboard/scroll setup below.
    try {
      document.querySelectorAll('article.story-lead, article.story-card').forEach((art, idx) => {
        const btn = document.createElement('button');
        btn.className = 'art-save-btn';
        btn.dataset.idx = idx;
        btn.onclick = function() { toggleSaveArticle(idx); };
        btn.innerHTML = '<span class="save-star">\u2606</span> Save';
        try {
          const src = art.querySelector('.story-src');
          if (src) src.insertAdjacentElement('beforebegin', btn);
          else art.appendChild(btn);
        } catch (_) { art.appendChild(btn); }
      });
      refreshSaveButtons();
    } catch (e) { console.warn('[Intelio] Save button injection failed:', e); }

    function getSavedArticles() {
      return JSON.parse(localStorage.getItem(SAVED_STORE_KEY) || '[]');
    }
    function setSavedArticles(arr) {
      localStorage.setItem(SAVED_STORE_KEY, JSON.stringify(arr));
    }

    function toggleSaveArticle(idx) {
      const arts = document.querySelectorAll('article.story-lead, article.story-card');
      const art = arts[idx];
      if (!art) return;

      const hl   = art.querySelector('.story-hl')?.textContent?.trim() || '';
      const body = art.querySelector('.story-body')?.textContent?.trim() || '';
      const tag  = art.querySelector('.story-tag')?.textContent?.trim() || '';
      const src  = art.querySelector('.story-src')?.textContent?.replace('\u2192','').trim() || '';
      const href = art.querySelector('.story-src')?.href || '#';

      const saved = getSavedArticles();
      const existingIndex = saved.findIndex(s => s.idx === idx);

      if (existingIndex >= 0) {
        saved.splice(existingIndex, 1);
      } else {
        saved.push({ idx, hl, body, tag, src, href, savedAt: new Date().toISOString() });
      }
      setSavedArticles(saved);
      refreshSaveButtons();
      renderSavedPanel();
    }

    function refreshSaveButtons() {
      const saved = getSavedArticles();
      const savedIdxs = new Set(saved.map(s => s.idx));
      document.querySelectorAll('.art-save-btn').forEach(btn => {
        const idx = Number(btn.dataset.idx);
        const isSaved = savedIdxs.has(idx);
        btn.classList.toggle('saved', isSaved);
        btn.innerHTML = isSaved
          ? '<span class="save-star">\u2605</span> Saved'
          : '<span class="save-star">\u2606</span> Save';
      });
      const count = saved.length;
      const countEl = document.getElementById('savedFabCount');
      if (countEl) {
        countEl.textContent = count;
        countEl.classList.toggle('visible', count > 0);
      }
      const headCount = document.getElementById('savedHeadCount');
      if (headCount) headCount.textContent = count === 0 ? 'No saved articles' : (count + ' article' + (count !== 1 ? 's' : '') + ' saved');
      const foot = document.getElementById('savedPanelFoot');
      if (foot) foot.style.display = count > 0 ? '' : 'none';
    }

    function renderSavedPanel() {
      const saved = getSavedArticles();
      const body  = document.getElementById('savedBody');
      const empty = document.getElementById('savedEmpty');
      if (!body) return;
      if (saved.length === 0) {
        body.innerHTML = '<div class="saved-empty" id="savedEmpty"><div class="saved-empty-icon">\u2605</div><p><strong>No saved articles yet.</strong><br>Click the star on any story to save it here.</p></div>';
        return;
      }
      body.innerHTML = saved.map((s, i) =>
        '<div class="saved-item">' +
          '<div class="saved-item-tag">' + s.tag + '</div>' +
          '<div class="saved-item-hl">' + s.hl + '</div>' +
          '<div class="saved-item-body">' + s.body + '</div>' +
          '<div class="saved-item-foot">' +
            '<span class="saved-item-src">' + s.src + '</span>' +
            '<button class="saved-item-remove" onclick="removeSavedAt(' + i + ')">\u2715 Remove</button>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    function removeSavedAt(i) {
      const saved = getSavedArticles();
      if (i >= 0 && i < saved.length) {
        saved.splice(i, 1);
        setSavedArticles(saved);
        refreshSaveButtons();
        renderSavedPanel();
      }
    }

    function toggleSaved() {
      savedOpen ? closeSaved() : openSaved();
    }
    function openSaved() {
      savedOpen = true;
      renderSavedPanel();
      document.getElementById('savedPanel').classList.add('open');
    }
    function closeSaved() {
      savedOpen = false;
      document.getElementById('savedPanel').classList.remove('open');
    }

    function exportSaved() {
      const saved = getSavedArticles();
      if (!saved.length) return;
      const text = saved.map((s, i) =>
        (i + 1) + '. ' + s.tag + '\n' + s.hl + '\n\n' + s.body + '\n\nSource: ' + s.src + '\n' + '\u2500'.repeat(60)
      ).join('\n\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'intelio-saved-articles.txt';
      a.click(); URL.revokeObjectURL(url);
    }

    function clearAllSaved() {
      setSavedArticles([]);
      refreshSaveButtons();
      renderSavedPanel();
    }

    // ── Mobile section nav (bottom drawer) ───────────────────────────────────
    let _mobNavOpen = false;

    function _updateMobNav(idx) {
      const name = document.getElementById('mobSecName');
      if (name) name.textContent = SECTION_NAMES[idx] || '';
      document.querySelectorAll('.mob-sec-item').forEach((el, i) => {
        el.classList.toggle('active', i === idx);
      });
    }

    function toggleMobNav() {
      _mobNavOpen ? closeMobNav() : openMobNav();
    }

    function openMobNav() {
      _mobNavOpen = true;
      const drawer = document.getElementById('mobSecDrawer');
      drawer.classList.add('open');
      document.querySelectorAll('.mob-sec-item').forEach((el, i) => {
        el.classList.toggle('active', i === currentIdx);
      });
    }

    function closeMobNav() {
      _mobNavOpen = false;
      document.getElementById('mobSecDrawer').classList.remove('open');
    }

    function mobNavSelect(idx) {
      closeMobNav();
      showSection(idx);
    }

    // Track which section is in view as the user scrolls
    const _ssEls = SECTION_IDS.map(id => document.getElementById(id)).filter(Boolean);
    let _ssTick = false;
    window.addEventListener('scroll', () => {
      if (_ssTick) return;
      _ssTick = true;
      requestAnimationFrame(() => {
        _ssTick = false;
        const mastH  = document.querySelector('.masthead')?.offsetHeight  || 0;
        const sigH   = document.querySelector('.signals-bar')?.offsetHeight || 0;
        const navH   = document.querySelector('.sec-nav')?.offsetHeight   || 0;
        const threshold = mastH + sigH + navH + 60;
        let ai = 0;
        _ssEls.forEach((el, i) => {
          if (el && el.getBoundingClientRect().top <= threshold) ai = i;
        });
        if (ai !== currentIdx) { currentIdx = ai; updateUI(); _updateMobNav(ai); }
      });
    }, { passive: true });

    // Keyboard shortcuts — chat, saved panel, mobile nav (section keys: template script)
    document.addEventListener('keydown', e => {
      const tag = document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'C') toggleChat();
      if (e.key === 'B') toggleSaved();
      if (e.key === 'Escape') {
        if (chatOpen) toggleChat();
        if (savedOpen) closeSaved();
        if (_mobNavOpen) closeMobNav();
      }
    });
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement === document.getElementById('chatInput')) {
        sendChat();
      }
    });
  </script>

</body>
</html>`;
}
