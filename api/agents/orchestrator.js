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
export function assembleBriefing({ client, today, orchestratorHtml, sectionHtmls, enabledSections }) {
  const { h01, h02, h03, h04, h05, h06 } = sectionHtmls;
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
  const agentSections = activeSections.map(s => {
    const html = htmlByAgent[s.agent];
    return `
    <section class="bsec" id="${s.slug}">
      <div class="sec-head">
        <div class="sec-title-row">
          <h2 class="sec-title">${s.name}</h2>
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
</head>
<body>

  <div id="progress"></div>

  <header class="masthead">
    <div class="masthead-left">
      <span class="edition-tag">${client.client_name}</span>
    </div>
    <div class="masthead-center">
      <div class="wordmark">Intel<span class="io">io</span>.</div>
      <div class="masthead-byline">Personalised intelligence for <strong>${client.client_name}</strong></div>
    </div>
    <div class="masthead-right">
      <span class="masthead-date">${dateLabel}</span>
      <button class="theme-btn" id="themeBtn" title="Switch to dark mode">\u263D</button>
      <button class="print-btn" onclick="window.print()">\u2193 Save PDF</button>
    </div>
  </header>

  <div class="signals-bar">
    <div class="signals-inner">
      <span class="signals-ts">Generated ${timeCET} CET \u00B7 ${dateLabel}</span>
    </div>
  </div>

  <nav class="sec-nav" id="secNav">
    <div class="sec-nav-inner">
      ${navPills}
      <div class="sec-counter-wrap">
        <span class="sec-counter" id="secCounter">
          1&thinsp;/&thinsp;${allSections.length} &nbsp;\u00B7&nbsp; <span class="counter-name">Executive Summary</span>
        </span>
      </div>
    </div>
  </nav>

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
        <a href="#">Manage preferences</a>
        <a href="#">View archive</a>
      </div>
    </div>
  </footer>

  <script>
    const SECTION_IDS   = ${SECTION_IDS_JSON};
    const SECTION_NAMES = ${SECTION_NAMES_JSON};
    ${TEMPLATE_SCRIPT}
  </script>

</body>
</html>`;
}
