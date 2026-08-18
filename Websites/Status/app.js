/* ══════════════════════════════════════════════════════
   GX eSports Operations Center — Real-Time SSE Client
   Server pushes data every 500ms via EventSource
   ══════════════════════════════════════════════════════ */

/* Auto-detect API base: if opened as file:// → use localhost:3000 */
const API_BASE = (location.protocol === 'file:' || location.hostname === '')
  ? 'http://localhost:3000'
  : window.location.origin;
const API_STREAM = API_BASE + '/api/stream';
const API_STATUS = API_BASE + '/api/status';

const VCR_STATIC = [
  { num: 1, id: '1539231767683137646', channel: '#『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟏', executive: false },
  { num: 2, id: '1539241189629362246', channel: '#🔒・فويس الإدارة',           executive: true  },
  { num: 3, id: '1539241414318227466', channel: '#『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟐', executive: false },
  { num: 4, id: '1539241621328101497', channel: '#『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟑', executive: false },
  { num: 5, id: '1539241867105927209', channel: '#『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟒', executive: false },
];

/* ─── Ring buffer for chart history ─── */
class RingBuffer {
  constructor(size) { this.size = size; this.buf = []; }
  push(v) { this.buf.push(v); if (this.buf.length > this.size) this.buf.shift(); }
  get data() { return this.buf; }
}

const pingHistory  = new RingBuffer(30);
const memHistory   = new RingBuffer(30);
const pingChart    = new RingBuffer(60);
const memChart     = new RingBuffer(60);
const uptimeChart  = new RingBuffer(60);

let prevPing = null;
let prevMem  = null;
let frameCount = 0;

/* ─── Uptime counter running client-side (increments every second) ─── */
let lastKnownUptimeSec = 0;
let lastUptimeReceivedAt = 0;

/* ══════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════ */
let $;
document.addEventListener('DOMContentLoaded', () => {
  $ = id => document.getElementById(id);

  buildVcrGrid();
  startClock();
  initNavHighlight();
  $('apiUrlDisplay').textContent = API_STATUS;

  $('copyApiBtn').addEventListener('click', () => {
    navigator.clipboard.writeText(API_STATUS).then(() => {
      $('copyApiBtn').textContent = 'Copied!';
      setTimeout(() => { $('copyApiBtn').textContent = 'Copy'; }, 2000);
    });
  });

  $('refreshBtn').addEventListener('click', () => {
    $('refreshBtn').classList.add('spin');
    reconnect();
    setTimeout(() => $('refreshBtn').classList.remove('spin'), 700);
  });

  $('clearLog').addEventListener('click', () => { $('eventLog').innerHTML = ''; });

  initCharts();
  connectSSE();

  /* Client-side uptime ticker — increments every second between server pushes */
  setInterval(() => {
    if (lastUptimeReceivedAt === 0) return;
    const elapsed = Math.floor((Date.now() - lastUptimeReceivedAt) / 1000);
    const live = lastKnownUptimeSec + elapsed;
    setEl('valUptime', fmtUptime(live));
    setEl('cloudUptimeLabel', fmtUptime(live));
  }, 1000);
});

/* ══════════════════════════════════════════════════════
   SSE CONNECTION
   ══════════════════════════════════════════════════════ */
let sseSource = null;
let reconnectTimer = null;
let sseConnected = false;

function connectSSE() {
  if (sseSource) { sseSource.close(); sseSource = null; }
  clearTimeout(reconnectTimer);

  setPillState('connecting', 'Connecting…');
  addLog('Opening real-time stream (SSE)…', 'info');

  sseSource = new EventSource(API_STREAM);

  sseSource.onopen = () => {
    sseConnected = true;
    setPillState('online', 'Live Stream Active');
    addLog('✅ Real-time stream connected — updates every 500ms', 'ok');
  };

  sseSource.onmessage = (event) => {
    try {
      const d = JSON.parse(event.data);
      processData(d);
    } catch (e) {
      addLog('Parse error: ' + e.message, 'error');
    }
  };

  sseSource.onerror = () => {
    sseConnected = false;
    sseSource.close();
    sseSource = null;
    setPillState('warning', 'Reconnecting…');
    addLog('Stream interrupted — retrying in 3s…', 'warn');
    reconnectTimer = setTimeout(connectSSE, 3000);
  };
}

function reconnect() {
  addLog('Manual reconnect requested…', 'info');
  connectSSE();
}

/* ══════════════════════════════════════════════════════
   DATA PROCESSOR  (called on every SSE message = ~500ms)
   ══════════════════════════════════════════════════════ */
