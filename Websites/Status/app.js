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
      showToast('✅ تم توثيق الدخول بنجاح! مرحباً بك في مركز قيادة GX eSports.', 'success');
      loadAppeals();
      loadPanels();
      loadModData();
      loadSupportTickets();
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
  showToast('تم قفل الجلسة بنجاح.', 'info');
}

/* ══════════════════════════════════════════════════════
   TAB SWITCHING & TITLES (ARABIC)
   ══════════════════════════════════════════════════════ */
const TAB_METAS = {
  overview: { title: 'نظرة عامة على النظام', sub: 'المؤشرات التشغيلية والقياسات الحية اللحظية' },
  support: { title: 'مركز الدعم الفني المباشر', sub: 'منصة المحادثة المباشرة ثنائية الاتجاه مع أعضاء ديسكورد' },
  moderation: { title: 'مركز الإشراف والأدوات الإدارية', sub: 'تنفيذ القرارات الإدارية وعمليات العقاب والعزل من الموقع' },
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
  if (tabId === 'appeals') loadAppeals();
  if (tabId === 'panels') loadPanels();
  if (tabId === 'moderation') loadModData();
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
          <span class="member-id-line">${m.id} ${m.isBot ? '• 🤖 بوت' : ''}</span>
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
   LIVE SUPPORT DESK COMMAND CENTER (ARABIC)
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
    container.innerHTML = `<div class="text-center text-muted py-4" style="font-size:12.5px;">لا توجد تذاكر دعم فني حالياً.</div>`;
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
            <span class="support-ticket-time">${new Date(t.lastActivityAt || t.openedAt || Date.now()).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="support-ticket-user">${escapeHtml(t.userTag || 'عضو')}</div>
          <div class="support-ticket-snippet">${escapeHtml(lastMsg || '')}</div>
          <div style="margin-top: 4px; display:flex; gap:6px; align-items:center;">
            <span class="badge-status ${isClosed ? 'rejected' : 'pending'}" style="font-size: 10.5px; padding: 2px 6px;">
              ${isClosed ? '🔒 مغلقة ومؤرشفة' : '💬 نشطة ومفتوحة'}
            </span>
            ${t.hasUnreadAgent && !isClosed ? `<span class="badge-status" style="background:var(--red); color:#fff; font-size:9.5px; padding:1px 6px;">رسالة جديدة</span>` : ''}
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
  if ($('chatUserTitle')) $('chatUserTitle').textContent = `${ticket.userTag} (${ticket.realName || 'صاحب التذكرة'})`;
  if ($('chatTicketCode')) $('chatTicketCode').textContent = `${ticket.ticketId} • معرف ديسكورد: ${ticket.userId}`;

  // Header Actions
  const headerActions = $('chatHeaderActions');
  if (headerActions) {
    if (ticket.stage !== 'CLOSED') {
      headerActions.innerHTML = `
        <button class="btn-action danger" onclick="closeSupportTicket('${ticket.threadId}')">
          🔒 إغلاق وأرشفة التذكرة
        </button>
      `;
    } else {
      headerActions.innerHTML = `<span class="status-chip inactive">مغلقة</span>`;
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
    stream.innerHTML = `<div class="text-center text-muted py-4">لا توجد رسائل سابقة في هذه التذكرة.</div>`;
    return;
  }

  stream.innerHTML = transcript
    .map((msg) => {
      const isAgent = !!msg.isAgent || msg.authorTag.includes('الدعم');
      const timeStr = new Date(msg.timestamp || Date.now()).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
      const imagesHtml = (msg.attachments || [])
        .map((img) => `<a href="${img}" target="_blank"><img src="${img}" class="chat-bubble-image" alt="مرفق" /></a>`)
        .join('');

      return `
        <div class="chat-bubble-wrap ${isAgent ? 'agent' : 'user'}">
          <div class="chat-bubble-meta">
            <span>${isAgent ? '🛡️ وكيل الدعم الفني لـ GX' : escapeHtml(msg.authorTag || ticket.userTag)}</span>
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
      <div style="font-weight:800; font-size:14.5px;">${escapeHtml(ticket.userTag || 'غير معروف')}</div>
      <div class="mono" style="font-size:11px; color:var(--text-sub);">${ticket.userId}</div>
    </div>
    <div class="spec-row">
      <span class="spec-name">رقم التذكرة</span>
      <span class="spec-val mono text-white">${ticket.ticketId}</span>
    </div>
    <div class="spec-row">
      <span class="spec-name">الاسم المسجل</span>
      <span class="spec-val">${escapeHtml(ticket.realName || 'لم يُحدد')}</span>
    </div>
    <div class="spec-row">
      <span class="spec-name">حالة الجلسة</span>
      <span class="spec-val text-white">${ticket.stage === 'CLOSED' ? 'مغلقة' : 'قيد المعالجة'}</span>
    </div>
    <div class="spec-row">
      <span class="spec-name">وقت الفتح</span>
      <span class="spec-val">${new Date(ticket.openedAt || Date.now()).toLocaleDateString('ar-SA')}</span>
    </div>
    <div style="margin-top: 14px;">
      <div style="font-size: 11.5px; color: var(--text-sub); font-weight:700; margin-bottom:4px;">وصف المشكلة الأساسي:</div>
      <div style="background:var(--bg-dark); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm); font-size:12.5px; line-height:1.5;">
        ${escapeHtml(ticket.reason || 'لا يوجد وصف')}
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
    showToast('يرجى كتابة نص الرد أو وضع رابط الصورة', 'error');
    return;
  }

  showToast('جارٍ إرسال الرد إلى ديسكورد…', 'info');
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
        agentName: 'وكيل الدعم الفني (GX Support)'
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      if (replyInput) replyInput.value = '';
      if (imageInput) imageInput.value = '';
      showToast('✅ تم تسليم الرد للعضو في ديسكورد بنجاح!', 'success');
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
  if (!confirm('هل أنت متأكد من رغبتك في إغلاق وأرشفة هذه التذكرة؟')) return;

  showToast('جارٍ إغلاق التذكرة…', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/tickets/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        threadId: threadId || activeTicketThreadId,
        reason: 'تم الحل والإغلاق عبر مركز الدعم الفني بالموقع'
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('🔒 تم إغلاق وأرشفة التذكرة بنجاح في ديسكورد!', 'success');
      loadSupportTickets();
    } else {
      showToast(data.error || 'فشل إغلاق التذكرة', 'error');
    }
  } catch {
    showToast('خطأ في الشبكة أثناء إغلاق التذكرة', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   MODERATION METADATA & SELECTORS (ARABIC)
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
   MODERATION ACTION HANDLERS (ARABIC)
   ══════════════════════════════════════════════════════ */
window.submitModBan = async () => {
  const targetId = $('banUserId')?.value.trim();
  const reason = $('banReason')?.value.trim();
  const deleteMessageDays = parseInt($('banDeleteDays')?.value || '0');
  if (!targetId) return showToast('يرجى تحديد أو إدخال معرف العضو', 'error');

  showToast(`جارٍ تنفيذ الحظر النهائي على ${targetId}…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, reason, deleteMessageDays })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم حظر العضو بنجاح', 'success');
      $('banUserId').value = '';
    } else {
      showToast(data.error || 'فشل حظر العضو', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء تنفيذ الحظر', 'error');
  }
};

window.submitModUnban = async () => {
  const targetId = $('unbanUserId')?.value.trim();
  const reason = $('unbanReason')?.value.trim();
  if (!targetId) return showToast('يرجى إدخال معرف العضو المحظور', 'error');

  showToast(`جارٍ فك الحظر عن ${targetId}…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/unban`, {
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
  const reason = $('kickReason')?.value.trim();
  if (!targetId) return showToast('يرجى تحديد أو إدخال معرف العضو', 'error');

  showToast(`جارٍ طرد العضو ${targetId}…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, reason })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم طرد العضو بنجاح', 'success');
      $('kickUserId').value = '';
    } else {
      showToast(data.error || 'فشل طرد العضو', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء تنفيذ الطرد', 'error');
  }
};

window.submitModTimeout = async () => {
  const targetId = $('timeoutUserId')?.value.trim();
  const durationMinutes = parseInt($('timeoutDuration')?.value || '10');
  const reason = $('timeoutReason')?.value.trim();
  if (!targetId) return showToast('يرجى تحديد أو إدخال معرف العضو', 'error');

  showToast(`جارٍ تطبيق الكتم لمدة ${durationMinutes} دقيقة على ${targetId}…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/timeout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId, durationMinutes, reason })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم تطبيق الكتم بنجاح', 'success');
      $('timeoutUserId').value = '';
    } else {
      showToast(data.error || 'فشل تطبيق الكتم', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء تطبيق الكتم', 'error');
  }
};

window.submitModUntimeout = async () => {
  const targetId = $('timeoutUserId')?.value.trim();
  if (!targetId) return showToast('يرجى تحديد أو إدخال معرف العضو', 'error');

  showToast(`جارٍ إلغاء الكتم عن ${targetId}…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/untimeout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ targetId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم إلغاء الكتم بنجاح', 'success');
      $('timeoutUserId').value = '';
    } else {
      showToast(data.error || 'فشل إلغاء الكتم', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء إلغاء الكتم', 'error');
  }
};

window.submitModPurge = async () => {
  const channelId = $('purgeChannelSelect')?.value;
  const count = parseInt($('purgeCount')?.value || '10');
  const targetUserId = $('purgeFilterUser')?.value.trim() || null;
  if (!channelId) return showToast('يرجى اختيار الروم المستهدف', 'error');

  showToast(`جارٍ مسح ${count} رسالة…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ channelId, count, targetUserId })
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
  if (!channelId) return showToast('يرجى اختيار الروم المستهدف', 'error');

  showToast(`جارٍ ${locked ? 'قفل' : 'فتح'} الروم…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ channelId, locked })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم تعديل قفل الروم بنجاح', 'success');
    } else {
      showToast(data.error || 'فشل تعديل قفل الروم', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء تعديل القفل', 'error');
  }
};

window.submitModSlowmode = async () => {
  const channelId = $('slowmodeChannelSelect')?.value;
  const seconds = parseInt($('slowmodeSeconds')?.value || '0');
  if (!channelId) return showToast('يرجى اختيار الروم المستهدف', 'error');

  showToast(`جارٍ ضبط السلو مود على ${seconds} ثانية…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/slowmode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ channelId, seconds })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'تم تطبيق السلو مود بنجاح', 'success');
    } else {
      showToast(data.error || 'فشل ضبط السلو مود', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال أثناء تطبيق السلو مود', 'error');
  }
};

