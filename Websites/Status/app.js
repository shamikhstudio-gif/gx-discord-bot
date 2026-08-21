export const LOGO_URL = './logo.jpg';

/* ══════════════════════════════════════════════════════
   GLOBAL STATE & CONSTANTS
   ══════════════════════════════════════════════════════ */
export const LIVE_BACKEND_URL = 'https://worker-production-cd30.up.railway.app';
export const LOCAL_BACKEND_URL = 'http://localhost:3000';

function resolveApiBase() {
  try {
    const host = window.location.hostname || '';
    const port = window.location.port || '';
    const proto = window.location.protocol || '';

    // 1. Direct deployment on Railway backend
    if (host.includes('railway.app')) {
      return window.location.origin;
    }
    // 2. Direct local Node.js server on port 3000
    if ((host === 'localhost' || host === '127.0.0.1') && (port === '3000' || !port)) {
      return `http://${host}:3000`;
    }
    // 3. Local frontend dev servers (Live Server 5500, Vite 5173, etc.)
    if (host === 'localhost' || host === '127.0.0.1') {
      return LOCAL_BACKEND_URL;
    }
    // 4. Any static host, Cloudflare Pages, custom domain (gxbot.eshamikh.com), file://, etc.
    return LIVE_BACKEND_URL;
  } catch {
    return LIVE_BACKEND_URL;
  }
}

let API_BASE = resolveApiBase();

/**
 * Universal Resilient API Fetch with Automatic Backend Failover
 */
async function apiFetch(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;
  try {
    const res = await fetch(url, options);
    // If static host returns 404/502/503 and we are not yet on LIVE_BACKEND_URL, auto-failover
    if ((res.status === 404 || res.status === 502 || res.status === 503) && API_BASE !== LIVE_BACKEND_URL) {
      console.warn(`[GX API] Request to ${url} returned ${res.status}. Failing over to live backend: ${LIVE_BACKEND_URL}`);
      API_BASE = LIVE_BACKEND_URL;
      const fallbackUrl = `${API_BASE}${endpoint}`;
      return await fetch(fallbackUrl, options);
    }
    return res;
  } catch (err) {
    if (API_BASE !== LIVE_BACKEND_URL) {
      console.warn(`[GX API] Request to ${url} failed (${err.message}). Failing over to live backend: ${LIVE_BACKEND_URL}`);
      API_BASE = LIVE_BACKEND_URL;
      const fallbackUrl = `${API_BASE}${endpoint}`;
      return await fetch(fallbackUrl, options);
    }
    throw err;
  }
}

let adminToken = sessionStorage.getItem('gx_admin_token') || null;
let currentAppeals = [];
let currentVerifications = [];
let currentTickets = [];
let activeTicketThreadId = null;
let activeTab = 'overview';
let activeModalAppealId = null;
let ticketFilter = 'all';
let verificationFilter = 'pending';
let serverChannels = [];
let serverRoles = [];

/* ══════════════════════════════════════════════════════
   NOTIFICATION CENTER STATE
   ══════════════════════════════════════════════════════ */
let notifications = [];
let unreadNotifCount = 0;

/* ══════════════════════════════════════════════════════
   DOM HELPERS & TOAST
   ══════════════════════════════════════════════════════ */
const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = $('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-30px) scale(0.95)';
    toast.style.transition = 'all 280ms cubic-bezier(0.32, 0.72, 0, 1)';
    setTimeout(() => toast.remove(), 300);
  }, 3800);
}

/* ══════════════════════════════════════════════════════
   ACCORDION NAVIGATION & TAB SWITCHING
   ══════════════════════════════════════════════════════ */
window.toggleNavGroup = (headerEl) => {
  const group = headerEl.closest('.nav-group');
  if (group) {
    group.classList.toggle('expanded');
  }
};

const TAB_METAS = {
  overview: { title: 'نظرة عامة على النظام', sub: 'المؤشرات التشغيلية والقياسات الحية اللحظية' },
  support: { title: 'مركز الدعم الفني المباشر', sub: 'منصة المحادثة المباشرة ثنائية الاتجاه مع أعضاء ديسكورد' },
  moderation: { title: 'مركز الإشراف والأدوات الإدارية', sub: 'تنفيذ القرارات الإدارية وعمليات العقاب والعزل من الموقع' },
  verifications: { title: 'مركز مراجعة وتوثيق الوافدين (Gatekeeper)', sub: 'إدارة طلبات الوافدين برتبة UNTRUSTED والبت الفوري في منحهم رتبة MEMBER أو أرشفتها' },
  appeals: { title: 'مركز مراجعة الطعون والالتماسات', sub: 'مراجعة طلبات فك الحظر والبت الفوري فيها' },
  panels: { title: 'مدير البانلات والرسائل التفاعلية', sub: 'نشر وإدارة رسائل وإمبدات التفاعل في قنوات ديسكورد' },
  vcr: { title: 'أسطول مسجلات الصوت (GX VCR Fleet)', sub: '5 مسجلات صوتية ذاتية ومقفولة في روماتها' },
  security: { title: 'درع الأمان ومزامنة الرتب الشاملة', sub: 'فحص رتب السيرفر وخوارزميات الحماية الصوتية' },
  broadcast: { title: 'استوديو البث والإعلانات الرسمية', sub: 'إرسال ونشر الإعلانات الرسمية إلى رومات السيرفر' },
  logs: { title: 'سجل الأحداث والعمليات اللحظي', sub: 'مراقبة حية لكافة عمليات البوت والنشاط الأمني' }
};

function switchTab(tabId) {
  activeTab = tabId;
  document.querySelectorAll('.nav-item[data-tab]').forEach((t) => {
    t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-content').forEach((c) => {
    c.classList.toggle('active', c.id === `tab-${tabId}`);
  });

  const meta = TAB_METAS[tabId] || { title: 'لوحة التحكم', sub: 'عمليات GX' };
  if ($('pageTitle')) $('pageTitle').textContent = meta.title;
  if ($('pageSubtitle')) $('pageSubtitle').textContent = meta.sub;

  if (tabId === 'support') loadSupportTickets();
  if (tabId === 'verifications') loadVerifications();
  if (tabId === 'appeals') loadAppeals();
  if (tabId === 'panels') loadPanels();
  if (tabId === 'moderation' || tabId === 'broadcast') loadModData();
}

/* ══════════════════════════════════════════════════════
   NOTIFICATION CENTER LOGIC
   ══════════════════════════════════════════════════════ */
function addNotification(type, title, desc, linkTab = null) {
  const notif = {
    id: Date.now() + Math.random().toString(36).substr(2, 4),
    type,
    title,
    desc,
    linkTab,
    time: Date.now(),
    read: false
  };
  notifications.unshift(notif);
  if (notifications.length > 40) notifications.pop();
  unreadNotifCount++;
  renderNotifications();
}

