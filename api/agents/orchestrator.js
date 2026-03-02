// api/agents/orchestrator.js — HTML assembly for the final briefing

/**
 * Assembles the complete Intelio briefing HTML from agent section outputs.
 * Wraps in the full Intelio brand shell (matching briefing-template.html style).
 */
export function assembleBriefing({ client, today, orchestratorHtml, sectionHtmls, enabledSections }) {
  const { h01, h02, h03, h04, h05, h06 } = sectionHtmls;
  const dateLabel = new Date(today).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const SECTIONS = [
    { id: 1, key: 'h01', icon: '📈', label: 'Macro & Markets',         html: h01 },
    { id: 2, key: 'h02', icon: '⚙️', label: 'Core Industry',           html: h02 },
    { id: 3, key: 'h03', icon: '🤝', label: 'Private Equity & M&A',    html: h03 },
    { id: 4, key: 'h04', icon: '📊', label: 'End-Market Demand',       html: h04 },
    { id: 5, key: 'h05', icon: '🏗️',  label: 'Assets & Capex',         html: h05 },
    { id: 6, key: 'h06', icon: '🏛️',  label: 'Local Policy',           html: h06 },
  ].filter(s => enabledSections.has(s.id) && s.html);

  const navDots = SECTIONS.map((s, i) =>
    `<button class="sec-dot${i === 0 ? ' active' : ''}" onclick="goTo(${i})" title="${s.label}"></button>`
  ).join('');

  const sectionBlocks = SECTIONS.map((s, i) => `
<section class="bsec${i === 0 ? ' active' : ''}" id="bsec-0${s.id}">
  <div class="sec-header">
    <span class="sec-icon">${s.icon}</span>
    <span class="sec-label">${s.label}</span>
    <span class="sec-count">${i + 1} / ${SECTIONS.length}</span>
  </div>
  <div class="sec-content">
    ${s.html}
  </div>
  <div class="sec-nav">
    ${i > 0 ? `<button class="sec-btn sec-prev" onclick="goTo(${i-1})">← Previous</button>` : '<span></span>'}
    <div class="sec-dots">${navDots}</div>
    ${i < SECTIONS.length - 1 ? `<button class="sec-btn sec-next" onclick="goTo(${i+1})">Next →</button>` : '<span></span>'}
  </div>
</section>`).join('\n');

  return `<!DOCTYPE html>
<html lang="${client.output_language || 'en'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Intelio · ${client.client_name} · ${dateLabel}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,800;1,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
/* ── Intelio Design Tokens (Option B — Paper Edition) ── */
:root {
  --cream:   #F9F8F5;
  --ink:     #1A1A1A;
  --crimson: #C41E3A;
  --surface: #FFFFFF;
  --border:  #E8E3DC;
  --text-2:  #6B6860;
  --accent:  #F5F0E8;
  --radius:  10px;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: 'Inter', sans-serif;
  background: var(--cream);
  color: var(--ink);
  min-height: 100vh;
}

/* ── Masthead ── */
.masthead {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  height: 76px;
  background: var(--ink);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 32px;
  border-bottom: 2px solid var(--crimson);
}
.wordmark {
  font-family: 'Playfair Display', serif;
  font-size: 34px; font-weight: 800;
  color: var(--cream); letter-spacing: -1px;
}
.wordmark span { color: var(--crimson); }
.masthead-meta { text-align: right; }
.masthead-client { color: var(--cream); font-size: 13px; font-weight: 600; }
.masthead-date   { color: var(--text-2); font-size: 11px; margin-top: 2px; }

/* ── Section nav ── */
.sec-nav-bar {
  position: fixed; top: 76px; left: 0; right: 0; z-index: 90;
  background: var(--surface); border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 8px;
  padding: 0 32px; height: 44px; overflow-x: auto;
}
.sec-tab {
  flex-shrink: 0; display: flex; align-items: center; gap: 6px;
  padding: 6px 14px; border-radius: 20px; border: 1px solid transparent;
  font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;
  background: none; color: var(--text-2);
}
.sec-tab:hover     { background: var(--accent); color: var(--ink); }
.sec-tab.active    { background: var(--ink); color: var(--cream); border-color: var(--ink); }

/* ── Main layout ── */
.main { margin-top: 120px; max-width: 860px; margin-left: auto; margin-right: auto; padding: 32px 24px 80px; }

/* ── Orchestrator blocks ── */
#exec-highlights, #key-themes {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 28px 32px; margin-bottom: 32px;
}
#exec-highlights h2, #key-themes h2 {
  font-family: 'Playfair Display', serif; font-size: 22px;
  margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid var(--border);
}

/* ── Section blocks ── */
.bsec { display: none; }
.bsec.active { display: block; animation: secEnter 0.35s cubic-bezier(.4,0,.2,1) both; }
@keyframes secEnter {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

.sec-header {
  display: flex; align-items: center; gap: 10px;
  margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid var(--border);
}
.sec-icon  { font-size: 20px; }
.sec-label { font-family: 'Playfair Display', serif; font-size: 22px; font-weight: 700; flex: 1; }
.sec-count { font-size: 12px; color: var(--text-2); }

/* ── Story cards ── */
.card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 28px; margin-bottom: 20px; position: relative;
  transition: box-shadow 0.2s;
}
.card:hover { box-shadow: 0 4px 20px rgba(0,0,0,0.07); }
.card-number { font-size: 11px; font-weight: 700; color: var(--crimson); letter-spacing: 0.1em; margin-bottom: 8px; }
.card-title  { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 700; line-height: 1.3; margin-bottom: 16px; }
.card-body   { font-size: 14px; line-height: 1.75; color: #333; }
.card-body strong { color: var(--ink); }
.card-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
.card-source { font-size: 11px; color: var(--text-2); }
.card-link   { font-size: 11px; color: var(--crimson); text-decoration: none; font-weight: 600; }
.card-link:hover { text-decoration: underline; }

/* ── Section footer nav ── */
.sec-nav {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 36px; padding-top: 24px; border-top: 1px solid var(--border);
}
.sec-btn {
  padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.2s; border: 1px solid var(--border);
  background: var(--surface); color: var(--ink);
}
.sec-btn:hover { background: var(--ink); color: var(--cream); border-color: var(--ink); }
.sec-dots { display: flex; gap: 6px; }
.sec-dot {
  width: 8px; height: 8px; border-radius: 50%; border: none; cursor: pointer;
  background: var(--border); transition: background 0.2s;
}
.sec-dot.active { background: var(--crimson); }
</style>
</head>
<body>

<!-- Masthead -->
<header class="masthead">
  <div class="wordmark">I<span>.</span></div>
  <div class="masthead-meta">
    <div class="masthead-client">${client.client_name}</div>
    <div class="masthead-date">${dateLabel}</div>
  </div>
</header>

<!-- Section tab nav -->
<nav class="sec-nav-bar">
  ${SECTIONS.map((s, i) =>
    `<button class="sec-tab${i === 0 ? ' active' : ''}" onclick="goTo(${i})">${s.icon} ${s.label}</button>`
  ).join('\n  ')}
</nav>

<!-- Main content -->
<main class="main">

  <!-- Orchestrator: Executive Highlights + Key Themes -->
  ${orchestratorHtml}

  <!-- Section briefings -->
  ${sectionBlocks}

</main>

<script>
let current = 0;
const sections = document.querySelectorAll('.bsec');
const tabs     = document.querySelectorAll('.sec-tab');
const dots     = document.querySelectorAll('.sec-dot');

function goTo(idx) {
  if (idx < 0 || idx >= sections.length) return;
  sections[current].classList.remove('active');
  tabs[current].classList.remove('active');
  current = idx;
  sections[current].classList.add('active');
  tabs[current].classList.add('active');
  dots.forEach((d, i) => d.classList.toggle('active', i === current));
  window.scrollTo({ top: 120, behavior: 'smooth' });
}

document.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') goTo(current + 1);
  if (e.key === 'ArrowLeft')  goTo(current - 1);
});
</script>

</body>
</html>`;
}
