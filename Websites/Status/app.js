import { GX_LOGO_DATA_URI } from './logo.js';

/* ══════════════════════════════════════════════════════
   GLOBAL STATE & CONSTANTS
   ══════════════════════════════════════════════════════ */
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = IS_LOCAL ? `http://${window.location.hostname}:3000` : 'https://gxbot.eshamikh.com';

let adminToken = sessionStorage.getItem('gx_admin_token') || null;
let currentAppeals = [];
let activeTab = 'overview';
let activeModalAppealId = null;

/* ══════════════════════════════════════════════════════
   DOM HELPERS
   ══════════════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

function showToast(message, type = 'info') {
  const container = $('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* ══════════════════════════════════════════════════════
   INITIALIZATION & LOGO INJECTION
   ══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Inject official GX logo everywhere
  document.querySelectorAll('.gx-logo-img').forEach((img) => {
    img.src = GX_LOGO_DATA_URI;
  });

  // Check auth state
  if (adminToken) {
    validateSession();
  } else {
    showAuthOverlay();
  }

  // Setup tab navigation
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      switchTab(target);
    });
  });

  // Setup Auth Events
  $('authForm')?.addEventListener('submit', handleLogin);
  $('togglePw')?.addEventListener('click', togglePasswordVisibility);
  $('btnLogout')?.addEventListener('click', handleLogout);

  // Search & Filter Appeals
  $('searchAppeals')?.addEventListener('input', renderAppealsTable);
  $('filterAppealStatus')?.addEventListener('change', renderAppealsTable);

  // Start Realtime Streams
  startRealtimeStream();
});

/* ══════════════════════════════════════════════════════
   AUTHENTICATION LOGIC
   ══════════════════════════════════════════════════════ */
function showAuthOverlay() {
  $('authOverlay')?.classList.remove('hidden');
}

function hideAuthOverlay() {
  $('authOverlay')?.classList.add('hidden');
}

function togglePasswordVisibility() {
  const input = $('adminPassword');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function handleLogin() {
  const pwInput = $('adminPassword');
  const errorEl = $('authError');
  const spinner = $('authSpinner');
  const btnText = document.querySelector('#btnSubmitAuth .btn-text');

  if (!pwInput || !pwInput.value) return;

  if (errorEl) errorEl.textContent = '';
  if (spinner) spinner.style.display = 'inline-block';
  if (btnText) btnText.textContent = 'Verifying…';

  try {
    const res = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwInput.value.trim() })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      adminToken = data.token;
      sessionStorage.setItem('gx_admin_token', adminToken);
      hideAuthOverlay();
      showToast('✅ Authenticated successfully! Welcome to GX Command Center.', 'success');
      loadAppeals();
      loadPanels();
    } else {
      if (errorEl) errorEl.textContent = data.error || 'Invalid master password.';
    }
  } catch (err) {
    if (errorEl) errorEl.textContent = 'Server connection error. Ensure backend is running.';
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (btnText) btnText.textContent = 'Authenticate & Enter';
  }
}

async function validateSession() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/session`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      hideAuthOverlay();
      loadAppeals();
      loadPanels();
    } else {
      handleLogout();
    }
  } catch {
    hideAuthOverlay();
  }
}

function handleLogout() {
  adminToken = null;
  sessionStorage.removeItem('gx_admin_token');
  showAuthOverlay();
  showToast('Logged out of Command Center.', 'info');
}

/* ══════════════════════════════════════════════════════
   TAB SWITCHING
   ══════════════════════════════════════════════════════ */
function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll('.nav-tab').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((c) => {
    c.classList.toggle('active', c.id === `tab-${tabId}`);
  });

  if (tabId === 'appeals') loadAppeals();
  if (tabId === 'panels') loadPanels();
}

/* ══════════════════════════════════════════════════════
   REALTIME TELEMETRY & SSE STREAM
   ══════════════════════════════════════════════════════ */
function startRealtimeStream() {
  const eventSource = new EventSource(`${API_BASE}/api/stream`);

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      updateTelemetry(data);
    } catch {}
  };

  eventSource.onerror = () => {
    // Fallback to polling if SSE disconnected
    setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (res.ok) {
          const data = await res.json();
          updateTelemetry(data);
        }
      } catch {}
    }, 1000);
  };
}

function updateTelemetry(d) {
  // Live Pill
  const pill = $('livePillText');
  if (pill) pill.textContent = `Online · ${d.ping || 0}ms`;

  // KPIs
  if ($('valPing')) $('valPing').textContent = d.ping || 0;
  if ($('valUptime')) $('valUptime').textContent = formatUptime(d.uptimeSeconds || 0);
  if ($('valMemory')) $('valMemory').textContent = Math.round((d.memory?.heapUsed || 0) / 1024 / 1024);
  if ($('valMembers')) $('valMembers').textContent = d.guild?.memberCount || '--';

  // VCR Sentinels KPI & Grid
  if (d.vcrFleet && Array.isArray(d.vcrFleet)) {
    const readyCount = d.vcrFleet.filter((w) => w.status === 'online').length;
    if ($('valVcrOnline')) $('valVcrOnline').textContent = readyCount;
    renderVcrGrid(d.vcrFleet);
  }

  // Live Gauge Fill
  const fill = $('gaugeFill');
  if (fill) fill.style.strokeDashoffset = '0';

  // Activity stream
  if (d.recentActivity && Array.isArray(d.recentActivity)) {
    renderActivityLog(d.recentActivity);
  }
}

function formatUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}h ${m}m ${s}s`;
}