window.submitModRole = async (action) => {
  const targetId = $('roleUserId')?.value.trim();
  const roleId = $('roleSelect')?.value;
  if (!targetId || !roleId) return showToast('يرجى اختيار العضو وتحديد الرتبة', 'error');

  showToast(`جارٍ ${action === 'add' ? 'منح' : 'سحب'} الرتبة…`, 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/mod/role`, {
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
    const res = await fetch(`${API_BASE}/api/admin/mod/voice-action`, {
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
  if (pill) pill.textContent = `متصل ومباشر · ${d.ping || 0}ms`;

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
          🔒 مثبت ومقفول بالروم
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
          ${a.status === 'approved' ? '✅ تم القبول وفك الحظر' : a.status === 'rejected' ? '❌ مرفوض' : '⏳ قيد الانتظار'}
        </span>
      </td>
      <td style="text-align: left;">
        <button class="btn-action" onclick="openStatementModal('${a.targetId}')">مراجعة الإفادة</button>
        ${
          a.status === 'pending'
            ? `
          <button class="btn-action primary" onclick="resolveAppeal('${a.targetId}', 'approve')">قبول وفك الحظر</button>
          <button class="btn-action danger" onclick="resolveAppeal('${a.targetId}', 'reject')">رفض</button>
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

  if ($('modalUserTag')) $('modalUserTag').textContent = `طعن العضو: ${appeal.userTag}`;
  if ($('modalUserId')) $('modalUserId').textContent = appeal.targetId;
  if ($('modalStatementText')) $('modalStatementText').textContent = appeal.statement || 'لا توجد إفادة مكتوبة.';

  const footer = $('modalActions');
  if (footer) {
    footer.innerHTML =
      appeal.status === 'pending'
        ? `
      <button class="btn-action primary" onclick="resolveAppeal('${targetId}', 'approve'); closeStatementModal();">✅ قبول وفك الحظر</button>
      <button class="btn-action danger" onclick="resolveAppeal('${targetId}', 'reject'); closeStatementModal();">❌ رفض الطعن</button>
    `
        : `<span class="badge-status ${appeal.status}">تمت المعالجة: ${appeal.status === 'approved' ? 'مقبول' : 'مرفوض'} بواسطة ${appeal.handledByName || 'الإدارة'}</span>`;
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
      showToast(`تم ${action === 'approve' ? 'قبول الطعن وفك الحظر وإشعار العضو بالخاص' : 'رفض الطعن'} بنجاح!`, 'success');
      loadAppeals();
    } else {
      showToast(data.error || 'فشلت معالجة الطعن', 'error');
    }
  } catch {
    showToast('خطأ في الشبكة أثناء معالجة الطعن', 'error');
  }
};

