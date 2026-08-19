import { GX_LOGO_DATA_URI } from './logo.js';

/* ══════════════════════════════════════════════════════
   GLOBAL STATE & CONSTANTS
   ══════════════════════════════════════════════════════ */
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE = IS_LOCAL ? `http://${window.location.hostname}:3000` : 'https://gxbot.eshamikh.com';

let adminToken = sessionStorage.getItem('gx_admin_token') || null;
let currentAppeals = [];
let currentTickets = [];
let activeTicketThreadId = null;
let activeTab = 'overview';
let activeModalAppealId = null;
let serverChannels = [];
let serverRoles = [];

/* ══════════════════════════════════════════════════════
   DOM HELPERS & TOAST
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
   INITIALIZATION & AUTH CHECK
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

  // Setup Instagram-style Sidebar Navigation
  document.querySelectorAll('.nav-item[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      switchTab(target);
    });
  });

  // Direct Route Check (/support or #support)
  if (window.location.pathname.includes('/support') || window.location.hash.includes('support')) {
    switchTab('support');
  }

  // Setup Auth Events
  $('authForm')?.addEventListener('submit', handleLogin);
  $('togglePw')?.addEventListener('click', togglePasswordVisibility);
  $('btnLogout')?.addEventListener('click', handleLogout);

  // Search & Filter Appeals & Support Tickets
  $('searchAppeals')?.addEventListener('input', renderAppealsTable);
  $('filterAppealStatus')?.addEventListener('change', renderAppealsTable);
  $('searchSupportTickets')?.addEventListener('input', renderSupportTicketsList);

  // Setup Real-time Member Search Dropdowns across Moderation inputs
  setupAllMemberSearchDropdowns();

  // Start Realtime Telemetry Streams
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
      loadModData();
      loadSupportTickets();
    } else {
      if (errorEl) errorEl.textContent = data.error || 'Invalid master password.';
    }
  } catch {
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
      loadModData();
      loadSupportTickets();
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
  showToast('Session locked.', 'info');
}

/* ══════════════════════════════════════════════════════
   TAB SWITCHING & TITLES
   ══════════════════════════════════════════════════════ */
const TAB_METAS = {
  overview: { title: 'System Overview', sub: 'Realtime Telemetry & KPIs' },
  support: { title: 'Live Support Desk', sub: 'Direct 2-Way Chat Console with Discord Members' },
  moderation: { title: 'Moderation Center', sub: 'Server Enforcement & Administrative Tools' },
  appeals: { title: 'Security Appeals Command', sub: 'Review & Resolve Member Untrusted/Ban Appeals' },
  panels: { title: 'Interactive Panels Manager', sub: 'Deploy & Manage Discord Interactive Embeds' },
  vcr: { title: 'VCR Audio Sentinel Fleet', sub: '5 Autonomous Multi-Track Recording Sentinels' },
  security: { title: 'Security Shield & Roles', sub: 'Acoustic Ear-Rape Defense & Member Sync' },
  broadcast: { title: 'Broadcast Studio', sub: 'Official Announcements to Discord Channels' },
  logs: { title: 'Live Audit Console', sub: 'Realtime SSE Stream & Security Activity Logs' }
};

function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll('.nav-item[data-tab]').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((c) => {
    c.classList.toggle('active', c.id === `tab-${tabId}`);
  });

  const meta = TAB_METAS[tabId] || { title: 'Control Panel', sub: 'GX Operations' };
  if ($('pageTitle')) $('pageTitle').textContent = meta.title;
  if ($('pageSubtitle')) $('pageSubtitle').textContent = meta.sub;

  if (tabId === 'support') loadSupportTickets();
  if (tabId === 'appeals') loadAppeals();
  if (tabId === 'panels') loadPanels();
  if (tabId === 'moderation') loadModData();
}

/* ══════════════════════════════════════════════════════
   REAL-TIME MEMBER AUTOCOMPLETE SEARCH ENGINE
   ══════════════════════════════════════════════════════ */