function renderVcrGrid(fleet) {
  const grid = $('vcrFleetGrid');
  if (!grid) return;
  grid.innerHTML = fleet
    .map(
      (w, i) => `
      <div class="panel-card" style="padding: 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
          <span style="font-weight:800; font-size:14px;">VCR #${i + 1}</span>
          <span class="status-chip ${w.status === 'online' ? '' : 'inactive'}">${w.status}</span>
        </div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom: 12px;">
          Room: <span class="text-white">${w.defaultChannelName || 'Assigned'}</span>
        </div>
        <button class="btn-action" style="width:100%; font-size:11px;" onclick="reconnectSingleVCR('${w.id}')">
          🔄 Re-Station
        </button>
      </div>
    `
    )
    .join('');
}

function renderActivityLog(logs) {
  const list = $('eventStreamList');
  if (!list) return;
  list.innerHTML = logs
    .slice(0, 30)
    .map(
      (l) => `
    <li class="log-entry ${l.category || 'system'}">
      <span>[${new Date(l.timestamp || Date.now()).toLocaleTimeString()}] <strong>${l.action}</strong>: ${l.details || ''}</span>
      <span class="mono text-muted">${l.category || 'SYSTEM'}</span>
    </li>
  `
    )
    .join('');
}

/* ══════════════════════════════════════════════════════
   APPEALS COMMAND CENTER
   ══════════════════════════════════════════════════════ */
