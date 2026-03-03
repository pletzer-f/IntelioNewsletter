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

    @media print { .chat-fab, .chat-panel { display: none !important; } }
    @media (max-width: 600px) { .chat-panel { width: 100%; } .chat-fab { bottom: 20px; right: 20px; } }
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

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      const tag = document.activeElement.tagName;
      if (e.key === 'C' && !e.metaKey && !e.ctrlKey && !e.altKey && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        toggleChat();
      }
      if (e.key === 'Escape' && chatOpen) toggleChat();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && document.activeElement === document.getElementById('chatInput')) {
        sendChat();
      }
    });
  </script>

</body>
</html>`;
}