function renderNotifications() {
  const listEl = $('notifList');
  const badgeEl = $('notifBadge');
  if (badgeEl) {
    badgeEl.textContent = unreadNotifCount;
    badgeEl.classList.toggle('hidden', unreadNotifCount === 0);
  }
  if (!listEl) return;

  if (notifications.length === 0) {
    listEl.innerHTML = '<div class="notif-empty">لا توجد تنبيهات جديدة في الوقت الحالي</div>';
    return;
  }

  listEl.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'}" onclick="handleNotifClick('${n.id}', '${n.linkTab || ''}')">
      <div class="notif-icon-box ${escapeHtml(n.type || 'info')}">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          ${n.type === 'security' ? '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>' :
            n.type === 'support' ? '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>' :
            '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'}
        </svg>
      </div>
      <div class="notif-content">
        <div class="notif-item-title">${escapeHtml(n.title)}</div>
        <div class="notif-item-desc">${escapeHtml(n.desc)}</div>
        <div class="notif-item-time">${formatTimeAgo(n.time)}</div>
      </div>
    </div>
  `).join('');
}

window.handleNotifClick = (id, linkTab) => {
  const notif = notifications.find(n => n.id === id);
  if (notif && !notif.read) {
    notif.read = true;
    unreadNotifCount = Math.max(0, unreadNotifCount - 1);
    renderNotifications();
  }
  $('notifDropdown')?.classList.remove('open');
  if (linkTab) switchTab(linkTab);
};

window.markAllNotificationsRead = () => {
  notifications.forEach(n => n.read = true);
  unreadNotifCount = 0;
  renderNotifications();
  showToast('تم تحديد جميع الإشعارات كمقروءة', 'info');
};

function formatTimeAgo(timestamp) {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return 'الآن';
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} ساعة`;
  return `منذ ${Math.floor(diff / 86400)} يوم`;
}

/* ══════════════════════════════════════════════════════
   INITIALIZATION & AUTH CHECK
   ══════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Inject official GX logo
  document.querySelectorAll('.gx-logo-img').forEach((img) => {
    img.src = './logo.jpg';
  });

  // Check auth state
  if (adminToken) {
    validateSession();
  } else {
    showAuthOverlay();
  }

  // Setup Sidebar Navigation
  document.querySelectorAll('.nav-item[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      switchTab(target);
    });
  });

  // Direct Route Check (/support or #support or #verifications)
  if (window.location.pathname.includes('/support') || window.location.hash.includes('support')) {
    switchTab('support');
  } else if (window.location.pathname.includes('/verifications') || window.location.hash.includes('verifications')) {
    switchTab('verifications');
  }

  // Setup Auth Events
  $('authForm')?.addEventListener('submit', handleLogin);
  $('togglePw')?.addEventListener('click', togglePasswordVisibility);
  $('btnLogout')?.addEventListener('click', handleLogout);

  // Setup Notifications Toggle & Click Outside
  $('btnNotificationsToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('notifDropdown')?.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-wrapper')) {
      $('notifDropdown')?.classList.remove('open');
    }
  });

  // Search & Filter Appeals & Support Tickets
  $('searchAppeals')?.addEventListener('input', renderAppealsTable);
  $('filterAppealStatus')?.addEventListener('change', renderAppealsTable);
  $('searchSupportTickets')?.addEventListener('input', renderSupportTicketsList);

  // Setup Ticket Filter Chips
  document.querySelectorAll('.filter-chip[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      ticketFilter = chip.getAttribute('data-filter') || 'all';
      renderSupportTicketsList();
    });
  });

  // Setup Real-time Member Search Dropdowns across Moderation inputs
  setupAllMemberSearchDropdowns();

  // Start Realtime Telemetry Streams
  startRealtimeStream();
});

/* ══════════════════════════════════════════════════════
   AUTHENTICATION LOGIC (ARABIC)
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
  if (btnText) btnText.textContent = 'جارٍ التحقق…';

  try {
    const res = await apiFetch(`/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwInput.value.trim() })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      adminToken = data.token;
      sessionStorage.setItem('gx_admin_token', adminToken);
      hideAuthOverlay();
      showToast('تم توثيق الدخول بنجاح! مرحباً بك في مركز قيادة GX eSports.', 'success');
      loadAppeals();
      loadVerifications();
      loadPanels();
      loadModData();
      loadSupportTickets();
      addNotification('security', 'تسجيل دخول جديد', 'تم تسجيل الدخول بنجاح إلى لوحة التحكم الرئيسية.');
    } else {
      if (errorEl) errorEl.textContent = data.error || 'كلمة المرور الرئيسية غير صحيحة.';
    }
  } catch {
    if (errorEl) errorEl.textContent = 'تعذر الاتصال بالخادم. يرجى التأكد من تشغيل البوت.';
  } finally {
    if (spinner) spinner.style.display = 'none';
    if (btnText) btnText.textContent = 'توثيق الدخول للنظام';
  }
}

async function validateSession() {
  try {
    const res = await apiFetch(`/api/admin/session`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      hideAuthOverlay();
      loadAppeals();
      loadVerifications();
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
  showToast('تم قفل الجلسة بنجاح.', 'info');
}

/* ══════════════════════════════════════════════════════
   REAL-TIME MEMBER AUTOCOMPLETE SEARCH ENGINE (ARABIC)
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
          showToast(`تم تحديد: ${selected.tag} (${selected.id})`, 'info');
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
    const res = await apiFetch(`/api/admin/members/search?q=${encodeURIComponent(query)}`, {
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
    container.innerHTML = `<div style="padding: 10px; font-size: 12.5px; color: var(--text-muted); text-align: center;">لم يتم العثور على أعضاء مطابقين</div>`;
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
          <span class="member-id-line">${m.id} ${m.isBot ? '• بوت' : ''}</span>
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
   LIVE SUPPORT DESK COMMAND CENTER (ARABIC REDESIGN)
   ══════════════════════════════════════════════════════ */