function setupAllMemberSearchDropdowns() {
  const inputs = [
    { inputId: 'banUserId', dropdownId: 'dropdown_banUserId' },
    { inputId: 'kickUserId', dropdownId: 'dropdown_kickUserId' },
    { inputId: 'timeoutUserId', dropdownId: 'dropdown_timeoutUserId' },
    { inputId: 'purgeFilterUser', dropdownId: 'dropdown_purgeFilterUser' },
    { inputId: 'roleUserId', dropdownId: 'dropdown_roleUserId' },
    { inputId: 'voiceUserId', dropdownId: 'dropdown_voiceUserId' }
  ];

  inputs.forEach(({ inputId, dropdownId }) => {
    const inputEl = $(inputId);
    const dropdownEl = $(dropdownId);
    if (!inputEl || !dropdownEl) return;

    let debounceTimer;
    inputEl.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = inputEl.value.trim();
      if (!q) {
        dropdownEl.classList.remove('open');
        dropdownEl.innerHTML = '';
        return;
      }

      debounceTimer = setTimeout(async () => {
        const members = await searchMembersRealtime(q);
        renderMemberDropdownResults(members, dropdownEl, (selected) => {
          inputEl.value = selected.id;
          dropdownEl.classList.remove('open');
          showToast(`Selected: ${selected.tag} (${selected.id})`, 'info');
        });
      }, 150);
    });

    document.addEventListener('click', (e) => {
      if (!inputEl.contains(e.target) && !dropdownEl.contains(e.target)) {
        dropdownEl.classList.remove('open');
      }
    });
  });
}

async function searchMembersRealtime(query) {
  if (!adminToken) return [];
  try {
    const res = await fetch(`${API_BASE}/api/admin/members/search?q=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      return data.members || [];
    }
  } catch {}
  return [];
}

function renderMemberDropdownResults(members, container, onSelect) {
  if (!members || members.length === 0) {
    container.innerHTML = `<div style="padding: 10px; font-size: 12px; color: var(--text-muted); text-align: center;">No matching members found</div>`;
    container.classList.add('open');
    return;
  }

  container.innerHTML = members
    .map(
      (m) => `
      <div class="member-autocomplete-item" data-id="${m.id}" data-tag="${escapeHtml(m.tag)}">
        <img src="${m.avatar || ''}" class="member-avatar-sm" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'" alt="" />
        <div class="member-info-col">
          <span class="member-tag-line">${escapeHtml(m.displayName || m.username)} <span style="color:var(--text-muted); font-size:11px;">(${escapeHtml(m.tag)})</span></span>
          <span class="member-id-line">${m.id} ${m.isBot ? '• 🤖 BOT' : ''}</span>
        </div>
      </div>
    `
    )
    .join('');

  container.classList.add('open');

  container.querySelectorAll('.member-autocomplete-item').forEach((item, index) => {
    item.addEventListener('click', () => {
      onSelect(members[index]);
    });
  });
}

/* ══════════════════════════════════════════════════════
   LIVE SUPPORT DESK COMMAND CENTER
   ══════════════════════════════════════════════════════ */
window.loadSupportTickets = async () => {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/tickets`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentTickets = data.tickets || [];
      const openCount = currentTickets.filter((t) => t.stage !== 'CLOSED').length;
      if ($('badgeOpenTickets')) $('badgeOpenTickets').textContent = openCount;
      renderSupportTicketsList();
      if (activeTicketThreadId) {
        selectSupportTicket(activeTicketThreadId, false);
      }
    }
  } catch {}
};