async function loadAppeals() {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/appeals`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentAppeals = data.appeals || [];
      const pendingCount = currentAppeals.filter((a) => a.status === 'pending').length;
      if ($('badgePendingAppeals')) $('badgePendingAppeals').textContent = pendingCount;
      renderAppealsTable();
    }
  } catch {}
}

function renderAppealsTable() {
  const tbody = $('appealsTableBody');
  if (!tbody) return;

  const searchQuery = ($('searchAppeals')?.value || '').toLowerCase();
  const filterStatus = $('filterAppealStatus')?.value || 'all';

  const filtered = currentAppeals.filter((a) => {
    const matchSearch =
      (a.userTag || '').toLowerCase().includes(searchQuery) ||
      (a.targetId || '').toLowerCase().includes(searchQuery);
    const matchStatus = filterStatus === 'all' || a.status === filterStatus;
    return matchSearch && matchStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No appeals found matching criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (a) => `
    <tr>
      <td><strong class="text-white">${escapeHtml(a.userTag || 'Unknown')}</strong></td>
      <td class="mono">${a.targetId}</td>
      <td class="text-muted">${new Date(a.createdAt || Date.now()).toLocaleDateString()}</td>
      <td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${escapeHtml(a.statement || 'No statement provided')}
      </td>
      <td>
        <span class="badge-status ${a.status}">
          ${a.status === 'approved' ? '✅ Approved' : a.status === 'rejected' ? '❌ Rejected' : '⏳ Pending'}
        </span>
      </td>
      <td style="text-align: right;">
        <button class="btn-action" onclick="openStatementModal('${a.targetId}')">Review Statement</button>
        ${
          a.status === 'pending'
            ? `
          <button class="btn-action primary" onclick="resolveAppeal('${a.targetId}', 'approve')">Approve & Unban</button>
          <button class="btn-action danger" onclick="resolveAppeal('${a.targetId}', 'reject')">Reject</button>
        `
            : ''
        }
      </td>
    </tr>
  `
    )
    .join('');
}

window.openStatementModal = (targetId) => {
  const appeal = currentAppeals.find((a) => a.targetId === targetId);
  if (!appeal) return;
  activeModalAppealId = targetId;

  if ($('modalUserTag')) $('modalUserTag').textContent = `Appeal: ${appeal.userTag}`;
  if ($('modalUserId')) $('modalUserId').textContent = appeal.targetId;
  if ($('modalStatementText')) $('modalStatementText').textContent = appeal.statement || 'No statement provided.';

  const footer = $('modalActions');
  if (footer) {
    footer.innerHTML =
      appeal.status === 'pending'
        ? `
      <button class="btn-action primary" onclick="resolveAppeal('${targetId}', 'approve'); closeStatementModal();">✅ Approve & Unban</button>
      <button class="btn-action danger" onclick="resolveAppeal('${targetId}', 'reject'); closeStatementModal();">❌ Reject Appeal</button>
    `
        : `<span class="badge-status ${appeal.status}">Resolved: ${appeal.status} by ${appeal.handledByName || 'Admin'}</span>`;
  }

  $('statementModal')?.classList.add('open');
};

window.closeStatementModal = () => {
  $('statementModal')?.classList.remove('open');
};

window.resolveAppeal = async (targetId, action) => {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/appeals/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetId, action })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Appeal ${action === 'approve' ? 'approved (User Unbanned + DM Sent)' : 'rejected'} successfully!`, 'success');
      loadAppeals();
    } else {
      showToast(data.error || 'Failed to resolve appeal', 'error');
    }
  } catch (err) {
    showToast('Network error while resolving appeal', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   PANELS & BOT OPERATIONS
   ══════════════════════════════════════════════════════ */
async function loadPanels() {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/panels`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.panels) {
        if ($('chipTicketStatus')) {
          $('chipTicketStatus').textContent = data.panels.ticketPanel?.status === 'active' ? 'Active' : 'Inactive';
          $('chipTicketStatus').className = `status-chip ${data.panels.ticketPanel?.status === 'active' ? '' : 'inactive'}`;
        }
        if ($('chipEventStatus')) {
          $('chipEventStatus').textContent = data.panels.eventPanel?.status === 'active' ? 'Active' : 'Inactive';
          $('chipEventStatus').className = `status-chip ${data.panels.eventPanel?.status === 'active' ? '' : 'inactive'}`;
        }
      }
    }
  } catch {}
}

window.deployPanel = async (panelType) => {
  if (!adminToken) return;
  showToast(`Deploying ${panelType} panel to Discord…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/panels/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ panelType })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'Panel deployed successfully!', 'success');
      loadPanels();
    } else {
      showToast(data.error || 'Failed to deploy panel', 'error');
    }
  } catch {
    showToast('Failed to deploy panel due to server error', 'error');
  }
};

window.removePanel = async (panelType) => {
  if (!adminToken) return;
  showToast(`Removing ${panelType} panel from Discord…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/panels/remove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ panelType })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'Panel removed successfully!', 'success');
      loadPanels();
    } else {
      showToast(data.error || 'Failed to remove panel', 'error');
    }
  } catch {
    showToast('Failed to remove panel', 'error');
  }
};

window.triggerMassSync = async () => {
  if (!adminToken) return;
  showToast('⚡ Running server-wide member & role sync…', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/bot/sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✅ Mass Member & Role Sync Completed!', 'success');
    }
  } catch {
    showToast('Sync request error', 'error');
  }
};

window.sendBroadcast = async () => {
  if (!adminToken) return;
  const channelId = $('broadcastChannel')?.value.trim();
  const title = $('broadcastTitle')?.value.trim();
  const message = $('broadcastMessage')?.value.trim();
  const color = parseInt($('broadcastColor')?.value || '16777215');

  if (!channelId || !message) {
    showToast('Please provide channel ID and message content', 'error');
    return;
  }

  showToast('Sending official announcement…', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/bot/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ channelId, title, message, color })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('📢 Official Announcement Broadcasted!', 'success');
      $('broadcastMessage').value = '';
    } else {
      showToast(data.error || 'Failed to send broadcast', 'error');
    }
  } catch {
    showToast('Broadcast request failed', 'error');
  }
};

window.forceReStationVCR = async () => {
  if (!adminToken) return;
  showToast('Re-stationing all 5 VCR sentinels…', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/vcr/reconnect`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (res.ok) showToast(data.message || 'Sentinels re-stationed!', 'success');
  } catch {
    showToast('Re-station request error', 'error');
  }
};

window.reconnectSingleVCR = async (vcrId) => {
  window.forceReStationVCR();
};

window.clearEventLog = () => {
  const list = $('eventStreamList');
  if (list) list.innerHTML = `<li class="log-entry">Console cleared.</li>`;
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