window.loadSupportTickets = async () => {
  if (!adminToken) return;
  try {
    const res = await apiFetch(`/api/admin/tickets`, {
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
  
  let filtered = currentTickets.filter((t) => {
    const matchSearch =
      (t.ticketId || '').toLowerCase().includes(searchQuery) ||
      (t.userTag || '').toLowerCase().includes(searchQuery) ||
      (t.userId || '').toLowerCase().includes(searchQuery) ||
      (t.reason || '').toLowerCase().includes(searchQuery);

    if (!matchSearch) return false;

    if (ticketFilter === 'active') return t.stage !== 'CLOSED';
    if (ticketFilter === 'closed') return t.stage === 'CLOSED';
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="tickets-empty-placeholder">لا توجد تذاكر مطابقة.</div>`;
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
        <div class="ticket-card ${isActive ? 'active' : ''}" onclick="selectSupportTicket('${t.threadId}')">
          <div class="ticket-card-header">
            <span class="ticket-badge-code">${escapeHtml(t.ticketId)}</span>
            <span class="ticket-time-stamp">${new Date(t.lastActivityAt || t.openedAt || Date.now()).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="ticket-user-line">
            <img src="${t.userAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" class="member-avatar-sm" style="width:20px; height:20px;" alt="" />
            <span>${escapeHtml(t.userTag || 'عضو')}</span>
          </div>
          <div class="ticket-preview-text">${escapeHtml(lastMsg || '')}</div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
            <span class="ticket-status-pill ${isClosed ? 'closed' : 'open'}">
              ${isClosed ? 'مغلقة' : 'نشطة'}
            </span>
            ${t.hasUnreadAgent && !isClosed ? `<span class="unread-dot-badge" title="رسالة جديدة"></span>` : ''}
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

  // Update Topbar
  if ($('chatUserAvatar')) $('chatUserAvatar').src = ticket.userAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
  if ($('chatUserTitle')) $('chatUserTitle').textContent = `${ticket.userTag} (${ticket.realName || 'صاحب التذكرة'})`;
  if ($('chatTicketCode')) $('chatTicketCode').textContent = `${ticket.ticketId} • معرف ديسكورد: ${ticket.userId}`;

  // Quick Action Buttons
  const quickActions = $('chatQuickActions');
  if (quickActions) {
    quickActions.innerHTML = `
      ${ticket.stage !== 'CLOSED' ? `
        <button class="btn-chat-action archive" onclick="closeSupportTicket('${ticket.threadId}')" title="أرشفة وإغلاق التذكرة في ديسكورد">
          <span>أرشفة وإغلاق</span>
        </button>
      ` : ''}
      <button class="btn-chat-action delete" onclick="deleteSupportTicket('${ticket.threadId}')" title="حذف التذكرة نهائياً من السيرفر والقاعدة">
        <span>حذف نهائي</span>
      </button>
    `;
  }

  // Render Transcript Messages
  renderTranscript(ticket.transcript || [], ticket);

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
    stream.innerHTML = `<div class="tickets-empty-placeholder">لا توجد رسائل سابقة في هذه التذكرة.</div>`;
    return;
  }

  stream.innerHTML = transcript
    .map((msg) => {
      const isAgent = !!msg.isAgent || msg.authorTag.includes('الدعم');
      const timeStr = new Date(msg.timestamp || Date.now()).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
      const avatarUrl = isAgent ? './logo.jpg' : (ticket.userAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png');
      const imagesHtml = (msg.attachments || [])
        .map((img) => `<a href="${img}" target="_blank"><img src="${img}" class="msg-attachment-img" alt="مرفق" /></a>`)
        .join('');

      return `
        <div class="msg-row ${isAgent ? 'agent' : 'user'}">
          <img src="${avatarUrl}" class="msg-avatar" alt="" />
          <div class="msg-content-block">
            <div class="msg-header">
              <span class="msg-author">${escapeHtml(msg.authorTag)} ${isAgent ? '<span class="msg-agent-tag">فريق الدعم</span>' : ''}</span>
              <span class="msg-time">${timeStr}</span>
            </div>
            <div class="msg-text">${escapeHtml(msg.content)}</div>
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

  const durationHours = Math.round(((Date.now() - (ticket.openedAt || Date.now())) / 3600000) * 10) / 10;
  const isClosed = ticket.stage === 'CLOSED';

  container.innerHTML = `
    <div class="detail-card-section">
      <div class="detail-user-card">
        <img src="${ticket.userAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" class="detail-user-avatar" alt="" />
        <div class="detail-user-titles">
          <h4>${escapeHtml(ticket.realName || ticket.userTag)}</h4>
          <span class="mono" style="cursor:pointer;" onclick="copyUserId('${ticket.userId}')" title="انقر للنسخ">${ticket.userTag}</span>
        </div>
      </div>

      <div class="detail-key-val-list">
        <div class="detail-row">
          <span class="detail-label">معرف المستخدم:</span>
          <span class="detail-val mono" style="cursor:pointer;" onclick="copyUserId('${ticket.userId}')" title="انقر لنسخ المعرف">${ticket.userId} 📋</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">تاريخ الإنشاء:</span>
          <span class="detail-val">${new Date(ticket.openedAt || Date.now()).toLocaleDateString('ar-SA')}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">مدة النشاط:</span>
          <span class="detail-val mono">${durationHours} ساعة</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">الحالة الحالية:</span>
          <span class="detail-val font-weight-bold" style="color: ${isClosed ? 'var(--red)' : 'var(--green)'};">
            ${isClosed ? 'مغلقة ومؤرشفة 🔒' : 'نشطة ومباشرة 🟢'}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">سبب التذكرة:</span>
          <span class="detail-val">${escapeHtml(ticket.reason || 'عام')}</span>
        </div>
      </div>
    </div>

    <div class="detail-card-section">
      <div class="detail-section-title" style="font-size:12.5px; font-weight:800; color:var(--text-muted); margin-bottom:8px;">إجراءات سريعة على التذكرة والعضو</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <button class="btn-action" style="width:100%; font-size:12px; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="copyTranscript('${ticket.threadId}')">
          <span>📋 نسخ سجل المحادثة كامل</span>
        </button>
        <button class="btn-action warning" style="width:100%; font-size:12px; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="quickModWarn('${ticket.userId}')">
          <span>⚠️ تحذير رسمي للعضو</span>
        </button>
        <button class="btn-action danger" style="width:100%; font-size:12px; display:flex; align-items:center; justify-content:center; gap:6px;" onclick="quickModTimeout('${ticket.userId}')">
          <span>🔇 كتم العضو (10 دقائق)</span>
        </button>
      </div>
    </div>
  `;
}

window.copyUserId = (id) => {
  navigator.clipboard.writeText(id);
  showToast(`تم نسخ المعرف: ${id}`, 'info');
};

window.copyTranscript = (threadId) => {
  const ticket = currentTickets.find((t) => t.threadId === threadId);
  if (!ticket || !ticket.transcript || ticket.transcript.length === 0) {
    return showToast('لا توجد رسائل سابقة في سجل هذه التذكرة للنسخ', 'warning');
  }
  const text = ticket.transcript
    .map((m) => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.authorTag}: ${m.content}`)
    .join('\n');
  navigator.clipboard.writeText(text);
  showToast('تم نسخ سجل المحادثة بالكامل إلى الحافظة بنجاح!', 'success');
};

window.quickModWarn = async (userId) => {
  if (!adminToken || !userId) return;
  const reason = prompt('أدخل سبب التحذير الإداري الرسمي للعضو:');
  if (!reason || !reason.trim()) return;
  showToast('جارٍ تسجيل التحذير الإداري…', 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/warn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId: userId, reason: reason.trim() })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`تم توجيه التحذير بنجاح! إجمالي التحذيرات: ${data.warnCount || 1}`, 'success');
    } else {
      showToast(data.error || 'فشل توجيه التحذير', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء التحذير', 'error');
  }
};

window.quickModTimeout = async (userId) => {
  if (!adminToken || !userId) return;
  showToast('جارٍ تطبيق الكتم السريع…', 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/timeout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId: userId, durationMinutes: 10, reason: 'كتم سريع من شات الدعم الفني' })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('تم كتم العضو لمدة 10 دقائق بنجاح', 'success');
    } else {
      showToast(data.error || 'فشل الكتم', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال', 'error');
  }
};

window.handleAgentKey = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendSupportAgentReply();
  }
};

window.insertCanned = (text) => {
  const input = $('agentReplyInput');
  if (input) {
    input.value = text;
    input.focus();
  }
};

window.sendSupportAgentReply = async () => {
  if (!adminToken) return showToast('يرجى تسجيل الدخول أولاً', 'error');
  if (!activeTicketThreadId) return showToast('يرجى تحديد تذكرة دعم فني أولاً', 'warning');

  const contentInput = $('agentReplyInput');
  const imageInput = $('agentImageInput');
  const content = contentInput?.value.trim() || '';
  const imageUrl = imageInput?.value.trim() || '';

  if (!content && !imageUrl) {
    return showToast('يرجى كتابة نص الرسالة أو إرفاق رابط صورة', 'warning');
  }

  showToast('جارٍ إرسال رد الدعم الفني…', 'info');

  try {
    const res = await apiFetch(`/api/admin/tickets/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        threadId: activeTicketThreadId,
        content,
        imageUrl
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      if (contentInput) contentInput.value = '';
      if (imageInput) imageInput.value = '';
      showToast('تم إرسال الرد بنجاح إلى ديسكورد!', 'success');
      loadSupportTickets();
    } else {
      showToast(data.error || 'فشل إرسال الرد', 'error');
    }
  } catch {
    showToast('خطأ في الشبكة أثناء إرسال الرد', 'error');
  }
};

window.closeSupportTicket = async (threadId) => {
  if (!adminToken) return;
  showToast('جارٍ أرشفة وإغلاق التذكرة…', 'info');
  try {
    const res = await apiFetch(`/api/admin/tickets/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ threadId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('تم إغلاق وأرشفة التذكرة بنجاح', 'success');
      loadSupportTickets();
    } else {
      showToast(data.error || 'فشل إغلاق التذكرة', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء إغلاق التذكرة', 'error');
  }
};

window.deleteSupportTicket = async (threadId) => {
  if (!adminToken) return;
  if (!confirm('هل أنت متأكد من رغبتك في حذف هذه التذكرة نهائياً؟')) return;
  showToast('جارٍ حذف التذكرة نهائياً…', 'info');
  try {
    const res = await apiFetch(`/api/admin/tickets/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ threadId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('تم حذف التذكرة نهائياً بنجاح', 'success');
      activeTicketThreadId = null;
      loadSupportTickets();
    } else {
      showToast(data.error || 'فشل حذف التذكرة', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء حذف التذكرة', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   MODERATION MODULE (ARABIC)
   ══════════════════════════════════════════════════════ */
async function loadModData() {
  if (!adminToken) return;
  if (serverChannels.length > 0 && serverRoles.length > 0) {
    populateModSelects();
  }
  try {
    const res = await apiFetch(`/api/admin/mod/data`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      serverChannels = data.channels || [];
      serverRoles = data.roles || [];
      populateModSelects();
    }
  } catch (err) {
    console.error('Error loading mod data:', err);
  }
}

function populateModSelects() {
  const channelSelects = [
    $('purgeChannelSelect'),
    $('lockChannelSelect'),
    $('slowmodeChannelSelect'),
    $('broadcastChannelSelect')
  ];

  channelSelects.forEach((sel) => {
    if (!sel) return;
    if (!serverChannels || serverChannels.length === 0) {
      sel.innerHTML = '<option value="">لا توجد رومات متاحة</option>';
      return;
    }
    sel.innerHTML = serverChannels
      .map((c) => `<option value="${c.id}"># ${escapeHtml(c.name)}</option>`)
      .join('');
  });

  const roleSel = $('roleSelect');
  if (roleSel) {
    if (!serverRoles || serverRoles.length === 0) {
      roleSel.innerHTML = '<option value="">لا توجد رتب متاحة</option>';
      return;
    }
    roleSel.innerHTML = serverRoles
      .map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`)
      .join('');
  }
}

window.submitModBan = async () => {
  const targetId = $('banUserId')?.value.trim();
  const reason = $('banReason')?.value.trim() || 'مخالفة القوانين';
  const deleteMessageDays = parseInt($('banDeleteDays')?.value || '0', 10);
  if (!targetId) return showToast('يرجى إدخال معرف العضو', 'error');

  showToast('جارٍ تنفيذ الحظر النهائي…', 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, reason, deleteMessageDays })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم حظر العضو بنجاح', 'success');
      $('banUserId').value = '';
    } else {
      showToast(data.error || 'فشل الحظر', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء تنفيذ الحظر', 'error');
  }
};

window.submitModUnban = async () => {
  const targetId = $('unbanUserId')?.value.trim();
  const reason = $('unbanReason')?.value.trim() || 'عفو وقبول الطعن';
  if (!targetId) return showToast('يرجى إدخال معرف العضو', 'error');

  showToast('جارٍ فك الحظر…', 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/unban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, reason })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم فك الحظر بنجاح', 'success');
      $('unbanUserId').value = '';
    } else {
      showToast(data.error || 'فشل فك الحظر', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء فك الحظر', 'error');
  }
};

window.submitModKick = async () => {
  const targetId = $('kickUserId')?.value.trim();
  const reason = $('kickReason')?.value.trim() || 'طرد إداري';
  if (!targetId) return showToast('يرجى إدخال معرف العضو', 'error');

  showToast('جارٍ تنفيذ الطرد…', 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, reason })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم طرد العضو بنجاح', 'success');
      $('kickUserId').value = '';
    } else {
      showToast(data.error || 'فشل الطرد', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء تنفيذ الطرد', 'error');
  }
};

window.submitModTimeout = async () => {
  const targetId = $('timeoutUserId')?.value.trim();
  const durationMinutes = parseInt($('timeoutDuration')?.value || '10', 10);
  const reason = $('timeoutReason')?.value.trim() || 'كتم إداري';
  if (!targetId) return showToast('يرجى إدخال معرف العضو', 'error');

  showToast('جارٍ تطبيق الكتم…', 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/timeout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, durationMinutes, reason })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم كتم العضو بنجاح', 'success');
    } else {
      showToast(data.error || 'فشل تطبيق الكتم', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء تطبيق الكتم', 'error');
  }
};

window.submitModUntimeout = async () => {
  const targetId = $('timeoutUserId')?.value.trim();
  if (!targetId) return showToast('يرجى إدخال معرف العضو', 'error');

  showToast('جارٍ إلغاء الكتم…', 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/timeout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, durationMinutes: 0, reason: 'إلغاء الكتم مبكراً' })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('تم إلغاء الكتم عن العضو بنجاح', 'success');
    } else {
      showToast(data.error || 'فشل إلغاء الكتم', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء إلغاء الكتم', 'error');
  }
};

window.submitModPurge = async () => {
  const channelId = $('purgeChannelSelect')?.value;
  const count = parseInt($('purgeCount')?.value || '10', 10);
  const filterUserId = $('purgeFilterUser')?.value.trim() || null;
  if (!channelId) return showToast('يرجى اختيار الروم', 'error');

  showToast(`جارٍ مسح ${count} رسالة…`, 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ channelId, count, filterUserId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم مسح الرسائل بنجاح', 'success');
    } else {
      showToast(data.error || 'فشل مسح الرسائل', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء مسح الرسائل', 'error');
  }
};

window.submitModChannelLock = async (locked) => {
  const channelId = $('lockChannelSelect')?.value;
  if (!channelId) return showToast('يرجى اختيار الروم', 'error');

  showToast(`جارٍ ${locked ? 'قفل' : 'فتح'} الروم…`, 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ channelId, locked })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || `تم ${locked ? 'قفل' : 'فتح'} الروم بنجاح`, 'success');
    } else {
      showToast(data.error || 'فشل تغيير حالة الروم', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال', 'error');
  }
};

window.submitModSlowmode = async () => {
  const channelId = $('slowmodeChannelSelect')?.value;
  const seconds = parseInt($('slowmodeSeconds')?.value || '0', 10);
  if (!channelId) return showToast('يرجى اختيار الروم', 'error');

  showToast('جارٍ تطبيق السلو مود…', 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/slowmode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ channelId, seconds })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم تطبيق السلو مود بنجاح', 'success');
    } else {
      showToast(data.error || 'فشل تطبيق السلو مود', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال', 'error');
  }
};

window.submitModRole = async (action) => {
  const targetId = $('roleUserId')?.value.trim();
  const roleId = $('roleSelect')?.value;
  if (!targetId) return showToast('يرجى إدخال معرف العضو', 'error');
  if (!roleId) return showToast('يرجى اختيار الرتبة', 'error');

  showToast(`جارٍ ${action === 'add' ? 'منح' : 'سحب'} الرتبة…`, 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, roleId, action })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم تعديل الرتبة بنجاح', 'success');
    } else {
      showToast(data.error || 'فشل تعديل الرتبة', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء تعديل الرتبة', 'error');
  }
};

window.submitModVoiceAction = async () => {
  const targetId = $('voiceUserId')?.value.trim();
  const action = $('voiceActionSelect')?.value || 'mute';
  if (!targetId) return showToast('يرجى اختيار العضو المتصل بالصوت', 'error');

  showToast(`جارٍ تنفيذ الإجراء الصوتي (${action})…`, 'info');
  try {
    const res = await apiFetch(`/api/admin/mod/voice-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, action })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم تنفيذ الإجراء الصوتي بنجاح', 'success');
    } else {
      showToast(data.error || 'فشل تنفيذ الإجراء الصوتي', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء تنفيذ الإجراء الصوتي', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   REALTIME TELEMETRY & SSE STREAM (ARABIC)
   ══════════════════════════════════════════════════════ */
let streamEventSource = null;
let streamFallbackTimer = null;

function startRealtimeStream() {
  if (streamEventSource) {
    try { streamEventSource.close(); } catch {}
    streamEventSource = null;
  }
  if (streamFallbackTimer) {
    clearInterval(streamFallbackTimer);
    streamFallbackTimer = null;
  }

  const sseUrl = `${API_BASE}/api/stream`;
  try {
    streamEventSource = new EventSource(sseUrl);

    streamEventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        updateTelemetry(data);
      } catch {}
    };

    streamEventSource.onerror = () => {
      if (API_BASE !== LIVE_BACKEND_URL) {
        API_BASE = LIVE_BACKEND_URL;
        startRealtimeStream();
        return;
      }
      if (!streamFallbackTimer) {
        streamFallbackTimer = setInterval(async () => {
          try {
            const res = await apiFetch('/api/status');
            if (res.ok) {
              const data = await res.json();
              updateTelemetry(data);
            }
          } catch {}
        }, 1500);
      }
    };
  } catch {
    if (!streamFallbackTimer) {
      streamFallbackTimer = setInterval(async () => {
        try {
          const res = await apiFetch('/api/status');
          if (res.ok) {
            const data = await res.json();
            updateTelemetry(data);
          }
        } catch {}
      }, 1500);
    }
  }
}

function updateTelemetry(d) {
  const pill = $('livePillText');
  if (pill) pill.textContent = `متصل ومباشر · ${d.ping || 0}ms`;

  if ($('valPing')) $('valPing').textContent = d.ping || 0;
  if ($('valUptime')) $('valUptime').textContent = formatUptime(d.uptimeSeconds || 0);
  if ($('valMemory')) $('valMemory').textContent = Math.round((d.memory?.heapUsed || 0) / 1024 / 1024);
  if ($('valMembers')) $('valMembers').textContent = d.guild?.memberCount || '--';

  // Live Tab Counters & Badges
  if (d.counts) {
    if ($('badgeOpenTickets') && typeof d.counts.openTickets === 'number') {
      $('badgeOpenTickets').textContent = d.counts.openTickets;
    }
  }

  // Live Notifications Synchronization
  if (d.recentNotifications && Array.isArray(d.recentNotifications) && d.recentNotifications.length > 0) {
    let hasNew = false;
    d.recentNotifications.forEach((rn) => {
      if (!notifications.some((n) => n.id === rn.id)) {
        notifications.unshift(rn);
        unreadNotifCount++;
        hasNew = true;
      }
    });
    if (hasNew) {
      if (notifications.length > 40) notifications = notifications.slice(0, 40);
      renderNotifications();
      // If currently on support tab, refresh ticket list seamlessly
      if (activeTab === 'support') {
        loadSupportTickets();
      }
    }
  }

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
  return `${h}س ${m}د ${s}ث`;
}

function renderVcrGrid(fleet) {
  const grid = $('vcrFleetGrid');
  if (!grid) return;
  grid.innerHTML = fleet
    .map(
      (w, i) => `
      <div class="panel-card" style="padding: 16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px;">
          <span style="font-weight:800; font-size:14px;">مسجل VCR #${i + 1}</span>
          <span class="status-chip ${w.status === 'online' ? '' : 'inactive'}">${w.status === 'online' ? 'متصل' : 'غير متصل'}</span>
        </div>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom: 12px;">
          الروم: <span class="text-white">${w.defaultChannelName || 'مخصص'}</span>
        </div>
        <button class="btn-action" style="width:100%; font-size:11.5px;" onclick="reconnectSingleVCR('${w.id}')">
          مثبت ومقفول بالروم
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
      <span>[${new Date(l.timestamp || l.ts || Date.now()).toLocaleTimeString('ar-SA')}] <strong>${escapeHtml(l.action)}</strong>: ${escapeHtml(l.details || l.detail || '')}</span>
      <span class="mono text-muted">${l.category || l.type || 'نظام'}</span>
    </li>
  `
    )
    .join('');
}

/* ══════════════════════════════════════════════════════
   APPEALS COMMAND CENTER (ARABIC)
   ══════════════════════════════════════════════════════ */
async function loadAppeals() {
  if (!adminToken) return;
  try {
    const res = await apiFetch(`/api/admin/appeals`, {
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
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">لا توجد طعون مطابقة لمعايير البحث.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (a) => `
    <tr>
      <td><strong class="text-white">${escapeHtml(a.userTag || 'غير معروف')}</strong></td>
      <td class="mono">${a.targetId}</td>
      <td class="text-muted">${new Date(a.createdAt || Date.now()).toLocaleDateString('ar-SA')}</td>
      <td style="max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${escapeHtml(a.statement || 'لم يتم تقديم إفادة')}
      </td>
      <td>
        <span class="badge-status ${a.status}">
          ${a.status === 'approved' ? 'تم القبول وفك الحظر' : a.status === 'rejected' ? 'مرفوض' : 'قيد الانتظار'}
        </span>
      </td>
      <td style="text-align: left;">
        <button class="btn-action" onclick="openStatementModal('${a.targetId}')">مراجعة</button>
        ${
          a.status === 'pending'
            ? `
          <button class="btn-action primary" onclick="resolveAppeal('${a.targetId}', 'approve')">قبول وفك العزل</button>
          <button class="btn-action danger" onclick="resolveAppeal('${a.targetId}', 'reject')">رفض</button>
        `
            : a.status === 'approved'
            ? `
          <button class="btn-action warning" style="color: #FEE75C; border-color: rgba(254,231,92,0.4);" onclick="resolveAppeal('${a.targetId}', 'revoke')">إلغاء القبول وعزل</button>
          <button class="btn-action danger" onclick="resolveAppeal('${a.targetId}', 'delete')">حذف</button>
        `
            : `
          <button class="btn-action danger" onclick="resolveAppeal('${a.targetId}', 'delete')">حذف السجل</button>
        `
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

  if ($('modalUserTag')) $('modalUserTag').textContent = `بيان الطعن: ${appeal.userTag || targetId}`;
  if ($('modalUserId')) $('modalUserId').textContent = targetId;
  if ($('modalStatementText')) $('modalStatementText').textContent = appeal.statement || 'لا توجد تفاصيل مرفقة';

  const actionsEl = $('modalActions');
  if (actionsEl) {
    if (appeal.status === 'pending') {
      actionsEl.innerHTML = `
        <button class="btn-action primary" onclick="resolveAppeal('${targetId}', 'approve')">قبول الطعن وفك العزل</button>
        <button class="btn-action danger" onclick="resolveAppeal('${targetId}', 'reject')">رفض وتثبيت الحظر</button>
      `;
    } else if (appeal.status === 'approved') {
      actionsEl.innerHTML = `
        <span class="badge-status approved" style="margin-left: 10px;">تم القبول مسبقاً (${appeal.handledByName || 'الإدارة'})</span>
        <button class="btn-action warning" style="color: #FEE75C; border-color: rgba(254,231,92,0.4);" onclick="resolveAppeal('${targetId}', 'revoke')">إلغاء القبول وإعادة العزل</button>
        <button class="btn-action danger" onclick="resolveAppeal('${targetId}', 'delete')">حذف السجل</button>
      `;
    } else {
      actionsEl.innerHTML = `
        <span class="badge-status rejected" style="margin-left: 10px;">مرفوض</span>
        <button class="btn-action danger" onclick="resolveAppeal('${targetId}', 'delete')">حذف السجل نهائياً</button>
      `;
    }
  }

  $('statementModal')?.classList.add('open');
};

window.closeStatementModal = () => {
  $('statementModal')?.classList.remove('open');
};

window.resolveAppeal = async (targetId, action) => {
  if (!adminToken) return showToast('يرجى تسجيل الدخول أولاً', 'error');

  if (action === 'delete') {
    if (!confirm('هل أنت متأكد من رغبتك في حذف سجل هذا الطعن نهائياً؟')) return;
  }
  if (action === 'revoke') {
    if (!confirm('هل أنت متأكد من رغبتك في إلغاء قرار القبول وسحب الرتب وإعادة عزل الحساب برتبة Banned By Anti-Spy؟')) return;
  }

  try {
    const res = await apiFetch(`/api/admin/appeals/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetId, action })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      let toastMsg = 'تم تنفيذ الإجراء بنجاح!';
      if (action === 'approve') toastMsg = 'تم قبول الطعن وإلغاء العزل وإرسال طلب التوثيق بنجاح!';
      else if (action === 'reject') toastMsg = 'تم رفض الطعن وتثبيت الحظر النهائي بنجاح!';
      else if (action === 'revoke') toastMsg = 'تم إلغاء قرار القبول وإعادة عزل الحساب بنجاح!';
      else if (action === 'delete') toastMsg = 'تم حذف سجل الطعن بنجاح!';

      showToast(toastMsg, 'success');
      window.closeStatementModal();
      loadAppeals();
      if (typeof loadVerifications === 'function') loadVerifications();
      if (typeof loadOverviewData === 'function') loadOverviewData();
    } else {
      showToast(data.error || 'فشلت معالجة الطعن', 'error');
    }
  } catch {
    showToast('خطأ في الشبكة أثناء معالجة الطعن', 'error');
  }
};

window.clearAllAppeals = async () => {
  if (!adminToken) return showToast('يرجى تسجيل الدخول أولاً', 'error');
  if (!confirm('هل أنت متأكد من رغبتك في تفريغ ومسح كافة سجلات الطعون نهائياً؟')) return;

  try {
    const res = await apiFetch(`/api/admin/appeals/clear-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('تم تفريغ ومسح كافة سجلات الطعون بنجاح!', 'success');
      currentAppeals = [];
      loadAppeals();
      if (typeof loadOverviewData === 'function') loadOverviewData();
    } else {
      showToast(data.error || 'فشل مسح الطعون', 'error');
    }
  } catch {
    showToast('خطأ في الشبكة أثناء تفريغ الطعون', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   VERIFICATIONS & GATEKEEPER (ARABIC)
   ══════════════════════════════════════════════════════ */
window.setVerificationFilter = (filter) => {
  verificationFilter = filter;
  document.querySelectorAll('.vfilter-chip').forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-vfilter') === filter);
  });
  renderVerificationsTable();
};

async function loadVerifications() {
  if (!adminToken) return;
  try {
    const res = await apiFetch(`/api/admin/verifications`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentVerifications = data.verifications || [];
      renderVerificationsTable();
    }
  } catch {}
}

function formatAccountAge(ts) {
  if (!ts) return 'غير محدد';
  const diffMs = Date.now() - ts;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 1) return '<span class="text-danger font-weight-bold">جديد اليوم</span>';
  if (days < 7) return `<span class="text-warning">${days} أيام</span>`;
  if (days < 30) return `${Math.floor(days / 7)} أسابيع`;
  if (days < 365) return `${Math.floor(days / 30)} أشهر`;
  return `${(days / 365).toFixed(1)} سنة`;
}

function renderVerificationsTable() {
  const tbody = $('verificationsTableBody');
  if (!tbody) return;

  const searchQuery = ($('searchVerifications')?.value || '').toLowerCase();

  const pendingList = currentVerifications.filter(v => v.status === 'pending' && !v.hidden);
  const approvedList = currentVerifications.filter(v => v.status === 'approved' && !v.hidden);
  const hiddenList = currentVerifications.filter(v => Boolean(v.hidden));

  if ($('chipPendingCount')) $('chipPendingCount').textContent = pendingList.length;
  if ($('chipApprovedCount')) $('chipApprovedCount').textContent = approvedList.length;
  if ($('chipHiddenCount')) $('chipHiddenCount').textContent = hiddenList.length;
  if ($('badgePendingVerifications')) $('badgePendingVerifications').textContent = pendingList.length;

  let currentList = [];
  if (verificationFilter === 'pending') currentList = pendingList;
  else if (verificationFilter === 'approved') currentList = approvedList;
  else if (verificationFilter === 'hidden') currentList = hiddenList;

  const filtered = currentList.filter((v) => {
    const matchSearch =
      (v.userTag || '').toLowerCase().includes(searchQuery) ||
      (v.targetId || '').toLowerCase().includes(searchQuery);
    return matchSearch;
  });

  if (filtered.length === 0) {
    const emptyMessages = {
      pending: 'لا توجد طلبات توثيق نشطة بانتظار المراجعة.',
      approved: 'لا توجد طلبات موثقة حالياً.',
      hidden: 'لا توجد طلبات مخفية أو مؤرشفة.'
    };
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">${emptyMessages[verificationFilter] || 'لا توجد عناصر مطابقة.'}</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map(
      (v) => `
    <tr>
      <td>
        <div style="display: flex; align-items: center; gap: 10px;">
          <img src="${v.userAvatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="" style="width: 34px; height: 34px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.15);" />
          <div>
            <strong class="text-white">${escapeHtml(v.userTag || 'غير معروف')}</strong>
            ${!v.isCurrentlyInServer ? '<span style="font-size: 11px; color: var(--color-danger); display: block;">(غادر السيرفر)</span>' : ''}
          </div>
        </div>
      </td>
      <td class="mono">
        <span style="display: inline-flex; align-items: center; gap: 6px;">
          ${v.targetId}
          <button class="btn-action" style="padding: 2px 6px; font-size: 11px;" onclick="navigator.clipboard.writeText('${v.targetId}'); showToast('تم نسخ المعرف: ${v.targetId}', 'info');" title="نسخ المعرف">نسخ</button>
        </span>
      </td>
      <td>${formatAccountAge(v.accountCreatedAt)}</td>
      <td><span class="status-chip" style="font-size: 11px;">${v.joinCount || 1} ${v.joinCount > 1 ? 'مرات' : 'مرة'}</span></td>
      <td class="text-muted">${new Date(v.createdAt || Date.now()).toLocaleDateString('ar-SA')}</td>
      <td>
        <span class="badge-status ${v.status}">
          ${v.status === 'approved' ? 'موثق (MEMBER)' : v.status === 'rejected' ? 'مرفوض' : 'قيد الانتظار'}
        </span>
        ${v.handledByName ? `<div style="font-size: 10px; color: var(--color-muted); margin-top: 3px;">بواسطة: ${escapeHtml(v.handledByName)}</div>` : ''}
        ${v.hidden ? `<div style="font-size: 10px; color: var(--color-warning); margin-top: 3px;">(مخفي / مؤرشف)</div>` : ''}
      </td>
      <td style="text-align: left;">
        <div style="display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap;">
          ${
            verificationFilter === 'hidden'
              ? `
            <button class="btn-action primary" onclick="resolveVerification('${v.targetId}', 'unhide')" title="استعادة إلى قائمة الطلبات النشطة">استعادة للنشطة</button>
            <button class="btn-action" onclick="resolveVerification('${v.targetId}', 'approve')" title="قبول وتوثيق العضو">قبول وتوثيق</button>
            <button class="btn-action danger" onclick="resolveVerification('${v.targetId}', 'delete')" title="حذف السجل نهائياً">حذف نهائي</button>
          `
              : verificationFilter === 'approved'
              ? `
            <button class="btn-action" onclick="resolveVerification('${v.targetId}', 'hide')" title="إخفاء من قائمة الموثقين ونقله للمخفية">إخفاء الطلب</button>
            <button class="btn-action danger" onclick="resolveVerification('${v.targetId}', 'ban')" title="حظر العضو">حظر</button>
          `
              : `
            <button class="btn-action primary" onclick="resolveVerification('${v.targetId}', 'approve')" title="منح رتبة MEMBER وإلغاء UNTRUSTED وتفعيل الكتابة">قبول وتوثيق</button>
            <button class="btn-action" onclick="resolveVerification('${v.targetId}', 'hide')" title="إخفاء هذا الطلب ونقله إلى قسم المخفية">إخفاء الطلب</button>
            <button class="btn-action danger" onclick="resolveVerification('${v.targetId}', 'kick')" title="طرد العضو من السيرفر">طرد</button>
            <button class="btn-action danger" onclick="resolveVerification('${v.targetId}', 'ban')" title="حظر العضو نهائياً">حظر</button>
          `
          }
        </div>
      </td>
    </tr>
  `
    )
    .join('');
}

window.resolveVerification = async (targetId, action) => {
  if (!adminToken) return;
  const actionNames = {
    approve: 'قبول وتوثيق العضو ومنحه رتبة MEMBER',
    reject: 'رفض طلب التوثيق',
    hide: 'إخفاء الطلب ونقله لقسم المخفية',
    unhide: 'استعادة الطلب لقائمة الطلبات النشطة',
    delete: 'حذف سجل الطلب نهائياً',
    kick: 'طرد العضو من السيرفر',
    ban: 'حظر العضو نهائياً'
  };

  showToast(`جارٍ تنفيذ (${actionNames[action] || action})…`, 'info');

  try {
    const res = await apiFetch(`/api/admin/verifications/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetId, action })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || `تمت العملية بنجاح!`, 'success');
      loadVerifications();
    } else {
      showToast(data.error || 'فشلت معالجة طلب التوثيق', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء معالجة طلب التوثيق', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   PANELS & BOT OPERATIONS (ARABIC)
   ══════════════════════════════════════════════════════ */
async function loadPanels() {
  if (!adminToken) return;
  try {
    const res = await apiFetch(`/api/admin/panels`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.panels) {
        if ($('chipTicketStatus')) {
          $('chipTicketStatus').textContent = data.panels.ticketPanel?.status === 'active' ? 'نشط' : 'غير نشط';
          $('chipTicketStatus').className = `status-chip ${data.panels.ticketPanel?.status === 'active' ? '' : 'inactive'}`;
        }
        if ($('chipEventStatus')) {
          $('chipEventStatus').textContent = data.panels.eventPanel?.status === 'active' ? 'نشط' : 'غير نشط';
          $('chipEventStatus').className = `status-chip ${data.panels.eventPanel?.status === 'active' ? '' : 'inactive'}`;
        }
      }
    }
  } catch {}
}

window.deployPanel = async (panelType) => {
  if (!adminToken) return;
  showToast(`جارٍ نشر بانل (${panelType}) في ديسكورد…`, 'info');
  try {
    const res = await apiFetch(`/api/admin/panels/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ panelType })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم نشر البانل بنجاح!', 'success');
      loadPanels();
    } else {
      showToast(data.error || 'فشل نشر البانل', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء نشر البانل', 'error');
  }
};

window.removePanel = async (panelType) => {
  if (!adminToken) return;
  showToast(`جارٍ حذف بانل (${panelType}) من ديسكورد…`, 'info');
  try {
    const res = await apiFetch(`/api/admin/panels/remove`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ panelType })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم حذف البانل بنجاح!', 'success');
      loadPanels();
    } else {
      showToast(data.error || 'فشل حذف البانل', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء حذف البانل', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   VCR FLEET CONTROLS (ARABIC)
   ══════════════════════════════════════════════════════ */
window.forceReStationVCR = async () => {
  if (!adminToken) return;
  showToast('جارٍ إعادة تثبيت وضبط أسطول مسجلات الصوت…', 'info');
  try {
    const res = await apiFetch(`/api/admin/vcr/re-station`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تمت إعادة تثبيت المسجلات بنجاح!', 'success');
    } else {
      showToast(data.error || 'فشلت إعادة التثبيت', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال', 'error');
  }
};

window.reconnectSingleVCR = async (vcrId) => {
  if (!adminToken) return;
  showToast(`جارٍ فحص وإعادة تثبيت مسجل VCR: ${vcrId}…`, 'info');
  try {
    const res = await apiFetch(`/api/admin/vcr/reconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({ vcrId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تمت إعادة ربط المسجل بنجاح!', 'success');
    } else {
      showToast(data.error || 'فشلت إعادة ربط المسجل', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   SECURITY & MASS ROLE SYNC (ARABIC)
   ══════════════════════════════════════════════════════ */
window.triggerMassSync = async () => {
  if (!adminToken) return;
  const btn = $('btnSyncRoles');
  if (btn) btn.disabled = true;
  showToast('جارٍ تنفيذ الفحص والمزامنة الشاملة لكافة أعضاء ورتب السيرفر…', 'info');

  try {
    const res = await apiFetch(`/api/admin/security/sync-all`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`اكتملت المزامنة بنجاح! تم فحص وتحديث (${data.updatedCount || 0}) عضواً.`, 'success');
    } else {
      showToast(data.error || 'فشلت المزامنة الشاملة', 'error');
    }
  } catch {
    showToast('خطأ في الشبكة أثناء المزامنة', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

/* ══════════════════════════════════════════════════════
   OFFICIAL BROADCAST STUDIO (ARABIC)
   ══════════════════════════════════════════════════════ */
function updateBroadcastPreview() {
  const mention = $('broadcastMention')?.value || 'none';
  const title = $('broadcastTitle')?.value.trim() || 'إشعار من الإدارة العليا';
  const message = $('broadcastMessage')?.value.trim() || 'تفاصيل الإعلان ستظهر هنا مباشرة أثناء الكتابة…';
  const imageUrl = $('broadcastImage')?.value.trim();
  const colorNum = parseInt($('broadcastColor')?.value || '16777215', 10);
  const colorHex = '#' + colorNum.toString(16).padStart(6, '0');

  const mentionEl = $('broadcastPreviewMention');
  if (mentionEl) {
    if (mention === 'everyone') {
      mentionEl.style.display = 'block';
      mentionEl.textContent = '@everyone';
    } else if (mention === 'here') {
      mentionEl.style.display = 'block';
      mentionEl.textContent = '@here';
    } else {
      mentionEl.style.display = 'none';
    }
  }

  if ($('broadcastPreviewTitle')) $('broadcastPreviewTitle').textContent = title;
  if ($('broadcastPreviewDesc')) $('broadcastPreviewDesc').textContent = message;

  const embedBox = $('broadcastPreviewEmbed');
  if (embedBox) embedBox.style.borderRightColor = colorHex;

  const imgContainer = $('broadcastPreviewImageContainer');
  const imgEl = $('broadcastPreviewImg');
  if (imgContainer && imgEl) {
    if (imageUrl && imageUrl.startsWith('http')) {
      imgEl.src = imageUrl;
      imgContainer.style.display = 'block';
    } else {
      imgContainer.style.display = 'none';
    }
  }
}

// Bind live preview listeners
['broadcastMention', 'broadcastTitle', 'broadcastMessage', 'broadcastImage', 'broadcastColor'].forEach((id) => {
  $(id)?.addEventListener('input', updateBroadcastPreview);
  $(id)?.addEventListener('change', updateBroadcastPreview);
});

window.sendBroadcast = async () => {
  if (!adminToken) return showToast('يرجى تسجيل الدخول أولاً', 'error');

  const channelId = $('broadcastChannelSelect')?.value;
  const mention = $('broadcastMention')?.value || 'none';
  const title = $('broadcastTitle')?.value.trim();
  const message = $('broadcastMessage')?.value.trim();
  const imageUrl = $('broadcastImage')?.value.trim() || null;
  const color = parseInt($('broadcastColor')?.value || '16777215', 10);

  if (!channelId || !title || !message) {
    return showToast('يرجى اختيار الروم وكتابة عنوان ونص الإعلان الرسمي', 'warning');
  }

  showToast('جارٍ إرسال ونشر الإعلان الرسمي…', 'info');

  try {
    const res = await apiFetch(`/api/admin/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        channelId,
        mention,
        title,
        message,
        imageUrl,
        color
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم نشر الإعلان الرسمي بنجاح في ديسكورد!', 'success');
      if ($('broadcastTitle')) $('broadcastTitle').value = '';
      if ($('broadcastMessage')) $('broadcastMessage').value = '';
      if ($('broadcastImage')) $('broadcastImage').value = '';
      updateBroadcastPreview();
    } else {
      showToast(data.error || 'فشل إرسال الإعلان', 'error');
    }
  } catch {
    showToast('خطأ في الشبكة أثناء نشر الإعلان', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   EVENT LOGS MODULE (ARABIC)
   ══════════════════════════════════════════════════════ */
window.clearEventLog = () => {
  const list = $('eventStreamList');
  if (list) {
    list.innerHTML = '<li class="log-entry">تم مسح سجل الأحداث من الشاشة.</li>';
    showToast('تم مسح الشاشة', 'info');
  }
};