function renderSupportTicketsList() {
  const container = $('supportTicketsList');
  if (!container) return;

  const searchQuery = ($('searchSupportTickets')?.value || '').toLowerCase();
  const filtered = currentTickets.filter((t) => {
    return (
      (t.ticketId || '').toLowerCase().includes(searchQuery) ||
      (t.userTag || '').toLowerCase().includes(searchQuery) ||
      (t.userId || '').toLowerCase().includes(searchQuery) ||
      (t.reason || '').toLowerCase().includes(searchQuery)
    );
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-center text-muted py-4" style="font-size:12.5px;">No support tickets found.</div>`;
    return;
  }

  // Sort by latest activity
  filtered.sort((a, b) => (b.lastActivityAt || b.openedAt || 0) - (a.lastActivityAt || a.openedAt || 0));

  container.innerHTML = filtered
    .map((t) => {
      const isActive = t.threadId === activeTicketThreadId;
      const isClosed = t.stage === 'CLOSED';
      const lastMsg = (t.transcript && t.transcript.length > 0) ? t.transcript[t.transcript.length - 1].content : t.reason;
      return `
        <div class="support-ticket-item ${isActive ? 'active' : ''}" onclick="selectSupportTicket('${t.threadId}')">
          <div class="support-ticket-header">
            <span class="support-ticket-code">${escapeHtml(t.ticketId)}</span>
            <span class="support-ticket-time">${new Date(t.lastActivityAt || t.openedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="support-ticket-user">${escapeHtml(t.userTag || 'Unknown Member')}</div>
          <div class="support-ticket-snippet">${escapeHtml(lastMsg || '')}</div>
          <div style="margin-top: 4px; display:flex; gap:6px; align-items:center;">
            <span class="badge-status ${isClosed ? 'rejected' : 'pending'}" style="font-size: 10px; padding: 2px 6px;">
              ${isClosed ? '🔒 Closed' : '💬 Active'}
            </span>
            ${t.hasUnreadAgent && !isClosed ? `<span class="badge-status" style="background:var(--red); color:#fff; font-size:9px; padding:1px 5px;">NEW</span>` : ''}
          </div>
        </div>
      `;
    })
    .join('');
}

window.selectSupportTicket = (threadId, autoScroll = true) => {
  activeTicketThreadId = threadId;
  renderSupportTicketsList();

  const ticket = currentTickets.find((t) => t.threadId === threadId);
  if (!ticket) return;

  // Update Chat Header
  if ($('chatUserAvatar')) {
    $('chatUserAvatar').src = ticket.userAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
    $('chatUserAvatar').style.display = 'block';
  }
  if ($('chatUserTitle')) $('chatUserTitle').textContent = `${ticket.userTag} (${ticket.realName || 'Member'})`;
  if ($('chatTicketCode')) $('chatTicketCode').textContent = `${ticket.ticketId} • Discord ID: ${ticket.userId}`;

  // Header Actions
  const headerActions = $('chatHeaderActions');
  if (headerActions) {
    if (ticket.stage !== 'CLOSED') {
      headerActions.innerHTML = `
        <button class="btn-action danger" onclick="closeSupportTicket('${ticket.threadId}')">
          🔒 Close & Archive Ticket
        </button>
      `;
    } else {
      headerActions.innerHTML = `<span class="status-chip inactive">Closed</span>`;
    }
  }

  // Render Transcript Messages
  renderTranscript(ticket.transcript || [], ticket);

  // Show/Hide Reply Bar
  const replyBar = $('supportReplyBar');
  if (replyBar) {
    replyBar.style.display = ticket.stage === 'CLOSED' ? 'none' : 'block';
  }

  // Render Details Sidebar
  renderTicketDetailsSidebar(ticket);

  if (autoScroll) {
    setTimeout(() => {
      const stream = $('supportMessagesStream');
      if (stream) stream.scrollTop = stream.scrollHeight;
    }, 50);
  }
};

function renderTranscript(transcript, ticket) {
  const stream = $('supportMessagesStream');
  if (!stream) return;

  if (!transcript || transcript.length === 0) {
    stream.innerHTML = `<div class="text-center text-muted py-4">No messages yet in this ticket.</div>`;
    return;
  }

  stream.innerHTML = transcript
    .map((msg) => {
      const isAgent = !!msg.isAgent || msg.authorTag.includes('الدعم');
      const timeStr = new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const imagesHtml = (msg.attachments || [])
        .map((img) => `<a href="${img}" target="_blank"><img src="${img}" class="chat-bubble-image" alt="Attachment" /></a>`)
        .join('');

      return `
        <div class="chat-bubble-wrap ${isAgent ? 'agent' : 'user'}">
          <div class="chat-bubble-meta">
            <span>${isAgent ? '🛡️ GX Support Agent' : escapeHtml(msg.authorTag || ticket.userTag)}</span>
            <span>• ${timeStr}</span>
          </div>
          <div class="chat-bubble">
            ${escapeHtml(msg.content || '')}
            ${imagesHtml}
          </div>
        </div>
      `;
    })
    .join('');
}

function renderTicketDetailsSidebar(ticket) {
  const container = $('supportDetailsContent');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align:center; margin-bottom: 16px;">
      <img src="${ticket.userAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" class="member-avatar-sm" style="width:52px; height:52px; margin-bottom:8px;" alt="" />
      <div style="font-weight:800; font-size:14px;">${escapeHtml(ticket.userTag || 'Unknown')}</div>
      <div class="mono" style="font-size:11px; color:var(--text-sub);">${ticket.userId}</div>
    </div>
    <div class="spec-row">
      <span class="spec-name">Ticket ID</span>
      <span class="spec-val mono text-white">${ticket.ticketId}</span>
    </div>
    <div class="spec-row">
      <span class="spec-name">Real Name</span>
      <span class="spec-val">${escapeHtml(ticket.realName || 'Not specified')}</span>
    </div>
    <div class="spec-row">
      <span class="spec-name">Status</span>
      <span class="spec-val text-white">${ticket.stage || 'ACTIVE'}</span>
    </div>
    <div class="spec-row">
      <span class="spec-name">Opened At</span>
      <span class="spec-val">${new Date(ticket.openedAt || Date.now()).toLocaleString()}</span>
    </div>
    <div style="margin-top: 14px;">
      <div style="font-size: 11px; color: var(--text-sub); font-weight:700; text-transform:uppercase; margin-bottom:4px;">Initial Problem Description</div>
      <div style="background:var(--bg-dark); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm); font-size:12px; line-height:1.4;">
        ${escapeHtml(ticket.reason || 'No description')}
      </div>
    </div>
  `;
}

window.handleAgentKey = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    window.sendSupportAgentReply();
  }
};

window.sendSupportAgentReply = async () => {
  if (!adminToken || !activeTicketThreadId) return;
  const replyInput = $('agentReplyInput');
  const imageInput = $('agentImageInput');
  const replyText = replyInput?.value.trim() || '';
  const imageUrl = imageInput?.value.trim() || null;

  if (!replyText && !imageUrl) {
    showToast('Please type a response or provide an image URL', 'error');
    return;
  }

  showToast('Sending response to Discord thread…', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/tickets/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        threadId: activeTicketThreadId,
        replyText,
        imageUrl,
        agentName: 'GX Support Agent'
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      if (replyInput) replyInput.value = '';
      if (imageInput) imageInput.value = '';
      showToast('✅ Response delivered to user in Discord!', 'success');
      loadSupportTickets();
    } else {
      showToast(data.error || 'Failed to send reply', 'error');
    }
  } catch {
    showToast('Network error while sending agent reply', 'error');
  }
};

window.closeSupportTicket = async (threadId) => {
  if (!adminToken) return;
  if (!confirm('Are you sure you want to close and archive this ticket?')) return;

  showToast('Closing ticket…', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/tickets/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        threadId: threadId || activeTicketThreadId,
        reason: 'Resolved by High Command via Web Support Desk'
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('🔒 Ticket closed & archived successfully in Discord!', 'success');
      loadSupportTickets();
    } else {
      showToast(data.error || 'Failed to close ticket', 'error');
    }
  } catch {
    showToast('Network error during ticket closure', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   MODERATION METADATA & SELECTORS
   ══════════════════════════════════════════════════════ */
async function loadModData() {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/data`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      serverChannels = data.channels || [];
      serverRoles = data.roles || [];
      populateModDropdowns();
    }
  } catch {}
}