/* ══════════════════════════════════════════════════════
   PANELS & BOT OPERATIONS (ARABIC)
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
      showToast(data.message || 'تم نشر البانل بنجاح!', 'success');
      loadPanels();
    } else {
      showToast(data.error || 'فشل نشر البانل', 'error');
    }
  } catch {
    showToast('خطأ في الاتصال بالخادم أثناء نشر البانل', 'error');
  }
};

window.removePanel = async (panelType) => {
  if (!adminToken) return;
  showToast(`جارٍ حذف بانل (${panelType}) من ديسكورد…`, 'info');
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
      showToast(data.message || 'تم حذف البانل بنجاح!', 'success');
      loadPanels();
    } else {
      showToast(data.error || 'فشل حذف البانل', 'error');
    }
  } catch {
    showToast('خطأ أثناء حذف البانل', 'error');
  }
};

window.triggerMassSync = async () => {
  if (!adminToken) return;
  showToast('⚡ جارٍ المزامنة الشاملة لكافة رتب وأعضاء السيرفر…', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/bot/sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✅ تمت المزامنة الشاملة للأعضاء والرتب بنجاح!', 'success');
    }
  } catch {
    showToast('فشلت عملية المزامنة', 'error');
  }
};

window.sendBroadcast = async () => {
  if (!adminToken) return;
  const channelId = $('broadcastChannelSelect')?.value.trim();
  const title = $('broadcastTitle')?.value.trim();
  const message = $('broadcastMessage')?.value.trim();
  const color = parseInt($('broadcastColor')?.value || '16777215');

  if (!channelId || !message) {
    showToast('يرجى اختيار الروم وكتابة نص الإعلان', 'error');
    return;
  }

  showToast('جارٍ نشر الإعلان الرسمي…', 'info');
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
      showToast('📢 تم نشر الإعلان الرسمي بنجاح في ديسكورد!', 'success');
      $('broadcastMessage').value = '';
    } else {
      showToast(data.error || 'فشل نشر الإعلان', 'error');
    }
  } catch {
    showToast('خطأ في إرسال الإعلان', 'error');
  }
};

window.forceReStationVCR = async () => {
  if (!adminToken) return;
  showToast('جارٍ إعادة تثبيت مسجلات الصوت الخمسة في روماتها…', 'info');
  try {
    const res = await fetch(`${API_BASE}/api/admin/vcr/reconnect`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (res.ok) showToast(data.message || 'تمت إعادة تثبيت المسجلات بنجاح!', 'success');
  } catch {
    showToast('خطأ في طلب إعادة التثبيت', 'error');
  }
};

window.reconnectSingleVCR = async (vcrId) => {
  window.forceReStationVCR();
};

window.clearEventLog = () => {
  const list = $('eventStreamList');
  if (list) list.innerHTML = `<li class="log-entry">تم مسح سجل الأحداث من الشاشة.</li>`;
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
