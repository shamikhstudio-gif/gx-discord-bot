/* ══════════════════════════════════════════════════════
   GX eSports Operations Center — Real-Time Client
   ══════════════════════════════════════════════════════ */

/* Auto-detect API base: if opened as file:// → use localhost:3000 */
const API_BASE = (location.protocol === 'file:' || location.hostname === '')
  ? 'http://localhost:3000'
  : window.location.origin;
const API = API_BASE + '/api/status';
const POLL_MS = 4000;

const VCR_STATIC = [
  { num: 1, id: '1539231767683137646', channel: '#『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟏', executive: false },
  { num: 2, id: '1539241189629362246', channel: '#🔒・فويس الإدارة',           executive: true  },
  { num: 3, id: '1539241414318227466', channel: '#『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟐', executive: false },
  { num: 4, id: '1539241621328101497', channel: '#『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟑', executive: false },
  { num: 5, id: '1539241867105927209', channel: '#『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟒', executive: false },
];

/* ─── Sparkline ring buffer ─── */
class RingBuffer {
  constructor(size) { this.size = size; this.buf = []; }
  push(v) { this.buf.push(v); if (this.buf.length > this.size) this.buf.shift(); }
  get data() { return this.buf; }
}

const pingHistory   = new RingBuffer(30);
const memHistory    = new RingBuffer(30);
const chartPingData = new RingBuffer(60);
const chartMemData  = new RingBuffer(60);

/* ─── State ─── */
let prevPing = null;
let prevMem  = null;

/* ══════════════════════════════════════════════════════
   DOM REFS (assigned after DOMContentLoaded)
   ══════════════════════════════════════════════════════ */
let $;
document.addEventListener('DOMContentLoaded', () => {
  $ = id => document.getElementById(id);

  /* Build VCR Fleet */
  buildVcrGrid();

  /* Start clock */
  startClock();

  /* Nav scroll active */
  initNavHighlight();

  /* API URL display — always show full localhost URL */
  $('apiUrlDisplay').textContent = API;

  /* Copy btn */
  $('copyApiBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.origin + '/api/status').then(() => {
      $('copyApiBtn').textContent = 'Copied!';
      setTimeout(() => { $('copyApiBtn').textContent = 'Copy'; }, 2000);
    });
  });

  /* Refresh btn */
  $('refreshBtn').addEventListener('click', () => {
    $('refreshBtn').classList.add('spin');
    fetchStatus().finally(() => {
      setTimeout(() => $('refreshBtn').classList.remove('spin'), 700);
    });
  });

  /* Clear log btn */
  $('clearLog').addEventListener('click', () => {
    $('eventLog').innerHTML = '';
  });

  /* Chart canvases */
  initChartCanvases();

  /* First fetch + poll */
  fetchStatus();
  setInterval(fetchStatus, POLL_MS);
});

/* ══════════════════════════════════════════════════════
   CLOCK
   ══════════════════════════════════════════════════════ */
function startClock() {
  function tick() {
    const now = new Date();
    const hh = now.getUTCHours().toString().padStart(2, '0');
    const mm = now.getUTCMinutes().toString().padStart(2, '0');
    const ss = now.getUTCSeconds().toString().padStart(2, '0');
    $('navClock').textContent = `${hh}:${mm}:${ss} UTC`;
  }
  tick();
  setInterval(tick, 1000);
}

/* ══════════════════════════════════════════════════════
   NAV HIGHLIGHT ON SCROLL
   ══════════════════════════════════════════════════════ */
function initNavHighlight() {
  const sections = ['overview', 'servers', 'vcr', 'analytics', 'security'];
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        const link = document.querySelector(`.nav-link[data-section="${e.target.id}"]`);
        if (link) link.classList.add('active');
      }
    });
  }, { threshold: 0.4 });
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

/* ══════════════════════════════════════════════════════
   BUILD VCR GRID
   ══════════════════════════════════════════════════════ */