function populateModDropdowns() {
  const textChannels = serverChannels.filter((c) => c.type === 'text');
  const channelOptions = textChannels
    .map((c) => `<option value="${c.id}">#${escapeHtml(c.name)} (${c.id})</option>`)
    .join('');

  if ($('purgeChannelSelect')) $('purgeChannelSelect').innerHTML = channelOptions;
  if ($('lockChannelSelect')) $('lockChannelSelect').innerHTML = channelOptions;
  if ($('slowmodeChannelSelect')) $('slowmodeChannelSelect').innerHTML = channelOptions;
  if ($('broadcastChannelSelect')) $('broadcastChannelSelect').innerHTML = channelOptions;

  const roleOptions = serverRoles
    .map((r) => `<option value="${r.id}">@${escapeHtml(r.name)}</option>`)
    .join('');
  if ($('roleSelect')) $('roleSelect').innerHTML = roleOptions;
}

/* ══════════════════════════════════════════════════════
   MODERATION ACTION HANDLERS
   ══════════════════════════════════════════════════════ */
window.submitModBan = async () => {
  const targetId = $('banUserId')?.value.trim();
  const reason = $('banReason')?.value.trim();
  const deleteMessageDays = parseInt($('banDeleteDays')?.value || '0');
  if (!targetId) return showToast('Please enter or select target User ID', 'error');

  showToast(`Executing permanent ban on ${targetId}…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, reason, deleteMessageDays })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      $('banUserId').value = '';
    } else {
      showToast(data.error || 'Failed to ban user', 'error');
    }
  } catch {
    showToast('Network error during ban request', 'error');
  }
};

window.submitModUnban = async () => {
  const targetId = $('unbanUserId')?.value.trim();
  const reason = $('unbanReason')?.value.trim();
  if (!targetId) return showToast('Please enter target User ID', 'error');

  showToast(`Executing unban for ${targetId}…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/unban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, reason })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      $('unbanUserId').value = '';
    } else {
      showToast(data.error || 'Failed to unban user', 'error');
    }
  } catch {
    showToast('Network error during unban request', 'error');
  }
};