function processData(d) {
  frameCount++;

  /* ── Overall pill ── */
  if (d.status === 'operational') {
    setPillState('online', 'Live · ' + formatTimestamp(d.timestamp));
  }

  /* ── Last updated ── */
  setEl('lastUpdated', 'Updated: ' + new Date().toLocaleTimeString('en-GB', { hour12: false }));

  /* ── Ping ── */
  const ping = d.ping || 0;
  setEl('valPing',      ping);
  setEl('mainPingLabel',  ping + ' ms');
  setEl('discordWsPing',  ping + ' ms');
  setEl('chartPingVal',   ping + ' ms');

  const pingPct  = Math.min((ping / 200) * 100, 100);
  setBarWidth('mainPingBar',       100 - pingPct);
  setBarWidth('discordLatencyBar', 100 - pingPct);
  setEl('discordLatencyLabel', ping < 60 ? '⚡ Excellent' : ping < 120 ? '✓ Good' : '⚠ Fair');

  const trendPingEl = $('trendPing');
  if (trendPingEl && prevPing !== null) {
    const d2 = ping - prevPing;
    trendPingEl.textContent = d2 > 0 ? `↑ +${d2}ms` : d2 < 0 ? `↓ ${d2}ms` : '→ Stable';
    trendPingEl.style.color = d2 > 20 ? '#f59e0b' : d2 < -5 ? '#22c55e' : '#64748b';
  }
  prevPing = ping;
  pingHistory.push(ping);
  pingChart.push(ping);

  /* ── Uptime (server value + client interpolation) ── */
  lastKnownUptimeSec   = d.uptimeSeconds || 0;
  lastUptimeReceivedAt = Date.now();
  setEl('valUptime', fmtUptime(lastKnownUptimeSec));
  setEl('cloudUptimeLabel', fmtUptime(lastKnownUptimeSec));

  const uptimePct = Math.min((lastKnownUptimeSec / 3600) * 100, 100);
  setBarWidth('cloudUptimeBar', uptimePct);
  updateGauge(lastKnownUptimeSec);
  uptimeChart.push(lastKnownUptimeSec % 3600); // oscillating wave for chart

  /* ── Memory ── */
  if (d.memory) {
    const heapMB = Math.round(d.memory.heapUsed / 1024 / 1024);
    setEl('valMemory',   heapMB);
    setEl('mainMemLabel', heapMB + ' MB');
    setEl('chartMemVal',  heapMB + ' MB');

    const memPct = Math.min((heapMB / 512) * 100, 100);
    setBarWidth('mainMemBar', memPct);

    const trendMemEl = $('trendMemory');
    if (trendMemEl && prevMem !== null) {
      const delta = heapMB - prevMem;
      trendMemEl.textContent = delta > 0 ? `↑ +${delta}MB` : delta < 0 ? `↓ ${delta}MB` : '→ Stable';
      trendMemEl.style.color = delta > 30 ? '#f59e0b' : '#64748b';
    }
    prevMem = heapMB;
    memHistory.push(heapMB);
    memChart.push(heapMB);
  }

  /* ── Guild / Members ── */
  if (d.guild) {
    setEl('valMembers',    (d.guild.memberCount || 0).toLocaleString());
    setEl('mainGuildName', d.guild.name || '𝑮𝑿 𝒆𝑺𝒑𝒐𝒓𝒕𝒔');
  }

  /* ── Main Bot ── */
  if (d.mainBot) {
    setEl('mainBotTag', d.mainBot.tag || 'GX Bot#3131');
    setEl('mainBotId',  d.mainBot.id  || '1507671146487742464');
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
      if (ch && vcr.defaultChannelName) ch.textContent = '#' + vcr.defaultChannelName;
    });
  } else { vcrOnline = 5; }
  setEl('valVcrOnline', vcrOnline);
  const vcrSummary = $('vcrSummary');
  if (vcrSummary) {
    vcrSummary.textContent = vcrOnline === 5 ? 'All Sentinels Online' : `${vcrOnline}/5 Online`;
    vcrSummary.className   = 'section-badge ' + (vcrOnline === 5 ? 'green' : 'amber');
  }

  /* ── Servers summary ── */
  setEl('serversSummary', '3 Nodes Online');

  /* ── API Sample (update every 10 frames to avoid flicker) ── */
  if (frameCount % 10 === 0) {
    const sampleEl = $('apiSample');
    if (sampleEl) {
      sampleEl.textContent = JSON.stringify({
        status: d.status,
        ping:   d.ping,
        uptimeSeconds: d.uptimeSeconds,
        vcrOnline: vcrOnline + '/5'
      }, null, 2);
    }
  }

  /* ── Draw sparklines (every frame — smooth) ── */
  drawSparkline('sparkPing',    pingHistory.data,  '#00c8ff');
  drawSparkline('sparkMem',     memHistory.data,   '#8b5cf6');
  drawSparkline('sparkUptime',  [1, 1, 1, 1],      '#22c55e');
  drawSparkline('sparkMembers', [1, 1, 1, 1],      '#00c8ff');
  drawSparkline('sparkVcr',     [1, 1, 1, 1],      '#22c55e');

  /* ── Draw full charts (every frame) ── */
  drawFullChart($('chartPing'), pingChart.data, '#00c8ff');
  drawFullChart($('chartMem'),  memChart.data,  '#8b5cf6');

  /* ── Log every 10 frames to avoid spam ── */
  if (frameCount % 10 === 0) {
    addLog(`Ping: ${ping}ms  RAM: ${prevMem}MB  VCR: ${vcrOnline}/5`, ping < 80 ? 'ok' : 'info');
  }
}