function buildVcrGrid() {
  const grid = $('vcrGrid');
  if (!grid) return;
  grid.innerHTML = VCR_STATIC.map(v => `
    <div class="vcr-card ${v.executive ? 'executive' : ''}" id="vcrCard${v.num}">
      <div class="vcr-top">
        <div class="vcr-num">VCR #${v.num}</div>
        <div class="vcr-status-dot" id="vcrDot${v.num}"></div>
      </div>
      <div class="vcr-name">
        GX VCR #${v.num}
        ${v.executive ? '<span class="exec-badge">EXEC</span>' : ''}
      </div>
      <div class="vcr-id">${v.id}</div>
      <div class="vcr-channel-label">Assigned Channel</div>
      <div class="vcr-channel-name" id="vcrCh${v.num}">${v.channel}</div>
      <div class="vcr-tags">
        <span class="vtag green">🎙️ Recording</span>
        ${v.executive ? '<span class="vtag gold">👑 Executive</span>' : '<span class="vtag">OGG Archive</span>'}
      </div>
    </div>
  `).join('');
}

/* ══════════════════════════════════════════════════════
   CHART CANVASES
   ══════════════════════════════════════════════════════ */
const chartCtxPing = {};
const chartCtxMem  = {};

function initChartCanvases() {
  /* Sparklines (KPI strip) — drawn via drawSparkline() on each update */
  /* Main charts */
  chartCtxPing.canvas = $('chartPing');
  chartCtxMem.canvas  = $('chartMem');
}

function drawSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (data.length < 2) return;

  const min = Math.min(...data);
  const max = Math.max(...data) || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - ((v - min) / (max - min || 1)) * (H - 4) - 2
  }));

  /* Gradient fill */
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color + '40');
  grad.addColorStop(1, color + '00');

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(mx, pts[i - 1].y, mx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  /* Line */
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(mx, pts[i - 1].y, mx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawFullChart(canvasEl, data, color, label) {
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');
  const W = canvasEl.offsetWidth || 300;
  const H = canvasEl.height || 90;
  canvasEl.width = W;
  ctx.clearRect(0, 0, W, H);
  if (data.length < 2) return;

  const min = Math.min(...data);
  const max = Math.max(...data) || 1;
  const pad = 8;
  const pts = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * (W - pad * 2),
    y: pad + (H - pad * 2) - ((v - min) / (max - min || 1)) * (H - pad * 2)
  }));

  /* Grid lines */
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (i / 4) * (H - pad * 2);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  }

  /* Fill */
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color + '30');
  grad.addColorStop(1, color + '00');
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(mx, pts[i - 1].y, mx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.lineTo(pts[pts.length - 1].x, H);
  ctx.lineTo(pts[0].x, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  /* Line */
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i - 1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(mx, pts[i - 1].y, mx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  /* Last dot */
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/* ══════════════════════════════════════════════════════
   FORMAT HELPERS
   ══════════════════════════════════════════════════════ */
function fmtUptime(s) {
  if (s == null) return '--';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
}

function fmtTime() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function setEl(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

/* ══════════════════════════════════════════════════════
   EVENT LOG
   ══════════════════════════════════════════════════════ */
function addLog(msg, type = 'info') {
  const log = $('eventLog');
  if (!log) return;
  const li = document.createElement('li');
  li.className = `log-item log-${type}`;
  li.textContent = `[${fmtTime()}] ${msg}`;
  log.prepend(li);
  /* Keep max 50 */
  while (log.children.length > 50) log.lastChild.remove();
}

/* ══════════════════════════════════════════════════════
   UPTIME GAUGE
   ══════════════════════════════════════════════════════ */
function updateGauge(uptimeSec) {
  const maxSec = 7 * 24 * 3600; // 1 week = 100%
  const pct = Math.min(uptimeSec / maxSec, 1);
  const ARC = 173;
  const fill = $('gaugeFill');
  const label = $('gaugeLabel');
  if (fill) fill.style.strokeDashoffset = ARC * (1 - pct);
  if (label) label.textContent = (pct * 100).toFixed(1) + '%';
}

/* ══════════════════════════════════════════════════════
   FETCH & UPDATE
   ══════════════════════════════════════════════════════ */
async function fetchStatus() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();

    /* ── Overall pill ── */
    const pill = $('overallPill');
    const dot  = $('pillDot');
    const pillText = $('pillText');
    if (d.status === 'operational') {
      dot.className = 'pill-dot online';
      if (pillText) pillText.textContent = 'All Systems Operational';
    } else {
      dot.className = 'pill-dot warning';
      if (pillText) pillText.textContent = 'Degraded';
    }

    /* ── Last updated ── */
    setEl('lastUpdated', 'Last updated: ' + new Date().toLocaleTimeString());

    /* ── Ping ── */
    const ping = d.ping || 0;
    setEl('valPing', ping);
    setEl('mainPingLabel', ping + ' ms');
    setEl('discordWsPing', ping + ' ms');
    setEl('chartPingVal', ping + ' ms');

    /* Ping bar (100ms = 100%) */
    const pingPct = Math.min((ping / 200) * 100, 100);
    const pingBar = $('mainPingBar');
    if (pingBar) pingBar.style.width = (100 - pingPct) + '%'; /* inverted — lower is better */

    /* Latency label & bar */
    const discBar = $('discordLatencyBar');
    const discLabel = $('discordLatencyLabel');
    if (discBar) discBar.style.width = (100 - pingPct) + '%';
    if (discLabel) discLabel.textContent = ping < 60 ? '⚡ Excellent' : ping < 120 ? '✓ Good' : '⚠ Fair';

    /* Ping trend */
    const trendPing = $('trendPing');
    if (trendPing) {
      if (prevPing !== null) {
        const delta = ping - prevPing;
        trendPing.textContent = delta > 0 ? `↑ +${delta}ms` : delta < 0 ? `↓ ${delta}ms` : '→ Stable';
        trendPing.style.color = delta > 20 ? '#f59e0b' : delta < -5 ? '#22c55e' : '#64748b';
      } else { trendPing.textContent = ''; }
    }
    prevPing = ping;
    pingHistory.push(ping);
    chartPingData.push(ping);
    addLog(`Ping: ${ping}ms`, ping < 80 ? 'ok' : ping < 150 ? 'info' : 'warn');

    /* ── Uptime ── */
    const up = d.uptimeSeconds || 0;
    setEl('valUptime', fmtUptime(up));
    setEl('cloudUptimeLabel', fmtUptime(up));
    const uptimePct = Math.min((up / (60 * 60)) * 100, 100); // 1hr = 100% for bar
    const cloudBar = $('cloudUptimeBar');
    if (cloudBar) cloudBar.style.width = uptimePct + '%';
    updateGauge(up);

    /* ── Memory ── */
    if (d.memory) {
      const heapMB = Math.round(d.memory.heapUsed / 1024 / 1024);
      const rss    = Math.round(d.memory.rss / 1024 / 1024);
      setEl('valMemory', heapMB);
      setEl('mainMemLabel', heapMB + ' MB');
      setEl('chartMemVal', heapMB + ' MB');
      const memPct = Math.min((heapMB / 512) * 100, 100); /* 512MB = 100% */
      const memBar = $('mainMemBar');
      if (memBar) memBar.style.width = memPct + '%';

      const trendMem = $('trendMemory');
      if (trendMem) {
        if (prevMem !== null) {
          const delta = heapMB - prevMem;
          trendMem.textContent = delta > 0 ? `↑ +${delta}MB` : delta < 0 ? `↓ ${delta}MB` : '→ Stable';
          trendMem.style.color = delta > 30 ? '#f59e0b' : '#64748b';
        } else { trendMem.textContent = ''; }
      }
      prevMem = heapMB;
      memHistory.push(heapMB);
      chartMemData.push(heapMB);
    }

    /* ── Guild / Members ── */
    if (d.guild) {
      setEl('valMembers', (d.guild.memberCount || 0).toLocaleString());
      setEl('mainGuildName', d.guild.name || '𝑮𝑿 𝒆𝑺𝒑𝒐𝒓𝒕𝒔');
    }

    /* ── Main Bot ── */
    if (d.mainBot) {
      setEl('mainBotTag', d.mainBot.tag || 'GX Bot#3131');
      setEl('mainBotId', d.mainBot.id || '1507671146487742464');
      setEl('mainVersion', 'v' + (d.mainBot.version || '1.0'));
      setEl('mainCmdCount', (d.mainBot.commandsCount || 42) + ' Slash');
    }

    /* ── VCR Fleet ── */
    let vcrOnline = 0;
    if (d.vcrFleet && Array.isArray(d.vcrFleet)) {
      d.vcrFleet.forEach((vcr, i) => {
        const num = i + 1;
        const online = vcr.status === 'online';
        if (online) vcrOnline++;
        const dot = $(`vcrDot${num}`);
        if (dot) {
          dot.style.background = online ? '#22c55e' : '#ef4444';
          dot.style.boxShadow  = online
            ? '0 0 0 2px rgba(34,197,94,0.2)'
            : '0 0 0 2px rgba(239,68,68,0.2)';
        }
        const ch = $(`vcrCh${num}`);
        if (ch && vcr.defaultChannelName) {
          ch.textContent = '#' + vcr.defaultChannelName;
        }
      });
    } else { vcrOnline = 5; }
    setEl('valVcrOnline', vcrOnline);
    const vcrSummary = $('vcrSummary');
    if (vcrSummary) {
      vcrSummary.textContent = vcrOnline === 5 ? 'All Sentinels Online' : `${vcrOnline}/5 Online`;
      vcrSummary.className = 'section-badge ' + (vcrOnline === 5 ? 'green' : 'amber');
    }

    /* ── API Sample ── */
    const sampleEl = $('apiSample');
    if (sampleEl) {
      sampleEl.textContent = JSON.stringify({
        status: d.status,
        ping: d.ping,
        uptimeSeconds: d.uptimeSeconds,
        vcrFleet: (d.vcrFleet || []).length + ' nodes'
      }, null, 2);
    }

    /* ── Servers summary badge ── */
    setEl('serversSummary', '3 Nodes Online');

    /* ── Draw sparklines ── */
    drawSparkline('sparkPing',    pingHistory.data,  '#00c8ff');
    drawSparkline('sparkUptime',  [1,1,1,1],         '#22c55e');
    drawSparkline('sparkMem',     memHistory.data,   '#8b5cf6');
    drawSparkline('sparkMembers', [1,1,1,1],         '#00c8ff');
    drawSparkline('sparkVcr',     [1,1,1,1],         '#22c55e');

    /* ── Draw full charts ── */
    drawFullChart(chartCtxPing.canvas, chartPingData.data, '#00c8ff');
    drawFullChart(chartCtxMem.canvas,  chartMemData.data,  '#8b5cf6');

  } catch (err) {
    /* ── Graceful fallback: show demo data so page never freezes ── */
    const isFileOrigin = location.protocol === 'file:';
    addLog((isFileOrigin
      ? 'Open via http://localhost:3000 for live data — showing demo mode'
      : 'API unreachable: ' + err.message), 'warn');

    /* Only update pill on first real error, not on every poll */
    const dot  = $('pillDot');
    const text = $('pillText');
    if (dot)  dot.className   = 'pill-dot warning';
    if (text) text.textContent = isFileOrigin ? 'Demo Mode (open via localhost)' : 'API Unreachable';

    /* Show static demo values so UI looks correct */
    const demoPing = 42 + Math.floor(Math.random() * 20);
    setEl('valPing',    demoPing);
    setEl('mainPingLabel', demoPing + ' ms');
    setEl('discordWsPing', demoPing + ' ms');
    setEl('chartPingVal',  demoPing + ' ms');
    setEl('valUptime',  '0m 0s');
    setEl('valMemory',  '--');
    setEl('valMembers', '--');
    setEl('serversSummary', 'Demo Mode');
    setEl('lastUpdated', 'Demo mode · open http://localhost:3000 for live data');
    pingHistory.push(demoPing);
    chartPingData.push(demoPing);
    drawSparkline('sparkPing', pingHistory.data, '#00c8ff');
    drawFullChart(chartCtxPing.canvas, chartPingData.data, '#00c8ff');
  }
}