window.submitModKick = async () => {
  const targetId = $('kickUserId')?.value.trim();
  const reason = $('kickReason')?.value.trim();
  if (!targetId) return showToast('Please enter or select target User ID', 'error');

  showToast(`Executing kick on ${targetId}…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, reason })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      $('kickUserId').value = '';
    } else {
      showToast(data.error || 'Failed to kick user', 'error');
    }
  } catch {
    showToast('Network error during kick request', 'error');
  }
};

window.submitModTimeout = async () => {
  const targetId = $('timeoutUserId')?.value.trim();
  const durationMinutes = parseInt($('timeoutDuration')?.value || '10');
  const reason = $('timeoutReason')?.value.trim();
  if (!targetId) return showToast('Please enter or select target User ID', 'error');

  showToast(`Applying ${durationMinutes}m timeout on ${targetId}…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/timeout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, durationMinutes, reason })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      $('timeoutUserId').value = '';
    } else {
      showToast(data.error || 'Failed to timeout user', 'error');
    }
  } catch {
    showToast('Network error during timeout request', 'error');
  }
};

window.submitModUntimeout = async () => {
  const targetId = $('timeoutUserId')?.value.trim();
  if (!targetId) return showToast('Please enter or select target User ID', 'error');

  showToast(`Removing timeout from ${targetId}…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/untimeout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
      $('timeoutUserId').value = '';
    } else {
      showToast(data.error || 'Failed to remove timeout', 'error');
    }
  } catch {
    showToast('Network error during untimeout request', 'error');
  }
};

window.submitModPurge = async () => {
  const channelId = $('purgeChannelSelect')?.value;
  const count = parseInt($('purgeCount')?.value || '10');
  const targetUserId = $('purgeFilterUser')?.value.trim() || null;
  if (!channelId) return showToast('Please select a target channel', 'error');

  showToast(`Purging ${count} messages…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ channelId, count, targetUserId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
    } else {
      showToast(data.error || 'Failed to purge messages', 'error');
    }
  } catch {
    showToast('Network error during purge request', 'error');
  }
};