/* ══════════════════════════════════════════════════════
   CLOCK
   ══════════════════════════════════════════════════════ */
function startClock() {
  function tick() {
    const n  = new Date();
    const hh = n.getUTCHours().toString().padStart(2, '0');
    const mm = n.getUTCMinutes().toString().padStart(2, '0');
    const ss = n.getUTCSeconds().toString().padStart(2, '0');
    $('navClock').textContent = `${hh}:${mm}:${ss} UTC`;
  }
  tick();
  setInterval(tick, 1000);
}

/* ══════════════════════════════════════════════════════
   NAV SCROLL HIGHLIGHT
   ══════════════════════════════════════════════════════ */
function initNavHighlight() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        const link = document.querySelector(`.nav-link[data-section="${e.target.id}"]`);
        if (link) link.classList.add('active');
      }
    });
  }, { threshold: 0.4 });
  ['overview','servers','vcr','analytics','security'].forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  });
}

/* ══════════════════════════════════════════════════════
   BUILD VCR GRID
   ══════════════════════════════════════════════════════ */
function buildVcrGrid() {
  const grid = document.getElementById('vcrGrid');
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
   UPTIME GAUGE
   ══════════════════════════════════════════════════════ */
function updateGauge(uptimeSec) {
  const pct  = Math.min(uptimeSec / (7 * 24 * 3600), 1);
  const fill  = document.getElementById('gaugeFill');
  const label = document.getElementById('gaugeLabel');
  if (fill)  fill.style.strokeDashoffset  = 173 * (1 - pct);
  if (label) label.textContent = (pct * 100).toFixed(1) + '%';
}

/* ══════════════════════════════════════════════════════
   CHARTS
   ══════════════════════════════════════════════════════ */
function initCharts() { /* nothing to pre-init — drawn on first data */ }

function drawSparkline(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || data.length < 2) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const min = Math.min(...data), max = Math.max(...data) || 1;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - ((v - min) / (max - min || 1)) * (H - 4) - 2
  }));

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color + '50');
  grad.addColorStop(1, color + '00');

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i-1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(mx, pts[i-1].y, mx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i-1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(mx, pts[i-1].y, mx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
}

function drawFullChart(canvas, data, color) {
  if (!canvas || data.length < 2) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 400;
  const H = canvas.height || 90;
  canvas.width = W;
  ctx.clearRect(0, 0, W, H);

  const min = Math.min(...data), max = Math.max(...data) || 1;
  const pad = 8;
  const pts = data.map((v, i) => ({
    x: pad + (i / (data.length - 1)) * (W - pad * 2),
    y: pad + (H - pad * 2) - ((v - min) / (max - min || 1)) * (H - pad * 2)
  }));

  /* Grid */
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + (i / 4) * (H - pad * 2);
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
  }

  /* Fill */
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color + '35');
  grad.addColorStop(1, color + '00');
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i-1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(mx, pts[i-1].y, mx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.lineTo(pts[pts.length-1].x, H); ctx.lineTo(pts[0].x, H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  /* Line */
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i-1].x + pts[i].x) / 2;
    ctx.bezierCurveTo(mx, pts[i-1].y, mx, pts[i].y, pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();

  /* Animated end dot */
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();

  /* Glow ring on dot */
  ctx.beginPath();
  ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
  ctx.strokeStyle = color + '40'; ctx.lineWidth = 2; ctx.stroke();
}

/* ══════════════════════════════════════════════════════
   EVENT LOG
   ══════════════════════════════════════════════════════ */
function addLog(msg, type = 'info') {
  const log = document.getElementById('eventLog');
  if (!log) return;
  const li = document.createElement('li');
  li.className = `log-item log-${type}`;
  li.textContent = `[${new Date().toLocaleTimeString('en-GB', { hour12: false })}] ${msg}`;
  log.prepend(li);
  while (log.children.length > 50) log.lastChild.remove();
}

/* ══════════════════════════════════════════════════════
   PILL STATE
   ══════════════════════════════════════════════════════ */
function setPillState(state, text) {
  const dot  = document.getElementById('pillDot');
  const txt  = document.getElementById('pillText');
  if (dot) dot.className = 'pill-dot ' + state;
  if (txt) txt.textContent = text;
}

/* ══════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════ */
function setEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function setBarWidth(id, pct) {
  const el = document.getElementById(id);
  if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}
function fmtUptime(s) {
  if (!s && s !== 0) return '--';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec}s`;
}
function formatTimestamp(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
}