window.submitModChannelLock = async (locked) => {
  const channelId = $('lockChannelSelect')?.value;
  if (!channelId) return showToast('Please select a target channel', 'error');

  showToast(`${locked ? 'Locking' : 'Unlocking'} channel…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ channelId, locked })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
    } else {
      showToast(data.error || 'Failed to modify channel lock', 'error');
    }
  } catch {
    showToast('Network error during channel lock request', 'error');
  }
};

window.submitModSlowmode = async () => {
  const channelId = $('slowmodeChannelSelect')?.value;
  const seconds = parseInt($('slowmodeSeconds')?.value || '0');
  if (!channelId) return showToast('Please select a target channel', 'error');

  showToast(`Setting slowmode to ${seconds}s…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/slowmode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ channelId, seconds })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
    } else {
      showToast(data.error || 'Failed to set slowmode', 'error');
    }
  } catch {
    showToast('Network error during slowmode request', 'error');
  }
};

window.submitModRole = async (action) => {
  const targetId = $('roleUserId')?.value.trim();
  const roleId = $('roleSelect')?.value;
  if (!targetId || !roleId) return showToast('Please select target User and select a Role', 'error');

  showToast(`${action === 'add' ? 'Granting' : 'Revoking'} role…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, roleId, action })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
    } else {
      showToast(data.error || 'Failed to modify role', 'error');
    }
  } catch {
    showToast('Network error during role request', 'error');
  }
};

window.submitModVoiceAction = async () => {
  const targetId = $('voiceUserId')?.value.trim();
  const action = $('voiceActionSelect')?.value || 'mute';
  if (!targetId) return showToast('Please select target User in Voice', 'error');

  showToast(`Executing voice action (${action})…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/voice-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, action })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message, 'success');
    } else {
      showToast(data.error || 'Failed to execute voice action', 'error');
    }
  } catch {
    showToast('Network error during voice action request', 'error');
  }
};

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
  const pill = $('livePillText');
  if (pill) pill.textContent = `Online · ${d.ping || 0}ms`;

  if ($('valPing')) $('valPing').textContent = d.ping || 0;
  if ($('valUptime')) $('valUptime').textContent = formatUptime(d.uptimeSeconds || 0);
  if ($('valMemory')) $('valMemory').textContent = Math.round((d.memory?.heapUsed || 0) / 1024 / 1024);
  if ($('valMembers')) $('valMembers').textContent = d.guild?.memberCount || '--';

  if (d.vcrFleet && Array.isArray(d.vcrFleet)) {
    const readyCount = d.vcrFleet.filter((w) => w.status === 'online').length;
    if ($('valVcrOnline')) $('valVcrOnline').textContent = readyCount;
    renderVcrGrid(d.vcrFleet);
  }

  const fill = $('gaugeFill');
  if (fill) fill.style.strokeDashoffset = '0';

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
          🔒 Locked & Stationed
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
    <li class="log-entry ${l.category || l.type || 'system'}">
      <span>[${new Date(l.timestamp || l.ts || Date.now()).toLocaleTimeString()}] <strong>${escapeHtml(l.action)}</strong>: ${escapeHtml(l.details || l.detail || '')}</span>
      <span class="mono text-muted">${l.category || l.type || 'SYSTEM'}</span>
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
  } catch {
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
  const channelId = $('broadcastChannelSelect')?.value.trim();
  const title = $('broadcastTitle')?.value.trim();
  const message = $('broadcastMessage')?.value.trim();
  const color = parseInt($('broadcastColor')?.value || '16777215');

  if (!channelId || !message) {
    showToast('Please select channel and enter message content', 'error');
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
