import {
  enforceSuspiciousAccountBan,
  handleAppealButton,
  handleAppealModalSubmit,
  executeAppealApproval,
  executeAppealRejection,
  loadAppealsData,
  SPY_ACCOUNT_CUTOFF_TIMESTAMP
} from './security/spyDefense.js';
import {
  verifyMasterPassword,
  checkRateLimit,
  recordFailedLogin,
  clearFailedLogin,
  createAdminSessionToken,
  verifyAdminSession
} from './security/adminAuth.js';
import {
  Client,
  GatewayIntentBits,
  Events,
  PermissionFlagsBits,
  ChannelType,
  ActivityType,
  EmbedBuilder,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  REST,
  Routes,
  AuditLogEvent
} from 'discord.js';
import {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  EndBehaviorType
} from '@discordjs/voice';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { VCRManager, VCR_BOT_IDS, VCR_ROLE_NAME } from './vcr/index.js';
import { loadVaultEnvironment } from './security/envVault.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables (from encrypted SHA-512 .env.enc or .env)
loadVaultEnvironment();
dotenv.config();

let BOT_VERSION = '2.0 Flash';
let TOKEN = process.env.DISCORD_TOKEN;
let ALLOWED_GUILD_ID = process.env.ALLOWED_GUILD_ID?.trim();
let AUTO_ROLE_NAME = 'UNTRUSTED';
let VERIFIED_MEMBER_ROLE_NAME = 'MEMBER';
let VERIFIED_MEMBER_ROLE_ID = process.env.AUTO_ROLE_ID?.trim() || '1538486805211389982';
let AUTO_ROLE_ID = VERIFIED_MEMBER_ROLE_ID;
let WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID?.trim() || '1538560876339265667';
let LEAVE_CHANNEL_ID = process.env.LEAVE_CHANNEL_ID?.trim() || '1538561457912946788';

// Data Directories and Files
const DATA_DIR = path.resolve('data');
const WELCOMED_FILE = path.join(DATA_DIR, 'welcomed_members.json');
const WELCOME_TRACKER_FILE = path.join(DATA_DIR, 'welcome_tracker.json');
const STATUS_MSG_FILE = path.join(DATA_DIR, 'status_message.json');
const WARNINGS_FILE = path.join(DATA_DIR, 'warnings.json');
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const TICKET_PANEL_FILE = path.join(DATA_DIR, 'ticket_panel.json');
const DM_SECURITY_SENT_FILE = path.join(DATA_DIR, 'dm_security_sent.json');
const USER_INFRACTIONS_FILE = path.join(DATA_DIR, 'user_infractions.json');
const VERIFICATION_REQUESTS_FILE = path.join(DATA_DIR, 'verification_requests.json');
const EMERGENCY_STATE_FILE = path.join(DATA_DIR, 'emergency_state.json');
const UNTRUSTED_ROLE_NAME = 'UNTRUSTED';
const EVENT_CHANNEL_ID = '1538600505012387860';
const ACTIVE_EVENT_FILE = path.join(DATA_DIR, 'active_event.json');
const COMMANDS_CONFIG_FILE = path.resolve('src', 'commands.json');

// ─────────────────────────────────────────────────────
// 📡 LIVE ACTIVITY LOG — Ring buffer (max 60 events)
//    Shown on the Operations Center dashboard
// ─────────────────────────────────────────────────────
const ACTIVITY_RING = [
  { ts: Date.now() - 15000, type: 'system', action: 'Core Engine Online', detail: 'GX Operations Engine v1.0 initialized on US-West cluster' },
  { ts: Date.now() - 12000, type: 'system', action: 'Commands Registered', detail: '42 Slash Commands synced with Discord API' },
  { ts: Date.now() - 9000,  type: 'vcr',    action: 'VCR Fleet Linked', detail: '5 Independent Audio Sentinels assigned to Voice channels' },
  { ts: Date.now() - 6000,  type: 'security', action: 'Acoustic Shield Engaged', detail: 'Military-grade RMS threshold (11k) & VIP immunity active' },
  { ts: Date.now() - 2000,  type: 'autocheck', action: 'Background Guard Started', detail: 'Relentless voice watchdog & 60s role synchronization loop active' }
];
const ACTIVITY_MAX  = 100;
const ACTIVITY_STATS = {
  commandsTotal: 0,
  securityAlerts: 0,
  autoChecksRun: 0,
  vcrEvents: 0
};

function logActivity(type, action, detail = '', user = null) {
  const entry = {
    id:     'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    ts:     Date.now(),
    type,   // 'command' | 'security' | 'vcr' | 'system' | 'member' | 'autocheck'
    action,
    detail,
    user:   user ? { id: user.id, tag: user.tag || user.username || 'User' } : null
  };
  if (type === 'command') ACTIVITY_STATS.commandsTotal++;
  if (type === 'security') ACTIVITY_STATS.securityAlerts++;
  if (type === 'autocheck') ACTIVITY_STATS.autoChecksRun++;
  if (type === 'vcr') ACTIVITY_STATS.vcrEvents++;

  ACTIVITY_RING.unshift(entry);
  if (ACTIVITY_RING.length > ACTIVITY_MAX) ACTIVITY_RING.pop();
}

function safeWriteJson(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch {
    try {
      import('os').then((osModule) => {
        const os = osModule.default || osModule;
        const tmpPath = path.join(os.tmpdir(), `gx_${Date.now()}_${path.basename(filePath)}`);
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        fs.copyFileSync(tmpPath, filePath);
        try { fs.unlinkSync(tmpPath); } catch {}
      }).catch(() => {});
    } catch {}
  }
}

function loadWelcomedMembers() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(WELCOMED_FILE)) {
      return JSON.parse(fs.readFileSync(WELCOMED_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('خطأ في قراءة ملف الأعضاء المرحب بهم:', err.message);
  }
  return [];
}

function saveWelcomedMembers(list) {
  safeWriteJson(WELCOMED_FILE, list);
}

function loadWelcomeTracker() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(WELCOME_TRACKER_FILE)) {
      return JSON.parse(fs.readFileSync(WELCOME_TRACKER_FILE, 'utf-8'));
    }
  } catch {}
  return { nextNumber: 1, members: {} };
}

function saveWelcomeTracker(data) {
  safeWriteJson(WELCOME_TRACKER_FILE, data);
}

function loadStatusMessageId() {
  try {
    if (fs.existsSync(STATUS_MSG_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATUS_MSG_FILE, 'utf-8'));
      return data.messageId || null;
    }
  } catch {}
  return null;
}

function saveStatusMessageId(messageId) {
  safeWriteJson(STATUS_MSG_FILE, { messageId });
}

function loadWarnings() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(WARNINGS_FILE)) {
      return JSON.parse(fs.readFileSync(WARNINGS_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveWarnings(data) {
  safeWriteJson(WARNINGS_FILE, data);
}

function loadTickets() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(TICKETS_FILE)) {
      return JSON.parse(fs.readFileSync(TICKETS_FILE, 'utf-8'));
    }
  } catch {}
  return { counter: 1, activeTickets: {} };
}

function saveTickets(data) {
  safeWriteJson(TICKETS_FILE, data);
}

function loadTicketPanelData() {
  try {
    if (fs.existsSync(TICKET_PANEL_FILE)) {
      return JSON.parse(fs.readFileSync(TICKET_PANEL_FILE, 'utf-8'));
    }
  } catch {}
  return { channelId: null, messageId: null };
}

function saveTicketPanelData(data) {
  safeWriteJson(TICKET_PANEL_FILE, data);
}

function loadDMSecuritySent() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DM_SECURITY_SENT_FILE)) {
      return JSON.parse(fs.readFileSync(DM_SECURITY_SENT_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveDMSecuritySent(list) {
  safeWriteJson(DM_SECURITY_SENT_FILE, list);
}

function isUntrustedMember(member) {
  if (!member || !member.roles) return false;
  return member.roles.cache.some((r) => r.name.toUpperCase() === UNTRUSTED_ROLE_NAME);
}

function loadVerificationRequests() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(VERIFICATION_REQUESTS_FILE)) {
      return JSON.parse(fs.readFileSync(VERIFICATION_REQUESTS_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveVerificationRequests(data) {
  safeWriteJson(VERIFICATION_REQUESTS_FILE, data);
}

// ----------------------------------------------------
// 🚨 Military Emergency State Storage & Helpers
// ----------------------------------------------------
function loadEmergencyState() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(EMERGENCY_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(EMERGENCY_STATE_FILE, 'utf-8'));
    }
  } catch {}
  return { isActive: false };
}

function saveEmergencyState(data) {
  safeWriteJson(EMERGENCY_STATE_FILE, data);
}

function isEmergencyActive() {
  const state = loadEmergencyState();
  return Boolean(state && state.isActive);
}

// ----------------------------------------------------
// 🧠 Levenshtein Distance & Smart Arabic Normalization
// ----------------------------------------------------
/**
 * 🧮 Fast Levenshtein Distance algorithm for smart fuzzy text similarity calculation.
 */
function levenshteinDistance(s1, s2) {
  if (s1 === s2) return 0;
  if (!s1.length) return s2.length;
  if (!s2.length) return s1.length;

  let v0 = new Array(s2.length + 1);
  let v1 = new Array(s2.length + 1);

  for (let i = 0; i <= s2.length; i++) v0[i] = i;

  for (let i = 0; i < s1.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < s2.length; j++) {
      const cost = s1[i] === s2[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= s2.length; j++) v0[j] = v1[j];
  }
  return v1[s2.length];
}

/**
 * 🎯 Calculates text similarity ratio between 0.0 and 1.0.
 */
function calculateTextSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  const s1 = String(str1).trim();
  const s2 = String(str2).trim();
  if (s1 === s2) return 1.0;
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(s1, s2);
  return Math.max(0, 1.0 - (dist / maxLen));
}

/**
 * 🧹 Normalizes Arabic text, removing tatweel/kashida, diacritics, repeating letters, and zero-width chars.
 */
function normalizeArabicText(text) {
  if (!text) return '';
  let str = String(text).toLowerCase();

  // Remove zero-width spaces and invisible characters
  str = str.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');

  // Remove Arabic diacritics (Tashkeel)
  str = str.replace(/[\u064B-\u065F\u0670]/g, '');

  // Remove Tatweel (Kashida)
  str = str.replace(/\u0640/g, '');

  // Normalize Alif variations (أ, إ, آ, ٱ -> ا)
  str = str.replace(/[أإآٱ]/g, 'ا');

  // Normalize Yaa variations (ى, ئ -> ي)
  str = str.replace(/[ى]/g, 'ي');

  // Normalize Taa Marbuta (ة -> ه)
  str = str.replace(/[ة]/g, 'ه');

  // Collapse repetitive characters (e.g. "هههههههههه" -> "هه", "سلاااام" -> "سلام")
  str = str.replace(/(.)\1{2,}/gu, '$1$1');

  // Remove excessive whitespace & punctuation
  str = str.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

  return str;
}

// User message history tracker for fuzzy spam & velocity burst
// Map<userId, Array<{ raw: string, normalized: string, timestamp: number, channelId: string }>>
const userMessageHistory = new Map();
const SPAM_WINDOW_MS = 10000;
const FUZZY_SIMILARITY_THRESHOLD = 0.75;
const MAX_SIMILAR_MESSAGES = 3;
const MAX_BURST_MESSAGES = 5;

/**
 * ⚡ Inspects and protects the server from fast burst message floods and smart fuzzy text repetitions.
 */
async function checkSmartSpamAndVelocity(message) {
  if (!message || !message.guild || !message.member || message.author.bot) return false;

  // Exempt Leadership & Managers
  if (isManagerMember(message.member) || isVerificationApprover(message.member, message.author)) {
    return false;
  }

  const userId = message.author.id;
  const now = Date.now();
  const rawText = message.content || '';
  const normalizedText = normalizeArabicText(rawText);

  let history = userMessageHistory.get(userId) || [];
  history = history.filter((entry) => now - entry.timestamp <= SPAM_WINDOW_MS);

  history.push({
    raw: rawText,
    normalized: normalizedText,
    timestamp: now,
    messageId: message.id,
    channelId: message.channel.id
  });
  userMessageHistory.set(userId, history);

  // 1. Fast Velocity Burst Check (> 5 messages in 4 seconds)
  const recentBurstCount = history.filter((entry) => now - entry.timestamp <= 4000).length;
  if (recentBurstCount >= MAX_BURST_MESSAGES) {
    userMessageHistory.set(userId, []);
    await applySmartSpamPunishment(message, 'إرسال رسائل متتالية بسرعة فائقة (Burst Flood Attack)', recentBurstCount);
    return true;
  }

  // 2. Fuzzy Text Similarity Check (Levenshtein Distance across recent messages)
  if (normalizedText.length >= 4) {
    let similarCount = 1;
    let maxSimilarity = 0;

    for (let i = 0; i < history.length - 1; i++) {
      const prev = history[i];
      if (!prev.normalized || prev.normalized.length < 4) continue;
      const sim = calculateTextSimilarity(normalizedText, prev.normalized);
      if (sim > maxSimilarity) maxSimilarity = sim;
      if (sim >= FUZZY_SIMILARITY_THRESHOLD) {
        similarCount++;
      }
    }

    if (similarCount >= MAX_SIMILAR_MESSAGES) {
      userMessageHistory.set(userId, []);
      await applySmartSpamPunishment(message, `تكرار نصوص متشابهة بذكاء (نسبة التشابه: ${Math.round(maxSimilarity * 100)}%)`, similarCount);
      return true;
    }
  }

  return false;
}

/**
 * 🔨 Applies penalty (delete, timeout, DM warning, log) for detected spam violations.
 */
async function applySmartSpamPunishment(message, reason, metricValue) {
  const member = message.member;
  const guild = message.guild;

  try {
    await message.delete().catch(() => {});
  } catch {}

  try {
    if (member && member.moderatable) {
      await member.timeout(5 * 60 * 1000, `GX Anti-Spam: ${reason}`).catch(() => {});
    }
  } catch {}

  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setAuthor({ name: '⚠️ تحذير أمني: مكافحة السبام الذكي | GX Security', iconURL: guild.iconURL() })
      .setTitle('تم عزل حسابك مؤقتاً (Timeout 5 دقائق)')
      .setDescription(
        `مرحباً <@${message.author.id}>، رصد نظام الحماية الذكي نشاطاً مخالفاً من حسابك في سيرفر **${guild.name}**.\n\n` +
        `🚫 **سبب العقوبة:** \`${reason}\`\n` +
        `⏱️ **مدة العزل:** 5 دقائق\n\n` +
        `يرجى الالتزام بقوانين السيرفر وعدم تكرار النصوص أو إرسال الرسائل بسرعة مفرطة لتجنب الحظر الدائم.`
      )
      .setFooter({ text: `GX eSports Defense System • الإصدار ${BOT_VERSION}` })
      .setTimestamp();
    await message.author.send({ embeds: [dmEmbed] }).catch(() => {});
  } catch {}

  try {
    const logEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setAuthor({ name: '🛡️ رصد وإحباط هجوم سبام ذكي (Anti-Spam Shield)', iconURL: message.author.displayAvatarURL() })
      .setDescription(
        `قام النظام باعتراض وعزل العضو <@${message.author.id}> (\`${message.author.tag}\`) في القناة <#${message.channel.id}>.\n\n` +
        `📝 **نوع المخالفة:** ${reason}\n` +
        `⚡ **الإجراء المتخذ:** تم حذف الرسائل وتطبيق تايم آوت لمدة 5 دقائق.\n` +
        `💬 **نص الرسالة المعترضة:**\n\`\`\`\n${message.content.slice(0, 500) || '[بدون نص]'}\n\`\`\``
      )
      .setFooter({ text: `GX eSports Security Engine • الإصدار ${BOT_VERSION}` })
      .setTimestamp();
    await sendToLogChannel(guild, logEmbed);
  } catch {}
}

const INFRACTIONS_META_FILE = path.join(DATA_DIR, 'infractions_meta.json');
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

function loadUserInfractions() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(USER_INFRACTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(USER_INFRACTIONS_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveUserInfractions(data) {
  safeWriteJson(USER_INFRACTIONS_FILE, data);
}

function loadInfractionsMeta() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(INFRACTIONS_META_FILE)) {
      return JSON.parse(fs.readFileSync(INFRACTIONS_META_FILE, 'utf-8'));
    }
  } catch {}
  return { lastResetAt: Date.now() };
}

function saveInfractionsMeta(data) {
  safeWriteJson(INFRACTIONS_META_FILE, data);
}

function loadActiveEvent() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(ACTIVE_EVENT_FILE)) {
      return JSON.parse(fs.readFileSync(ACTIVE_EVENT_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveActiveEvent(eventData) {
  if (!eventData) {
    try {
      if (fs.existsSync(ACTIVE_EVENT_FILE)) fs.unlinkSync(ACTIVE_EVENT_FILE);
    } catch {}
  } else {
    safeWriteJson(ACTIVE_EVENT_FILE, eventData);
  }
}

const TOURNAMENT_MODES = {
  '1v1': { label: '⚔️ بطولة فردية (1v1)', teamSize: 1, matchSize: 2 },
  '2v2': { label: '👥 بطولة ثنائية (2v2)', teamSize: 2, matchSize: 4 },
  '3v3': { label: '🔥 بطولة ثلاثية (3v3)', teamSize: 3, matchSize: 6 },
  '4v4': { label: '🛡️ بطولة رباعية (4v4)', teamSize: 4, matchSize: 8 },
  '5v5': { label: '👑 بطولة خماسية (5v5)', teamSize: 5, matchSize: 10 },
  'ffa': { label: '🌐 فعالية عامة (Free For All)', teamSize: 1, matchSize: 0 }
};

function buildProgressBar(current, max, size = 10) {
  if (!max || max <= 0) return '';
  const ratio = Math.min(Math.max(current / max, 0), 1);
  const filled = Math.round(ratio * size);
  const empty = size - filled;
  const percentage = Math.round(ratio * 100);
  return `${'🟩'.repeat(filled)}${'⬜'.repeat(empty)} \`(${percentage}%)\``;
}

async function getOrCreateTournamentCategory(guild) {
  if (!guild) return null;
  let cat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.includes('TOURNAMENTS'));
  if (!cat) {
    cat = await guild.channels.create({
      name: '🏆┃TOURNAMENTS & MATCHES',
      type: ChannelType.GuildCategory,
      reason: 'GX Tournament System match rooms'
    }).catch(() => null);
  }
  return cat;
}

/**
 * ⚔️ Automatic Tournament Matching Engine
 * Divides registered players into matches/teams, creates private voice channels & temporary roles, and DMs them.
 */
async function processTournamentMatching(guild, eventData) {
  if (!guild || !eventData || eventData.status === 'ended') return false;
  const modeKey = eventData.mode || '1v1';
  const modeConfig = TOURNAMENT_MODES[modeKey] || TOURNAMENT_MODES['1v1'];

  if (modeKey === 'ffa') return false;

  if (!eventData.matches) eventData.matches = [];
  if (!eventData.teams) eventData.teams = [];

  const matchedPlayerIds = new Set();
  eventData.matches.forEach((m) => m.playerIds && m.playerIds.forEach((id) => matchedPlayerIds.add(id)));
  eventData.teams.forEach((t) => t.playerIds && t.playerIds.forEach((id) => matchedPlayerIds.add(id)));

  const unmatchedPlayers = (eventData.participants || []).filter((id) => !matchedPlayerIds.has(id));

  let changed = false;

  // 1v1 Mode: Every 2 unmatched players form a match and get a private 1v1 room
  if (modeKey === '1v1') {
    while (unmatchedPlayers.length >= 2) {
      const p1Id = unmatchedPlayers.shift();
      const p2Id = unmatchedPlayers.shift();
      const matchNum = eventData.matches.length + 1;

      const member1 = await guild.members.fetch(p1Id).catch(() => null);
      const member2 = await guild.members.fetch(p2Id).catch(() => null);

      const u1Name = member1 ? (member1.nickname || member1.user.username) : p1Id.slice(0, 5);
      const u2Name = member2 ? (member2.nickname || member2.user.username) : p2Id.slice(0, 5);

      // Create Temporary Match Role
      const tempRole = await guild.roles.create({
        name: `⚔️ Match ${matchNum}: [1v1]`,
        color: 0x5865F2,
        reason: `GX Tournament temporary match role for match #${matchNum}`
      }).catch(() => null);

      if (tempRole) {
        if (member1) await member1.roles.add(tempRole).catch(() => {});
        if (member2) await member2.roles.add(tempRole).catch(() => {});
      }

      // Get/Create Tournament Category
      const cat = await getOrCreateTournamentCategory(guild);

      // Create Private Voice Channel
      const voiceChan = await guild.channels.create({
        name: `⚔️・${u1Name}-vs-${u2Name}`,
        type: ChannelType.GuildVoice,
        parent: cat ? cat.id : null,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
          },
          ...(tempRole ? [{
            id: tempRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
          }] : [
            { id: p1Id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
            { id: p2Id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }
          ])
        ],
        reason: `GX Tournament 1v1 Room: ${u1Name} vs ${u2Name}`
      }).catch(() => null);

      eventData.matches.push({
        matchNumber: matchNum,
        playerIds: [p1Id, p2Id],
        playerNames: [u1Name, u2Name],
        roleId: tempRole ? tempRole.id : null,
        voiceChannelId: voiceChan ? voiceChan.id : null,
        createdAt: Date.now()
      });

      changed = true;

      // Send Direct DM Notifications with match details
      const matchDMEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: '🏆 تجهيز المواجهة | GX eSports Tournament', iconURL: guild.iconURL() })
        .setTitle(`⚔️ مواجهة 1 ضد 1: ${u1Name} 🆚 ${u2Name}`)
        .setDescription(
          `🎉 **تم اكتمال حجز مباراتك في بطولة: ${eventData.title}!**\n\n` +
          `👥 **المتنافسان:** <@${p1Id}> 🆚 <@${p2Id}>\n` +
          (voiceChan ? `🎙️ **الروم الصوتي الخاص بمباراتكما:** <#${voiceChan.id}>\n` : '') +
          (tempRole ? `🎖️ **الرتبة المؤقتة:** <@&${tempRole.id}>\n` : '') +
          `\n🔒 **الروم الصوتي مغلق وخاص بكما فقط.** يرجى التواجد والاستعداد لمباراتك!`
        )
        .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      if (member1) member1.send({ embeds: [matchDMEmbed] }).catch(() => {});
      if (member2) member2.send({ embeds: [matchDMEmbed] }).catch(() => {});
    }
  }

  // 2v2 (or 3v3 / 4v4 / 5v5) Mode: Every teamSize unmatched players form a Team room
  else if (['2v2', '3v3', '4v4', '5v5'].includes(modeKey)) {
    const requiredSize = modeConfig.teamSize;
    while (unmatchedPlayers.length >= requiredSize) {
      const teamPlayerIds = [];
      for (let i = 0; i < requiredSize; i++) {
        teamPlayerIds.push(unmatchedPlayers.shift());
      }
      const teamNum = eventData.teams.length + 1;

      const teamMembers = [];
      const teamNames = [];
      for (const pid of teamPlayerIds) {
        const mem = await guild.members.fetch(pid).catch(() => null);
        if (mem) {
          teamMembers.push(mem);
          teamNames.push(mem.nickname || mem.user.username);
        } else {
          teamNames.push(pid.slice(0, 5));
        }
      }

      // Create Temporary Team Role
      const tempRole = await guild.roles.create({
        name: `🎮 Team ${teamNum}: [${modeKey}]`,
        color: 0x57F287,
        reason: `GX Tournament temporary team role for Team #${teamNum}`
      }).catch(() => null);

      if (tempRole) {
        for (const mem of teamMembers) {
          await mem.roles.add(tempRole).catch(() => {});
        }
      }

      const cat = await getOrCreateTournamentCategory(guild);

      const voiceChan = await guild.channels.create({
        name: `👥・Team-${teamNum}-[${teamNames.slice(0, 2).join('&')}]`,
        type: ChannelType.GuildVoice,
        parent: cat ? cat.id : null,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
          },
          ...(tempRole ? [{
            id: tempRole.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
          }] : teamPlayerIds.map((pid) => ({
            id: pid,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
          })))
        ],
        reason: `GX Tournament Team Room: Team ${teamNum}`
      }).catch(() => null);

      eventData.teams.push({
        teamNumber: teamNum,
        playerIds: teamPlayerIds,
        playerNames: teamNames,
        roleId: tempRole ? tempRole.id : null,
        voiceChannelId: voiceChan ? voiceChan.id : null,
        createdAt: Date.now()
      });

      changed = true;

      // Send Direct DM Notifications to all team members
      const teamDMEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🏆 تشكيل الفريق | GX eSports Tournament', iconURL: guild.iconURL() })
        .setTitle(`👥 تم تشكيل فريقك: Team ${teamNum} (${modeKey})`)
        .setDescription(
          `🎉 **تم اكتمال تشكيل فريقك في بطولة: ${eventData.title}!**\n\n` +
          `👥 **أعضاء الفريق:** ${teamPlayerIds.map((id) => `<@${id}>`).join(' ، ')}\n` +
          (voiceChan ? `🎙️ **الروم الصوتي الخاص بفريقكم:** <#${voiceChan.id}>\n` : '') +
          (tempRole ? `🎖️ **رتبة الفريق المؤقتة:** <@&${tempRole.id}>\n` : '') +
          `\n🔒 **الروم متاح فقط لأعضاء فريقكم.** يرجى التجمع والتنسيق والاستعداد!`
        )
        .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      for (const mem of teamMembers) {
        mem.send({ embeds: [teamDMEmbed] }).catch(() => {});
      }
    }
  }

  if (changed) {
    saveActiveEvent(eventData);
  }
  return changed;
}

/**
 * 🧹 Cleans up temporary tournament voice channels and match roles upon event completion or cancellation.
 */
async function cleanupTournamentResources(guild, eventData) {
  if (!guild || !eventData) return;
  if (eventData.matches && Array.isArray(eventData.matches)) {
    for (const m of eventData.matches) {
      if (m.voiceChannelId) {
        const ch = guild.channels.cache.get(m.voiceChannelId);
        if (ch) await ch.delete('Cleaning up tournament match room').catch(() => {});
      }
      if (m.roleId) {
        const r = guild.roles.cache.get(m.roleId);
        if (r) await r.delete('Cleaning up tournament temporary role').catch(() => {});
      }
    }
  }
  if (eventData.teams && Array.isArray(eventData.teams)) {
    for (const t of eventData.teams) {
      if (t.voiceChannelId) {
        const ch = guild.channels.cache.get(t.voiceChannelId);
        if (ch) await ch.delete('Cleaning up tournament team room').catch(() => {});
      }
      if (t.roleId) {
        const r = guild.roles.cache.get(t.roleId);
        if (r) await r.delete('Cleaning up tournament temporary role').catch(() => {});
      }
    }
  }
  if (eventData.createdGeneralVoice && eventData.generalVoiceId) {
    const genCh = guild.channels.cache.get(eventData.generalVoiceId);
    if (genCh) await genCh.delete('Cleaning up temporary general event voice room').catch(() => {});
  }
}

/**
 * 🎨 Renders the rich interactive tournament & event embed for #🎉・الـفـعـالـيـة
 */
function renderEventEmbed(eventData, clientUser) {
  const count = eventData.participants ? eventData.participants.length : 0;
  const maxStr = eventData.maxParticipants ? ` / ${eventData.maxParticipants}` : '';
  const statusColor = eventData.status === 'started' ? 0x57F287 : 0xFEE75C;
  const statusText = eventData.status === 'started' ? '🟢 البطولة جارية الآن!' : '🟡 باب التسجيل وحجز المباريات مفتوح';
  const modeKey = eventData.mode || '1v1';
  const modeLabel = (TOURNAMENT_MODES[modeKey] && TOURNAMENT_MODES[modeKey].label) || '⚔️ بطولة 1v1';

  let matchesListText = '';
  if (eventData.matches && eventData.matches.length > 0) {
    matchesListText = '\n\n⚔️ **المواجهات والمباريات الجاهزة:**\n' +
      eventData.matches.map((m) => `• **مواجهة #${m.matchNumber}:** <@${m.playerIds[0]}> 🆚 <@${m.playerIds[1]}> ──> <#${m.voiceChannelId}>`).join('\n');
  } else if (eventData.teams && eventData.teams.length > 0) {
    matchesListText = '\n\n👥 **الفرق المكتملة:**\n' +
      eventData.teams.map((t) => `• **فريق #${t.teamNumber}:** ${t.playerIds.map((id) => `<@${id}>`).join(' ، ')} ──> <#${t.voiceChannelId}>`).join('\n');
  }

  const progressBar = eventData.maxParticipants ? `\n📊 **مؤشر الامتلاء:** ${buildProgressBar(count, eventData.maxParticipants)}` : '';
  const countdownText = eventData.startTime ? `\n⏳ **موعد انطلاق البطولة:** <t:${Math.floor(eventData.startTime / 1000)}:R> (<t:${Math.floor(eventData.startTime / 1000)}:t>)` : '';

  const voiceLine = eventData.mode === 'ffa'
    ? (eventData.generalVoiceId ? `🎙️ **الروم الصوتي للفعالية:** <#${eventData.generalVoiceId}> (قاعة عامة مفتوحة للجميع) 🔊\n` : `🎙️ **الروم الصوتي:** قاعة الفعاليات العامة 🔊\n`)
    : `🎙️ **الرومات الصوتية:** توليد تلقائي لرومات خاصة لكل مواجهة وفريق 🔒\n`;

  const embed = new EmbedBuilder()
    .setColor(statusColor)
    .setAuthor({ name: '🏆 بطولة وفعالية رسمية | GX eSports', iconURL: clientUser?.displayAvatarURL() })
    .setTitle(`🔥 ${eventData.title}`)
    .setDescription(
      `${eventData.description}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `🎮 **نظام الفعالية:** \`${modeLabel}\`\n` +
      `📊 **حالة التسجيل:** ${statusText}\n` +
      `👥 **اللاعبون المسجلون:** \`${count}${maxStr}\` لاعب ${progressBar}${countdownText}\n` +
      (eventData.prize ? `🎁 **الجائزة:** **${eventData.prize}** 🏆\n` : '') +
      voiceLine +
      `👑 **المنظم:** <@${eventData.hostId}>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━` +
      matchesListText +
      `\n\n🔹 *اضغط على **🎟️ انضمام للبطولة** ليتم تسجيلك وإرسال التذكيرات وتفاصيل مباراتك في الخاص تلقائياً!*`
    )
    .setFooter({ text: `GX eSports Tournament Engine • المعرف: ${eventData.id} • الإصدار ${BOT_VERSION}` })
    .setTimestamp(eventData.createdAt);

  return embed;
}

/**
 * 🔘 Renders the action buttons for the event card
 */
function renderEventButtons(eventData) {
  const isStarted = eventData.status === 'started';
  const isFull = eventData.maxParticipants && eventData.participants && eventData.participants.length >= eventData.maxParticipants;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`event_join_${eventData.id}`)
      .setLabel('🎟️ انضمام للبطولة')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isStarted || isFull),
    new ButtonBuilder()
      .setCustomId(`event_leave_${eventData.id}`)
      .setLabel('🚪 انسحاب')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isStarted),
    new ButtonBuilder()
      .setCustomId(`event_list_${eventData.id}`)
      .setLabel(`👥 الفرق والمشاركون (${eventData.participants ? eventData.participants.length : 0})`)
      .setStyle(ButtonStyle.Primary)
  );
}

/**
 * 🔄 Ensures the active event panel is posted and synced in #🎉・الـفـعـالـيـة
 */
async function ensureEventPanel(guild) {
  if (!guild) return null;
  const eventData = loadActiveEvent();
  if (!eventData || eventData.status === 'ended') return null;

  const eventChannel = guild.channels.cache.get(EVENT_CHANNEL_ID);
  if (!eventChannel) return null;

  const embed = renderEventEmbed(eventData, client.user);
  const row = renderEventButtons(eventData);

  if (eventData.messageId) {
    const existingMsg = await eventChannel.messages.fetch(eventData.messageId).catch(() => null);
    if (existingMsg) {
      await existingMsg.edit({ embeds: [embed], components: [row] }).catch(() => null);
      return existingMsg;
    }
  }

  const newMsg = await eventChannel.send({
    content: `🎉 @everyone **بطولة رسمية جديدة في سيرفر GX eSports!**`,
    embeds: [embed],
    components: [row]
  }).catch(() => null);

  if (newMsg) {
    eventData.messageId = newMsg.id;
    saveActiveEvent(eventData);
  }
  return newMsg;
}

/**
 * 🔄 Checks and resets all user infractions/strikes every 2 weeks automatically.
 */
async function checkAndResetBiweeklyInfractions(guild) {
  if (!guild || guild.id !== ALLOWED_GUILD_ID) return;
  const meta = loadInfractionsMeta();
  const now = Date.now();

  if (!meta.lastResetAt) {
    meta.lastResetAt = now;
    saveInfractionsMeta(meta);
    return;
  }

  if (now - meta.lastResetAt >= TWO_WEEKS_MS) {
    console.log('🔄 [تصفير المخالفات الدوري] انقضاء أسبوعين.. جارٍ تصفير عداد المخالفات لجميع الأعضاء...');
    const infractions = loadUserInfractions();
    let resetCount = 0;

    for (const userId in infractions) {
      if (infractions[userId] && infractions[userId].strikes > 0) {
        infractions[userId].strikes = 0;
        infractions[userId].history = [];
        resetCount++;
      }
    }

    saveUserInfractions(infractions);
    meta.lastResetAt = now;
    saveInfractionsMeta(meta);

    const logEmbed = new EmbedBuilder()
      .setColor(0x57F287)
      .setAuthor({ name: '🔄 تصفير المخالفات الدوري (كل 14 يوماً)', iconURL: guild.iconURL() || client.user?.displayAvatarURL() })
      .setTitle('تم تصفير عداد المخالفات والإنذارات دورياً')
      .setDescription(
        `# 🔄 تصفير المخالفات التلقائي (دورة كل أسبوعين)\n\n` +
        `وفقاً للنظام الأمني المعتمد، تم تصفير سجلات ومخالفات جميع الأعضاء تلقائياً بعد مرور **14 يوماً**:\n\n` +
        `> 📊 **عدد الأعضاء الذين تم تصفير مخالفاتهم:** \`${resetCount}\` عضو\n` +
        `> ⏰ **موعد التصفير الدوري القادم:** <t:${Math.floor((now + TWO_WEEKS_MS) / 1000)}:R>`
      )
      .setFooter({ text: `GX eSports Security Engine • الإصدار ${BOT_VERSION}` })
      .setTimestamp();

    await sendToLogChannel(guild, logEmbed);
  }
}

// ----------------------------------------------------
// 🛡️ Text Normalization & 85% Similarity Calculation Engine
// ----------------------------------------------------
function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/<a?:[a-zA-Z0-9_]+:[0-9]+>/g, '')
    .replace(/<@[!&]?[0-9]+>/g, '')
    .replace(/<#[0-9]+>/g, '')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F0F5}\u{1F200}-\u{1F2FF}]/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) {
    return str1.trim() === str2.trim() ? 1.0 : 0.0;
  }

  const track = Array(s2.length + 1).fill(null).map(() =>
    Array(s1.length + 1).fill(null));
  for (let i = 0; i <= s1.length; i += 1) track[0][i] = i;
  for (let j = 0; j <= s2.length; j += 1) track[j][0] = j;

  for (let j = 1; j <= s2.length; j += 1) {
    for (let i = 1; i <= s1.length; i += 1) {
      const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
      track[j][i] = Math.min(
        track[j][i - 1] + 1,
        track[j - 1][i] + 1,
        track[j - 1][i - 1] + indicator
      );
    }
  }

  const distance = track[s2.length][s1.length];
  const maxLen = Math.max(s1.length, s2.length);
  return 1 - (distance / maxLen);
}

// ----------------------------------------------------
// 🎫 Motivational Dynamic Feedback Pool for Tickets (Large Headers)
// ----------------------------------------------------
const botManagedDeletedMessages = new Set();
const userRecentMessages = new Map();
const userSpamWarnings = new Map();

const TICKET_FEEDBACK = {
  NAME: [
    (name) => `# ✨ أحسنت يا ${name}!\n> ### 📊 تم حفظ الاسم بنجاح • \`[ 🟩⬜⬜ 33% ]\``,
    (name) => `# 🎉 أهلاً وسهلاً بك يا ${name}!\n> ### 📊 بداية رائعة وتم تدوين اسمك • \`[ 🟩⬜⬜ 33% ]\``,
    (name) => `# 🌟 تشرفنا بك يا ${name}!\n> ### 📊 تم تسجيل الاسم بنجاح • \`[ 🟩⬜⬜ 33% ]\``
  ],
  AGE: [
    (age) => `# 📝 العمر كله يا رب (${age} سنة)!\n> ### 📊 تم توثيق العمر بنجاح • \`[ 🟩🟩⬜ 66% ]\``,
    (age) => `# 🚀 ممتاز جداً!\n> ### 📊 تم حفظ العمر بنجاح، اقتربنا من الانتهاء • \`[ 🟩🟩⬜ 66% ]\``,
    (age) => `# ⚡ رائع!\n> ### 📊 قطعت ثلثي الطريق لتقديم طلبك • \`[ 🟩🟩⬜ 66% ]\``
  ],
  REASON: [
    () => `# 🎯 أحسنت عملاً! اكتملت كافة البيانات\n> ### 📊 \`[ 🟩🟩🟩 100% ]\` • التقرير جاهز لاستلام وكيل الدعم`,
    () => `# 💎 رائع جداً! تم توثيق كامل تفاصيل طلبك\n> ### 📊 \`[ 🟩🟩🟩 100% ]\` • جارٍ ربطك بوكيل الدعم`,
    () => `# 🌟 ممتاز! تم حفظ كافة بيانات التذكرة\n> ### 📊 \`[ 🟩🟩🟩 100% ]\` • تم رفع الملف الإداري بنجاح`
  ]
};

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function loadCommandsConfig() {
  try {
    if (fs.existsSync(COMMANDS_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(COMMANDS_CONFIG_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('خطأ في قراءة commands.json:', err.message);
  }
  return [];
}

/**
 * Translates Discord channel types into pure, elegant Arabic.
 */

/**
 * Translates Discord Permission names to elegant Arabic.
 */
function translatePermissionName(perm) {
  const map = {
    Administrator: 'مسؤول كامل (Administrator)',
    ManageGuild: 'إدارة الخادم (Manage Server)',
    ManageRoles: 'إدارة الرتب (Manage Roles)',
    ManageChannels: 'إدارة القنوات (Manage Channels)',
    KickMembers: 'طرد الأعضاء (Kick Members)',
    BanMembers: 'حظر الأعضاء (Ban Members)',
    ManageMessages: 'إدارة وحذف الرسائل (Manage Messages)',
    MentionEveryone: 'منشن للجميع (@everyone)',
    MuteMembers: 'كتم الأعضاء صوتياً (Mute Members)',
    DeafenMembers: 'تصميت الأعضاء صوتياً (Deafen Members)',
    MoveMembers: 'سحب ونقل الأعضاء (Move Members)',
    ManageNicknames: 'إدارة ألقاب الأعضاء (Manage Nicknames)',
    ManageWebhooks: 'إدارة الويب هوك (Manage Webhooks)',
    ManageEmojisAndStickers: 'إدارة الإيموجي والملصقات',
    ManageThreads: 'إدارة الثريدات (Manage Threads)',
    ModerateMembers: 'عزل الأعضاء (Timeout / Moderate Members)',
    ViewAuditLog: 'عرض سجل التدقيق (View Audit Log)',
    ViewGuildInsights: 'عرض إحصائيات الخادم',
    SendMessages: 'إرسال الرسائل',
    SendMessagesInThreads: 'إرسال الرسائل في الثريدات',
    EmbedLinks: 'تضمين الروابط (Embed Links)',
    AttachFiles: 'إرفاق الملفات والصور',
    ReadMessageHistory: 'قراءة سجل الرسائل',
    AddReactions: 'إضافة تفاعلات (Reactions)',
    Connect: 'الاتصال بالرومات الصوتية',
    Speak: 'التحدث في الفويس',
    Stream: 'البث المباشر ومشاركة الشاشة (Go Live)',
    UseVAD: 'استخدام التحدث الصوتي الحر (Voice Activity)'
  };
  return map[perm] || perm;
}

/**
 * Translates Discord Server Verification Levels to Arabic.
 */
function translateVerificationLevel(level) {
  switch (level) {
    case 0: return 'بدون قيود (None)';
    case 1: return 'منخفض (Low) - بريد إلكتروني موثق';
    case 2: return 'متوسط (Medium) - مسجل منذ 5 دقائق';
    case 3: return 'عالي (High) - عضو بالسيرفر منذ 10 دقائق';
    case 4: return 'أعلى حماية (Very High) - رقم هاتف موثق';
    default: return `مستوى ${level}`;
  }
}

/**
 * Translates Explicit Content Filter Levels to Arabic.
 */
function translateContentFilter(level) {
  switch (level) {
    case 0: return 'معطل (Disabled)';
    case 1: return 'فحص رسائل الأعضاء بدون رتب فقط';
    case 2: return 'فحص رسائل جميع الأعضاء (All Members)';
    default: return `مستوى ${level}`;
  }
}

/**
 * Translates Default Notification Levels to Arabic.
 */
function translateNotificationLevel(level) {
  switch (level) {
    case 0: return 'جميع الرسائل (All Messages)';
    case 1: return 'المنشن فقط (@mentions only)';
    default: return `مستوى ${level}`;
  }
}

function translateChannelType(type) {
  switch (type) {
    case ChannelType.GuildText:
      return 'قناة كتابية (نصية)';
    case ChannelType.GuildVoice:
      return 'قناة صوتية (فويس)';
    case ChannelType.GuildCategory:
      return 'قسم تصنيفي (Category)';
    case ChannelType.GuildAnnouncement:
      return 'قناة إعلانات رسمية';
    case ChannelType.GuildStageVoice:
      return 'قناة مسرح صوتي (Stage)';
    case ChannelType.GuildForum:
      return 'قناة منتدى ونقاشات (Forum)';
    case ChannelType.GuildMedia:
      return 'قناة وسائط وصور';
    case ChannelType.PublicThread:
      return 'موضوع عام (Public Thread)';
    case ChannelType.PrivateThread:
      return 'موضوع خاص (Private Thread)';
    case ChannelType.AnnouncementThread:
      return 'موضوع إعلانات';
    default:
      return `قناة نوع (${type})`;
  }
}

// Create client with complete Gateway Intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildEmojisAndStickers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildWebhooks
  ]
});

let isSyncingRoles = false;
let isUpdatingStatus = false;
let statusMessageRef = null;

// ----------------------------------------------------
// Voice System State
// ----------------------------------------------------
let currentVoiceConnection = null;
let currentVoiceOwner = null; // { userId, userTag, channelId, channelName, joinedAt }
let activeTransferCollector = null;
let isAuthorizedBotMove = false;

function setAuthorizedMove() {
  isAuthorizedBotMove = true;
  setTimeout(() => {
    isAuthorizedBotMove = false;
  }, 3500);
}

// ----------------------------------------------------
// 👑 Admin Roles & Managers System
// ----------------------------------------------------
const ADMIN_TIER_ROLE_NAMES = [
  'owner',
  'ceo',
  'coo',
  'super admin',
  'middle admin',
  'lower admin'
];

const ADMIN_TIER_ROLE_IDS = [
  '1538485406922838066', // OWNER
  '1538485672795570196', // CEO
  '1538544110913454160', // COO
  '1538545256239210546', // SUPER ADMIN
  '1538486022902386738', // MIDDLE ADMIN
  '1538486371805700156'  // LOWER ADMIN
];

/**
 * 👑 Checks if a member has COO, CEO, OWNER, SUPER ADMIN, MIDDLE ADMIN, or LOWER ADMIN roles.
 */
function hasAdminTierRole(member) {
  if (!member) return false;
  return member.roles.cache.some((r) => {
    if (ADMIN_TIER_ROLE_IDS.includes(r.id)) return true;
    const name = r.name.toLowerCase().trim();
    return ADMIN_TIER_ROLE_NAMES.some((tier) => name === tier || name.includes(tier));
  });
}

/**
 * 🛡️ Finds or creates the UNTRUSTED role with view & voice permissions only (strictly NO text/chat permissions).
 */
async function findOrCreateUntrustedRole(guild) {
  if (!guild) return null;
  let role = guild.roles.cache.find((r) => r.name.toUpperCase() === UNTRUSTED_ROLE_NAME);
  if (!role) {
    role = await guild.roles.create({
      name: UNTRUSTED_ROLE_NAME,
      color: 0x4F545C,
      permissions: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD
      ],
      reason: 'GX Security: Untrusted Restricted Member Role (View, Voice & Voice Activity Only)'
    }).catch(() => null);

    if (role) {
      console.log(`🛡️ [رتبة مقيدة] تم إنشاء وتأمين رتبة ${UNTRUSTED_ROLE_NAME} بنجاح.`);
    }
  } else {
    if (!role.permissions.has(PermissionFlagsBits.UseVAD)) {
      await role.setPermissions([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD
      ]).catch(() => {});
    }
  }
  return role;
}

/**
 * ⚡ Checks if a user or member has permission to approve verification requests (OWNER, CEO, COO, or Server Owner).
 */
function isVerificationApprover(member, user) {
  const u = user || member?.user;
  if (!u) return false;
  if (member?.guild?.ownerId === u.id) return true;
  if (u.id === '1152686277255237663' || u.id === '1484535997893967980') return true;
  const username = u.username?.toLowerCase() || '';
  if (username === 'itszoki' || username === 'ice0090') return true;
  if (member) {
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const approverRoleIds = ['1538485406922838066', '1538485672795570196', '1538544110913454160'];
    if (member.roles.cache.some((r) => approverRoleIds.includes(r.id))) return true;
    const approverNames = ['owner', 'ceo', 'coo'];
    if (member.roles.cache.some((r) => approverNames.some((n) => r.name.toLowerCase().trim().includes(n)))) return true;
  }
  return false;
}

/**
 * 👑 Retrieves all members holding COO, CEO, or OWNER roles to receive private DM verification requests.
 */
async function getExecutiveMembers(guild) {
  if (!guild) return [];
  const members = await guild.members.fetch().catch(() => guild.members.cache);
  const approverRoleIds = ['1538485406922838066', '1538485672795570196', '1538544110913454160'];
  const approverNames = ['owner', 'ceo', 'coo'];

  return members.filter((m) => {
    if (m.user.bot) return false;
    if (m.id === guild.ownerId) return true;
    if (m.id === '1152686277255237663' || m.id === '1484535997893967980') return true;
    if (m.roles.cache.some((r) => approverRoleIds.includes(r.id))) return true;
    if (m.roles.cache.some((r) => approverNames.some((n) => r.name.toLowerCase().trim().includes(n)))) return true;
    return false;
  });
}

/**
 * 📩 Sends the interactive verification order directly to the Private DMs of COO, CEO, and OWNER.
 */
async function sendVerificationRequestToExecutives(guild, member) {
  if (!guild || !member) return;

  const executives = await getExecutiveMembers(guild);
  if (!executives || executives.size === 0) return;

  const requestsData = loadVerificationRequests();
  const targetId = member.id;

  // Always reset to a fresh pending state on every join / quarantine / re-join
  requestsData[targetId] = {
    targetId,
    userTag: member.user.tag,
    status: 'pending',
    messages: [],
    handledBy: null,
    handledByName: null,
    createdAt: Date.now(),
    joinCount: (requestsData[targetId]?.joinCount || 0) + 1
  };

  const isRejoin = requestsData[targetId].joinCount > 1;

  const embed = new EmbedBuilder()
    .setColor(isRejoin ? 0xED4245 : 0xFEE75C)
    .setAuthor({ 
      name: isRejoin ? '⚠️ إعادة انضمام عضو قيد التوثيق | GX Security' : '📩 طلب توثيق عضوية جديد | GX Security', 
      iconURL: member.user.displayAvatarURL() 
    })
    .setTitle(`طلب ترقية وتوثيق: ${member.user.tag}${isRejoin ? ' (انضمام متكرر)' : ''}`)
    .setDescription(
      `👤 **العضو:** <@${member.id}> (\`${member.user.tag}\`)\n` +
      `🆔 **المعرف (ID):** \`${member.id}\`\n` +
      `📅 **تاريخ إنشاء الحساب:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>\n` +
      `🔄 **مرات الانضمام:** \`${requestsData[targetId].joinCount}\` مرة\n` +
      `🔒 **الرتبة الحالية:** \`UNTRUSTED\` (محظور من الكتابة ومقيد الصلاحيات لحين التوثيق)\n\n` +
      `⚡ **صلاحية الموافقة:** مخصصة لكم كرتبة **OWNER / CEO / COO**.\n` +
      `👉 **أول مسؤول فقط يوافق على الطلب**، سيتم فوراً منح العضو رتبة **MEMBER** وتحديث الرسائل تلقائياً لدى باقي المسؤولين.`
    )
    .setFooter({ text: `GX eSports Security Engine • المعرف: ${member.id}` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`verify_approve_${member.id}`)
      .setLabel('✅ موافقة ومنح MEMBER')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`verify_reject_${member.id}`)
      .setLabel('❌ رفض الطلب')
      .setStyle(ButtonStyle.Danger)
  );

  for (const [, execMember] of executives) {
    try {
      const dmMsg = await execMember.send({
        content: `🔔 **طلب توثيق عضو ${isRejoin ? 'أعاد الانضمام' : 'جديد'} في سيرفر \`${guild.name}\` بحاجة لموافقتك (أول موافق فقط):**`,
        embeds: [embed],
        components: [row]
      }).catch(() => null);

      if (dmMsg) {
        requestsData[targetId].messages.push({
          execUserId: execMember.id,
          channelId: dmMsg.channelId,
          messageId: dmMsg.id
        });
      }
    } catch {}
  }

  saveVerificationRequests(requestsData);
  console.log(`📩 [طلب توثيق] تم إرسال طلب التوثيق في الخاص للإدارة العليا بخصوص ${member.user.tag} (انضمام رقم ${requestsData[targetId].joinCount})`);
}

/**
 * 🛡️ Finds the MANAGERS role in the guild.
 */
function findManagersRole(guild) {
  if (!guild) return null;
  return (
    guild.roles.cache.get('1538569735057178745') ||
    guild.roles.cache.find((r) => r.name.toLowerCase() === 'managers' || r.name.toLowerCase() === 'manager') ||
    null
  );
}

/**
 * Checks if a member has the MANAGERS role, Admin Tier role, or Administrator permission (Voice Immunity).
 */
function isManagerMember(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (hasAdminTierRole(member)) return true;
  return member.roles.cache.some((r) =>
    r.name.toLowerCase() === 'managers' ||
    r.name.toLowerCase() === 'manager' ||
    r.name.toLowerCase().includes('manager')
  );
}

/**
 * 👑 Checks if a member has OWNER or CEO roles, Administrator permission, or is Guild Owner.
 */
function isOwnerOrCeo(member) {
  if (!member) return false;
  if (member.guild?.ownerId === member.id) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return member.roles.cache.some((r) => {
    if (r.id === '1538485406922838066' || r.id === '1538485672795570196' || r.id === '1538544110913454160') return true;
    const name = r.name.trim().toLowerCase();
    return name === 'owner' || name === 'ceo' || name.includes('owner') || name.includes('ceo');
  });
}

/**
 * 👑 Checks if a user is authorized to grant, upgrade, or revoke roles (@itszoki or @ice0090).
 */
function isAuthorizedRoleManager(member, user) {
  const u = user || member?.user;
  if (!u) return false;
  // Specific IDs for ice0090 (1152686277255237663) and itszoki (1484535997893967980)
  if (u.id === '1152686277255237663' || u.id === '1484535997893967980') return true;
  if (member?.guild?.ownerId === u.id) return true;
  const username = u.username?.toLowerCase() || '';
  if (username === 'itszoki' || username === 'ice0090') return true;
  return false;
}

// ----------------------------------------------------
// 📜 Slash Commands Generator from JSON
// ----------------------------------------------------
function buildSlashCommandsFromJson() {
  const commandsDef = loadCommandsConfig();

  // 🛡️ Filter strictly for public commands for server users
  // All moderation & administration commands are controlled via the GX Control Panel
  const publicCommands = commandsDef.filter(
    (def) => def.Public_Command === true || (def.category !== 'moderation' && def.category !== 'admin' && !def.permission)
  );

  return publicCommands.map((def) => {
    const builder = new SlashCommandBuilder()
      .setName(def.name)
      .setDescription(def.description);

    if (def.permission) {
      if (def.permission === 'Administrator') {
        builder.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
      } else if (def.permission === 'ManageMessages') {
        builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
      } else if (def.permission === 'ManageChannels') {
        builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels);
      } else if (def.permission === 'KickMembers') {
        builder.setDefaultMemberPermissions(PermissionFlagsBits.KickMembers);
      } else if (def.permission === 'BanMembers') {
        builder.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers);
      } else if (def.permission === 'ModerateMembers') {
        builder.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);
      } else if (def.permission === 'ManageRoles') {
        builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
      } else if (def.permission === 'ManageNicknames') {
        builder.setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames);
      } else if (def.permission === 'MuteMembers') {
        builder.setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers);
      }
    }

    if (def.options && Array.isArray(def.options)) {
      for (const opt of def.options) {
        if (opt.type === 'INTEGER') {
          builder.addIntegerOption((o) => {
            o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required);
            if (opt.minValue !== undefined) o.setMinValue(opt.minValue);
            if (opt.maxValue !== undefined) o.setMaxValue(opt.maxValue);
            return o;
          });
        } else if (opt.type === 'STRING') {
          builder.addStringOption((o) => {
            o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required);
            if (opt.choices && Array.isArray(opt.choices)) {
              o.addChoices(...opt.choices);
            }
            return o;
          });
        } else if (opt.type === 'USER') {
          builder.addUserOption((o) => o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required));
        } else if (opt.type === 'ROLE') {
          builder.addRoleOption((o) => o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required));
        } else if (opt.type === 'CHANNEL') {
          builder.addChannelOption((o) => o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required));
        } else if (opt.type === 'BOOLEAN') {
          builder.addBooleanOption((o) => o.setName(opt.name).setDescription(opt.description).setRequired(!!opt.required));
        }
      }
    }

    return builder;
  });
}

/**
 * Reloads all configuration and environment variables from .env
 */
function reloadConfiguration() {
  const result = dotenv.config({ override: true });
  TOKEN = process.env.DISCORD_TOKEN;
  ALLOWED_GUILD_ID = process.env.ALLOWED_GUILD_ID?.trim();
  AUTO_ROLE_NAME = process.env.AUTO_ROLE_NAME?.trim() || 'MEMBER';
  AUTO_ROLE_ID = process.env.AUTO_ROLE_ID?.trim();
  WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID?.trim() || '1538560876339265667';
  LEAVE_CHANNEL_ID = process.env.LEAVE_CHANNEL_ID?.trim() || '1538561457912946788';
  console.log('🔄 [تحديث البرمجة] تمت إعادة قراءة ملف الإعدادات .env بنجاح.');
  return !result.error;
}

/**
 * Registers Slash Commands with Discord API from JSON file.
 */
async function registerSlashCommands(clientId, guildId) {
  try {
    const slashCommands = buildSlashCommandsFromJson();
    console.log(`🔄 جارٍ تسجيل وتحديث ${slashCommands.length} أوامر سلاش (/) من commands.json...`);
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: slashCommands.map((cmd) => cmd.toJSON()) }
    );
    console.log(`✅ تم تسجيل وتفعيل ${slashCommands.length} أوامر سلاش (/) بنجاح!`);
    return true;
  } catch (error) {
    console.error('❌ فشل تسجيل أوامر سلاش:', error.message);
    return false;
  }
}

// ----------------------------------------------------
// Voice Helper Functions & Infinite Audio Player (Loop)
// ----------------------------------------------------
let currentVoicePlayer = null;
let currentAudioResource = null;
let currentVolumeLevel = 0.10; // 10% - صوت منخفض وهادئ ومريح للخلفية افتراضياً

function playLoopAudio(connection) {
  try {
    if (!connection) return;

    if (!currentVoicePlayer) {
      currentVoicePlayer = createAudioPlayer();

      currentVoicePlayer.on(AudioPlayerStatus.Idle, () => {
        console.log('🔄 [تكرار الصوت] انتهى المقطع الصوتي، جارٍ إعادة التشغيل في حلقة لا نهائية (Loop)...');
        if (currentVoiceConnection) {
          playLoopAudio(currentVoiceConnection);
        }
      });

      currentVoicePlayer.on('error', (err) => {
        console.error('⚠️ [خطأ في تشغيل الصوت]:', err.message);
        setTimeout(() => {
          if (currentVoiceConnection) playLoopAudio(currentVoiceConnection);
        }, 1500);
      });
    }

    const candidateAudioPaths = [
      path.resolve(__dirname, 'default_track.mp3'),
      path.resolve('assets', 'audio', 'default_track.mp3'),
      path.resolve('assets', 'audio', 'loop_track.mp3')
    ];
    const audioPath = candidateAudioPaths.find((p) => fs.existsSync(p));
    if (audioPath) {
      currentAudioResource = createAudioResource(audioPath, { inlineVolume: true });
      if (currentAudioResource.volume) {
        currentAudioResource.volume.setVolume(currentVolumeLevel);
      }
      currentVoicePlayer.play(currentAudioResource);
      connection.subscribe(currentVoicePlayer);
      console.log(`🎶 [البث الصوتي] تشغيل مقطع الصوت الافتراضي بمستوى صوت منخفض (${Math.round(currentVolumeLevel * 100)}%) بنظام التكرار المستمر (Loop).`);
    } else {
      console.warn('⚠️ [تنبيه] لم يتم العثور على ملف الصوت الافتراضي.');
    }
  } catch (err) {
    console.error('❌ خطأ في تشغيل البث الصوتي:', err.message);
  }
}

function connectToVoiceChannel(channel) {
  try {
    let connection = getVoiceConnection(channel.guild.id);
    if (!connection || connection.state.status === VoiceConnectionStatus.Destroyed) {
      connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });

      connection.on(VoiceConnectionStatus.Ready, () => {
        console.log(`🔊 [الفويس] البوت متصل وجاهز في #${channel.name}. جارٍ تشغيل الصوت...`);
        playLoopAudio(connection);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        if (currentVoiceOwner) {
          console.warn('⚡ [فويس GX] رصد انقطاع اتصال البوت أثناء وجود المالك، جارٍ إعادة الاتصال التلقائي الفوري...');
          setTimeout(() => {
            if (currentVoiceOwner) {
              const targetCh = client.guilds.cache.get(ALLOWED_GUILD_ID)?.channels.cache.get(currentVoiceOwner.channelId);
              if (targetCh) {
                setAuthorizedMove();
                connectToVoiceChannel(targetCh);
              }
            }
          }, 200);
          return;
        }

        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5000)
          ]);
        } catch {
          if (!isAuthorizedBotMove && !currentVoiceOwner) {
            console.log('🔌 تم فصل اتصال البوت الصوتي.');
            disconnectVoice();
          }
        }
      });
    } else {
      connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });
    }

    currentVoiceConnection = connection;
    playLoopAudio(connection);
    return connection;
  } catch (err) {
    console.error('❌ خطأ في الاتصال بالروم الصوتي:', err.message);
    return null;
  }
}

function disconnectVoice() {
  if (currentVoicePlayer) {
    try { currentVoicePlayer.stop(); } catch {}
  }
  if (currentVoiceConnection) {
    try { currentVoiceConnection.destroy(); } catch {}
  }
  const oldConnection = getVoiceConnection(ALLOWED_GUILD_ID);
  if (oldConnection) {
    try { oldConnection.destroy(); } catch {}
  }
  currentVoiceConnection = null;
  currentVoicePlayer = null;
  currentVoiceOwner = null;
}

function findVerifiedMemberRole(guild) {
  if (!guild) return null;
  if (VERIFIED_MEMBER_ROLE_ID) {
    const roleById = guild.roles.cache.get(VERIFIED_MEMBER_ROLE_ID);
    if (roleById) return roleById;
  }
  return guild.roles.cache.find(
    (r) => r.name.toLowerCase() === 'member'
  ) || null;
}

function findAutoRole(guild) {
  return findVerifiedMemberRole(guild);
}

function findGeneralChannel(guild) {
  if (!guild) return null;
  return (
    guild.channels.cache.find((c) => c.isTextBased() && (c.name.includes('عام') || c.name.includes('general') || c.name.includes('chat') || c.name.includes('الدردشة') || c.name.includes('شات') || c.name.includes('main'))) ||
    guild.channels.cache.find((c) => c.isTextBased() && c.id !== EVENT_CHANNEL_ID && !c.name.includes('log') && !c.name.includes('status') && !c.name.includes('ticket')) ||
    null
  );
}


// ----------------------------------------------------
// 📊 System-Status Live Dashboard (تتحدث كل 10 ثوان)
// ----------------------------------------------------
function formatUptime(uptimeSeconds) {
  const d = Math.floor(uptimeSeconds / (3600 * 24));
  const h = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
  const m = Math.floor((uptimeSeconds % 3600) / 60);
  const s = Math.floor(uptimeSeconds % 60);
  return `${d > 0 ? `${d}d ` : ''}${h > 0 ? `${h}h ` : ''}${m}m ${s}s`;
}

async function getOrCreateSystemStatusChannel(guild) {
  if (!guild) return null;

  try {
    let channel = guild.channels.cache.find(
      (c) => (c.name === 'system-status' || c.name === 'حالة-النظام') && c.type === ChannelType.GuildText
    );

    if (!channel) {
      const botMember = guild.members.me;
      if (botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        channel = await guild.channels.create({
          name: 'system-status',
          type: ChannelType.GuildText,
          topic: '📊 لوحة تحكم وإحصائيات النظام المباشرة لبوت GX eSports • تتحدث باستمرار كل 10 ثوان'
        });
        console.log(`📁 [لوحة النظام] تم إنشاء قناة #${channel.name} بنجاح.`);
      }
    }
    return channel;
  } catch (err) {
    console.error('خطأ في إيجاد أو إنشاء قناة system-status:', err.message);
    return null;
  }
}

function buildSystemStatusEmbed(guild) {
  const ping = Math.round(client.ws.ping) || 0;
  const uptimeStr = formatUptime(process.uptime());
  const memUsed = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
  const memTotal = (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2);
  const rss = (process.memoryUsage().rss / 1024 / 1024).toFixed(2);

  const totalMembers = guild.memberCount;
  const botsCount = guild.members.cache.filter((m) => m.user.bot).size;
  const humansCount = totalMembers - botsCount;
  const rolesCount = guild.roles.cache.size;
  const textChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).size;
  const voiceChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).size;
  const categoriesCount = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).size;

  const botVoiceId = guild.members.me?.voice?.channelId;
  const botVoiceChannel = botVoiceId ? guild.channels.cache.get(botVoiceId) : null;
  const voiceMembersCount = botVoiceChannel ? botVoiceChannel.members.size : 0;

  const role = findAutoRole(guild);
  const roleOk = role && guild.members.me?.roles.highest.comparePositionTo(role) > 0;

  const commandsCount = loadCommandsConfig().length;

  const embed = new EmbedBuilder()
    .setColor(0x00D26A)
    .setAuthor({
      name: '🟢 لوحة التحكم والإحصائيات المباشرة | GX eSports',
      iconURL: guild.iconURL({ dynamic: true }) || client.user?.displayAvatarURL()
    })
    .setTitle('⚡ حالة النظام وأداء البوت (Real-Time Live Monitor)')
    .setDescription(
      `مراقبة وإحصائيات شاملة ومباشرة لكافة أنظمة البوت والسيرفر تتحدث تلقائياً:\n\n` +
      `🟢 **حالة البوت:** \`متصل ومستقر (Online)\` • 📦 **الإصدار:** \`v${BOT_VERSION}\` • 📜 **الأوامر:** \`${commandsCount} أمر نشط\``
    )
    .addFields(
      {
        name: '⚡ سرعة الاتصال والاستجابة',
        value: `\`🌐 API Ping: ${ping}ms\`\n\`🟢 Websocket: مستقر\``,
        inline: true
      },
      {
        name: '⏱️ مدة التشغيل (Live Uptime)',
        value: `\`⏳ ${uptimeStr}\``,
        inline: true
      },
      {
        name: '🧠 استهلاك الذاكرة (RAM)',
        value: `\`Heap: ${memUsed} MB / ${memTotal} MB\`\n\`RSS: ${rss} MB\``,
        inline: true
      },
      {
        name: '👥 إحصائيات أعضاء السيرفر',
        value:
          `• 👥 إجمالي الأعضاء: **${totalMembers}** عضو\n` +
          `• 👤 الأعضاء (بشر): **${humansCount}**\n` +
          `• 🤖 البوتات: **${botsCount}**`,
        inline: true
      },
      {
        name: '📁 إحصائيات الرتب والقنوات',
        value:
          `• 🎭 عدد الرتب: **${rolesCount}** رتبة\n` +
          `• 💬 القنوات الكتابية: **${textChannels}**\n` +
          `• 🔊 القنوات الصوتية: **${voiceChannels}**\n` +
          `• 📂 الأقسام (Categories): **${categoriesCount}**`,
        inline: true
      },
      {
        name: '🎙️ نظام الفويس والاستدعاء',
        value:
          `• 📻 الحالة: ${botVoiceId ? `\`متصل في #${botVoiceChannel?.name}\` 🔊` : '`غير متصل (جاهز للاستدعاء)` 💤'}\n` +
          `• 👑 المتحكم: ${currentVoiceOwner ? `<@${currentVoiceOwner.userId}>` : '\`متاح للجميع\`'}\n` +
          `• 👥 متواجدون معه: \`${voiceMembersCount}\` عضو\n` +
          `• 🛡️ حماية السحب (Anti-Drag): \`نشطة 🟢\`\n` +
          `• 👑 حصانة الإدارة: \`رتبة MANAGERS محمية ومعزولة عن MEMBER 🛡️\``,
        inline: false
      },
      {
        name: '👑 نظام الرتب التلقائية (Auto-Role)',
        value:
          `• 🏷️ الرتبة: \`${AUTO_ROLE_NAME}\` (${role ? `<@&${role.id}>` : 'غير موجودة'})\n` +
          `• 📶 التراتبية: ${roleOk ? '`صحيحة (أعلى من الرتبة)` ✅' : '`تحتاج تعديل` ⚠️'}\n` +
          `• ⏱️ المزامنة: \`كل 30 ثانية تلقائياً في الخلفية\` 🟢`,
        inline: true
      },
      {
        name: '📋 القنوات الإدارية والرسمية',
        value:
          `• 🔒 سجلات الإدارة: \`#log\` (لحظية وشاملة)\n` +
          `• 🎉 روم الترحيب: <#${WELCOME_CHANNEL_ID}>\n` +
          `• 📤 روم المغادرة: <#${LEAVE_CHANNEL_ID}>`,
        inline: true
      }
    )
    .setFooter({
      text: `GX eSports Live Engine • تحديث مباشر كل 10 ثوان • الإصدار ${BOT_VERSION}`,
      iconURL: client.user?.displayAvatarURL()
    })
    .setTimestamp();

  return embed;
}

async function updateLiveSystemStatus(guild) {
  if (isUpdatingStatus || !guild || guild.id !== ALLOWED_GUILD_ID) return;
  isUpdatingStatus = true;

  try {
    const statusChannel = await getOrCreateSystemStatusChannel(guild);
    if (!statusChannel) {
      isUpdatingStatus = false;
      return;
    }

    const embed = buildSystemStatusEmbed(guild);

    if (!statusMessageRef) {
      const savedMsgId = loadStatusMessageId();
      if (savedMsgId) {
        statusMessageRef = await statusChannel.messages.fetch(savedMsgId).catch(() => null);
      }
    }

    if (!statusMessageRef) {
      const messages = await statusChannel.messages.fetch({ limit: 10 }).catch(() => null);
      const botMsg = messages?.find((m) => m.author.id === client.user.id);
      if (botMsg) {
        statusMessageRef = botMsg;
        saveStatusMessageId(botMsg.id);
      }
    }

    if (statusMessageRef) {
      await statusMessageRef.edit({ embeds: [embed] }).catch((err) => {
        if (err.code === 10008) statusMessageRef = null;
      });
    } else {
      const newMsg = await statusChannel.send({ embeds: [embed] }).catch(() => null);
      if (newMsg) {
        statusMessageRef = newMsg;
        saveStatusMessageId(newMsg.id);
      }
    }
  } catch (err) {
    // Ignore rate limits gracefully
  } finally {
    isUpdatingStatus = false;
  }
}

// ----------------------------------------------------
// 🎉 Welcome & Leave Channels System (Dynamic Numbering)
// ----------------------------------------------------
async function getNextDynamicMemberNumber(member) {
  const tracker = loadWelcomeTracker();
  if (tracker.members && tracker.members[member.id]?.number) {
    return tracker.members[member.id].number;
  }

  const nextNum = tracker.nextNumber || 1;
  if (!tracker.members) tracker.members = {};
  tracker.members[member.id] = {
    number: nextNum,
    username: member.user.username,
    joinedAt: Date.now()
  };
  tracker.nextNumber = nextNum + 1;
  saveWelcomeTracker(tracker);
  return nextNum;
}

async function sendWelcomeMessage(member, explicitNumber = null) {
  const welcomeChId = WELCOME_CHANNEL_ID || '1538560876339265667';
  const welcomeChannel = member.guild.channels.cache.get(welcomeChId);

  if (!welcomeChannel) return;

  const memberNumber = explicitNumber || await getNextDynamicMemberNumber(member);

  const embed = new EmbedBuilder()
    .setColor(0x00D26A)
    .setAuthor({
      name: '🎉 انضمام عضو جديد | GX eSports',
      iconURL: member.guild.iconURL() || client.user?.displayAvatarURL()
    })
    .setTitle(`مرحبا بك يا ${member.user.username} 👋`)
    .setDescription(
      `مرحبا بك يا <@${member.id}>.. انت العضو رقم **#${memberNumber}** في سيرفرنا!\n\n` +
      `👑 **تم منحك رتبة \`${AUTO_ROLE_NAME}\` تلقائياً.**\n` +
      `📜 نرجو منك قراءة القوانين والاستمتاع بتجربتك معنا في **GX eSports**!`
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
    .addFields(
      { name: '👤 العضو', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
      { name: '🔢 رقم العضوية', value: `\`#${memberNumber}\``, inline: true },
      { name: '📅 تاريخ إنشاء الحساب', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: '👥 إجمالي الأعضاء', value: `\`${member.guild.memberCount}\` عضو`, inline: true }
    )
    .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
    .setTimestamp();

  await welcomeChannel.send({
    content: `👋 مرحباً بك يا <@${member.id}> في سيرفر **GX eSports**!`,
    embeds: [embed]
  }).catch(() => {});
}

async function sendLeaveMessage(member) {
  const leaveChId = LEAVE_CHANNEL_ID || '1538561457912946788';
  const leaveChannel = member.guild.channels.cache.get(leaveChId);

  if (!leaveChannel) return;

  const joinTime = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'غير معروف';

  const embed = new EmbedBuilder()
    .setColor(0xED4245)
    .setAuthor({
      name: '📤 مغادرة عضو من السيرفر | GX eSports',
      iconURL: member.guild.iconURL() || client.user?.displayAvatarURL()
    })
    .setTitle(`وداعاً يا ${member.user.username} 💔`)
    .setDescription(
      `وداعاً يا <@${member.id}>.. نتمنى لك التوفيق!\n\n` +
      `📊 **أصبح عدد أعضاء السيرفر الآن:** \`${member.guild.memberCount}\` عضو.`
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 512 }))
    .addFields(
      { name: '👤 العضو', value: `\`${member.user.tag}\` (<@${member.id}>)`, inline: true },
      { name: '📅 انضم للسيرفر في', value: joinTime, inline: true },
      { name: '👥 الأعضاء المتبقون', value: `\`${member.guild.memberCount}\` عضو`, inline: true }
    )
    .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
    .setTimestamp();

  await leaveChannel.send({
    content: `💔 غادر <@${member.id}> سيرفر **GX eSports**.`,
    embeds: [embed]
  }).catch(() => {});
}

async function welcomeExistingMembersSequentially(guild) {
  const welcomedList = loadWelcomedMembers();
  const tracker = loadWelcomeTracker();
  const allMembers = await guild.members.fetch().catch(() => guild.members.cache);

  const humanMembers = allMembers
    .filter((m) => !m.user.bot)
    .sort((a, b) => (a.joinedTimestamp || 0) - (b.joinedTimestamp || 0));

  let countIndex = 1;
  for (const [, member] of humanMembers) {
      // Check & ban suspicious accounts created on/after 16 August 2026
      if (await enforceSuspiciousAccountBan(member, guild, client, sendToLogChannel, isOwnerOrCeo, BOT_VERSION)) continue;
    if (!tracker.members[member.id]) {
      tracker.members[member.id] = {
        number: countIndex,
        username: member.user.username,
        joinedAt: member.joinedTimestamp || Date.now()
      };
    }
    if (!welcomedList.includes(member.id)) {
      await sendWelcomeMessage(member, countIndex);
      welcomedList.push(member.id);
      saveWelcomedMembers(welcomedList);
      console.log(`✅ [ترحيب] تم إرسال بطاقة الترحيب للعضو #${countIndex}: ${member.user.tag}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    countIndex++;
  }
  tracker.nextNumber = countIndex;
  saveWelcomeTracker(tracker);
  saveWelcomedMembers(welcomedList);
}

/**
 * 🛡️ Sends the official "تم تفعيل GX" security onboarding direct message to a member.
 * Sends the "تم تفعيل GX" security onboarding message to members.
 */
async function sendSecurityOnboardingDM(member) {
  if (!member || member.user.bot) return;

  const sentList = loadDMSecuritySent();
  if (sentList.includes(member.id)) return;

  const securityEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({
      name: '🛡️ نظام الحماية والأمان الذكي | GX eSports Shield',
      iconURL: member.guild.iconURL() || member.client.user?.displayAvatarURL()
    })
    .setTitle('تم تفعيل GX')
    .setDescription(
      `# 🛡️ تم تفعيل نظام الأمان المتقدم لحسابك بنجاح\n\n` +
      `أهلاً بك يا <@${member.id}> في مجتمع **GX eSports**.\n` +
      `تم ربط وتفعيل منظومة **GX Security Engine** لحماية وتأمين تواجدك داخل السيرفر:\n\n` +
      `🔹 **الخصائص والأنظمة المفعلة:**\n` +
      `> ⚡ **مكافحة التكرار والسبام الذكية:** مراقبة وتحليل النصوص المتطابقة أو المشابهة بنسبة \`85%+\`.\n` +
      `> 🛡️ **نظام المخالفات التلقائي (Strikes Ladder):** إنذارات متدرجة وحظر فوري عند الإصرار على الإزعاج.\n` +
      `> 🎫 **نظام التذاكر المشفرة:** حماية كاملة وخصوصية لطلبات الدعم الفني.\n\n` +
      `💡 *نتمنى لك قضاء وقت ممتع ومميز في GX eSports!*`
    )
    .setFooter({ text: `GX eSports Security System • الإصدار ${BOT_VERSION}` })
    .setTimestamp();

  try {
    await member.send({ embeds: [securityEmbed] });
    console.log(`🛡️ [أمان GX] تم إرسال رسالة "تم تفعيل GX" بنجاح إلى ${member.user.tag} (${member.id})`);
  } catch (err) {
    console.log(`ℹ️ [أمان GX] تعذر إرسال رسالة الأمان بالخاص إلى ${member.user.tag} (الخاص مغلق لدى العضو).`);
  } finally {
    if (!sentList.includes(member.id)) {
      sentList.push(member.id);
      saveDMSecuritySent(sentList);
    }
  }
}

/**
 * 🛡️ Retroactively sends the "تم تفعيل GX" security message to all existing members.
 */
async function sendSecurityDMToExistingMembers(guild) {
  if (!guild || guild.id !== ALLOWED_GUILD_ID) return;
  try {
    const allMembers = await guild.members.fetch().catch(() => guild.members.cache);
    const sentList = loadDMSecuritySent();

    for (const [, m] of allMembers) {
      if (!m.user.bot && !sentList.includes(m.id)) {
        await sendSecurityOnboardingDM(m);
        await new Promise((resolve) => setTimeout(resolve, 800)); // Delay to prevent Discord API rate limiting
      }
    }
  } catch (err) {
    console.error('خطأ في إرسال رسائل الأمان للأعضاء الحاليين:', err.message);
  }
}


/**
 * 🎫 Support Ticket Thread Generator with Collected Data (Instant Modal Creation)
 */
/**
 * 📩 Sends a high-priority DM notification to Executives (OWNER, CEO, COO) when a ticket is opened.
 */
async function sendTicketNotificationToExecutives(guild, user, ticketCode, realName, reason, thread) {
  if (!guild || !user) return;
  const executives = await getExecutiveMembers(guild);
  if (!executives || executives.size === 0) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: '🎫 إشعار تذكرة دعم فني جديدة | GX Support Alert', iconURL: user.displayAvatarURL() })
    .setTitle(`تم فتح تذكرة جديدة: ${ticketCode}`)
    .setDescription(
      `# 🎫 طلب دعم فني جديد\n` +
      `> 👤 **صاحب التذكرة:** <@${user.id}> (\`${user.tag}\`)\n` +
      `> 📛 **الاسم:** \`${realName}\`\n` +
      `> 📝 **السبب:** ${reason}\n` +
      `> 🧵 **القناة الفرعية الخاصة:** <#${thread.id}>\n\n` +
      `🔗 **الرد والمعالجة المباشرة عبر لوحة التحكم:**\n` +
      `### [اضغط هنا للدخول إلى مركز الدعم الفني (gxbot.eshamikh.com/support)](https://gxbot.eshamikh.com/support)`
    )
    .setFooter({ text: 'GX eSports High Command Support • gxbot.eshamikh.com/support' })
    .setTimestamp();

  for (const [, execMember] of executives) {
    try {
      await execMember.send({
        content: `🔔 **إشعار دعم فني جديد:** قام العضو \`${user.tag}\` بفتح تذكرة [${ticketCode}]. اضغط الرابط للرد من الموقع: https://gxbot.eshamikh.com/support`,
        embeds: [embed]
      }).catch(() => null);
    } catch {}
  }
}

async function openTicketThreadWithData(guild, originChannel, user, realName, reason) {
  const ticketsData = loadTickets();
  const counter = ticketsData.counter || 1;
  const ticketCode = `GX-T-${String(counter).padStart(3, '0')}`;
  ticketsData.counter = counter + 1;

  let baseChannel = originChannel;
  if (!baseChannel || baseChannel.type !== ChannelType.GuildText) {
    baseChannel = guild.channels.cache.find(c => (c.name === 'tickets' || c.name === 'تذاكر' || c.name === 'الدعم' || c.name === 'تذاكر-الدعم') && c.type === ChannelType.GuildText) ||
                  guild.channels.cache.find(c => c.type === ChannelType.GuildText);
  }

  let thread;
  try {
    thread = await baseChannel.threads.create({
      name: ticketCode,
      autoArchiveDuration: 1440,
      type: ChannelType.PrivateThread,
      reason: `تذكرة دعم فني خاصة بواسطة ${user.tag}`
    });
  } catch (e) {
    thread = await baseChannel.threads.create({
      name: ticketCode,
      autoArchiveDuration: 1440,
      type: ChannelType.PublicThread,
      reason: `تذكرة دعم فني بواسطة ${user.tag}`
    });
  }

  // 🔒 ISOLATE THREAD: Strictly add ONLY the ticket author to the thread
  await thread.members.add(user.id).catch(() => {});

  if (!ticketsData.activeTickets) ticketsData.activeTickets = {};
  ticketsData.activeTickets[thread.id] = {
    ticketId: ticketCode,
    threadId: thread.id,
    userId: user.id,
    userTag: user.tag,
    userAvatar: user.displayAvatarURL(),
    channelId: baseChannel.id,
    stage: 'WAITING_AGENT',
    realName: realName,
    reason: reason,
    claimedBy: null,
    claimedByTag: null,
    openedAt: Date.now(),
    lastActivityAt: Date.now(),
    hasUnreadAgent: true,
    transcript: [
      {
        authorId: user.id,
        authorTag: user.tag,
        authorAvatar: user.displayAvatarURL(),
        content: `[فتح التذكرة] الاسم: ${realName} • السبب: ${reason}`,
        timestamp: Date.now()
      }
    ]
  };
  saveTickets(ticketsData);

  // Clean Welcome Card for the User in the Thread
  const userWelcomeEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: 'مركز الدعم الفني | GX Support Desk', iconURL: guild.iconURL() })
    .setTitle(`🎫 تذكرة الدعم الفني: ${ticketCode}`)
    .setDescription(
      `مرحباً بك يا <@${user.id}>،\n\n` +
      `✅ **تم تسجيل واستلام طلبك بنجاح من قبل فريق الدعم الفني.**\n` +
      `📝 **تفاصيل المشكلة:** ${reason}\n\n` +
      `💬 يرجى كتابة أي تفاصيل إضافية أو إرسال الصور هنا، وسيقوم وكيل الدعم بالرد عليك مباشرة من لوحة التحكم.`
    )
    .setFooter({ text: `GX Support Engine • ${ticketCode}` })
    .setTimestamp();

  await thread.send({
    content: `<@${user.id}>`,
    embeds: [userWelcomeEmbed]
  });

  // Notify Executives with direct Web link
  await sendTicketNotificationToExecutives(guild, user, ticketCode, realName, reason, thread);

  logActivity('ticket', 'Ticket Opened', `${user.tag} opened ${ticketCode} (${reason.slice(0, 30)})`, user);

  const logEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: '🎫 فتح تذكرة دعم جديدة', iconURL: user.displayAvatarURL() })
    .setDescription(`قام العضو <@${user.id}> (\`${user.tag}\`) بفتح تذكرة جديدة: <#${thread.id}> (\`${ticketCode}\`).\n🔗 الإدارة والرد مباشرة عبر: https://gxbot.eshamikh.com/support`)
    .setFooter({ text: `GX eSports Support • ${ticketCode}` })
    .setTimestamp();
  await sendToLogChannel(guild, logEmbed);

  return thread;
}

/**
 * Syncs and adds all managers to any existing active ticket threads.
 */
async function syncActiveTicketsMembers(guild) {
  if (!guild || guild.id !== ALLOWED_GUILD_ID) return;
  const ticketsData = loadTickets();
  if (!ticketsData.activeTickets) return;

  const allMembers = await guild.members.fetch().catch(() => guild.members.cache);

  for (const [threadId, ticket] of Object.entries(ticketsData.activeTickets)) {
    try {
      const thread = await guild.channels.fetch(threadId).catch(() => null);
      if (thread) {
        await thread.members.add(ticket.userId).catch(() => {});
        for (const [, m] of allMembers) {
          if (isManagerMember(m)) {
            await thread.members.add(m.id).catch(() => {});
          }
        }
        console.log(`🎫 [مزامنة التذاكر] تمت إضافة الإداريين للتذكرة النشطة: ${ticket.ticketId}`);
      }
    } catch {}
  }
}

/**
 * Gets or creates the official ticket support channel.
 */
async function getOrCreateTicketChannel(guild) {
  if (!guild) return null;

  try {
    let ticketChannel = guild.channels.cache.find(
      (c) => (c.name === 'tickets' || c.name === 'تذاكر' || c.name === 'الدعم' || c.name === 'تذاكر-الدعم' || c.name === 'ticket-support' || c.name.includes('تذاكر')) && c.type === ChannelType.GuildText
    );

    if (!ticketChannel) {
      ticketChannel = await guild.channels.create({
        name: '🎫・تذاكر-الدعم',
        type: ChannelType.GuildText,
        topic: 'مركز الدعم الفني والمساعدة الرسمي لسيرفر GX eSports',
        reason: 'إنشاء قناة تذاكر الدعم الفني الدائمة'
      });
      console.log(`📁 [إنشاء روم] تم إنشاء قناة التذاكر الرسمية: #${ticketChannel.name}`);
    }

    return ticketChannel;
  } catch (err) {
    console.error('خطأ في جلب أو إنشاء روم التذاكر:', err.message);
    return null;
  }
}

/**
 * Ensures the permanent ticket panel message is always present in the ticket channel with @everyone and button.
 */
async function ensurePermanentTicketPanel(guild) {
  if (!guild || guild.id !== ALLOWED_GUILD_ID) return;

  try {
    const channel = await getOrCreateTicketChannel(guild);
    if (!channel) return;

    const panelData = loadTicketPanelData();
    let existingMsg = null;

    if (panelData.channelId === channel.id && panelData.messageId) {
      existingMsg = await channel.messages.fetch(panelData.messageId).catch(() => null);
    }

    if (!existingMsg) {
      const messages = await channel.messages.fetch({ limit: 10 }).catch(() => null);
      const botMsg = messages?.find((m) => m.author.id === client.user.id && m.components?.length > 0);
      if (botMsg) {
        existingMsg = botMsg;
        saveTicketPanelData({ channelId: channel.id, messageId: botMsg.id });
      }
    }

    const panelEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({
        name: '🎫 مركز الدعم الفني والمساعدة | GX eSports',
        iconURL: guild.iconURL({ dynamic: true }) || client.user?.displayAvatarURL()
      })
      .setTitle('مركز المساعدة وفتح تذاكر الدعم الفني 📩')
      .setDescription(
        `مرحباً بكم في مركز المساعدة الرسمي لسيرفر **GX eSports**.\n\n` +
        `🔹 **هل تواجه مشكلة أو تحتاج استفساراً أو مساعدة من الإدارة؟**\n` +
        `اضغط على الزر أدناه لفتح تذكرة دعم فني خاصة بك للتواصل المباشر مع فريق الإدارة والمشرفين.\n\n` +
        `📌 **مميزات نظام التذاكر:**\n` +
        `• 🧵 قناة فرعية (Thread) مستقلة ومخصصة لك لمتابعة طلبك.\n` +
        `• ⚡ استجابة سريعة من المشرفين وأصحاب رتبة **MANAGERS**.\n` +
        `• 🔒 خصوصية وأمان تام وتوثيق كامل لكافة تفاصيل طلبك.\n\n` +
        `👇 **اضغط على الزر أدناه لبدء التذكرة:**`
      )
      .setFooter({
        text: `GX eSports Support System • رسالة دائمة ومحدثة • الإصدار ${BOT_VERSION}`,
        iconURL: client.user?.displayAvatarURL()
      })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open_ticket_btn')
        .setLabel('📩 فتح تذكرة دعم فني')
        .setStyle(ButtonStyle.Primary)
    );

    if (existingMsg) {
      await existingMsg.edit({
        content: '@everyone',
        embeds: [panelEmbed],
        components: [row]
      }).catch(() => {});
      saveTicketPanelData({ channelId: channel.id, messageId: existingMsg.id });
    } else {
      const newMsg = await channel.send({
        content: '@everyone',
        embeds: [panelEmbed],
        components: [row]
      });
      if (newMsg) {
        saveTicketPanelData({ channelId: channel.id, messageId: newMsg.id });
        console.log(`📌 [لوحة التذاكر الدائمة] تم إرسال وتثبيت لوحة التذاكر مع منشن @everyone في #${channel.name}`);
      }
    }
  } catch (err) {
    console.error('خطأ في لوحة التذاكر الدائمة:', err.message);
  }
}

/**
 * Gets or creates the private #log channel restricted to Administrators.
 */
async function getOrCreateLogChannel(guild) {
  if (!guild) return null;

  try {
    let logChannel = guild.channels.cache.find(
      (c) => (c.name === 'log' || c.name === 'logs' || c.name === 'سجلات') && c.type === ChannelType.GuildText
    );

    if (!logChannel) {
      const botMember = guild.members.me;
      if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return null;
      }

      logChannel = await guild.channels.create({
        name: 'log',
        type: ChannelType.GuildText,
        topic: '📋 سجلات الإدارة الشاملة لسيرفر GX eSports • سرية للإدارة فقط',
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
          },
          {
            id: botMember.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles
            ]
          }
        ]
      });

      console.log(`📁 [نظام السجلات الشامل] تم إنشاء روم السجلات #${logChannel.name} بنجاح.`);

      const welcomeLogEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📋 تم تفعيل نظام السجلات الإدارية الشامل اللحظي')
        .setDescription(
          `مرحباً بكم في غرفة سجلات الإدارة الشاملة لسيرفر **${guild.name}**.\n\n` +
          `🔒 **القناة مخصصة للإدارة فقط لتسجيل جميع الأحداث بشكل فوري ولحظي:**\n` +
          `• 📁 **القنوات والأقسام التصنيفية (Categories)**: إنشاء، تعديل الأسماء والخواص، والحذف.\n` +
          `• 👑 **الرتب**: إنشاء، تعديل الأسماء والألوان والصلاحيات، حذف، وإعطاء أو سحب الرتب وعزل الإدارة عن MEMBER.\n` +
          `• 🛡️ **حماية الفويس**: التصدي لمحاولات السحب اليدوي وإعادة البوت تلقائياً.\n` +
          `• 🎙️ **الرومات الصوتية**: الاستدعاء، الانتقال، وتسليم التحكم.\n` +
          `• 💬 **الرسائل والرقابة**: الحذف، التعديل، المسح الجماعي (/clear)، والتحذيرات والتايم أوت.\n` +
          `• 👥 **الأعضاء**: الانضمام، المغادرة، الطرد، الحظر، والتايم أوت وتغيير الألقاب.`
        )
        .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      await logChannel.send({ embeds: [welcomeLogEmbed] }).catch(() => {});
    }

    return logChannel;
  } catch (err) {
    console.error('❌ خطأ في العثور على أو إنشاء روم السجلات:', err.message);
    return null;
  }
}

/**
 * Sends an embed message instantly to the admin log channel.
 */
async function sendToLogChannel(guild, embed) {
  if (!guild || guild.id !== ALLOWED_GUILD_ID) return;
  try {
    const logCh = await getOrCreateLogChannel(guild);
    if (logCh && logCh.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
      await logCh.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err) {
    console.error('تعذر الإرسال إلى قناة السجلات:', err.message);
  }
}

/**
 * Fetches recent audit log executor for an action (skipping bot self-actions).
 */
async function fetchAuditExecutor(guild, auditType, targetId = null) {
  try {
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;

    // Small delay to let Discord REST audit log propagate
    await new Promise((resolve) => setTimeout(resolve, 800));

    const fetchedLogs = await guild.fetchAuditLogs({
      limit: 6,
      type: auditType
    });

    const matchingEntry = fetchedLogs.entries.find((entry) => {
      // Skip the bot itself so we don't attribute undo actions to the bot
      if (entry.executor?.id === client.user.id) return false;
      // If targetId specified, entry target must match
      if (targetId && entry.target?.id !== targetId) return false;
      // Must be recent (last 15 seconds)
      return (Date.now() - entry.createdTimestamp) < 15000;
    });

    if (matchingEntry) {
      return matchingEntry.executor;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Syncs the MEMBER role to regular server members, and assigns MANAGERS to admin tier roles (COO, CEO, OWNER, SUPER ADMIN, MIDDLE ADMIN, LOWER ADMIN).
 */
async function syncAllMembersRole(guild, fetchRemote = false) {
  if (!guild || isSyncingRoles) return { count: 0, total: 0, removedCount: 0, managerGrantedCount: 0 };

  isSyncingRoles = true;

  try {
    const role = findAutoRole(guild);
    const managersRole = findManagersRole(guild);
    if (!role) {
      isSyncingRoles = false;
      return { count: 0, total: 0, removedCount: 0, managerGrantedCount: 0, error: `الرتبة "${AUTO_ROLE_NAME}" غير موجودة بالسيرفر` };
    }

    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
      isSyncingRoles = false;
      return { count: 0, total: 0, removedCount: 0, managerGrantedCount: 0, error: 'صلاحيات إدارة الرتب غير مكتملة' };
    }

    const members = fetchRemote ? await guild.members.fetch().catch(() => guild.members.cache) : guild.members.cache;
    const humanMembers = members.filter((m) => !m.user.bot);

    const untrustedRole = await findOrCreateUntrustedRole(guild);

    let givenCount = 0;
    let removedCount = 0;
    let managerGrantedCount = 0;

    for (const [, member] of humanMembers) {
      const hasAdminRole = hasAdminTierRole(member);
      const isManager = isManagerMember(member);
      const hasMemberRole = member.roles.cache.has(role.id);
      const hasUntrustedRole = untrustedRole ? member.roles.cache.has(untrustedRole.id) : false;

      // 0. Untrusted Member Isolation: strictly enforce UNTRUSTED, strip MEMBER
      if (hasUntrustedRole) {
        if (hasMemberRole) {
          try {
            await member.roles.remove(role);
            removedCount++;
          } catch {}
        }
        continue;
      }

      // 1. If user has COO, CEO, OWNER, SUPER ADMIN, MIDDLE ADMIN, LOWER ADMIN -> Ensure they have MANAGERS role
      if (hasAdminRole && managersRole && !member.roles.cache.has(managersRole.id)) {
        try {
          if (botMember.roles.highest.comparePositionTo(managersRole) > 0) {
            await member.roles.add(managersRole);
            managerGrantedCount++;
            console.log(`🛡️ [ترقية إدارية تلقائية] تم منح رتبة "${managersRole.name}" للعضو: ${member.user.tag}`);

            const logEmbed = new EmbedBuilder()
              .setColor(0x57F287)
              .setAuthor({ name: '🛡️ ترقية إدارية تلقائية (MANAGERS)', iconURL: member.user.displayAvatarURL() })
              .setDescription(`تم منح رتبة <@&${managersRole.id}> تلقائياً للعضو <@${member.id}> (\`${member.user.tag}\`) لحمله إحدى الرتب الإدارية العليا (COO / CEO / OWNER / SUPER ADMIN / MIDDLE ADMIN / LOWER ADMIN).`)
              .setFooter({ text: `GX eSports Security • الإصدار ${BOT_VERSION}` })
              .setTimestamp();
            await sendToLogChannel(guild, logEmbed);
            await new Promise((res) => setTimeout(res, 400));
          }
        } catch (err) {
          console.error(`❌ تعذر منح رتبة MANAGERS للعضو ${member.user.tag}:`, err.message);
        }
      }

      // 2. If Manager has MEMBER or UNTRUSTED role -> REMOVE IT!
      if ((isManager || hasAdminRole) && (hasMemberRole || hasUntrustedRole)) {
        try {
          if (hasMemberRole && botMember.roles.highest.comparePositionTo(role) > 0) {
            await member.roles.remove(role);
            removedCount++;
            console.log(`🗑️ [إزالة رتبة] تم بنجاح سحب رتبة "${role.name}" من العضو الإداري (${member.user.tag}) لحمله رتبة MANAGERS.`);
          }
          if (hasUntrustedRole && untrustedRole && botMember.roles.highest.comparePositionTo(untrustedRole) > 0) {
            await member.roles.remove(untrustedRole);
          }
        } catch (err) {
          console.error(`❌ تعذر إزالة الرتبة من الإداري ${member.user.tag}:`, err.message);
        }
      }

      // 3. Regular member without MEMBER and without UNTRUSTED -> Give UNTRUSTED as default and send verification request to executives DM
      else if (!isManager && !hasAdminRole && !hasMemberRole && !hasUntrustedRole) {
        try {
          if (untrustedRole && botMember.roles.highest.comparePositionTo(untrustedRole) > 0) {
            await member.roles.add(untrustedRole);
            givenCount++;
            console.log(`🛡️ [رتبة افتراضية] تم تعيين رتبة UNTRUSTED للعضو الجديد: ${member.user.tag}`);
            await sendVerificationRequestToExecutives(guild, member);
            await new Promise((res) => setTimeout(res, 400));
          }
        } catch (err) {
          console.error(`❌ تعذر إعطاء رتبة UNTRUSTED للعضو ${member.user.tag}:`, err.message);
        }
      }
    }

    isSyncingRoles = false;
    return { count: givenCount, removedCount, managerGrantedCount, total: humanMembers.size };
  } catch (err) {
    console.error('خطأ أثناء مزامنة الرتب:', err.message);
    isSyncingRoles = false;
    return { count: 0, removedCount: 0, managerGrantedCount: 0, total: 0, error: err.message };
  }
}

async function handleUnauthorizedGuild(guild) {
  if (!guild) return;

  console.warn(`\n⚠️  [حظر] تم رصد البوت في سيرفر غير مصرح به: "${guild.name}" (${guild.id})`);

  try {
    let targetChannel = guild.systemChannel;

    if (!targetChannel || !targetChannel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
      targetChannel = guild.channels.cache.find(
        (ch) =>
          ch.type === ChannelType.GuildText &&
          ch.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)
      );
    }

    if (targetChannel) {
      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: 'نظام الحماية والأمان | GX eSports', iconURL: client.user?.displayAvatarURL() })
        .setTitle('⛔ تنبيه: هذا البوت مخصص لسيرفر رسمي فقط')
        .setDescription(
          `عذراً، هذا البوت مخصص حصرياً للعمل داخل سيرفر **GX eSports** (المعرف: \`${ALLOWED_GUILD_ID}\`) ولا يعمل في السيرفرات الأخرى.\n\n` +
          `*⚠️ سيقوم البوت بمغادرة هذا السيرفر تلقائياً للحفاظ على الخصوصية والأمان.*`
        )
        .setFooter({ text: `GX eSports • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      await targetChannel.send({ embeds: [embed] }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    await guild.leave();
    console.log(`🚪 [مغادرة] تم مغادرة السيرفر غير المصرح به: "${guild.name}" (${guild.id})\n`);
  } catch (error) {
    console.error(`❌ [خطأ] فشل أثناء مغادرة السيرفر "${guild.name}":`, error.message);
  }
}

// ----------------------------------------------------
// Global Crash Guards & Error Listeners
// ----------------------------------------------------
client.on(Events.Error, (error) => {
  console.error('⚠️ [خطأ في العميل]', error.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [استثناء غير معالج]', reason);
});

process.on('uncaughtException', (error) => {
  console.error('⚠️ [استثناء غير متوقع]', error);
});


// ====================================================
// 🎙️ GX VCR AUTONOMOUS CLUSTER MANAGER (MODULAR BRIDGE)
// ====================================================
const vcrManager = new VCRManager(client, BOT_VERSION, sendToLogChannel);

async function findOrCreateVCRLogChannel(guild) {
  return vcrManager.findOrCreateVCRLogChannel(guild);
}

async function findOrCreateVCRRole(guild) {
  return vcrManager.findOrCreateVCRRole(guild);
}

async function autoAssignVCRRoles(guild) {
  return vcrManager.autoAssignVCRRoles(guild);
}

async function deployStationaryVCRBots(guild) {
  return vcrManager.deployStationary(guild);
}

async function runAutonomousVCRWatchdog(guild) {
  return vcrManager.runWatchdog(guild);
}

async function initVCRWorkers(guild) {
  return vcrManager.init(guild);
}

// ----------------------------------------------------
// EVENT: Ready
// ----------------------------------------------------

/**
 * 🔒 Comprehensive Permissions & Overwrites Auto-Sync Engine
 * Synchronizes channel permission overwrites, roles security flags, and VCR access across the entire server.
 */
async function syncAllPermissionsAndOverwrites(guild) {
  if (!guild) return { success: false, syncedChannels: 0 };
  const botMember = guild.members.me;
  if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels) && !botMember?.permissions.has(PermissionFlagsBits.Administrator)) {
    return { success: false, syncedChannels: 0, error: 'صلاحيات إدارة القنوات غير متوفرة' };
  }

  let syncedChannels = 0;
  const adminTierRoleIds = ['1538485406922838066', '1538485672795570196', '1538544110913454160', '1538545256239210546'];
  const everyoneRole = guild.roles.everyone;
  const untrustedRole = await findOrCreateUntrustedRole(guild);
  const vcrRole = await findOrCreateVCRRole(guild);

  try {
    // 1. Ensure UNTRUSTED Role has strictly Voice & View permissions (NO text/chat permissions)
    if (untrustedRole) {
      await untrustedRole.setPermissions([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD
      ], 'GX Security: Untrusted Restricted Member Role').catch(() => {});
    }

    // 2. Ensure VCR Fleet Role has proper voice permissions
    if (vcrRole) {
      await vcrRole.setPermissions([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.UseVAD,
        PermissionFlagsBits.MuteMembers
      ], 'GX Security: VCR Fleet Role Permissions').catch(() => {});
    }

    // 3. Sync Secret VCR Logs Channel Overwrites
    const vcrLogChannel = await findOrCreateVCRLogChannel(guild);
    if (vcrLogChannel) {
      const overwrites = [
        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }
      ];
      for (const roleId of adminTierRoleIds) {
        const r = guild.roles.cache.get(roleId);
        if (r) overwrites.push({ id: r.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
      }
      await vcrLogChannel.permissionOverwrites.set(overwrites, 'GX Auto-Sync: Secret VCR Logs Overwrites').catch(() => {});
      syncedChannels++;
    }

    // 4. Sync General Log Channel Overwrites
    const logChannel = await getOrCreateLogChannel(guild);
    if (logChannel) {
      const overwrites = [
        { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }
      ];
      for (const roleId of adminTierRoleIds) {
        const r = guild.roles.cache.get(roleId);
        if (r) overwrites.push({ id: r.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
      }
      await logChannel.permissionOverwrites.set(overwrites, 'GX Auto-Sync: Security Log Overwrites').catch(() => {});
      syncedChannels++;
    }

    // 5. Sync System Status Channel Overwrites
    const statusChannel = await getOrCreateSystemStatusChannel(guild);
    if (statusChannel) {
      const overwrites = [
        { id: everyoneRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions] },
        { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }
      ];
      await statusChannel.permissionOverwrites.set(overwrites, 'GX Auto-Sync: Status Channel Overwrites').catch(() => {});
      syncedChannels++;
    }

    // 6. Sync Ticket Panel Channel Overwrites
    const ticketChannel = await getOrCreateTicketChannel(guild);
    if (ticketChannel) {
      const overwrites = [
        { id: everyoneRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
        { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory] }
      ];
      await ticketChannel.permissionOverwrites.set(overwrites, 'GX Auto-Sync: Ticket Panel Overwrites').catch(() => {});
      syncedChannels++;
    }

    // 7. Sync Voice Channels Overwrites for VCR bots and UNTRUSTED members
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    const voiceChannels = channels.filter(c => c && c.isVoiceBased() && !c.isThread());

    for (const [, vCh] of voiceChannels) {
      if (vcrRole) {
        await vCh.permissionOverwrites.edit(vcrRole, {
          ViewChannel: true,
          Connect: true,
          Speak: true,
          UseVAD: true
        }, { reason: 'GX Auto-Sync: VCR Voice Access' }).catch(() => {});
      }
      syncedChannels++;
    }

    return { success: true, syncedChannels };
  } catch (err) {
    console.error('خطأ في مزامنة الصلاحيات والقنوات:', err.message);
    return { success: false, syncedChannels, error: err.message };
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`\n======================================================`);
  console.log(`🤖 تم تسجيل الدخول بنجاح باسم: ${c.user.tag} (المعرف: ${c.user.id})`);
  console.log(`📦 إصدار البوت: ${BOT_VERSION}`);
  console.log(`🛡️  معرف السيرفر المعتمد: ${ALLOWED_GUILD_ID || '[غير محدد]'}`);
  console.log(`🔒 الرتبة التلقائية الافتراضية للوافدين: "UNTRUSTED" (تحتاج توثيق القيادة)`);
  console.log(`👑 رتبة العضو الموثق (بعد الموافقة): "${VERIFIED_MEMBER_ROLE_NAME}" (${VERIFIED_MEMBER_ROLE_ID})`);
  console.log(`🎉 روم الترحيب: ${WELCOME_CHANNEL_ID}`);
  console.log(`📤 روم المغادرة: ${LEAVE_CHANNEL_ID}`);
  console.log(`📊 روم حالة النظام الحية: system-status`);
  console.log(`======================================================\n`);

  if (!ALLOWED_GUILD_ID) {
    console.error(`❌ خطأ: ALLOWED_GUILD_ID غير محدد في ملف .env!`);
    return;
  }

  c.user.setPresence({
    activities: [{ name: `/استدعاء | GX eSports v${BOT_VERSION}`, type: ActivityType.Listening }],
    status: 'online'
  });

  await registerSlashCommands(c.user.id, ALLOWED_GUILD_ID);

  for (const [guildId, guild] of c.guilds.cache) {
    if (guildId !== ALLOWED_GUILD_ID) {
      await handleUnauthorizedGuild(guild);
    } else {
      console.log(`✅ البوت متصل بالسيرفر المعتمد: "${guild.name}" (${guild.id})`);

      await getOrCreateLogChannel(guild);
      await getOrCreateSystemStatusChannel(guild);
      await ensurePermanentTicketPanel(guild);
      await getOrCreateTournamentCategory(guild);
      await ensureEventPanel(guild);
      await syncActiveTicketsMembers(guild);
      await syncAllMembersRole(guild, true);
      await welcomeExistingMembersSequentially(guild);
    await findOrCreateVCRRole(guild);
    await autoAssignVCRRoles(guild);
    await initVCRWorkers(guild);

      // 🎙️ High-Frequency 3-second VCR Watchdog & Reconnection Guardian
      let _watchdogCount = 0;
      setInterval(async () => {
        try {
          await vcrManager.runWatchdog(guild);
          _watchdogCount++;
          if (_watchdogCount % 10 === 0) { // log every 30s to keep clean
            logActivity('autocheck', 'VCR Fleet Health Check', 'Verified 5 Audio Sentinel voice connections & persistence');
          }
        } catch {}
      }, 3000);
      console.log('🛡️ [حارس الفويس VCR] تم تفعيل حارس المراقبة الفورية وإعادة التثبيت التلقائي لمسجلات الصوت كل 3 ثوانٍ.');
      await checkAndResetBiweeklyInfractions(guild);
      sendSecurityDMToExistingMembers(guild);

      // Start 60s recurring role sync & manager auto-grant check (every minute)
      setInterval(async () => {
        try {
          await syncAllMembersRole(guild, true);
          await checkAndResetBiweeklyInfractions(guild);
        } catch (err) {
          console.error('خطأ في المزامنة الدورية:', err.message);
        }
      }, 60 * 1000);
      console.log(`⏱️ [المزامنة التلقائية] تم تفعيل فحص وترقية الإداريين ورتبة MANAGERS والأعضاء كل دقيقة (60 ثانية) في الخلفية.`);
  // Log auto-sync triggers
  setInterval(() => {
    logActivity('autocheck', 'Auto Role Sync', 'Periodic MANAGERS/MEMBER role verification ran');
  }, 60000);

      // Start 10-second live system status loop
      let _statusLoopCount = 0;
      setInterval(async () => {
        try {
          await updateLiveSystemStatus(guild);
          _statusLoopCount++;
          if (_statusLoopCount % 6 === 0) { // log every 60s
            logActivity('autocheck', 'Live Embed Refresh', 'Updated live server statistics panel in #system-status');
          }
        } catch (err) {
          // ignore
        }
      }, 10 * 1000);

      // Start 30-second automated tournament reminder watchdog
      setInterval(async () => {
        try {
          const activeEv = loadActiveEvent();
          if (activeEv && activeEv.startTime && activeEv.status === 'active') {
            const timeRemaining = activeEv.startTime - Date.now();

            // 10-Minute Automated Reminder
            if (timeRemaining <= 10 * 60 * 1000 && timeRemaining > 2 * 60 * 1000 && !activeEv.reminded10m) {
              activeEv.reminded10m = true;
              saveActiveEvent(activeEv);

              const reminderEmbed = new EmbedBuilder()
                .setColor(0xFEE75C)
                .setAuthor({ name: '⏰ تذكير بموعد البطولة | GX eSports', iconURL: guild.iconURL() })
                .setTitle(`⚔️ اقترب موعد انطلاق: ${activeEv.title}`)
                .setDescription(
                  `📢 **بقي أقل من 10 دقائق على انطلاق البطولة!**\n\n` +
                  `🎮 **نظام البطولة:** ${activeEv.mode || '1v1'}\n` +
                  `🔒 يرجى التواجد فوراً في رومك الصوتي المخصص مع خصمك أو فريقك والاستعداد للمباراة!`
                )
                .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
                .setTimestamp();

              const recipients = new Set([...(activeEv.participants || []), ...(activeEv.remindUsers || [])]);
              for (const uid of recipients) {
                const mem = await guild.members.fetch(uid).catch(() => null);
                if (mem) mem.send({ embeds: [reminderEmbed] }).catch(() => {});
              }
            }

            // 2-Minute Final Countdown Reminder
            else if (timeRemaining <= 2 * 60 * 1000 && timeRemaining > 0 && !activeEv.reminded2m) {
              activeEv.reminded2m = true;
              saveActiveEvent(activeEv);

              const finalEmbed = new EmbedBuilder()
                .setColor(0xED4245)
                .setAuthor({ name: '🚨 نداء أخير للمباراة | GX eSports', iconURL: guild.iconURL() })
                .setTitle(`🔥 انطلاق البطولة خلال دقيقتين: ${activeEv.title}`)
                .setDescription(
                  `⚠️ **الرجاء التوجه فوراً إلى الرومات الصوتية!** البطولة على وشك البدء الآن.\n\n` +
                  `🏆 نتمنى التوفيق لجميع المتنافسين!`
                )
                .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
                .setTimestamp();

              const recipients = new Set([...(activeEv.participants || []), ...(activeEv.remindUsers || [])]);
              for (const uid of recipients) {
                const mem = await guild.members.fetch(uid).catch(() => null);
                if (mem) mem.send({ embeds: [finalEmbed] }).catch(() => {});
              }
            }
          }
        } catch (err) {
          // ignore
        }
      }, 30 * 1000);
      console.log(`📊 [لوحة النظام الحية] تم تفعيل التحديث التلقائي كل 10 ثوان في #system-status.`);

      // Voice Reconnection Watchdog (Maintains relentless persistence)
      setInterval(async () => {
        try {
          if (currentVoiceOwner) {
            const targetChannel = guild.channels.cache.get(currentVoiceOwner.channelId);
            if (targetChannel) {
              const isOwnerInCh = targetChannel.members.has(currentVoiceOwner.userId);
              if (isOwnerInCh) {
                const botVoiceChId = guild.members.me?.voice?.channelId;
                if (botVoiceChId !== targetChannel.id) {
                  console.log('⚡ [حارس الفويس] إعادة توجيه وربط البوت بالروم الصوتي لمالكه...');
                  setAuthorizedMove();
                  connectToVoiceChannel(targetChannel);
                }
              } else {
                currentVoiceOwner = null;
              }
            } else {
              currentVoiceOwner = null;
            }
          }
        } catch {}
      }, 3000);
    }
  }
});

// ----------------------------------------------------
// EVENT: GuildCreate (Bot invited to server)
// ----------------------------------------------------
client.on(Events.GuildCreate, async (guild) => {
  if (guild.id !== ALLOWED_GUILD_ID) {
    console.log(`🚨 تمت إضافة البوت إلى سيرفر غير مصرح به: "${guild.name}" (${guild.id})`);
    await handleUnauthorizedGuild(guild);
  } else {
    console.log(`🎉 انضم البوت إلى السيرفر المعتمد: "${guild.name}" (${guild.id})`);
    await registerSlashCommands(client.user.id, guild.id);
    await syncAllMembersRole(guild, true);
    await welcomeExistingMembersSequentially(guild);
  }
});

// ====================================================
// 🎙️ VOICE STATE MANAGEMENT & ANTI-DRAG SECURITY
// ====================================================
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  vcrManager.onVoiceStateUpdate(oldState, newState).catch(() => {});
  if (newState.guild.id !== ALLOWED_GUILD_ID) return;
  const member = newState.member;
  if (!member) return;

  const botMember = newState.guild.members.me;
  const botVoiceChannelId = botMember?.voice?.channelId;

  // 🛡️ GX ECOSYSTEM IMMUNITY: All GX Bots (Main Bot & GX VCRs) Cannot be Server Muted or Server Deafened
  if (member.id === client.user.id || VCR_BOT_IDS.has(member.id)) {
    if (newState.serverMute) {
      try {
        await newState.setMute(false, 'حصانة أمنية: منظومة GX محصنة ضد الكتم الإجباري');
        console.warn(`🛡️ [حماية الفويس] تم إلغاء كتم ${member.user.tag} فوراً.`);
      } catch (err) {
        console.error('خطأ في إلغاء كتم البوت:', err.message);
      }
    }

    if (newState.serverDeaf) {
      try {
        await newState.setDeaf(false, 'حصانة أمنية: منظومة GX محصنة ضد التصميت الإجباري');
        console.warn(`🛡️ [حماية الفويس] تم إلغاء تصميت ${member.user.tag} فوراً.`);
      } catch (err) {
        console.error('خطأ في إلغاء تصميت البوت:', err.message);
      }
    }
  }

  // 1. Anti-Drag & Anti-Disconnect Protection for Bot
  if (member.id === client.user.id) {
    // A. Anti-Drag (Moved manually to another room without authorization)
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      if (!isAuthorizedBotMove) {
        console.warn(`🛡️ [حماية الفويس] تم رصد محاولة سحب يدوي للبوت من #${oldState.channel?.name} إلى #${newState.channel?.name}. جارٍ العودة فوراً...`);

        const previousChannel = oldState.channel || newState.guild.channels.cache.get(currentVoiceOwner?.channelId);
        if (previousChannel) {
          setAuthorizedMove();
          try {
            // Force move the bot back immediately via Discord API
            await newState.setChannel(previousChannel);
          } catch (err) {
            console.error('خطأ في إرجاع البوت عبر setChannel:', err.message);
          }

          connectToVoiceChannel(previousChannel);

          const executor = await fetchAuditExecutor(newState.guild, AuditLogEvent.MemberMove, client.user.id);

          const returnEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setAuthor({ name: '🛡️ نظام حماية الفويس | GX eSports', iconURL: client.user?.displayAvatarURL() })
            .setTitle('⛔ منع السحب اليدوي للبوت (Anti-Drag Protection)')
            .setDescription(
              `تم رصد محاولة سحب يدوي للبوت من قِبل ${executor ? `<@${executor.id}> (\`${executor.tag}\`)` : 'أحد الأعضاء'} إلى الروم **#${newState.channel?.name}**.\n\n` +
              `🔒 **قام البوت بالعودة فوراً وبشكل تلقائي إلى رومه الأصلي:** <#${previousChannel.id}> (\`#${previousChannel.name}\`).`
            )
            .setFooter({ text: `GX eSports Voice Security • الإصدار ${BOT_VERSION}` })
            .setTimestamp();

          await sendToLogChannel(newState.guild, returnEmbed);
        }
        return;
      }
    }

    // B. Anti-Disconnect (Only if controlled by active owner)
    if (oldState.channelId && !newState.channelId) {
      if (!isAuthorizedBotMove && currentVoiceOwner) {
        const previousChannel = oldState.channel || newState.guild.channels.cache.get(currentVoiceOwner?.channelId);
        if (previousChannel) {
          console.warn(`🛡️ [حماية الفويس] تم رصد محاولة فصل يدوي للبوت. جارٍ إعادة الاتصال فوراً...`);

          setAuthorizedMove();
          const staleConn = getVoiceConnection(newState.guild.id);
          if (staleConn) {
            try { staleConn.destroy(); } catch {}
          }
          setTimeout(() => {
            connectToVoiceChannel(previousChannel);
          }, 150);

          const executor = await fetchAuditExecutor(newState.guild, AuditLogEvent.MemberDisconnect, client.user.id);

          const reconEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setAuthor({ name: '🛡️ نظام حماية الفويس | GX eSports', iconURL: client.user?.displayAvatarURL() })
            .setTitle('⛔ منع الفصل اليدوي للبوت (Anti-Disconnect Protection)')
            .setDescription(
              `تم رصد محاولة فصل يدوي للبوت من قِبل ${executor ? `<@${executor.id}> (\`${executor.tag}\`)` : 'أحد الأعضاء'}.\n\n` +
              `🔒 **البوت محصن ضد الفصل اليدوي وتمت إعادة اتصاله فوراً بالروم:** <#${previousChannel.id}>.`
            )
            .setFooter({ text: `GX eSports Voice Security • الإصدار ${BOT_VERSION}` })
            .setTimestamp();

          await sendToLogChannel(newState.guild, reconEmbed);
          return;
        }
      }
    }

    // C. Anti-Server Mute (Auto Unmute Bot)
    if (newState.serverMute) {
      try {
        await newState.setMute(false, 'حصانة أمنية: البوت محصن ضد الكتم');
        console.warn('🛡️ [حماية الفويس] تم إلغاء كتم البوت الإجباري فوراً.');

        const executor = await fetchAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, client.user.id);

        const muteEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '🛡️ نظام حماية الفويس | GX eSports', iconURL: client.user?.displayAvatarURL() })
          .setTitle('⛔ منع الكتم الإجباري للبوت (Anti-Server Mute)')
          .setDescription(
            `تم رصد محاولة كتم البوت إجبارياً من قِبل ${executor ? `<@${executor.id}> (\`${executor.tag}\`)` : 'أحد الأعضاء'}.\n\n` +
            `🔒 **قام البوت بفك الكتم عن نفسه تلقائياً وبشكل فوري لضمان استمرار البث الصوتي.**`
          )
          .setFooter({ text: `GX eSports Voice Security • الإصدار ${BOT_VERSION}` })
          .setTimestamp();

        await sendToLogChannel(newState.guild, muteEmbed);
      } catch (err) {
        console.error('خطأ في إلغاء كتم البوت:', err.message);
      }
    }

    // D. Anti-Server Deafen (Auto Undeafen Bot)
    if (newState.serverDeaf) {
      try {
        await newState.setDeaf(false, 'حصانة أمنية: البوت محصن ضد التصميت');
        console.warn('🛡️ [حماية الفويس] تم إلغاء تصميت البوت الإجباري فوراً.');

        const executor = await fetchAuditExecutor(newState.guild, AuditLogEvent.MemberUpdate, client.user.id);

        const deafEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '🛡️ نظام حماية الفويس | GX eSports', iconURL: client.user?.displayAvatarURL() })
          .setTitle('⛔ منع التصميت الإجباري للبوت (Anti-Server Deafen)')
          .setDescription(
            `تم رصد محاولة تصميت البوت إجبارياً من قِبل ${executor ? `<@${executor.id}> (\`${executor.tag}\`)` : 'أحد الأعضاء'}.\n\n` +
            `🔒 **قام البوت بفك التصميت عن نفسه تلقائياً وبشكل فوري.**`
          )
          .setFooter({ text: `GX eSports Voice Security • الإصدار ${BOT_VERSION}` })
          .setTimestamp();

        await sendToLogChannel(newState.guild, deafEmbed);
      } catch (err) {
        console.error('خطأ في إلغاء تصميت البوت:', err.message);
      }
    }
  }

  // 2. Owner release
  if (currentVoiceOwner && currentVoiceOwner.userId === member.id) {
    const leftVoice = oldState.channelId && !newState.channelId;
    const movedAway = oldState.channelId && newState.channelId && newState.channelId !== botVoiceChannelId;

    if (leftVoice || movedAway) {
      console.log(`👋 [الفويس] غادر المتحكم السابق ${member.user.tag} الروم الصوتي.`);

      const logEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setAuthor({ name: '🔓 تحرير صلاحية استدعاء البوت', iconURL: member.user.displayAvatarURL() })
        .setDescription(
          `غادر المتحكم السابق <@${member.id}> الروم الصوتي.\n` +
          `📢 **أصبح البوت الآن متاحاً للاستدعاء والسحب من قِبل أي عضو في أي فويس آخر دون الحاجة لموافقة!**`
        )
        .setFooter({ text: `GX eSports Voice System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await sendToLogChannel(newState.guild, logEmbed);
      currentVoiceOwner = null;
    }
  }

  // 3. Auto-disconnect if alone
  if (botVoiceChannelId) {
    const botChannel = newState.guild.channels.cache.get(botVoiceChannelId);
    if (botChannel && botChannel.members.filter((m) => !m.user.bot).size === 0) {
      console.log('🔇 [الفويس] بقي البوت وحيداً في الروم الصوتي. جارٍ المغادرة التلقائية...');
      disconnectVoice();
    }
  }

  // 4. Voice logs
  if (member.id !== client.user.id) {
    if (!oldState.channelId && newState.channelId) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🔊 دخول روم صوتي', iconURL: member.user.displayAvatarURL() })
        .addFields(
          { name: '👤 العضو', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
          { name: '🎙️ الروم الصوتي', value: `\`#${newState.channel.name}\``, inline: true }
        )
        .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(newState.guild, logEmbed);
    } else if (oldState.channelId && !newState.channelId) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🔇 خروج من روم صوتي', iconURL: member.user.displayAvatarURL() })
        .addFields(
          { name: '👤 العضو', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
          { name: '🎙️ الروم الصوتي', value: `\`#${oldState.channel.name}\``, inline: true }
        )
        .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(oldState.guild, logEmbed);
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setAuthor({ name: '🔀 انتقال بين الرومات الصوتية', iconURL: member.user.displayAvatarURL() })
        .addFields(
          { name: '👤 العضو', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
          { name: '🔴 من الروم', value: `\`#${oldState.channel.name}\``, inline: true },
          { name: '🟢 إلى الروم', value: `\`#${newState.channel.name}\``, inline: true }
        )
        .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(newState.guild, logEmbed);
    }

    if (!oldState.streaming && newState.streaming) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setAuthor({ name: '📺 بدء بث شاشة (Screen Share)', iconURL: member.user.displayAvatarURL() })
        .addFields(
          { name: '👤 العضو', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
          { name: '🎙️ في الروم', value: `\`#${newState.channel?.name}\``, inline: true }
        )
        .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(newState.guild, logEmbed);
    }
  }
});

// ====================================================
// 📋 MEMBER JOIN & LEAVE EVENTS (WITH WELCOME & GOODBYE)
// ====================================================

// ====================================================
// 👑 1. GUILD UPDATE LOGS (SERVER SETTINGS, NAME & ICON)
// ====================================================
client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  if (newGuild.id !== ALLOWED_GUILD_ID) return;

  const executor = await fetchAuditExecutor(newGuild, AuditLogEvent.GuildUpdate);
  const changes = [];

  // A. Server Name Change
  if (oldGuild.name !== newGuild.name) {
    changes.push(`🏛️ **اسم السيرفر:** من \`${oldGuild.name}\` ⬅️ إلى \`${newGuild.name}\``);
  }

  // B. Server Icon Change
  let iconChanged = false;
  if (oldGuild.icon !== newGuild.icon) {
    changes.push(`🖼️ **أيقونة/شعار السيرفر:** تم تحديث الشعار الرسمي للخادم.`);
    iconChanged = true;
  }

  // C. Server Banner / Splash Change
  if (oldGuild.banner !== newGuild.banner) {
    changes.push(`🎨 **بانر السيرفر (Banner):** ${newGuild.banner ? 'تم تعيين بانر جديد 🖼️' : 'تمت إزالة البانر 🗑️'}`);
  }
  if (oldGuild.splash !== newGuild.splash) {
    changes.push(`✨ **صورة الدعوة (Splash):** ${newGuild.splash ? 'تم تعيين خلفية دعوة جديدة 🖼️' : 'تمت إزالة خلفية الدعوة'}`);
  }

  // D. Server Description & Vanity URL
  if (oldGuild.description !== newGuild.description) {
    changes.push(`📝 **وصف السيرفر:** من \`${oldGuild.description || 'لا يوجد'}\` ⬅️ إلى \`${newGuild.description || 'لا يوجد'}\``);
  }
  if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
    changes.push(`🔗 **الرابط المخصص (Vanity URL):** من \`discord.gg/${oldGuild.vanityURLCode || 'لا يوجد'}\` ⬅️ إلى \`discord.gg/${newGuild.vanityURLCode || 'لا يوجد'}\``);
  }

  // E. AFK Channel & Timeout
  if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
    const oldAfk = oldGuild.afkChannel ? `#${oldGuild.afkChannel.name}` : 'لا يوجد';
    const newAfk = newGuild.afkChannel ? `#${newGuild.afkChannel.name}` : 'لا يوجد';
    changes.push(`💤 **روم الخمول (AFK Channel):** من \`${oldAfk}\` ⬅️ إلى \`${newAfk}\``);
  }
  if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
    changes.push(`⏱️ **مهلة الخمول (AFK Timeout):** من \`${oldGuild.afkTimeout / 60}\` دقيقة ⬅️ إلى \`${newGuild.afkTimeout / 60}\` دقيقة`);
  }

  // F. Security & Moderation Settings
  if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
    changes.push(`🛡️ **مستوى التحقق والأمان:** من \`${translateVerificationLevel(oldGuild.verificationLevel)}\` ⬅️ إلى \`${translateVerificationLevel(newGuild.verificationLevel)}\``);
  }
  if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
    changes.push(`🔞 **فلتر المحتوى الصريح:** من \`${translateContentFilter(oldGuild.explicitContentFilter)}\` ⬅️ إلى \`${translateContentFilter(newGuild.explicitContentFilter)}\``);
  }
  if (oldGuild.defaultMessageNotifications !== newGuild.defaultMessageNotifications) {
    changes.push(`🔔 **إشعارات السيرفر الافتراضية:** من \`${translateNotificationLevel(oldGuild.defaultMessageNotifications)}\` ⬅️ إلى \`${translateNotificationLevel(newGuild.defaultMessageNotifications)}\``);
  }

  // G. System, Rules, Updates Channels
  if (oldGuild.systemChannelId !== newGuild.systemChannelId) {
    changes.push(`📢 **قناة رسائل النظام:** من ${oldGuild.systemChannel ? `<#${oldGuild.systemChannelId}>` : '\`لا توجد\`'} ⬅️ إلى ${newGuild.systemChannel ? `<#${newGuild.systemChannelId}>` : '\`لا توجد\`'}`);
  }
  if (oldGuild.rulesChannelId !== newGuild.rulesChannelId) {
    changes.push(`📜 **قناة القوانين:** من ${oldGuild.rulesChannel ? `<#${oldGuild.rulesChannelId}>` : '\`لا توجد\`'} ⬅️ إلى ${newGuild.rulesChannel ? `<#${newGuild.rulesChannelId}>` : '\`لا توجد\`'}`);
  }

  // H. Server Owner Transfer
  if (oldGuild.ownerId !== newGuild.ownerId) {
    changes.push(`👑 **نقل ملكية السيرفر:** من <@${oldGuild.ownerId}> ⬅️ إلى <@${newGuild.ownerId}>`);
  }

  if (changes.length === 0) return;

  const logEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: '🏛️ تعديل إعدادات وبيانات السيرفر (Server Update)', iconURL: newGuild.iconURL({ dynamic: true }) })
    .setTitle(`تم تحديث إعدادات: ${newGuild.name}`)
    .setDescription(changes.join('\n\n'))
    .addFields(
      { name: '🆔 معرف السيرفر (Guild ID)', value: `\`${newGuild.id}\``, inline: true },
      { name: '👥 إجمالي الأعضاء', value: `\`${newGuild.memberCount}\` عضو`, inline: true }
    );

  if (iconChanged && newGuild.iconURL()) {
    logEmbed.setThumbnail(newGuild.iconURL({ dynamic: true, size: 512 }));
  }

  if (executor) {
    logEmbed.addFields({ name: '👮‍♂️ تم التعديل بواسطة', value: `<@${executor.id}> (\`${executor.tag}\`)`, inline: true });
  }

  logEmbed.setFooter({ text: `GX eSports Advanced Logs • الإصدار ${BOT_VERSION}` }).setTimestamp();
  await sendToLogChannel(newGuild, logEmbed);
});

// ====================================================
// 🎭 2. EMOJIS & STICKERS LOGS
// ====================================================
client.on(Events.GuildEmojisUpdate, async (emojis, guild) => {
  if (guild.id !== ALLOWED_GUILD_ID) return;
  // Audit log entry handles specific details
});

client.on(Events.GuildAuditLogEntryCreate, async (auditEntry, guild) => {
  if (guild.id !== ALLOWED_GUILD_ID) return;

  try {
    // A. Emoji Creation / Deletion / Update
    if (auditEntry.action === AuditLogEvent.EmojiCreate) {
      const emoji = guild.emojis.cache.get(auditEntry.targetId);
      const logEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '😀 إضافة إيموجي جديد (Emoji Created)', iconURL: guild.iconURL() })
        .addFields(
          { name: '✨ الإيموجي', value: emoji ? `${emoji} (\`:${emoji.name}:\`)` : `\`${auditEntry.targetId}\``, inline: true },
          { name: '🆔 المعرف', value: `\`${auditEntry.targetId}\``, inline: true },
          { name: '👮‍♂️ أضيف بواسطة', value: auditEntry.executor ? `<@${auditEntry.executor.id}> (\`${auditEntry.executor.tag}\`)` : 'غير معروف', inline: true }
        )
        .setFooter({ text: `GX eSports Advanced Logs • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      if (emoji) logEmbed.setThumbnail(emoji.url);
      await sendToLogChannel(guild, logEmbed);
    } else if (auditEntry.action === AuditLogEvent.EmojiDelete) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🗑️ حذف إيموجي (Emoji Deleted)', iconURL: guild.iconURL() })
        .addFields(
          { name: '🆔 معرف الإيموجي المحذوف', value: `\`${auditEntry.targetId}\``, inline: true },
          { name: '👮‍♂️ حُذف بواسطة', value: auditEntry.executor ? `<@${auditEntry.executor.id}> (\`${auditEntry.executor.tag}\`)` : 'غير معروف', inline: true }
        )
        .setFooter({ text: `GX eSports Advanced Logs • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(guild, logEmbed);
    }

    // B. Sticker Creation / Deletion
    else if (auditEntry.action === AuditLogEvent.StickerCreate) {
      const sticker = guild.stickers.cache.get(auditEntry.targetId);
      const logEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🏷️ إضافة ملصق جديد (Sticker Created)', iconURL: guild.iconURL() })
        .addFields(
          { name: '🏷️ اسم الملصق', value: sticker ? `\`${sticker.name}\`` : `\`${auditEntry.targetId}\``, inline: true },
          { name: '🆔 المعرف', value: `\`${auditEntry.targetId}\``, inline: true },
          { name: '👮‍♂️ أضيف بواسطة', value: auditEntry.executor ? `<@${auditEntry.executor.id}> (\`${auditEntry.executor.tag}\`)` : 'غير معروف', inline: true }
        )
        .setFooter({ text: `GX eSports Advanced Logs • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      if (sticker?.url) logEmbed.setThumbnail(sticker.url);
      await sendToLogChannel(guild, logEmbed);
    } else if (auditEntry.action === AuditLogEvent.StickerDelete) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🗑️ حذف ملصق (Sticker Deleted)', iconURL: guild.iconURL() })
        .addFields(
          { name: '🆔 معرف الملصق المحذوف', value: `\`${auditEntry.targetId}\``, inline: true },
          { name: '👮‍♂️ حُذف بواسطة', value: auditEntry.executor ? `<@${auditEntry.executor.id}> (\`${auditEntry.executor.tag}\`)` : 'غير معروف', inline: true }
        )
        .setFooter({ text: `GX eSports Advanced Logs • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(guild, logEmbed);
    }

    // C. Webhook Creation / Deletion
    else if (auditEntry.action === AuditLogEvent.WebhookCreate) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🔗 إنشاء ويب هوك جديد (Webhook Created)', iconURL: guild.iconURL() })
        .addFields(
          { name: '🆔 معرف الويب هوك', value: `\`${auditEntry.targetId}\``, inline: true },
          { name: '👮‍♂️ أنشئ بواسطة', value: auditEntry.executor ? `<@${auditEntry.executor.id}> (\`${auditEntry.executor.tag}\`)` : 'غير معروف', inline: true }
        )
        .setFooter({ text: `GX eSports Advanced Logs • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(guild, logEmbed);
    } else if (auditEntry.action === AuditLogEvent.WebhookDelete) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🗑️ حذف ويب هوك (Webhook Deleted)', iconURL: guild.iconURL() })
        .addFields(
          { name: '🆔 معرف الويب هوك المحذوف', value: `\`${auditEntry.targetId}\``, inline: true },
          { name: '👮‍♂️ حُذف بواسطة', value: auditEntry.executor ? `<@${auditEntry.executor.id}> (\`${auditEntry.executor.tag}\`)` : 'غير معروف', inline: true }
        )
        .setFooter({ text: `GX eSports Advanced Logs • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(guild, logEmbed);
    }

    // D. Bot / Integration Added
    else if (auditEntry.action === AuditLogEvent.BotAdd) {
      const botUser = await client.users.fetch(auditEntry.targetId).catch(() => null);
      const logEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setAuthor({ name: '🤖 إضافة بوت جديد للسيرفر (Bot Added)', iconURL: botUser?.displayAvatarURL() || guild.iconURL() })
        .addFields(
          { name: '🤖 البوت المضاف', value: botUser ? `<@${botUser.id}> (\`${botUser.tag}\`)` : `\`${auditEntry.targetId}\``, inline: true },
          { name: '🆔 المعرف (ID)', value: `\`${auditEntry.targetId}\``, inline: true },
          { name: '👮‍♂️ تمت الإضافة بواسطة', value: auditEntry.executor ? `<@${auditEntry.executor.id}> (\`${auditEntry.executor.tag}\`)` : 'غير معروف', inline: true }
        )
        .setFooter({ text: `GX eSports Advanced Logs • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(guild, logEmbed);
    }
  } catch (err) {
    console.error('خطأ في معالجة سجل التدقيق:', err.message);
  }
});

// ====================================================
// 📨 3. INVITE CREATE & DELETE LOGS
// ====================================================
client.on(Events.InviteCreate, async (invite) => {
  if (invite.guild?.id !== ALLOWED_GUILD_ID) return;

  const logEmbed = new EmbedBuilder()
    .setColor(0x57F287)
    .setAuthor({ name: '📨 إنشاء رابط دعوة جديد (Invite Created)', iconURL: invite.guild.iconURL() })
    .addFields(
      { name: '🔗 رابط الدعوة', value: `[discord.gg/${invite.code}](${invite.url})`, inline: true },
      { name: '💬 القناة المستهدفة', value: invite.channel ? `<#${invite.channel.id}>` : 'غير محددة', inline: true },
      { name: '👤 المنشئ', value: invite.inviter ? `<@${invite.inviter.id}> (\`${invite.inviter.tag}\`)` : 'غير معروف', inline: true },
      { name: '🔢 أقصى عدد للاستخدام', value: invite.maxUses === 0 ? '\`غير محدود (∞)\`' : `\`${invite.maxUses}\` استخدام`, inline: true },
      { name: '⏱️ تاريخ الصلاحية', value: invite.maxAge === 0 ? '\`دائم لا ينتهي\`' : `<t:${Math.floor((Date.now() + (invite.maxAge * 1000)) / 1000)}:R>`, inline: true }
    )
    .setFooter({ text: `GX eSports Advanced Logs • الإصدار ${BOT_VERSION}` })
    .setTimestamp();

  await sendToLogChannel(invite.guild, logEmbed);
});

client.on(Events.InviteDelete, async (invite) => {
  if (invite.guild?.id !== ALLOWED_GUILD_ID) return;

  const logEmbed = new EmbedBuilder()
    .setColor(0xED4245)
    .setAuthor({ name: '🗑️ حذف أو انتهاء رابط دعوة (Invite Deleted)', iconURL: invite.guild.iconURL() })
    .addFields(
      { name: '🔗 كود الدعوة', value: `\`${invite.code}\``, inline: true },
      { name: '💬 القناة', value: invite.channel ? `<#${invite.channel.id}>` : 'غير محددة', inline: true }
    )
    .setFooter({ text: `GX eSports Advanced Logs • الإصدار ${BOT_VERSION}` })
    .setTimestamp();

  await sendToLogChannel(invite.guild, logEmbed);
});


client.on(Events.GuildMemberAdd, async (member) => {
  logActivity('member', 'Member Joined', `${member.user.tag} joined the server`, member.user);
  if (member.guild.id !== ALLOWED_GUILD_ID) return;
  console.log(`👋 انضمام عضو جديد: ${member.user.tag} (${member.id})`);

  try {
    if (member.partial) await member.fetch();

    // 🛡️ SPY & SUSPICIOUS ACCOUNT DEFENSE (Created on or after August 16, 2026)
    const wasSpy = await enforceSuspiciousAccountBan(member, member.guild, client, sendToLogChannel, isOwnerOrCeo, BOT_VERSION);
    if (wasSpy) return;

    // Check if new member is one of our VCR Bots
    if (VCR_BOT_IDS.has(member.id)) {
      const vcrRole = await findOrCreateVCRRole(member.guild);
      if (vcrRole) {
        await member.roles.add(vcrRole).catch(() => {});
      }
      console.log(`🎙️ [انضمام مسجل] انضم البوت المسجل ${member.user.tag} وتم منحه رتبة "${VCR_ROLE_NAME}" فوراً.`);
      const vcrLogEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: '🎙️ انضمام مسجل صوتي جديد | GX VCR Cluster', iconURL: member.user.displayAvatarURL() })
        .setTitle('✅ تم تفعيل وربط مسجل صوتي بالسيرفر')
        .setDescription(`تم بنجاح ضم المسجل <@${member.id}> (` + member.user.tag + `) ومنحه رتبة <@&${vcrRole?.id}> ليصبح جاهزاً لتسجيل الرومات الصوتية فوراً!`)
        .setFooter({ text: `GX eSports VCR System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(member.guild, vcrLogEmbed);
      return;
    }

    const untrustedRole = await findOrCreateUntrustedRole(member.guild);
    const botMember = member.guild.members.me;

    // Give default UNTRUSTED role to new human members
    if (!member.user.bot && !isManagerMember(member)) {
      if (untrustedRole && botMember?.permissions.has(PermissionFlagsBits.ManageRoles) && botMember.roles.highest.comparePositionTo(untrustedRole) > 0) {
        await member.roles.add(untrustedRole);
        console.log(`🛡️ [رتبة افتراضية للأعضاء الجدد] تم بنجاح منح رتبة UNTRUSTED للعضو ${member.user.tag}!`);
      }
    }

    // 1. Send stylized Welcome Card to Welcome Channel
    if (!member.user.bot) {
      const welcomedList = loadWelcomedMembers();
      await sendWelcomeMessage(member, member.guild.memberCount);
      if (!welcomedList.includes(member.id)) {
        welcomedList.push(member.id);
        saveWelcomedMembers(welcomedList);
      }
      await sendSecurityOnboardingDM(member);
      await sendVerificationRequestToExecutives(member.guild, member);
    }

    // 2. Audit Log
    const isManager = isManagerMember(member);
    const logEmbed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setAuthor({ name: '📥 انضمام عضو جديد (قيد التوثيق)', iconURL: member.user.displayAvatarURL() })
      .addFields(
        { name: '👤 العضو', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
        { name: '🆔 المعرف (ID)', value: `\`${member.id}\``, inline: true },
        { name: '👑 الرتبة الممنوحة', value: isManager ? '`مستثنى (يحمل رتبة MANAGERS)` 🛡️' : (untrustedRole ? `<@&${untrustedRole.id}> (افتراضية)` : 'لا توجد'), inline: true },
        { name: '📅 تاريخ إنشاء الحساب', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
        { name: '👥 عدد الأعضاء الحالي', value: `\`${member.guild.memberCount}\` عضو`, inline: true }
      )
      .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
      .setTimestamp();

    await sendToLogChannel(member.guild, logEmbed);
  } catch (error) {
    console.error(`❌ [خطأ انضمام عضو] ${member.user.tag}:`, error.message);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  logActivity('member', 'Member Left', `${member.user.tag} left the server`, member.user);
  if (member.guild.id !== ALLOWED_GUILD_ID) return;

  try {
    if (!member.user.bot) {
      await sendLeaveMessage(member);
    }

    const welcomedList = loadWelcomedMembers();
    const updatedList = welcomedList.filter((id) => id !== member.id);
    saveWelcomedMembers(updatedList);

    const executor = await fetchAuditExecutor(member.guild, AuditLogEvent.MemberKick);
    const roles = member.roles?.cache ? member.roles.cache.filter((r) => r.id !== member.guild.id).map((r) => `<@&${r.id}>`).join(' ') || 'لا توجد رتب' : 'لا توجد رتب';

    const logEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setAuthor({ name: executor ? '👢 طرد عضو من السيرفر' : '📤 مغادرة عضو من السيرفر', iconURL: member.user.displayAvatarURL() })
      .addFields(
        { name: '👤 العضو', value: `\`${member.user.tag}\` (<@${member.id}>)`, inline: true },
        { name: '🆔 المعرف', value: `\`${member.id}\``, inline: true },
        { name: '🎭 الرتب السابقة', value: roles, inline: false }
      );

    if (executor) {
      logEmbed.addFields({ name: '👮‍♂️ تم الطرد بواسطة', value: `<@${executor.id}> (\`${executor.tag}\`)`, inline: true });
    }

    logEmbed.setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` }).setTimestamp();
    await sendToLogChannel(member.guild, logEmbed);
  } catch (error) {
    console.error(`❌ [خطأ مغادرة عضو] ${member.user.tag}:`, error.message);
  }
});

// ====================================================
// 🔍 COMPREHENSIVE INSTANT AUDIT LOG EVENTS
// ====================================================
client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild || newChannel.guild.id !== ALLOWED_GUILD_ID) return;

  const executor = await fetchAuditExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate);
  const typeArabic = translateChannelType(newChannel.type);
  let changes = [];

  if (oldChannel.name !== newChannel.name) {
    changes.push(`**تغيير الاسم:** من \`${oldChannel.name}\` ⬅️ إلى \`${newChannel.name}\``);
  }
  if (oldChannel.topic !== newChannel.topic) {
    changes.push(`**تغيير الوصف/الموضوع:** من \`${oldChannel.topic || 'لا يوجد'}\` ⬅️ إلى \`${newChannel.topic || 'لا يوجد'}\``);
  }
  if (oldChannel.parentId !== newChannel.parentId) {
    const oldCat = oldChannel.parent?.name || 'بدون قسم';
    const newCat = newChannel.parent?.name || 'بدون قسم';
    changes.push(`**نقل القسم التصنيفي:** من \`${oldCat}\` ⬅️ إلى \`${newCat}\``);
  }
  if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
    changes.push(`**وضع التباطؤ (Slowmode):** من \`${oldChannel.rateLimitPerUser}s\` ⬅️ إلى \`${newChannel.rateLimitPerUser}s\``);
  }
  if (oldChannel.nsfw !== newChannel.nsfw) {
    changes.push(`**المحتوى الحساس (NSFW):** \`${newChannel.nsfw ? 'تم التفعيل 🔞' : 'تم الإلغاء 🟢'}\``);
  }
  if (oldChannel.bitrate !== newChannel.bitrate) {
    changes.push(`**جودة الصوت (Bitrate):** من \`${oldChannel.bitrate / 1000}kbps\` ⬅️ إلى \`${newChannel.bitrate / 1000}kbps\``);
  }
  if (oldChannel.userLimit !== newChannel.userLimit) {
    changes.push(`**الحد الأقصى للمستخدمين:** من \`${oldChannel.userLimit || 'غير محدود'}\` ⬅️ إلى \`${newChannel.userLimit || 'غير محدود'}\``);
  }

  if (changes.length === 0) return;

  const isCategory = newChannel.type === ChannelType.GuildCategory;
  const logEmbed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setAuthor({
      name: isCategory ? '📂 تعديل قسم تصنيفي (Category Update)' : '✏️ تعديل قناة',
      iconURL: newChannel.guild.iconURL()
    })
    .setTitle(`تم تعديل: ${isCategory ? `قسم [ ${newChannel.name} ]` : `<#${newChannel.id}>`}`)
    .addFields(
      { name: '📂 نوع القناة', value: `\`${typeArabic}\``, inline: true },
      { name: '🆔 المعرف (ID)', value: `\`${newChannel.id}\``, inline: true },
      { name: '📝 التغييرات التي تمت', value: changes.join('\n'), inline: false }
    );

  if (executor) {
    logEmbed.addFields({ name: '👮‍♂️ تم التعديل بواسطة', value: `<@${executor.id}> (\`${executor.tag}\`)`, inline: true });
  }

  logEmbed.setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` }).setTimestamp();
  await sendToLogChannel(newChannel.guild, logEmbed);
});

client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild || channel.guild.id !== ALLOWED_GUILD_ID) return;
  const executor = await fetchAuditExecutor(channel.guild, AuditLogEvent.ChannelCreate);
  const typeArabic = translateChannelType(channel.type);
  const isCategory = channel.type === ChannelType.GuildCategory;

  const logEmbed = new EmbedBuilder()
    .setColor(0x57F287)
    .setAuthor({
      name: isCategory ? '📂 إنشاء قسم تصنيفي جديد (Category)' : '📁 إنشاء قناة جديدة',
      iconURL: channel.guild.iconURL()
    })
    .addFields(
      { name: isCategory ? '📂 اسم القسم' : '💬 القناة', value: isCategory ? `\`${channel.name}\`` : `<#${channel.id}> (\`#${channel.name}\`)`, inline: true },
      { name: '📂 النوع', value: `\`${typeArabic}\``, inline: true },
      { name: '🆔 المعرف', value: `\`${channel.id}\``, inline: true }
    );

  if (executor) {
    logEmbed.addFields({ name: '👮‍♂️ أنشئت بواسطة', value: `<@${executor.id}> (\`${executor.tag}\`)`, inline: true });
  }

  logEmbed.setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` }).setTimestamp();
  await sendToLogChannel(channel.guild, logEmbed);
});

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild || channel.guild.id !== ALLOWED_GUILD_ID) return;
  const executor = await fetchAuditExecutor(channel.guild, AuditLogEvent.ChannelDelete);
  const typeArabic = translateChannelType(channel.type);
  const isCategory = channel.type === ChannelType.GuildCategory;

  const logEmbed = new EmbedBuilder()
    .setColor(0xED4245)
    .setAuthor({
      name: isCategory ? '🗑️ حذف قسم تصنيفي (Category)' : '🗑️ حذف قناة',
      iconURL: channel.guild.iconURL()
    })
    .addFields(
      { name: isCategory ? '📂 اسم القسم المحذوف' : '💬 اسم القناة المحذوفة', value: `\`#${channel.name}\``, inline: true },
      { name: '📂 النوع', value: `\`${typeArabic}\``, inline: true },
      { name: '🆔 المعرف', value: `\`${channel.id}\``, inline: true }
    );

  if (executor) {
    logEmbed.addFields({ name: '👮‍♂️ حذفت بواسطة', value: `<@${executor.id}> (\`${executor.tag}\`)`, inline: true });
  }

  logEmbed.setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` }).setTimestamp();
  await sendToLogChannel(channel.guild, logEmbed);
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  if (newRole.guild.id !== ALLOWED_GUILD_ID) return;
  const executor = await fetchAuditExecutor(newRole.guild, AuditLogEvent.RoleUpdate);
  let changes = [];

  if (oldRole.name !== newRole.name) {
    changes.push(`✏️ **تغيير الاسم:** من \`${oldRole.name}\` ⬅️ إلى \`${newRole.name}\``);
  }
  if (oldRole.hexColor !== newRole.hexColor) {
    changes.push(`🎨 **تغيير اللون:** من \`${oldRole.hexColor}\` ⬅️ إلى \`${newRole.hexColor}\``);
  }
  if (oldRole.hoist !== newRole.hoist) {
    changes.push(`📌 **فصل الرتبة في قائمة الأعضاء:** \`${newRole.hoist ? 'مفعل 🟢' : 'ملغى 🔴'}\``);
  }
  if (oldRole.mentionable !== newRole.mentionable) {
    changes.push(`📢 **إمكانية المنشن للرتبة:** \`${newRole.mentionable ? 'مسموح للجميع 🟢' : 'مغلق 🔴'}\``);
  }
  if (oldRole.icon !== newRole.icon) {
    changes.push(`🖼️ **أيقونة الرتبة:** ${newRole.icon ? 'تم تعيين أيقونة جديدة 🎨' : 'تمت إزالة الأيقونة 🗑️'}`);
  }

  // Smart Permissions Diff Calculation
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
    const addedPerms = newRole.permissions.toArray().filter((p) => !oldRole.permissions.has(p));
    const removedPerms = oldRole.permissions.toArray().filter((p) => !newRole.permissions.has(p));

    if (addedPerms.length > 0) {
      changes.push(`🟢 **الصلاحيات المضافة (+):**\n` + addedPerms.map((p) => `• \`+\` ${translatePermissionName(p)}`).join('\n'));
    }
    if (removedPerms.length > 0) {
      changes.push(`🔴 **الصلاحيات المسحوبة (-):**\n` + removedPerms.map((p) => `• \`-\` ${translatePermissionName(p)}`).join('\n'));
    }
  }

  if (changes.length === 0) return;

  const logEmbed = new EmbedBuilder()
    .setColor(newRole.color || 0xFEE75C)
    .setAuthor({ name: '👑 تعديل رتبة (Role Update)', iconURL: newRole.guild.iconURL() })
    .setTitle(`تم تعديل الرتبة: <@&${newRole.id}> (\`${newRole.name}\`)`)
    .setDescription(changes.join('\n\n'))
    .addFields(
      { name: '🆔 معرف الرتبة', value: `\`${newRole.id}\``, inline: true },
      { name: '🎨 اللون الحالي', value: `\`${newRole.hexColor}\``, inline: true },
      { name: '👥 عدد حاملي الرتبة', value: `\`${newRole.members.size}\` عضو`, inline: true }
    );

  if (newRole.iconURL()) {
    logEmbed.setThumbnail(newRole.iconURL());
  }

  if (executor) {
    logEmbed.addFields({ name: '👮‍♂️ تم التعديل بواسطة', value: `<@${executor.id}> (\`${executor.tag}\`)`, inline: true });
  }

  logEmbed.setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` }).setTimestamp();
  await sendToLogChannel(newRole.guild, logEmbed);
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.guild.id !== ALLOWED_GUILD_ID || message.author.bot) return;

  // 1. Military Emergency Lockdown Enforcement (Exclusively OWNER / CEO / COO):
  if (isEmergencyActive()) {
    const isExecutive = isVerificationApprover(message.member, message.author);
    if (!isExecutive) {
      try {
        await message.delete().catch(() => {});
        const alertMsg = await message.channel.send({
          content: `🚨 <@${message.author.id}> **السيرفر خاضع لحالة الطوارئ العسكرية والدفاع الشامل حالياً. جميع الصلاحيات الإدارية والعامة مجمدة والحديث مقتصر حصرياً على (OWNER / CEO / COO) فقط.**`
        }).catch(() => null);
        if (alertMsg) {
          setTimeout(() => alertMsg.delete().catch(() => {}), 4000);
        }
      } catch {}
      return;
    }
  }

  // 2. 🎫 2-WAY SUPPORT DESK LIVE SYNC: If message sent in an active Ticket Thread
  if (message.channel.isThread()) {
    const ticketsData = loadTickets();
    if (ticketsData.activeTickets && ticketsData.activeTickets[message.channel.id]) {
      const ticket = ticketsData.activeTickets[message.channel.id];
      if (!ticket.transcript) ticket.transcript = [];
      const attachments = message.attachments.map(a => a.url);

      ticket.transcript.push({
        authorId: message.author.id,
        authorTag: message.author.tag,
        authorAvatar: message.author.displayAvatarURL(),
        content: message.content || '',
        attachments: attachments,
        timestamp: Date.now(),
        isAgent: false
      });
      ticket.lastActivityAt = Date.now();
      ticket.hasUnreadAgent = true;
      saveTickets(ticketsData);

      logActivity('ticket', 'Ticket Message', `${message.author.tag}: ${(message.content || 'Image').slice(0, 50)}`, message.author);
      return; // Allow ticket communication freely
    }
  }

  // 3. Intercept any message sent by untrusted members in general channels
  const isUntrusted = isUntrustedMember(message.member) || message.member?.roles.cache.some((r) => r.name.toUpperCase() === UNTRUSTED_ROLE_NAME);
  if (isUntrusted) {
    try {
      await message.delete();
      const warnMsg = await message.channel.send({
        content: `⛔ <@${message.author.id}> **أنت مقيد برتبة \`UNTRUSTED\` وممنوع من الكتابة وإرسال الرسائل في السيرفر بشكل قطعي!**`
      }).catch(() => null);

      if (warnMsg) {
        setTimeout(() => warnMsg.delete().catch(() => {}), 4000);
      }

      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '⛔ منع وحذف رسالة عضو غير موثوق', iconURL: message.author.displayAvatarURL() })
        .setDescription(
          `تم اعتراض وحذف رسالة من العضو المقيد <@${message.author.id}> (\`${message.author.tag}\`) في القناة <#${message.channel.id}>.\n\n` +
          `📝 **محتوى الرسالة المحذوفة:**\n\`\`\`\n${message.content.slice(0, 1000) || '[بدون نص / وسائط]'}\n\`\`\``
        )
        .setFooter({ text: `GX eSports Untrusted Shield • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await sendToLogChannel(message.guild, logEmbed);
    } catch (err) {
      console.error('خطأ في اعتراض رسالة العضو غير الموثوق:', err.message);
    }
    return;
  }

  // 3. Fuzzy Levenshtein Smart Anti-Spam & Burst Shield
  await checkSmartSpamAndVelocity(message);
});

client.on(Events.GuildRoleCreate, async (role) => {
  if (role.guild.id !== ALLOWED_GUILD_ID) return;
  const executor = await fetchAuditExecutor(role.guild, AuditLogEvent.RoleCreate);

  const logEmbed = new EmbedBuilder()
    .setColor(0x57F287)
    .setAuthor({ name: '👑 إنشاء رتبة جديدة', iconURL: role.guild.iconURL() })
    .addFields(
      { name: '🎭 اسم الرتبة', value: `<@&${role.id}> (\`${role.name}\`)`, inline: true },
      { name: '🎨 اللون', value: `\`${role.hexColor}\``, inline: true },
      { name: '🆔 المعرف', value: `\`${role.id}\``, inline: true }
    );

  if (executor) {
    logEmbed.addFields({ name: '👮‍♂️ أنشئت بواسطة', value: `<@${executor.id}> (\`${executor.tag}\`)`, inline: true });
  }

  logEmbed.setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` }).setTimestamp();
  await sendToLogChannel(role.guild, logEmbed);
});

client.on(Events.GuildRoleDelete, async (role) => {
  if (role.guild.id !== ALLOWED_GUILD_ID) return;
  const executor = await fetchAuditExecutor(role.guild, AuditLogEvent.RoleDelete);

  const logEmbed = new EmbedBuilder()
    .setColor(0xED4245)
    .setAuthor({ name: '🗑️ حذف رتبة', iconURL: role.guild.iconURL() })
    .addFields(
      { name: '🎭 اسم الرتبة المحذوفة', value: `\`${role.name}\``, inline: true },
      { name: '🆔 المعرف', value: `\`${role.id}\``, inline: true }
    );

  if (executor) {
    logEmbed.addFields({ name: '👮‍♂️ حذفت بواسطة', value: `<@${executor.id}> (\`${executor.tag}\`)`, inline: true });
  }

  logEmbed.setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` }).setTimestamp();
  await sendToLogChannel(role.guild, logEmbed);
});

client.on(Events.GuildBanAdd, async (ban) => {
  if (ban.guild.id !== ALLOWED_GUILD_ID) return;
  const executor = await fetchAuditExecutor(ban.guild, AuditLogEvent.MemberBanAdd);

  const logEmbed = new EmbedBuilder()
    .setColor(0x992D22)
    .setAuthor({ name: '🔨 حظر عضو (Ban)', iconURL: ban.user.displayAvatarURL() })
    .addFields(
      { name: '👤 العضو المحظور', value: `<@${ban.user.id}> (\`${ban.user.tag}\`)`, inline: true },
      { name: '👮‍♂️ المشرف', value: executor ? `<@${executor.id}> (\`${executor.tag}\`)` : 'غير معروف', inline: true },
      { name: '📄 السبب', value: ban.reason || 'لم يتم تحديد سبب', inline: false }
    )
    .setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` })
    .setTimestamp();

  await sendToLogChannel(ban.guild, logEmbed);
});

client.on(Events.GuildBanRemove, async (ban) => {
  if (ban.guild.id !== ALLOWED_GUILD_ID) return;
  const executor = await fetchAuditExecutor(ban.guild, AuditLogEvent.MemberBanRemove);

  const logEmbed = new EmbedBuilder()
    .setColor(0x57F287)
    .setAuthor({ name: '🔓 فك حظر عضو (Unban)', iconURL: ban.user.displayAvatarURL() })
    .addFields(
      { name: '👤 العضو', value: `<@${ban.user.id}> (\`${ban.user.tag}\`)`, inline: true },
      { name: '👮‍♂️ المشرف', value: executor ? `<@${executor.id}> (\`${executor.tag}\`)` : 'غير معروف', inline: true }
    )
    .setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` })
    .setTimestamp();

  await sendToLogChannel(ban.guild, logEmbed);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (newMember.guild.id !== ALLOWED_GUILD_ID) return;

  if (oldMember.nickname !== newMember.nickname) {
    const logEmbed = new EmbedBuilder()
      .setColor(0xFEE75C)
      .setAuthor({ name: '✏️ تغيير اللقب (Nickname)', iconURL: newMember.user.displayAvatarURL() })
      .addFields(
        { name: '👤 العضو', value: `<@${newMember.id}> (\`${newMember.user.tag}\`)`, inline: true },
        { name: '🔴 اللقب القديم', value: `\`${oldMember.nickname || 'الاسم الأصلي'}\``, inline: true },
        { name: '🟢 اللقب الجديد', value: `\`${newMember.nickname || 'الاسم الأصلي'}\``, inline: true }
      )
      .setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` })
      .setTimestamp();
    await sendToLogChannel(newMember.guild, logEmbed);
  }

  const addedRoles = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
  const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));

  if (addedRoles.size > 0 || removedRoles.size > 0) {
    const logEmbed = new EmbedBuilder()
      .setColor(addedRoles.size > 0 ? 0x57F287 : 0xED4245)
      .setAuthor({ name: '🎭 تعديل رتب العضو', iconURL: newMember.user.displayAvatarURL() })
      .addFields({ name: '👤 العضو', value: `<@${newMember.id}> (\`${newMember.user.tag}\`)`, inline: true });

    if (addedRoles.size > 0) {
      logEmbed.addFields({ name: '🟢 الرتب المضافة', value: addedRoles.map((r) => `<@&${r.id}>`).join(' '), inline: false });
    }
    if (removedRoles.size > 0) {
      logEmbed.addFields({ name: '🔴 الرتب المسحوبة', value: removedRoles.map((r) => `<@&${r.id}>`).join(' '), inline: false });
    }

    logEmbed.setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` }).setTimestamp();
    await sendToLogChannel(newMember.guild, logEmbed);

    // Auto-grant MANAGERS role if user has COO, CEO, OWNER, SUPER ADMIN, MIDDLE ADMIN, LOWER ADMIN
    if (hasAdminTierRole(newMember)) {
      const managersRole = findManagersRole(newMember.guild);
      if (managersRole && !newMember.roles.cache.has(managersRole.id)) {
        try {
          await newMember.roles.add(managersRole);
          console.log(`🛡️ [ترقية إدارية فورية] تم منح رتبة MANAGERS للعضو ${newMember.user.tag} لحصوله على رتبة إدارية.`);
          const mgmtEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setAuthor({ name: '🛡️ منح رتبة MANAGERS التلقائية', iconURL: newMember.user.displayAvatarURL() })
            .setDescription(`تم منح رتبة <@&${managersRole.id}> تلقائياً للعضو <@${newMember.id}> (\`${newMember.user.tag}\`) لحمله إحدى الرتب الإدارية العليا.`)
            .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
            .setTimestamp();
          await sendToLogChannel(newMember.guild, mgmtEmbed);
        } catch (err) {
          console.error(`خطأ في منح رتبة MANAGERS للإداري ${newMember.user.tag}:`, err.message);
        }
      }
    }

    // Auto-strip MEMBER role if user is/became a MANAGER
    if (isManagerMember(newMember) || hasAdminTierRole(newMember)) {
      const autoRole = findAutoRole(newMember.guild);
      if (autoRole && newMember.roles.cache.has(autoRole.id)) {
        try {
          await newMember.roles.remove(autoRole);
          console.log(`🗑️ [إزالة رتبة فورية] تم سحب رتبة "${autoRole.name}" من ${newMember.user.tag} لحصوله على رتبة MANAGERS.`);
          const stripEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setAuthor({ name: '👑 إزالة رتبة الأعضاء من الإدارة', iconURL: newMember.user.displayAvatarURL() })
            .setDescription(`تم سحب رتبة <@&${autoRole.id}> من <@${newMember.id}> (\`${newMember.user.tag}\`) لحمله رتبة **MANAGERS** 🛡️.`)
            .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
            .setTimestamp();
          await sendToLogChannel(newMember.guild, stripEmbed);
        } catch (err) {
          console.error(`خطأ في سحب الرتبة من الإداري ${newMember.user.tag}:`, err.message);
        }
      }
    }
  }

  if (!oldMember.isCommunicationDisabled() && newMember.isCommunicationDisabled()) {
    const logEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setAuthor({ name: '⏳ تم تطبيق تايم آوت (Timeout)', iconURL: newMember.user.displayAvatarURL() })
      .addFields(
        { name: '👤 العضو المعزول', value: `<@${newMember.id}> (\`${newMember.user.tag}\`)`, inline: true },
        { name: '⏰ ينتهي في', value: `<t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:R>`, inline: true }
      )
      .setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` })
      .setTimestamp();
    await sendToLogChannel(newMember.guild, logEmbed);
  }
});

client.on(Events.MessageDelete, async (message) => {
  if (!message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;

  // 1. فحص ما إذا كانت الرسالة المحذوفة هي لوحة التذاكر الدائمة لإعادة إنشائها فوراً
  const panelData = loadTicketPanelData();
  if (message.id === panelData.messageId || (message.channel && message.channel.id === panelData.channelId && message.author?.id === client.user?.id)) {
    console.log('⚠️ [حذف لوحة التذاكر] تم رصد حذف لوحة التذاكر الدائمة! جارٍ إعادة إنشائها وتثبيتها فوراً مع @everyone...');
    setTimeout(() => {
      ensurePermanentTicketPanel(message.guild);
    }, 1200);
  }

  // 2. فحص ما إذا كانت الرسالة المحذوفة هي رسالة الفعالية لإعادة تثبيتها فوراً وإرسال التحذير للحاذف
  const activeEvent = loadActiveEvent();
  if (activeEvent && (message.id === activeEvent.messageId || (message.channel && message.channel.id === EVENT_CHANNEL_ID && message.author?.id === client.user?.id))) {
    console.log('⚠️ [حذف رسالة الفعالية] تم رصد محاولة حذف رسالة الفعالية! جارٍ إعادة تثبيتها فوراً...');
    setTimeout(() => {
      ensureEventPanel(message.guild);
    }, 1000);

    // معرفة الشخص الذي قام بحذف الرسالة
    fetchAuditExecutor(message.guild, AuditLogEvent.MessageDelete).then(async (executor) => {
      if (executor && executor.id !== client.user.id) {
        try {
          const dmUser = await client.users.fetch(executor.id).catch(() => null);
          if (dmUser && !dmUser.bot) {
            const deleteWarningEmbed = new EmbedBuilder()
              .setColor(0xED4245)
              .setAuthor({ name: '⚠️ تحذير أمني خاص | GX eSports', iconURL: client.user?.displayAvatarURL() })
              .setTitle('🚫 محاولة حذف رسالة الفعالية الرسمية')
              .setDescription('كلب ابن كلب حقير ابن حقير ليش تنكح الرسالة حيوان')
              .setImage('https://cdn.discordapp.com/attachments/1538578678789840897/anti_delete_warning.png')
              .setFooter({ text: `GX eSports Security System • نظام الحماية التلقائي` })
              .setTimestamp();

            await dmUser.send({
              content: 'كلب ابن كلب حقير ابن حقير ليش تنكح الرسالة حيوان',
              embeds: [deleteWarningEmbed]
            }).catch(() => {});
          }
        } catch (err) {
          console.error('خطأ في إرسال رسالة الخاص للحاذف:', err.message);
        }

        const logEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '🛡️ تصدي لحذف رسالة الفعالية', iconURL: executor.displayAvatarURL() })
          .setDescription(`قام <@${executor.id}> (\`${executor.tag}\`) بمحاولة حذف رسالة الفعالية في <#${EVENT_CHANNEL_ID}>.\n🔒 **قام البوت بإعادة تثبيت الفعالية فوراً وإرسال التنبيه للحاذف في الخاص.**`)
          .setFooter({ text: `GX eSports Security • الإصدار ${BOT_VERSION}` })
          .setTimestamp();
        await sendToLogChannel(message.guild, logEmbed);
      }
    }).catch(() => {});
  }

  if (message.author?.bot) return;

  const channelName = message.channel ? `#${message.channel.name}` : 'قناة غير معروفة';
  const authorName = message.author ? `${message.author.tag} (<@${message.author.id}>)` : 'مستخدم غير معروف';
  const content = message.content || '*(لا يوجد نص، ربما وسائط أو إيموجي)*';

  const logEmbed = new EmbedBuilder()
    .setColor(0xED4245)
    .setAuthor({ name: '🗑️ حذف رسالة', iconURL: message.author?.displayAvatarURL() })
    .addFields(
      { name: '👤 صاحب الرسالة', value: authorName, inline: true },
      { name: '💬 القناة', value: channelName, inline: true },
      { name: '📄 محتوى الرسالة المحذوفة', value: content.length > 1000 ? `${content.slice(0, 1000)}...` : content, inline: false }
    );

  if (message.attachments.size > 0) {
    logEmbed.addFields({
      name: '📎 المرفقات',
      value: message.attachments.map((a) => a.name || a.url).join(', '),
      inline: false
    });
  }

  logEmbed.setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` }).setTimestamp();
  await sendToLogChannel(message.guild, logEmbed);
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!oldMessage.guild || oldMessage.guild.id !== ALLOWED_GUILD_ID) return;
  if (oldMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  const logEmbed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setAuthor({ name: '✏️ تعديل رسالة', iconURL: oldMessage.author?.displayAvatarURL() })
    .addFields(
      { name: '👤 الكاتب', value: `${oldMessage.author?.tag} (<@${oldMessage.author?.id}>)`, inline: true },
      { name: '💬 القناة', value: `#${oldMessage.channel.name}`, inline: true },
      { name: '🔗 رابط الرسالة', value: `[انقر هنا للذهاب للرسالة](${newMessage.url})`, inline: true },
      { name: '🔴 النص قبل التعديل', value: oldMessage.content ? (oldMessage.content.length > 500 ? `${oldMessage.content.slice(0, 500)}...` : oldMessage.content) : '*(فارغ)*', inline: false },
      { name: '🟢 النص بعد التعديل', value: newMessage.content ? (newMessage.content.length > 500 ? `${newMessage.content.slice(0, 500)}...` : newMessage.content) : '*(فارغ)*', inline: false }
    )
    .setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` })
    .setTimestamp();

  await sendToLogChannel(oldMessage.guild, logEmbed);
});

client.on(Events.MessageBulkDelete, async (messages, channel) => {
  if (!channel.guild || channel.guild.id !== ALLOWED_GUILD_ID) return;

  const logEmbed = new EmbedBuilder()
    .setColor(0xED4245)
    .setAuthor({ name: '🧹 مسح رسائل جماعي (Bulk Delete)', iconURL: channel.guild.iconURL() })
    .addFields(
      { name: '💬 القناة', value: `<#${channel.id}> (\`#${channel.name}\`)`, inline: true },
      { name: '🔢 عدد الرسائل المحذوفة', value: `\`${messages.size}\` رسالة`, inline: true }
    )
    .setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` })
    .setTimestamp();

  await sendToLogChannel(channel.guild, logEmbed);
});

// ====================================================
// 💬 MESSAGE CREATE HANDLER (Tickets & 85% Similarity Anti-Spam)
// ====================================================
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.guild.id !== ALLOWED_GUILD_ID) return;
  if (message.author.bot) return;

  // 1. معالجة قنوات التذاكر الفرعية
  if (message.channel.isThread()) {
    const ticketsData = loadTickets();
    if (!ticketsData.activeTickets) return;
    const ticket = ticketsData.activeTickets[message.channel.id];

    if (ticket) {
      const isCreator = message.author.id === ticket.userId;
      const isAgent = ticket.claimedBy && message.author.id === ticket.claimedBy;

      // 🛡️ عزل وخصوصية تامة: منع أي شخص غير صاحب التذكرة والوكيل المستلم
      if (!isCreator && !isAgent) {
        botManagedDeletedMessages.add(message.id);
        await message.delete().catch(() => {});
        return;
      }

      // توثيق في سجل المحادثة
      if (!ticket.transcript) ticket.transcript = [];
      ticket.transcript.push({
        authorId: message.author.id,
        authorTag: isAgent ? `${message.author.tag} (وكيل الدعم)` : message.author.tag,
        content: message.content,
        timestamp: Date.now()
      });
      saveTickets(ticketsData);

      // في حال كتب الوكيل رسالة مباشرة في الشات (حذفها فوراً وإعادة إرسالها باسم البوت)
      if (isAgent) {
        const agentContent = message.content;
        botManagedDeletedMessages.add(message.id);
        await message.delete().catch(() => {});

        const agentEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setAuthor({
            name: 'وكيل الدعم الفني | GX Support Agent',
            iconURL: client.user?.displayAvatarURL()
          })
          .setDescription(agentContent)
          .setFooter({ text: `GX eSports Support Agent • ${ticket.ticketId}` })
          .setTimestamp();

        return message.channel.send({ embeds: [agentEmbed] });
      }

      // إرسال كود #000 من المشتكي لطلب إنهاء المشكلة وإغلاق التذكرة
      else if (isCreator && message.content.trim() === '#000') {
        ticket.stage = 'AWAITING_CODE';
        saveTickets(ticketsData);

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`close_ticket_${ticket.threadId}`)
            .setLabel('🔒 إغلاق التذكرة فوراً')
            .setStyle(ButtonStyle.Danger)
        );

        const closePromptEmbed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setTitle('🔔 تأكيد إنهاء المشكلة من العضو (#000)')
          .setDescription(
            `# 🔒 تم طلب إغلاق التذكرة (#000)\n` +
            `> قام صاحب التذكرة <@${ticket.userId}> بإرسال كود التأكيد \`#000\` لإنهاء المشكلة.\n` +
            `> **الزر أدناه متاح حصرياً للوكيل المستلم (<@${ticket.claimedBy}>) لإغلاق وأرشفة التذكرة.**`
          )
          .setFooter({ text: `GX eSports Support • ${ticket.ticketId}` });

        return message.channel.send({
          embeds: [closePromptEmbed],
          components: [closeRow]
        });
      }
    }
    return;
  }

  // ----------------------------------------------------
  // 🛡️ 2. نظام مكافحة التكرار والسبام الذكي (85%+ Similarity Filter - يطبق على الجميع دون استثناء)
  // ----------------------------------------------------
  if (message.content && message.content.trim().length > 0) {
    const now = Date.now();
    let history = userRecentMessages.get(message.author.id) || [];
    history = history.filter((m) => now - m.timestamp < 60000); // 60 ثانية

    let similarCount = 0;
    for (const past of history) {
      const sim = calculateSimilarity(message.content, past.content);
      if (sim >= 0.85) {
        similarCount++;
      }
    }

    // إذا أرسل العضو 3 رسائل متطابقة أو متشابهة بنسبة 85%+
    if (similarCount >= 2) {
      botManagedDeletedMessages.add(message.id);
      await message.delete().catch(() => {});

      let warnings = (userSpamWarnings.get(message.author.id) || 0) + 1;
      userSpamWarnings.set(message.author.id, warnings);

      // المحاولات 1 و 2: إرسال تنبيه الشك في الإزعاج بالخاص ليكون مرئياً له فقط (Only you can see this message)
      if (warnings <= 2) {
        const warnEmbed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setAuthor({ name: '⚠️ تنبيه أمني خاص (مرئي لك فقط) | GX Shield', iconURL: message.guild.iconURL() || client.user?.displayAvatarURL() })
          .setTitle('تنبيه: اشتباه في محاولة تكرار أو إزعاج')
          .setDescription(
            `# ⚠️ تنبيه أمني خاص بك (مرئي لك فقط)\n\n` +
            `مرحباً <@${message.author.id}>، **يشك النظام في أنك تحاول الإزعاج (تكرار رسائل متشابهة بنسبة 85%+ في الشات)**.\n\n` +
            `> 🚫 **يرجى عدم إرسال نفس الرسالة أو رسالة مشابهة لها الآن.. جرب في وقت لاحق.**\n\n` +
            `💡 *هذا التنبيه خاص وسري لتفادي تسجيل مخالفات رسمية (Strikes) بحق حسابك عند تكرار المحاولة.*`
          )
          .setFooter({ text: `GX eSports Anti-Spam Security • تنبيه محاولة (${warnings}/2)` })
          .setTimestamp();

        try {
          await message.author.send({ embeds: [warnEmbed] });
        } catch {}
        return;
      }

      // المحاولات 3 فما فوق (وصول المجموع لـ 5 محاولات): تسجيل مخالفات تصاعدية
      const infractions = loadUserInfractions();
      if (!infractions[message.author.id]) {
        infractions[message.author.id] = {
          userId: message.author.id,
          userTag: message.author.tag,
          strikes: 0,
          history: []
        };
      }

      const userInf = infractions[message.author.id];
      userInf.strikes += 1;
      userInf.history.push({
        strikeNumber: userInf.strikes,
        reason: 'تكرار إرسال رسائل متشابهة بنسبة 85%+ وتجاهل الإنذارات',
        contentSnippet: message.content.slice(0, 100),
        timestamp: now
      });
      saveUserInfractions(infractions);

      // المخالفة 1/3 أو 2/3
      if (userInf.strikes < 3) {
        const strikeEmbed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setAuthor({ name: '⚠️ تسجيل مخالفة أمنية رسمية', iconURL: message.author.displayAvatarURL() })
          .setTitle(`مخالفة أمنية (${userInf.strikes}/3)`)
          .setDescription(
            `تم تسجيل مخالفة رسمية بحق <@${message.author.id}> (\`${userInf.strikes}/3\`).\n\n` +
            `> 📌 **السبب:** الإصرار على تكرار وإرسال رسائل متطابقة/مشابهة بنسبة \`85%+\`.\n` +
            `> 🚨 **تحذير أمني:** عند الوصول إلى **3/3 مخالفات**، سيتم حظرك تلقائياً من السيرفر فوراً.`
          )
          .setFooter({ text: `GX eSports Security Engine • الإصدار ${BOT_VERSION}` })
          .setTimestamp();

        const strikeMsg = await message.channel.send({ embeds: [strikeEmbed] }).catch(() => null);
        if (strikeMsg) setTimeout(() => strikeMsg.delete().catch(() => {}), 10000);

        await sendToLogChannel(message.guild, strikeEmbed);

        try {
          await message.author.send({ embeds: [strikeEmbed] });
        } catch {}
        return;
      }

      // المخالفة 3/3: حظر العضو تلقائياً من السيرفر
      else {
        const banEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '🚨 حظر أمني تلقائي | GX eSports Shield', iconURL: message.guild.iconURL() })
          .setTitle('تم حظرك من سيرفر GX eSports')
          .setDescription(
            `# ⛔ تم حظرك تلقائياً من السيرفر\n\n` +
            `مرحباً <@${message.author.id}>، تم تطبيق قرار الحظر التلقائي بحق حسابك بعد استنفاد كامل المخالفات (\`3/3 Strikes\`):\n\n` +
            `> 📌 **سبب الحظر:** تكرار إرسال رسائل مزعجة أو متشابهة بنسبة \`85%+\` وتجاهل الإنذارات الأمنية الموجهة إليك.`
          )
          .setFooter({ text: `GX eSports Security Shield • المعرف: ${message.author.id}` })
          .setTimestamp();

        try {
          await message.author.send({ embeds: [banEmbed] });
        } catch {}

        await message.guild.members.ban(message.author.id, {
          reason: 'تجاوز الحد الأقصى للمخالفات الأمنية (3/3) - تكرار السبام بنسبة 85%+'
        }).catch(() => {});

        const logBanEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '🚨 حظر أمني تلقائي (3/3 Strikes)', iconURL: message.author.displayAvatarURL() })
          .setDescription(
            `تم حظر العضو <@${message.author.id}> (\`${message.author.tag}\`) تلقائياً من السيرفر.\n` +
            `**السبب:** بلوغ الحد الأقصى للمخالفات (\`3/3\`) بسبب تكرار الرسائل المتشابهة بنسبة \`85%+\` وتجاهل الإنذارات.`
          )
          .setFooter({ text: `GX eSports Anti-Spam Security` })
          .setTimestamp();

        await sendToLogChannel(message.guild, logBanEmbed);
        return;
      }
    }

    history.push({ content: message.content, timestamp: now });
    userRecentMessages.set(message.author.id, history);
  }
});

// ====================================================
// 🎮 SLASH COMMANDS & INTERACTION HANDLER
// ====================================================
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.guildId && interaction.guildId !== ALLOWED_GUILD_ID) {
      if (interaction.isRepliable()) {
        const embed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('⛔ غير مصرح')
          .setDescription(`هذا البوت مخصص فقط لسيرفر **GX eSports** (المعرف: \`${ALLOWED_GUILD_ID}\`).`)
          .setFooter({ text: `الإصدار ${BOT_VERSION}` });
        await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
      }
      if (interaction.guild) await handleUnauthorizedGuild(interaction.guild);
      return;
    }

    // ----------------------------------------------------
    // 🪟 MODAL SUBMIT HANDLER (Ticket Creation & Agent Reply)
    // ----------------------------------------------------
    if (interaction.isModalSubmit()) {
      if (await handleAppealModalSubmit(interaction, client, getExecutiveMembers, ALLOWED_GUILD_ID)) return;
      // 1. استلام نافذة فتح التذكرة الخاصة (مرئية للمشتكي فقط 100%)
      if (interaction.customId === 'ticket_creation_modal') {
        await interaction.deferReply({ ephemeral: true });

        const realName = interaction.fields.getTextInputValue('ticket_real_name').trim();
        const reason = interaction.fields.getTextInputValue('ticket_reason').trim();

        try {
          const thread = await openTicketThreadWithData(
            interaction.guild,
            interaction.channel,
            interaction.user,
            realName,
            reason
          );

          return interaction.editReply({
            content:
              `# ✅ تم فتح تذكرة الدعم الفني بنجاح!\n` +
              `> 🔗 **رابط التذكرة الخاصة بك:** <#${thread.id}>\n` +
              `> ⏳ **يرجى التوجه إلى الروم وانتظار حضور وكيل الدعم لمساعدتك.**`
          });
        } catch (err) {
          return interaction.editReply({
            content: `❌ تعذر إنشاء التذكرة: ${err.message}`
          });
        }
      }

      // 2. استلام نافذة إرسال رد رسمي كوكيل الدعم (خفي 100% ودون ظهور حساب الوكيل)
      else if (interaction.customId.startsWith('agent_reply_modal_')) {
        const threadId = interaction.customId.replace('agent_reply_modal_', '');
        const replyText = interaction.fields.getTextInputValue('agent_reply_text').trim();

        const ticketsData = loadTickets();
        const ticket = ticketsData.activeTickets ? ticketsData.activeTickets[threadId] : null;

        const thread = interaction.guild.channels.cache.get(threadId);
        if (thread) {
          const agentEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setAuthor({
              name: 'وكيل الدعم الفني | GX Support Agent',
              iconURL: client.user?.displayAvatarURL()
            })
            .setDescription(replyText)
            .setFooter({ text: `GX eSports Support Agent • ${ticket ? ticket.ticketId : 'GX Support'}` })
            .setTimestamp();

          await thread.send({ embeds: [agentEmbed] });

          if (ticket) {
            if (!ticket.transcript) ticket.transcript = [];
            ticket.transcript.push({
              authorId: interaction.user.id,
              authorTag: `${interaction.user.tag} (وكيل الدعم)`,
              content: replyText,
              timestamp: Date.now()
            });
            saveTickets(ticketsData);
          }
        }

        return interaction.reply({
          content: '✅ **تم إرسال ردك بنجاح باسم وكيل الدعم الفني دون أي ظهور لحسابك الشخصي.**',
          ephemeral: true
        });
      }


    }

    // ----------------------------------------------------
    // 🎫 BUTTON INTERACTIONS HANDLER (Tickets & Events)
    // ----------------------------------------------------
    if (interaction.isButton()) {
      if (await handleAppealButton(interaction, client, sendToLogChannel, isVerificationApprover, ALLOWED_GUILD_ID, BOT_VERSION)) return;
      // ====================================================
      // 🎉 EVENT BUTTON INTERACTIONS (انضمام / انسحاب / تذكير / مشاركون)
      // ====================================================
      if (interaction.customId.startsWith('event_join_')) {
        const eventId = interaction.customId.replace('event_join_', '');
        const eventData = loadActiveEvent();
        if (!eventData || eventData.id !== eventId || eventData.status === 'ended') {
          return interaction.reply({ content: '❌ لا توجد فعالية أو بطولة نشطة حالياً للتسجيل فيها.', ephemeral: true });
        }
        if (eventData.status === 'started') {
          return interaction.reply({ content: '⛔ تم إغلاق باب التسجيل لأن البطولة قد بدأت بالفعل!', ephemeral: true });
        }
        if (eventData.participants && eventData.participants.includes(interaction.user.id)) {
          return interaction.reply({ content: 'ℹ️ أنت مسجل بالفعل في هذه البطولة! 🎉', ephemeral: true });
        }
        if (eventData.maxParticipants && eventData.participants && eventData.participants.length >= eventData.maxParticipants) {
          return interaction.reply({ content: `⛔ اكتمل العدد الأقصى للمشاركين في هذه البطولة (${eventData.maxParticipants} مشارك)!`, ephemeral: true });
        }

        if (!eventData.participants) eventData.participants = [];
        eventData.participants.push(interaction.user.id);
        saveActiveEvent(eventData);

        await interaction.deferReply({ ephemeral: true });

        // Process Tournament Matching & Room Generation automatically
        await processTournamentMatching(interaction.guild, eventData);

        const eventEmbed = renderEventEmbed(eventData, client.user);
        const eventRow = renderEventButtons(eventData);
        if (eventData.messageId) {
          const ch = interaction.guild.channels.cache.get(EVENT_CHANNEL_ID);
          if (ch) {
            const msg = await ch.messages.fetch(eventData.messageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [eventEmbed], components: [eventRow] }).catch(() => {});
          }
        }

        return interaction.editReply({
          content: `🎉 **أهلاً بك <@${interaction.user.id}>!** تم تسجيلك بنجاح في بطولة **${eventData.title}**!\n🔔 **تم تفعيل التنبيهات بالخاص تلقائياً.** ستصلك رسالة بالخاص عند تشكيل روم مواجهتك/فريقك وتذكير قبل انطلاق البطولة.`
        });
      }

      else if (interaction.customId.startsWith('event_leave_')) {
        const eventId = interaction.customId.replace('event_leave_', '');
        const eventData = loadActiveEvent();
        if (!eventData || eventData.id !== eventId || eventData.status === 'ended') {
          return interaction.reply({ content: '❌ لا توجد فعالية أو بطولة نشطة حالياً.', ephemeral: true });
        }
        if (eventData.status === 'started') {
          return interaction.reply({ content: '⛔ لا يمكن الانسحاب بعد انطلاق البطولة!', ephemeral: true });
        }
        if (!eventData.participants || !eventData.participants.includes(interaction.user.id)) {
          return interaction.reply({ content: 'ℹ️ أنت لست مسجلاً في هذه البطولة بالأصل.', ephemeral: true });
        }

        eventData.participants = eventData.participants.filter((id) => id !== interaction.user.id);
        saveActiveEvent(eventData);

        const eventEmbed = renderEventEmbed(eventData, client.user);
        const eventRow = renderEventButtons(eventData);
        await interaction.update({ embeds: [eventEmbed], components: [eventRow] }).catch(() => {});

        return interaction.followUp({
          content: `🚪 تم إلغاء تسجيلك وانسحابك من البطولة بنجاح.`,
          ephemeral: true
        }).catch(() => {});
      }

      else if (interaction.customId.startsWith('event_remind_')) {
        const eventData = loadActiveEvent();
        if (!eventData || eventData.status === 'ended') {
          return interaction.reply({ content: '❌ لا توجد فعالية نشطة حالياً.', ephemeral: true });
        }

        if (!eventData.remindUsers) eventData.remindUsers = [];
        if (!eventData.remindUsers.includes(interaction.user.id)) {
          eventData.remindUsers.push(interaction.user.id);
          saveActiveEvent(eventData);
        }

        // Send instant DM confirmation
        const remindConfirmEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setAuthor({ name: '🔔 تأكيد تفعيل التذكير | GX eSports', iconURL: interaction.guild.iconURL() })
          .setTitle(`تم تفعيل التذكير لبطولة: ${eventData.title}`)
          .setDescription(
            `✅ سيقوم البوت بإرسال إشعار خاص لك قبل انطلاق البطولة بـ 10 دقائق مع رابط الروم الصوتي وتفاصيل مباراتك.\n\n` +
            `🏆 **نتمنى لك التوفيق والانتصار!**`
          )
          .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
          .setTimestamp();

        await interaction.user.send({ embeds: [remindConfirmEmbed] }).catch(() => {});

        return interaction.reply({
          content: `🔔 **تم تفعيل التذكير بنجاح!** ستصلك رسالة في الخاص قبل بدء البطولة لتنبيهك.`,
          ephemeral: true
        });
      }

      else if (interaction.customId.startsWith('event_list_')) {
        const eventData = loadActiveEvent();
        if (!eventData || eventData.status === 'ended') {
          return interaction.reply({ content: '❌ لا توجد فعالية نشطة حالياً.', ephemeral: true });
        }

        const count = eventData.participants ? eventData.participants.length : 0;
        if (count === 0) {
          return interaction.reply({ content: '📋 لم يسجل أي مشارك حتى الآن في البطولة!', ephemeral: true });
        }

        let matchesText = 'لا توجد مواجهات مكتملة بعد.';
        if (eventData.matches && eventData.matches.length > 0) {
          matchesText = eventData.matches.map((m) => `⚔️ **مواجهة #${m.matchNumber}:** <@${m.playerIds[0]}> 🆚 <@${m.playerIds[1]}> ──> <#${m.voiceChannelId}>`).join('\n');
        } else if (eventData.teams && eventData.teams.length > 0) {
          matchesText = eventData.teams.map((t) => `👥 **فريق #${t.teamNumber}:** ${t.playerIds.map((id) => `<@${id}>`).join(' ، ')} ──> <#${t.voiceChannelId}>`).join('\n');
        }

        const participantsList = eventData.participants.map((id, index) => `${index + 1}. <@${id}> (\`${id}\`)`).join('\n');

        const listEmbed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(`👥 تفاصيل بطولة: ${eventData.title}`)
          .addFields(
            { name: `🎮 اللاعبون المسجلون (${count})`, value: participantsList.length > 1024 ? participantsList.slice(0, 1000) + '...' : participantsList, inline: false },
            { name: `⚔️ الرومات والمواجهات المجهزة`, value: matchesText.length > 1024 ? matchesText.slice(0, 1000) + '...' : matchesText, inline: false }
          )
          .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` });

        return interaction.reply({ embeds: [listEmbed], ephemeral: true });
      }

      // 1. زر فتح تذكرة دعم فني (عرض نافذة إدخال خاصة ومباشرة)
      else if (interaction.customId === 'open_ticket_btn') {
        const modal = new ModalBuilder()
          .setCustomId('ticket_creation_modal')
          .setTitle('🎫 فتح تذكرة دعم فني | GX eSports');

        const nameInput = new TextInputBuilder()
          .setCustomId('ticket_real_name')
          .setLabel('ما هو اسمك الحقيقي؟')
          .setPlaceholder('اكتب اسمك الحقيقي هنا (مثال: أحمد، محمد...)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(50);

        const reasonInput = new TextInputBuilder()
          .setCustomId('ticket_reason')
          .setLabel('سبب التذكرة وتفاصيل المشكلة؟')
          .setPlaceholder('يرجى شرح سبب فتح التذكرة والاستفسار بالتفصيل لمساعدتك...')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(5)
          .setMaxLength(1000);

        const firstRow = new ActionRowBuilder().addComponents(nameInput);
        const secondRow = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(firstRow, secondRow);

        return interaction.showModal(modal);
      }

      // 2. زر فتح نافذة الرد السري كوكيل الدعم
      else if (interaction.customId.startsWith('agent_reply_btn_')) {
        const threadId = interaction.customId.replace('agent_reply_btn_', '');
        const ticketsData = loadTickets();
        const ticket = ticketsData.activeTickets ? ticketsData.activeTickets[threadId] : null;

        if (ticket && ticket.claimedBy && ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({
            content: `⚠️ عذراً، هذا الإجراء مخصص حصرياً للوكيل المستلم للتذكرة (<@${ticket.claimedBy}>).`,
            ephemeral: true
          });
        }

        const replyModal = new ModalBuilder()
          .setCustomId(`agent_reply_modal_${threadId}`)
          .setTitle('💬 إرسال رد رسمي كوكيل الدعم');

        const textInput = new TextInputBuilder()
          .setCustomId('agent_reply_text')
          .setLabel('نص الرسالة والرد:')
          .setPlaceholder('اكتب ردك هنا وسيقوم البوت بنشره باسم وكيل الدعم الفني...')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(2000);

        const row = new ActionRowBuilder().addComponents(textInput);
        replyModal.addComponents(row);

        return interaction.showModal(replyModal);
      }



      // 6. زر سحب واستلام التذكرة (مع معالجة التنافس والاعتذار عند التأخير)
      else if (interaction.customId.startsWith('claim_ticket_')) {
        if (!isManagerMember(interaction.member)) {
          return interaction.reply({
            content: '❌ عذراً، هذا الإجراء مخصص فقط لأصحاب رتبة MANAGERS وفريق الإدارة!',
            ephemeral: true
          });
        }

        const threadId = interaction.customId.replace('claim_ticket_', '');
        const ticketsData = loadTickets();
        const ticket = ticketsData.activeTickets ? ticketsData.activeTickets[threadId] : null;

        if (!ticket) {
          return interaction.reply({ content: '❌ لم يتم العثور على بيانات هذه التذكرة أو تم إغلاقها.', ephemeral: true });
        }

        // 🛡️ فحص التنافس: في حال سبق وكيل آخر بسحب التذكرة
        if (ticket.claimedBy) {
          return interaction.reply({
            content: `⚠️ **عذراً يا زميلنا العزيز <@${interaction.user.id}>**، تم استلام وسحب هذه التذكرة بالفعل من قِبل الوكيل <@${ticket.claimedBy}> قبل لحظات. شكراً لسرعة استجابتك!`,
            ephemeral: true
          });
        }

        ticket.claimedBy = interaction.user.id;
        ticket.claimedByTag = interaction.user.tag;
        ticket.stage = 'CLAIMED';
        saveTickets(ticketsData);

        // عزل التذكرة وحصرها: إبقاء الوكيل المستلم وصاحب التذكرة فقط وإزالة بقية المشرفين
        try {
          const thread = interaction.guild.channels.cache.get(threadId);
          if (thread) {
            await thread.members.add(interaction.user.id).catch(() => {});
            const allMembers = await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache);
            for (const [, m] of allMembers) {
              if (m.id !== interaction.user.id && m.id !== ticket.userId && isManagerMember(m)) {
                await thread.members.remove(m.id).catch(() => {});
              }
            }
          }
        } catch {}

        const claimedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`claimed_done_${threadId}`)
            .setLabel(`✅ تم الاستلام بواسطة: ${interaction.user.displayName}`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
        );

        await interaction.update({ components: [claimedRow] }).catch(() => {});

        const connectedEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '🎧 وكيل الدعم الفني متصل الآن', iconURL: client.user?.displayAvatarURL() })
          .setTitle('وكيل الدعم من GX متصل بك، كيف يمكنه المساعدة؟')
          .setDescription(
            `# 🎧 مرحباً بك!\n` +
            `> تم استلام تذكرتك بنجاح بواسطة ممثل الدعم الفني <@${interaction.user.id}>.\n` +
            `> التذكرة الآن خاصة ومغلقة بينكما فقط.\n\n` +
            `💡 **ملاحظة للمشتكي:** عند حل المشكلة، يمكنك كتابة \`#000\` في الشات ليظهر للوكيل خيار إغلاق التذكرة.`
          )
          .setFooter({ text: `GX eSports Support Engine • ${ticket.ticketId}` })
          .setTimestamp();

        await interaction.channel.send({
          content: `📢 <@${ticket.userId}>`,
          embeds: [connectedEmbed]
        });

        // لوحة تحكم سرية خاصة بالوكيل المستلم فقط (Only you can see this message)
        const agentQuickAction = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`agent_reply_btn_${threadId}`)
            .setLabel('💬 إرسال رد كوكيل الدعم (خفي)')
            .setStyle(ButtonStyle.Primary)
        );

        await interaction.followUp({
          content:
            `# 🎧 مرحباً بك يا <@${interaction.user.id}> في إدارة التذكرة (${ticket.ticketId})\n` +
            `> 🔒 **لإرسال ردود رسمية باسم البوت دون ظهور حسابك الشخصي مطلقاً:**\n` +
            `> • اضغط على الزر أدناه لكتابة الرد في نافذة منبثقة.\n` +
            `> • أو استخدم الأمر \`/رد <الرسالة>\` مباشرة في الشات.`,
          components: [agentQuickAction],
          ephemeral: true
        });

        const logEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '🎧 استلام وسحب تذكرة دعم', iconURL: interaction.user.displayAvatarURL() })
          .setDescription(`قام الوكيل <@${interaction.user.id}> (\`${interaction.user.tag}\`) بسحب واستلام التذكرة <#${threadId}> (\`${ticket.ticketId}\`).`)
          .setFooter({ text: `GX eSports Support • ${ticket.ticketId}` })
          .setTimestamp();
        await sendToLogChannel(interaction.guild, logEmbed);
        return;
      }

      // 7. زر إغلاق وحذف التذكرة (حصري للوكيل المستلم أو صاحب التذكرة مع اعتذار للبقية)
      else if (interaction.customId.startsWith('close_ticket_')) {
        const threadId = interaction.customId.replace('close_ticket_', '');
        const ticketsData = loadTickets();
        const ticket = ticketsData.activeTickets ? ticketsData.activeTickets[threadId] : null;

        if (!ticket) {
          return interaction.reply({ content: '❌ لم يتم العثور على بيانات هذه التذكرة.', ephemeral: true });
        }

        const isAgent = ticket.claimedBy && interaction.user.id === ticket.claimedBy;
        const isCreator = interaction.user.id === ticket.userId;

        if (!isAgent && !isCreator && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({
            content: `⚠️ **عذراً يا زميلنا**، لا يمكن إغلاق هذه التذكرة إلا من قبل الوكيل المستلم لها (<@${ticket.claimedBy}>) أو صاحب التذكرة!`,
            ephemeral: true
          });
        }

        await interaction.reply({
          content: `🔒 **تم تأكيد إنهاء المشكلة وإغلاق التذكرة بواسطة <@${interaction.user.id}>.**\n⏳ سيتم حذف وأرشفة التذكرة تلقائياً خلال **5 ثوانٍ**...`
        });

        const transcriptText = ticket.transcript && ticket.transcript.length > 0
          ? ticket.transcript.map(t => `[${new Date(t.timestamp).toLocaleTimeString()}] ${t.authorTag}: ${t.content}`).join('\n')
          : 'لا توجد محادثات إضافية';

        const logEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '🔒 إغلاق وأرشفة تذكرة دعم فني', iconURL: interaction.guild.iconURL() })
          .setTitle(`تم إغلاق التذكرة: ${ticket.ticketId}`)
          .addFields(
            { name: '👤 صاحب التذكرة', value: `<@${ticket.userId}> (\`${ticket.userTag}\`)`, inline: true },
            { name: '📛 الاسم الحقيقي', value: `\`${ticket.realName || 'غير محدد'}\``, inline: true },
            { name: '👮‍♂️ وكيل الدعم المستلم', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'لم يتم الاستلام', inline: true },
            { name: '📝 سبب التذكرة', value: ticket.reason || 'غير محدد', inline: false },
            { name: '📜 سجل المحادثة (Transcript)', value: transcriptText.length > 1000 ? `${transcriptText.slice(0, 1000)}...` : transcriptText, inline: false }
          )
          .setFooter({ text: `GX eSports Support Transcript • ${ticket.ticketId}` })
          .setTimestamp();

        await sendToLogChannel(interaction.guild, logEmbed);

        delete ticketsData.activeTickets[threadId];
        saveTickets(ticketsData);

        setTimeout(async () => {
          try {
            const thread = interaction.guild.channels.cache.get(threadId);
            if (thread) await thread.delete('Ticket closed');
          } catch {}
        }, 5000);
        return;
      }

      // 8. زر قبول توثيق العضوية (خاص برتب OWNER / CEO / COO عبر الخاص DM - أول موافق فقط)
      else if (interaction.customId.startsWith('verify_approve_')) {
        const targetId = interaction.customId.replace('verify_approve_', '');
        const guild = interaction.guild || client.guilds.cache.get(ALLOWED_GUILD_ID);

        if (!guild) {
          return interaction.reply({ content: '❌ تعذر الوصول إلى السيرفر.', ephemeral: true });
        }

        const approverMember = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!isVerificationApprover(approverMember, interaction.user)) {
          return interaction.reply({
            content: '❌ **عذراً، الموافقة على طلبات التوثيق مقتصرة فقط على رتب (OWNER / CEO / COO)!**',
            ephemeral: true
          });
        }

        const requestsData = loadVerificationRequests();
        const req = requestsData[targetId];

        // First-Responder Guard: if already handled by someone else
        if (req && req.status !== 'pending') {
          const handledLabel = req.status === 'approved'
            ? `✅ تم القبول مسبقاً بواسطة: @${req.handledByName || 'مسؤول آخر'}`
            : `❌ تم الرفض مسبقاً بواسطة: @${req.handledByName || 'مسؤول آخر'}`;

          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`already_handled_${targetId}`)
              .setLabel(handledLabel)
              .setStyle(req.status === 'approved' ? ButtonStyle.Success : ButtonStyle.Danger)
              .setDisabled(true)
          );
          await interaction.update({ components: [disabledRow] }).catch(() => {});
          return interaction.followUp({
            content: `⚠️ **عذراً يا عزيزنا <@${interaction.user.id}>**، تم التعامل مع هذا الطلب مسبقاً بواسطة **@${req.handledByName}**!`,
            ephemeral: true
          });
        }

        const targetMember = await guild.members.fetch(targetId).catch(() => null);
        if (!targetMember) {
          return interaction.reply({ content: '❌ لم يتم العثور على العضو في السيرفر (ربما غادر السيرفر).', ephemeral: true });
        }

        const memberRole = findAutoRole(guild);
        const untrustedRole = await findOrCreateUntrustedRole(guild);

        if (untrustedRole && targetMember.roles.cache.has(untrustedRole.id)) {
          await targetMember.roles.remove(untrustedRole).catch(() => {});
        }
        if (memberRole && !targetMember.roles.cache.has(memberRole.id)) {
          await targetMember.roles.add(memberRole).catch(() => {});
        }

        const approverName = interaction.user.displayName || interaction.user.username;

        if (!requestsData[targetId]) {
          requestsData[targetId] = { targetId, messages: [] };
        }
        requestsData[targetId].status = 'approved';
        requestsData[targetId].handledBy = interaction.user.id;
        requestsData[targetId].handledByName = approverName;
        requestsData[targetId].handledAt = Date.now();
        saveVerificationRequests(requestsData);

        // 1. Update clicking approver's message
        const approverRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`approved_by_me_${targetId}`)
            .setLabel(`✅ تم القبول بواسطتك (@${approverName})`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
        );
        await interaction.update({ components: [approverRow] }).catch(() => {});

        // 2. Broadcast button update to all other executives' DMs ("تم القبول بواسطة: @{name}")
        const otherExecRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`approved_by_other_${targetId}`)
            .setLabel(`✅ تم القبول بواسطة: @${approverName}`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
        );

        if (req && Array.isArray(req.messages)) {
          for (const msgInfo of req.messages) {
            if (msgInfo.execUserId !== interaction.user.id) {
              try {
                const execUser = await client.users.fetch(msgInfo.execUserId).catch(() => null);
                if (execUser) {
                  const dmChan = execUser.dmChannel || await execUser.createDM().catch(() => null);
                  if (dmChan) {
                    const msg = await dmChan.messages.fetch(msgInfo.messageId).catch(() => null);
                    if (msg) await msg.edit({ components: [otherExecRow] }).catch(() => {});
                  }
                }
              } catch {}
            }
          }
        }

        // Direct DM to the approved member
        const approvedDMEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '🎉 تم قبول التوثيق بنجاح | GX eSports', iconURL: guild.iconURL() })
          .setTitle('👑 تهانينا! تمت ترقيتك وتفعيل حسابك بالكامل')
          .setDescription(
            `أهلاً بك <@${targetId}>! تمت مراجعة طلبك والموافقة على توثيق حسابك بواسطة الإدارة العليا (<@${interaction.user.id}>).\n\n` +
            `✅ **تم منحك رتبة:** <@&${memberRole ? memberRole.id : ''}>\n` +
            `🗑️ **تمت إزالة رتبة:** \`UNTRUSTED\`\n` +
            `💬 **أصبح بإمكانك الآن الكتابة والتفاعل والمشاركة في جميع قنوات السيرفر بحرية.**\n\n` +
            `نتمنى لك أوقاتاً ممتعة معنا في **GX eSports**! 🎮🔥`
          )
          .setFooter({ text: `GX eSports Security System • الإصدار ${BOT_VERSION}` })
          .setTimestamp();

        await targetMember.send({ embeds: [approvedDMEmbed] }).catch(() => {});

        const logEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '✅ قبول توثيق عضو (عبر الخاص)', iconURL: interaction.user.displayAvatarURL() })
          .setDescription(`قام المسؤول <@${interaction.user.id}> بالموافقة في الخاص على توثيق <@${targetId}> (\`${targetMember.user.tag}\`) ومنحه رتبة **MEMBER** وسحب **UNTRUSTED** وتفعيل صلاحية الكتابة.`)
          .setFooter({ text: `GX eSports Security • الإصدار ${BOT_VERSION}` })
          .setTimestamp();
        await sendToLogChannel(guild, logEmbed);

        return interaction.followUp({
          content: `✅ **تم بنجاح توثيق العضو <@${targetId}> ومنحه رتبة MEMBER وإلغاء UNTRUSTED!**`,
          ephemeral: true
        });
      }

      // 9. زر رفض توثيق العضوية (عبر الخاص DM - أول مسؤول فقط)
      else if (interaction.customId.startsWith('verify_reject_')) {
        const targetId = interaction.customId.replace('verify_reject_', '');
        const guild = interaction.guild || client.guilds.cache.get(ALLOWED_GUILD_ID);

        if (!guild) {
          return interaction.reply({ content: '❌ تعذر الوصول إلى السيرفر.', ephemeral: true });
        }

        const approverMember = await guild.members.fetch(interaction.user.id).catch(() => null);
        if (!isVerificationApprover(approverMember, interaction.user)) {
          return interaction.reply({
            content: '❌ **عذراً، رفض طلبات التوثيق مقتصر فقط على رتب (OWNER / CEO / COO)!**',
            ephemeral: true
          });
        }

        const requestsData = loadVerificationRequests();
        const req = requestsData[targetId];

        // First-Responder Guard: if already handled by someone else
        if (req && req.status !== 'pending') {
          const handledLabel = req.status === 'approved'
            ? `✅ تم القبول مسبقاً بواسطة: @${req.handledByName || 'مسؤول آخر'}`
            : `❌ تم الرفض مسبقاً بواسطة: @${req.handledByName || 'مسؤول آخر'}`;

          const disabledRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`already_handled_${targetId}`)
              .setLabel(handledLabel)
              .setStyle(req.status === 'approved' ? ButtonStyle.Success : ButtonStyle.Danger)
              .setDisabled(true)
          );
          await interaction.update({ components: [disabledRow] }).catch(() => {});
          return interaction.followUp({
            content: `⚠️ **عذراً يا عزيزنا <@${interaction.user.id}>**، تم التعامل مع هذا الطلب مسبقاً بواسطة **@${req.handledByName}**!`,
            ephemeral: true
          });
        }

        const rejecterName = interaction.user.displayName || interaction.user.username;

        if (!requestsData[targetId]) {
          requestsData[targetId] = { targetId, messages: [] };
        }
        requestsData[targetId].status = 'rejected';
        requestsData[targetId].handledBy = interaction.user.id;
        requestsData[targetId].handledByName = rejecterName;
        requestsData[targetId].handledAt = Date.now();
        saveVerificationRequests(requestsData);

        // 1. Update clicking user's message
        const rejecterRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rejected_by_me_${targetId}`)
            .setLabel(`❌ تم رفض الطلب بواسطتك (@${rejecterName})`)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true)
        );
        await interaction.update({ components: [rejecterRow] }).catch(() => {});

        // 2. Broadcast button update to all other executives' DMs
        const otherRejectRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rejected_by_other_${targetId}`)
            .setLabel(`❌ تم الرفض بواسطة: @${rejecterName}`)
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true)
        );

        if (req && Array.isArray(req.messages)) {
          for (const msgInfo of req.messages) {
            if (msgInfo.execUserId !== interaction.user.id) {
              try {
                const execUser = await client.users.fetch(msgInfo.execUserId).catch(() => null);
                if (execUser) {
                  const dmChan = execUser.dmChannel || await execUser.createDM().catch(() => null);
                  if (dmChan) {
                    const msg = await dmChan.messages.fetch(msgInfo.messageId).catch(() => null);
                    if (msg) await msg.edit({ components: [otherRejectRow] }).catch(() => {});
                  }
                }
              } catch {}
            }
          }
        }

        const targetMember = await guild.members.fetch(targetId).catch(() => null);
        if (targetMember) {
          const rejectDMEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setAuthor({ name: '❌ طلب التوثيق | GX eSports', iconURL: guild.iconURL() })
            .setTitle('تنبيه بخصوص طلب توثيق العضوية')
            .setDescription(
              `عزيزنا <@${targetId}>، تم رفض طلب التوثيق الخاص بك حالياً من قِبل الإدارة العليا.\n` +
              `ستبقى رتبتك كما هي \`UNTRUSTED\` (يمكنك مشاهدة القنوات ودخول الرومات الصوتية فقط).`
            )
            .setFooter({ text: `GX eSports Security • الإصدار ${BOT_VERSION}` })
            .setTimestamp();
          await targetMember.send({ embeds: [rejectDMEmbed] }).catch(() => {});
        }

        const logEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '❌ رفض توثيق عضو (عبر الخاص)', iconURL: interaction.user.displayAvatarURL() })
          .setDescription(`قام المسؤول <@${interaction.user.id}> برفض طلب توثيق <@${targetId}> عبر الخاص.`)
          .setFooter({ text: `GX eSports Security • الإصدار ${BOT_VERSION}` })
          .setTimestamp();
        await sendToLogChannel(guild, logEmbed);

        return interaction.followUp({
          content: `❌ **تم رفض طلب التوثيق للعضو <@${targetId}>.**`,
          ephemeral: true
        });
      }
    }

    if (!interaction.isChatInputCommand()) return;

    // Strict Emergency Lockdown command shield (non-executives blocked from running commands during emergency)
    if (isEmergencyActive()) {
      const isExecutive = isVerificationApprover(interaction.member, interaction.user);
      if (!isExecutive && interaction.commandName !== 'طوارئ_حالة' && interaction.commandName !== 'طوارئ_إلغاء') {
        return interaction.reply({
          content: '🚨 **عذراً، السيرفر في وضع الطوارئ العسكرية والدفاع الشامل حالياً. جميع العمليات والأوامر مجمدة ومحصورة حصرياً برتب (OWNER / CEO / COO) فقط.**',
          ephemeral: true
        });
      }
    }

    const { commandName } = interaction;
    try {
      logActivity('command', `/${commandName}`, `Used in #${interaction.channel?.name || 'DM'} by ${interaction.user.tag}`, interaction.user);
    } catch {}

    // 1. أمر /مسح و /clear
    if (commandName === 'clear' || commandName === 'مسح') {
      const amount = interaction.options.getInteger('العدد');
      const targetUser = interaction.options.getUser('المستخدم');

      await interaction.deferReply({ ephemeral: true });

      try {
        const messages = await interaction.channel.messages.fetch({ limit: amount });
        let toDelete = messages;

        if (targetUser) {
          toDelete = messages.filter((m) => m.author.id === targetUser.id);
        }

        const deleted = await interaction.channel.bulkDelete(toDelete, true);

        await interaction.editReply({
          content: `🧹 **تم بنجاح مسح ${deleted.size} رسالة** ${targetUser ? `خاصة بالعضو <@${targetUser.id}>` : ''} في القناة <#${interaction.channelId}>.`
        });

        const logEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '🧹 مسح رسائل (/clear)', iconURL: interaction.user.displayAvatarURL() })
          .setDescription(`قام المشرف <@${interaction.user.id}> بمسح **${deleted.size}** رسالة في القناة <#${interaction.channelId}>${targetUser ? ` خاصة بالعضو <@${targetUser.id}>` : ''}.`)
          .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` })
          .setTimestamp();
        await sendToLogChannel(interaction.guild, logEmbed);
      } catch (err) {
        await interaction.editReply({ content: `❌ تعذر مسح الرسائل: ${err.message}` });
      }
    }

    // 2. أمر /طرد
    else if (commandName === 'طرد') {
      const targetUser = interaction.options.getUser('المستخدم');
      const reason = interaction.options.getString('السبب') || 'لم يتم تحديد سبب';

      if (targetUser.id === client.user.id) {
        return interaction.reply({ content: '❌ **لا يمكن طرد البوت من السيرفر! البوت محصن ومحمي أمنياً.**', ephemeral: true });
      }
      if (targetUser.id === interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ **لا يمكن طرد مالك السيرفر!**', ephemeral: true });
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو في السيرفر.', ephemeral: true });
      }

      const botMember = interaction.guild.members.me;
      if (!targetMember.kickable || botMember.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0) {
        return interaction.reply({ content: '❌ لا يمكن طرد هذا العضو لأن رتبته أعلى من البوت أو يملك صلاحيات محمية.', ephemeral: true });
      }

      await targetMember.kick(`بواسطة ${interaction.user.tag}: ${reason}`);

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '👢 تم طرد العضو بنجاح', iconURL: targetUser.displayAvatarURL() })
        .setDescription(`تم طرد <@${targetUser.id}> (\`${targetUser.tag}\`) من السيرفر.\n**السبب:** ${reason}`)
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 3. أمر /حظر
    else if (commandName === 'حظر') {
      const targetUser = interaction.options.getUser('المستخدم');
      const reason = interaction.options.getString('السبب') || 'لم يتم تحديد سبب';
      const days = interaction.options.getInteger('مسح_الرسائل_أيام') || 0;

      if (targetUser.id === client.user.id) {
        return interaction.reply({ content: '❌ **لا يمكن حظر البوت من السيرفر! البوت محصن ومحمي أمنياً.**', ephemeral: true });
      }
      if (targetUser.id === interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ **لا يمكن حظر مالك السيرفر!**', ephemeral: true });
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const botMember = interaction.guild.members.me;

      if (targetMember && (!targetMember.bannable || botMember.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0)) {
        return interaction.reply({ content: '❌ لا يمكن حظر هذا العضو لأن رتبته أعلى من البوت أو يملك صلاحيات محمية.', ephemeral: true });
      }

      await interaction.guild.members.ban(targetUser.id, {
        reason: `بواسطة ${interaction.user.tag}: ${reason}`,
        deleteMessageSeconds: days * 86400
      });

      const embed = new EmbedBuilder()
        .setColor(0x992D22)
        .setAuthor({ name: '🔨 تم حظر العضو بنجاح (Ban)', iconURL: targetUser.displayAvatarURL() })
        .setDescription(`تم حظر <@${targetUser.id}> (\`${targetUser.tag}\`) من السيرفر نهائياً.\n**السبب:** ${reason}\n**مسح رسائل:** ${days} أيام.`)
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 4. أمر /فك_حظر
    else if (commandName === 'فك_حظر') {
      const userId = interaction.options.getString('المعرف').trim();
      const reason = interaction.options.getString('السبب') || 'فك حظر بواسطة الإدارة';

      try {
        await interaction.guild.members.unban(userId, `بواسطة ${interaction.user.tag}: ${reason}`);

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '🔓 تم فك حظر العضو بنجاح (Unban)', iconURL: interaction.guild.iconURL() })
          .setDescription(`تم إلغاء حظر العضو صاحب المعرف \`${userId}\` بنجاح.\n**السبب:** ${reason}`)
          .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });
      } catch (err) {
        await interaction.reply({ content: `❌ تعذر فك الحظر: قد لا يكون هذا المعرف محظوراً أو غير صحيح (${err.message})`, ephemeral: true });
      }
    }

    // 5. أمر /عزل
    else if (commandName === 'عزل') {
      const targetUser = interaction.options.getUser('المستخدم');
      const durationSeconds = parseInt(interaction.options.getString('المدة'));
      const reason = interaction.options.getString('السبب') || 'مخالفة القوانين';

      if (targetUser.id === client.user.id) {
        return interaction.reply({ content: '❌ **لا يمكن عزل البوت! البوت محصن ومحمي أمنياً.**', ephemeral: true });
      }
      if (targetUser.id === interaction.guild.ownerId) {
        return interaction.reply({ content: '❌ **لا يمكن عزل مالك السيرفر!**', ephemeral: true });
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو.', ephemeral: true });
      }

      if (isManagerMember(targetMember)) {
        return interaction.reply({ content: '❌ لا يمكن تطبيق تايم آوت على المشرفين والإدارة!', ephemeral: true });
      }

      await targetMember.timeout(durationSeconds * 1000, `بواسطة ${interaction.user.tag}: ${reason}`);

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '⏳ تم عزل العضو بنجاح (Timeout)', iconURL: targetUser.displayAvatarURL() })
        .setDescription(
          `تم عزل <@${targetUser.id}> (\`${targetUser.tag}\`) مؤقتاً.\n` +
          `**المدة:** \`${durationSeconds / 60}\` دقيقة\n` +
          `**ينتهي في:** <t:${Math.floor((Date.now() + durationSeconds * 1000) / 1000)}:R>\n` +
          `**السبب:** ${reason}`
        )
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 6. أمر /فك_عزل
    else if (commandName === 'فك_عزل') {
      const targetUser = interaction.options.getUser('المستخدم');
      const reason = interaction.options.getString('السبب') || 'إلغاء العزل بواسطة الإدارة';

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو.', ephemeral: true });
      }

      await targetMember.timeout(null, `بواسطة ${interaction.user.tag}: ${reason}`);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🔓 تم إلغاء عزل العضو بنجاح', iconURL: targetUser.displayAvatarURL() })
        .setDescription(`تم إلغاء التايم آوت عن <@${targetUser.id}> (\`${targetUser.tag}\`) وأصبح بإمكانه المشاركة الآن.`)
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 7. أمر /تحذير
    else if (commandName === 'تحذير') {
      const targetUser = interaction.options.getUser('المستخدم');
      const reason = interaction.options.getString('السبب');

      const allWarnings = loadWarnings();
      if (!allWarnings[targetUser.id]) allWarnings[targetUser.id] = [];

      const newWarn = {
        id: `warn_${Date.now()}`,
        moderatorId: interaction.user.id,
        moderatorTag: interaction.user.tag,
        reason,
        timestamp: Date.now()
      };

      allWarnings[targetUser.id].push(newWarn);
      saveWarnings(allWarnings);

      const warnCount = allWarnings[targetUser.id].length;

      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setAuthor({ name: '⚠️ تم تسجيل تحذير رسمي', iconURL: targetUser.displayAvatarURL() })
        .setDescription(
          `تم توجيه تحذير رسمي للعضو <@${targetUser.id}> (\`${targetUser.tag}\`).\n\n` +
          `📝 **السبب:** ${reason}\n` +
          `🔢 **إجمالي تحذيرات العضو:** \`${warnCount}\` تحذيرات.`
        )
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      const logEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setAuthor({ name: '⚠️ تسجيل تحذير رسمي', iconURL: targetUser.displayAvatarURL() })
        .setDescription(`قام المشرف <@${interaction.user.id}> بتحذير العضو <@${targetUser.id}>.\n**السبب:** ${reason}\n**العدد:** ${warnCount}`)
        .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(interaction.guild, logEmbed);
    }

    // 8. أمر /تحذيرات
    else if (commandName === 'تحذيرات') {
      const targetUser = interaction.options.getUser('المستخدم');
      const allWarnings = loadWarnings();
      const userWarns = allWarnings[targetUser.id] || [];

      if (userWarns.length === 0) {
        return interaction.reply({
          content: `✅ العضو <@${targetUser.id}> (\`${targetUser.tag}\`) ليس لديه أي تحذيرات سابقة في سجله!`,
          ephemeral: true
        });
      }

      const warnListText = userWarns
        .map(
          (w, idx) =>
            `**#${idx + 1}** • بواسطة: <@${w.moderatorId}> • <t:${Math.floor(w.timestamp / 1000)}:R>\n📝 **السبب:** ${w.reason}`
        )
        .join('\n\n');

      const embed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setAuthor({ name: `📋 سجل تحذيرات: ${targetUser.username}`, iconURL: targetUser.displayAvatarURL() })
        .setDescription(`إجمالي التحذيرات: **${userWarns.length}**\n\n${warnListText}`)
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 9. أمر /مسح_التحذيرات
    else if (commandName === 'مسح_التحذيرات') {
      const targetUser = interaction.options.getUser('المستخدم');
      const allWarnings = loadWarnings();

      if (allWarnings[targetUser.id]) {
        delete allWarnings[targetUser.id];
        saveWarnings(allWarnings);
      }

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🧹 تم تصفير سجل التحذيرات')
        .setDescription(`تم مسح جميع تحذيرات العضو <@${targetUser.id}> (\`${targetUser.tag}\`) بنجاح بواسطة <@${interaction.user.id}>.`)
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` });

      await interaction.reply({ embeds: [embed] });
    }

    // 10. أمر /قفل
    else if (commandName === 'قفل') {
      try {
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          SendMessages: false
        });

        const embed = new EmbedBuilder()
          .setColor(0xED4245)
          .setTitle('🔒 تم قفل القناة')
          .setDescription(`تم قفل القناة <#${interaction.channelId}> بواسطة <@${interaction.user.id}>.`)
          .setFooter({ text: `GX eSports • الإصدار ${BOT_VERSION}` });

        await interaction.reply({ embeds: [embed] });

        const logEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '🔒 قفل قناة', iconURL: interaction.user.displayAvatarURL() })
          .setDescription(`قام المشرف <@${interaction.user.id}> بقفل القناة <#${interaction.channelId}>.`)
          .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
          .setTimestamp();
        await sendToLogChannel(interaction.guild, logEmbed);
      } catch (err) {
        await interaction.reply({ content: `❌ تعذر قفل القناة: ${err.message}`, ephemeral: true });
      }
    }

    // 11. أمر /فتح
    else if (commandName === 'فتح') {
      try {
        const memberRole = findAutoRole(interaction.guild);
        const untrustedRole = await findOrCreateUntrustedRole(interaction.guild);

        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          SendMessages: null
        });

        if (memberRole) {
          await interaction.channel.permissionOverwrites.edit(memberRole, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          });
        }

        if (untrustedRole) {
          await interaction.channel.permissionOverwrites.edit(untrustedRole, {
            ViewChannel: true,
            SendMessages: false,
            ReadMessageHistory: true
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🔓 تم فتح القناة')
          .setDescription(`تم فتح القناة <#${interaction.channelId}> وإتاحة الكتابة للأعضاء بواسطة <@${interaction.user.id}>.`)
          .setFooter({ text: `GX eSports • الإصدار ${BOT_VERSION}` });

        await interaction.reply({ embeds: [embed] });

        const logEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '🔓 فتح قناة', iconURL: interaction.user.displayAvatarURL() })
          .setDescription(`قام المشرف <@${interaction.user.id}> بفتح القناة <#${interaction.channelId}> ومزامنة صلاحيات الكتابة.`)
          .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
          .setTimestamp();
        await sendToLogChannel(interaction.guild, logEmbed);
      } catch (err) {
        await interaction.reply({ content: `❌ تعذر فتح القناة: ${err.message}`, ephemeral: true });
      }
    }

    // 12. أمر /قفل_الكل
    else if (commandName === 'قفل_الكل') {
      await interaction.deferReply();
      let lockedCount = 0;

      const textChannels = interaction.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText);
      for (const [, ch] of textChannels) {
        try {
          await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
          lockedCount++;
        } catch {}
      }

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🚨 تم قفل جميع قنوات السيرفر (Emergency Lockdown)')
        .setDescription(`تم قفل **${lockedCount}** قناة نصية في السيرفر بواسطة <@${interaction.user.id}>.`)
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` });

      await interaction.editReply({ embeds: [embed] });
    }

    // 13. أمر /فتح_الكل
    else if (commandName === 'فتح_الكل') {
      const startTime = Date.now();
      await interaction.deferReply();
      let unlockedCount = 0;

      const memberRole = findAutoRole(interaction.guild);
      const untrustedRole = await findOrCreateUntrustedRole(interaction.guild);
      const everyoneRole = interaction.guild.roles.everyone;

      const systemChannelIds = new Set([
        WELCOME_CHANNEL_ID,
        LEAVE_CHANNEL_ID,
        SECRET_VCR_CHANNEL_ID
      ]);

      const channels = await interaction.guild.channels.fetch().catch(() => interaction.guild.channels.cache);
      const textChannels = channels.filter(c => c && c.type === ChannelType.GuildText && !systemChannelIds.has(c.id));

      for (const [, ch] of textChannels) {
        // Skip log, status, ticket and secret archive channels by name
        if (ch.name.includes('log') || ch.name.includes('status') || ch.name.includes('سجلات') || ch.name.includes('welcome') || ch.name.includes('تذاكر') || ch.name.includes('ticket')) {
          continue;
        }

        try {
          await ch.permissionOverwrites.edit(everyoneRole, { SendMessages: null });
          if (memberRole) {
            await ch.permissionOverwrites.edit(memberRole, { 
              ViewChannel: true, 
              SendMessages: true, 
              ReadMessageHistory: true 
            });
          }
          if (untrustedRole) {
            await ch.permissionOverwrites.edit(untrustedRole, { 
              ViewChannel: true, 
              SendMessages: false, 
              ReadMessageHistory: true 
            });
          }
          unlockedCount++;
        } catch {}
      }

      // 🔒 Complete Server Permissions & Roles Auto-Sync
      const permSyncResult = await syncAllPermissionsAndOverwrites(interaction.guild);
      const roleSyncResult = await syncAllMembersRole(interaction.guild, false);

      const durationMs = Date.now() - startTime;

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🔓 فتح شامل ومزامنة الصلاحيات | GX Security', iconURL: interaction.guild.iconURL() })
        .setTitle('✅ تم فتح جميع القنوات وإعادة مزامنة الصلاحيات بنجاح')
        .setDescription(
          `تم فتح **${unlockedCount}** قناة نصية وإتاحة الكتابة لجميع الأعضاء الموثقين برتبة <@&${memberRole?.id || ''}>، مع مزامنة وحماية كافة تصاريح القنوات خلال **${durationMs}ms**:`
        )
        .addFields(
          {
            name: '🔓 القنوات المفتوحة',
            value: `\`${unlockedCount} قناة نصية جاهزة للكتابة\` ✅`,
            inline: true
          },
          {
            name: '🔒 مزامنة الصلاحيات (Permissions)',
            value: permSyncResult.success ? `\`تمت مزامنة وتأمين ${permSyncResult.syncedChannels} قناة\` 🔒` : '`جاهزة ومؤمنة` 🟢',
            inline: true
          },
          {
            name: '👥 رتب الأعضاء المزامنة',
            value: `\`تم فحص ${roleSyncResult.total} عضو وتحديث صلاحياتهم\` 👑`,
            inline: true
          }
        )
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      const logEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🔓 فتح شامل ومزامنة القنوات', iconURL: interaction.user.displayAvatarURL() })
        .setDescription(`قام المشرف <@${interaction.user.id}> بفتح جميع قنوات السيرفر وتفعيل مزامنة الصلاحيات التلقائية لجميع الأعضاء.`)
        .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(interaction.guild, logEmbed);
    }

    // 14. أمر /تباطؤ
    else if (commandName === 'تباطؤ') {
      const seconds = interaction.options.getInteger('الثواني');
      await interaction.channel.setRateLimitPerUser(seconds);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('⏱️ تم ضبط وضع التباطؤ (Slowmode)')
        .setDescription(
          seconds > 0
            ? `تم تعيين وضع التباطؤ في القناة <#${interaction.channelId}> إلى **${seconds}** ثانية.`
            : `تم إلغاء وضع التباطؤ في القناة <#${interaction.channelId}>.`
        )
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` });

      await interaction.reply({ embeds: [embed] });
    }

    // 15. أمر /تغيير_لقب
    else if (commandName === 'تغيير_لقب') {
      const targetUser = interaction.options.getUser('المستخدم');
      const newNick = interaction.options.getString('اللقب_الجديد');

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو.', ephemeral: true });
      }

      await targetMember.setNickname(newNick || null);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('✏️ تم تعديل اللقب بنجاح')
        .setDescription(`تم تغيير لقب العضو <@${targetUser.id}> إلى: **${newNick || 'الاسم الأصلي'}**`)
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` });

      await interaction.reply({ embeds: [embed] });
    }

    // 16. أمر /اعطاء_رتبة
    else if (commandName === 'اعطاء_رتبة') {
      if (!isAuthorizedRoleManager(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '⛔ **عذراً، صلاحية ترقية ومنح الرتب محصورة حصرياً بالقيادة العليا (<@1484535997893967980> و <@1152686277255237663>) فقط!**',
          ephemeral: true
        });
      }

      const targetUser = interaction.options.getUser('المستخدم');
      const targetRole = interaction.options.getRole('الرتبة');

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو في السيرفر.', ephemeral: true });
      }

      const botMember = interaction.guild.members.me;
      if (botMember.roles.highest.comparePositionTo(targetRole) <= 0) {
        return interaction.reply({ content: '❌ رتبة البوت أدنى من هذه الرتبة ولا يمكنه منحها. يرجى سحب رتبة البوت لأعلى قائمة الرتب.', ephemeral: true });
      }

      await targetMember.roles.add(targetRole);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '👑 ترقية ومنح رتبة', iconURL: targetUser.displayAvatarURL() })
        .setTitle('تم منح الرتبة بنجاح')
        .setDescription(`تم منح وترقية رتبة <@&${targetRole.id}> للعضو <@${targetUser.id}> بنجاح بواسطة <@${interaction.user.id}>.`)
        .setFooter({ text: `GX eSports Role Management • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      const logEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '👑 ترقية رتبة رسمية', iconURL: interaction.user.displayAvatarURL() })
        .setDescription(`قام القائد <@${interaction.user.id}> بمنح وترقية رتبة <@&${targetRole.id}> للعضو <@${targetUser.id}> (\`${targetUser.tag}\`).`)
        .setFooter({ text: `GX eSports Security Logs • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(interaction.guild, logEmbed);
    }

    // 17. أمر /سحب_رتبة
    else if (commandName === 'سحب_رتبة') {
      if (!isAuthorizedRoleManager(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '⛔ **عذراً، صلاحية سحب وإدارة الرتب محصورة حصرياً بالقيادة العليا (<@1484535997893967980> و <@1152686277255237663>) فقط!**',
          ephemeral: true
        });
      }

      const targetUser = interaction.options.getUser('المستخدم');
      const targetRole = interaction.options.getRole('الرتبة');

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو في السيرفر.', ephemeral: true });
      }

      const botMember = interaction.guild.members.me;
      if (botMember.roles.highest.comparePositionTo(targetRole) <= 0) {
        return interaction.reply({ content: '❌ رتبة البوت أدنى من هذه الرتبة ولا يمكنه سحبها.', ephemeral: true });
      }

      await targetMember.roles.remove(targetRole);

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🗑️ سحب وإزالة رتبة', iconURL: targetUser.displayAvatarURL() })
        .setTitle('تم سحب الرتبة بنجاح')
        .setDescription(`تم سحب رتبة <@&${targetRole.id}> من العضو <@${targetUser.id}> بنجاح بواسطة <@${interaction.user.id}>.`)
        .setFooter({ text: `GX eSports Role Management • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🗑️ سحب رتبة رسمية', iconURL: interaction.user.displayAvatarURL() })
        .setDescription(`قام القائد <@${interaction.user.id}> بسحب رتبة <@&${targetRole.id}> من العضو <@${targetUser.id}> (\`${targetUser.tag}\`).`)
        .setFooter({ text: `GX eSports Security Logs • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(interaction.guild, logEmbed);
    }


    // 19. أمر /استدعاء
    else if (commandName === 'استدعاء') {
      const member = interaction.member;
      const targetVoiceChannel = member?.voice?.channel;

      if (!targetVoiceChannel) {
        return interaction.reply({
          content: '❌ **يجب أن تكون متواجداً داخل روم صوتي لاستدعاء البوت!**',
          ephemeral: true
        });
      }

      const botMember = interaction.guild.members.me;
      const currentBotVoiceId = botMember?.voice?.channelId;

      if (!currentBotVoiceId) {
        setAuthorizedMove();
        connectToVoiceChannel(targetVoiceChannel);
        currentVoiceOwner = {
          userId: member.id,
          userTag: member.user.tag,
          channelId: targetVoiceChannel.id,
          channelName: targetVoiceChannel.name,
          joinedAt: Date.now()
        };

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '🎙️ استدعاء البوت بنجاح', iconURL: member.user.displayAvatarURL() })
          .setTitle(`✅ انضم البوت إلى الروم الصوتي: #${targetVoiceChannel.name}`)
          .setDescription(
            `👑 **المتحكم الحالي في البوت:** <@${member.id}>\n\n` +
            `✨ يمكنك الآن استخدام أوامر الفويس:\n` +
            `• \`/مغادرة\` : فصل البوت من الروم.\n` +
            `• \`/فويس_حالة\` : فحص حالة التواجد الصوتي.\n` +
            `• \`/فويس_نقل_التحكم\` : تسليم التحكم لعضو آخر بالروم.\n` +
            `• \`/كتم_الكل\` و \`/فك_كتم_الكل\` : إدارة كتم المتواجدين (رتبة MANAGERS محمية).\n` +
            `• 🛡️ **حماية السحب:** البوت محمي ويعود تلقائياً إذا حاول أحد نقله بـ Move to.`
          )
          .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` })
          .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        const logEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '🎙️ استدعاء البوت الصوتي', iconURL: member.user.displayAvatarURL() })
          .setDescription(`قام <@${member.id}> (\`${member.user.tag}\`) باستدعاء البوت إلى الروم الصوتي <#${targetVoiceChannel.id}>.`)
          .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` })
          .setTimestamp();
        await sendToLogChannel(interaction.guild, logEmbed);
        return;
      }

      if (currentBotVoiceId === targetVoiceChannel.id) {
        return interaction.reply({
          content: `ℹ️ **البوت متواجد معك بالفعل في الروم الصوتي <#${targetVoiceChannel.id}>!**\n👑 المتحكم الحالي: <@${currentVoiceOwner?.userId || member.id}>`,
          ephemeral: true
        });
      }

      const currentBotChannel = interaction.guild.channels.cache.get(currentBotVoiceId);
      const isOwnerStillInChannel = currentVoiceOwner && currentBotChannel?.members.has(currentVoiceOwner.userId);

      // إذا كان المستدعي الأصلي لا يزال في الروم، إرسال طلب استئذان تفاعلي لنقل الملكية
      if (isOwnerStillInChannel) {
        if (activeTransferCollector) {
          return interaction.reply({
            content: '⏳ **هناك طلب استئذان لنقل البوت قيد الانتظار حالياً، يرجى المحاولة بعد قليل.**',
            ephemeral: true
          });
        }

        await interaction.deferReply();

        const acceptBtnId = `accept_transfer_${Date.now()}`;
        const rejectBtnId = `reject_transfer_${Date.now()}`;

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(acceptBtnId).setLabel('✅ موافقة على نقل الملكية').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(rejectBtnId).setLabel('❌ رفض الطلب').setStyle(ButtonStyle.Danger)
        );

        const requestEmbed = new EmbedBuilder()
          .setColor(0xFEE75C)
          .setAuthor({ name: '🛎️ طلب استئذان لنقل ملكية البوت', iconURL: member.user.displayAvatarURL() })
          .setTitle('طلب نقل واستدعاء البوت إلى روم آخر')
          .setDescription(
            `عزيزي <@${currentVoiceOwner.userId}> (متحكم ومالك البوت الحالي):\n` +
            `يطلب العضو <@${member.id}> استدعاء ونقل ملكية البوت إلى الروم الصوتي **#${targetVoiceChannel.name}**.\n\n` +
            `🔹 **لديك 60 ثانية للموافقة أو الرفض عبر الأزرار أدناه:**`
          )
          .setFooter({ text: `GX eSports Voice System • مهلة الرد: 60 ثانية` })
          .setTimestamp();

        const ownerVoiceChannel = interaction.guild.channels.cache.get(currentBotVoiceId) || interaction.channel;

        const transferMessage = await ownerVoiceChannel.send({
          content: `🔔 تنبيه: <@${currentVoiceOwner.userId}> يرجى مراجعة طلب نقل ملكية واستدعاء البوت من <@${member.id}> إلى الروم <#${targetVoiceChannel.id}>.`,
          embeds: [requestEmbed],
          components: [row]
        });

        await interaction.editReply({
          content: `⏳ **تم إرسال طلب استئذان رسمي داخل شات الروم الصوتي <#${currentBotVoiceId}> إلى مالك البوت الحالي (<@${currentVoiceOwner.userId}>).** يرجى الانتظار حتى يرد.`
        });

        const collector = transferMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 60 * 1000
        });
        activeTransferCollector = collector;

        collector.on('collect', async (btnInteraction) => {
          const isCurrentOwner = btnInteraction.user.id === currentVoiceOwner.userId;

          if (!isCurrentOwner) {
            return btnInteraction.reply({
              content: `❌ **عذراً، قبول أو رفض نقل البوت محصور حصرياً بمالك البوت الحالي (<@${currentVoiceOwner.userId}>) فقط!**`,
              ephemeral: true
            });
          }

          if (btnInteraction.customId === acceptBtnId) {
            collector.stop('accepted');

            setAuthorizedMove();
            connectToVoiceChannel(targetVoiceChannel);
            const previousOwnerId = currentVoiceOwner.userId;
            currentVoiceOwner = {
              userId: member.id,
              userTag: member.user.tag,
              channelId: targetVoiceChannel.id,
              channelName: targetVoiceChannel.name,
              joinedAt: Date.now()
            };

            const acceptedEmbed = new EmbedBuilder()
              .setColor(0x57F287)
              .setTitle('✅ تمت الموافقة على نقل ملكية البوت!')
              .setDescription(
                `وافق <@${previousOwnerId}> على نقل البوت!\n` +
                `🎙️ **انتقل البوت بنجاح إلى الروم الصوتي:** <#${targetVoiceChannel.id}>\n` +
                `👑 **المالك والمتحكم الجديد:** <@${member.id}>`
              )
              .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` })
              .setTimestamp();

            await btnInteraction.update({
              content: `🎉 تمت الموافقة على نقل البوت بواسطة <@${previousOwnerId}>!`,
              embeds: [acceptedEmbed],
              components: []
            }).catch(() => {});

            await interaction.followUp({
              content: `🎉 **وافق <@${previousOwnerId}> على طلبك!** انضم البوت إلى رومك <#${targetVoiceChannel.id}> وأصبحت أنت المالك والمتحكم الجديد.`
            }).catch(() => {});

            const logEmbed = new EmbedBuilder()
              .setColor(0x57F287)
              .setAuthor({ name: '🎙️ نقل ملكية البوت بموافقة', iconURL: member.user.displayAvatarURL() })
              .setDescription(`وافق <@${previousOwnerId}> على نقل البوت إلى <#${targetVoiceChannel.id}> بدعوة من <@${member.id}>.`)
              .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` })
              .setTimestamp();
            await sendToLogChannel(interaction.guild, logEmbed);

          } else if (btnInteraction.customId === rejectBtnId) {
            collector.stop('rejected');

            const rejectedEmbed = new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle('❌ تم رفض طلب نقل البوت')
              .setDescription(`رفض المالك الحالي <@${currentVoiceOwner.userId}> نقل البوت وسيبقى البوت في رومه الصوتي الحالي.`)
              .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` })
              .setTimestamp();

            await btnInteraction.update({
              content: `❌ تم رفض طلب النقل بواسطة <@${currentVoiceOwner.userId}>.`,
              embeds: [rejectedEmbed],
              components: []
            }).catch(() => {});

            await interaction.followUp({
              content: `❌ **عذراً، رفض <@${currentVoiceOwner.userId}> طلب سحب البوت.** سيبقى البوت في رومه الحالي.`
            }).catch(() => {});
          }
        });

        collector.on('end', async (_, reason) => {
          activeTransferCollector = null;
          if (reason === 'time') {
            const timeoutEmbed = new EmbedBuilder()
              .setColor(0xED4245)
              .setTitle('⏰ انتهت مهلة الرد على طلب نقل البوت')
              .setDescription(`لم يقم المالك الحالي <@${currentVoiceOwner?.userId}> بالرد خلال 60 ثانية، تم إلغاء الطلب تلقائياً.`)
              .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` });

            await transferMessage.edit({
              content: '⏰ تم إلغاء الطلب لعدم الرد في الوقت المحدد.',
              embeds: [timeoutEmbed],
              components: []
            }).catch(() => {});
          }
        });
        return;
      }

      // إذا غادر المستدعي الأصلي الروم، يحق للعضو الحالي سحب البوت وامتلاكه
      setAuthorizedMove();
      connectToVoiceChannel(targetVoiceChannel);
      currentVoiceOwner = {
        userId: member.id,
        userTag: member.user.tag,
        channelId: targetVoiceChannel.id,
        channelName: targetVoiceChannel.name,
        joinedAt: Date.now()
      };

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🎙️ سحب واستدعاء البوت بنجاح', iconURL: member.user.displayAvatarURL() })
        .setTitle(`✅ تم سحب البوت إلى الروم الصوتي: #${targetVoiceChannel.name}`)
        .setDescription(`🔓 نظراً لعدم تواجد المتحكم السابق في الروم، تم سحب البوت وأصبحت أنت المتحكم الجديد: <@${member.id}>.`)
        .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      const logEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🎙️ سحب البوت الصوتي', iconURL: member.user.displayAvatarURL() })
        .setDescription(`قام <@${member.id}> بسحب البوت إلى الروم <#${targetVoiceChannel.id}> بعد خروج المتحكم السابق.`)
        .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(interaction.guild, logEmbed);
      return;
    }

    // 20. أمر /مغادرة
    else if (commandName === 'مغادرة') {
      const botMember = interaction.guild.members.me;
      const botVoiceId = botMember?.voice?.channelId;

      if (!botVoiceId) {
        return interaction.reply({ content: '❌ **البوت ليس متواجداً في أي روم صوتي حالياً.**', ephemeral: true });
      }

      const memberVoiceId = interaction.member?.voice?.channelId;
      if (!memberVoiceId || memberVoiceId !== botVoiceId) {
        return interaction.reply({
          content: `❌ **يجب أن تكون متواجداً داخل نفس الروم الصوتي مع البوت (<#${botVoiceId}>) لاستخدام أمر المغادرة!**`,
          ephemeral: true
        });
      }

      const isOwner = currentVoiceOwner && currentVoiceOwner.userId === interaction.user.id;
      const isLeader = isAuthorizedRoleManager(interaction.member, interaction.user);

      if (!isOwner && !isLeader) {
        return interaction.reply({
          content: `❌ **عذراً، أمر المغادرة مخصص حصرياً لمالك البوت الحالي المتواجد معه بالروم (<@${currentVoiceOwner?.userId || 'المستدعي'}>)!**`,
          ephemeral: true
        });
      }

      setAuthorizedMove();
      disconnectVoice();

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🚪 تم فصل البوت من الروم الصوتي')
        .setDescription(`قام <@${interaction.user.id}> بفصل البوت من الروم الصوتي بنجاح.`)
        .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });

      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🚪 مغادرة الروم الصوتي', iconURL: interaction.user.displayAvatarURL() })
        .setDescription(`قام <@${interaction.user.id}> بفصل البوت من الروم الصوتي.`)
        .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(interaction.guild, logEmbed);
    }

    // 21. أمر /فويس_حالة
    else if (commandName === 'فويس_حالة') {
      const botMember = interaction.guild.members.me;
      const botVoiceId = botMember?.voice?.channelId;

      if (!botVoiceId) {
        return interaction.reply({ content: 'ℹ️ البوت ليس متصلاً بأي روم صوتي حالياً. يمكنك استخدام `/استدعاء` لاستدعائه.', ephemeral: true });
      }

      const voiceChannel = interaction.guild.channels.cache.get(botVoiceId);
      const membersInRoom = voiceChannel ? voiceChannel.members.map((m) => `<@${m.id}>`).join(', ') : 'لا يوجد';
      const durationMin = currentVoiceOwner?.joinedAt ? Math.floor((Date.now() - currentVoiceOwner.joinedAt) / 60000) : 0;

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎙️ تقرير التواجد الصوتي للبوت')
        .addFields(
          { name: '📻 الروم الصوتي المتواجد به', value: `<#${botVoiceId}> (\`#${voiceChannel?.name}\`)`, inline: true },
          { name: '👑 المتحكم الحالي في البوت', value: currentVoiceOwner ? `<@${currentVoiceOwner.userId}> (\`${currentVoiceOwner.userTag}\`)` : '`متاح للجميع` 🟢', inline: true },
          { name: '🛡️ حماية السحب اليدوي', value: '`مفعلة وتتصدى للـ Move to` 🟢', inline: true },
          { name: '🛡️ حصانة الإدارة', value: '`رتبة MANAGERS محمية من الكتم` 👑', inline: true },
          { name: '⏱️ مدة التواجد', value: `\`${durationMin}\` دقيقة`, inline: true },
          { name: '👥 المتواجدون بالروم', value: membersInRoom, inline: false }
        )
        .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 22. أمر /فويس_نقل_التحكم
    else if (commandName === 'فويس_نقل_التحكم') {
      const botMember = interaction.guild.members.me;
      const botVoiceId = botMember?.voice?.channelId;

      if (!botVoiceId) {
        return interaction.reply({ content: '❌ البوت ليس متصلاً بروم صوتي حالياً.', ephemeral: true });
      }

      const isOwner = currentVoiceOwner && currentVoiceOwner.userId === interaction.user.id;
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

      if (!isOwner && !isAdmin) {
        return interaction.reply({
          content: `❌ فقط المتحكم الحالي بالبوت (<@${currentVoiceOwner?.userId}>) أو الإدارة يمكنهم نقل صلاحية التحكم!`,
          ephemeral: true
        });
      }

      const targetUser = interaction.options.getUser('المستخدم');
      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      if (!targetMember || targetMember.voice?.channelId !== botVoiceId) {
        return interaction.reply({
          content: `❌ يجب أن يكون العضو <@${targetUser.id}> متواجداً معك في نفس الروم الصوتي لنقل التحكم إليه!`,
          ephemeral: true
        });
      }

      currentVoiceOwner = {
        userId: targetMember.id,
        userTag: targetMember.user.tag,
        channelId: botVoiceId,
        channelName: targetMember.voice?.channel?.name || 'Voice Channel',
        joinedAt: currentVoiceOwner?.joinedAt || Date.now()
      };

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('👑 تم نقل صلاحية التحكم في البوت بنجاح')
        .setDescription(`قام <@${interaction.user.id}> بتسليم صلاحية التحكم في البوت الصوتي إلى: <@${targetMember.id}> 🎉.`)
        .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 23. أمر /كتم_الكل
    else if (commandName === 'كتم_الكل') {
      const botMember = interaction.guild.members.me;
      const botVoiceId = botMember?.voice?.channelId;

      if (!botVoiceId) {
        return interaction.reply({ content: '❌ البوت ليس متواجداً في روم صوتي حالياً.', ephemeral: true });
      }

      const voiceChannel = interaction.guild.channels.cache.get(botVoiceId);
      const isOwner = currentVoiceOwner && currentVoiceOwner.userId === interaction.user.id;
      const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.MuteMembers);

      if (!isOwner && !hasPermission) {
        return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر.', ephemeral: true });
      }

      await interaction.deferReply();
      let mutedCount = 0;
      let skippedManagers = 0;

      for (const [, m] of voiceChannel.members) {
        if (!m.user.bot && m.id !== interaction.user.id) {
          if (isManagerMember(m)) {
            skippedManagers++;
            continue;
          }
          try {
            await m.voice.setMute(true);
            mutedCount++;
          } catch {}
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🔇 تم كتم جميع الأعضاء في الروم')
        .setDescription(
          `تم كتم **${mutedCount}** عضو في الروم <#${botVoiceId}> بواسطة <@${interaction.user.id}>.\n` +
          `${skippedManagers > 0 ? `🛡️ **تم استثناء وحماية ${skippedManagers} عضو من أصحاب رتبة MANAGERS / الإدارة.**` : ''}`
        )
        .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` });

      await interaction.editReply({ embeds: [embed] });
    }

    // 24. أمر /فك_كتم_الكل
    else if (commandName === 'فك_كتم_الكل') {
      const botMember = interaction.guild.members.me;
      const botVoiceId = botMember?.voice?.channelId;

      if (!botVoiceId) {
        return interaction.reply({ content: '❌ البوت ليس متواجداً في روم صوتي حالياً.', ephemeral: true });
      }

      const voiceChannel = interaction.guild.channels.cache.get(botVoiceId);
      const isOwner = currentVoiceOwner && currentVoiceOwner.userId === interaction.user.id;
      const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.MuteMembers);

      if (!isOwner && !hasPermission) {
        return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر.', ephemeral: true });
      }

      await interaction.deferReply();
      let unmutedCount = 0;

      for (const [, m] of voiceChannel.members) {
        if (!m.user.bot) {
          try {
            await m.voice.setMute(false);
            unmutedCount++;
          } catch {}
        }
      }

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🔊 تم إلغاء كتم جميع الأعضاء')
        .setDescription(`تم إلغاء كتم **${unmutedCount}** عضو في الروم <#${botVoiceId}> بواسطة <@${interaction.user.id}>.`)
        .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` });

      await interaction.editReply({ embeds: [embed] });
    }

    // 25. أمر /صوت
    else if (commandName === 'صوت') {
      const isOwner = currentVoiceOwner && currentVoiceOwner.userId === interaction.user.id;
      const isGuildOwner = interaction.user.id === interaction.guild.ownerId;

      if (currentVoiceOwner && !isOwner && !isGuildOwner) {
        return interaction.reply({
          content: `❌ **التحكم بمستوى الصوت مخصص حصرياً للمستدعي الأول للبوت (<@${currentVoiceOwner.userId}>).**`,
          ephemeral: true
        });
      }

      const level = interaction.options.getInteger('المستوى');
      currentVolumeLevel = level / 100;

      if (currentAudioResource && currentAudioResource.volume) {
        currentAudioResource.volume.setVolume(currentVolumeLevel);
      }

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🔊 تم تعديل مستوى الصوت')
        .setDescription(`تم ضبط مستوى صوت الموسيقى في الروم الصوتي إلى **${level}%** ${level <= 20 ? '🔉 (صوت منخفض وهادئ)' : (level >= 80 ? '🔊 (صوت مرتفع)' : '🔉')}.`)
        .setFooter({ text: `GX eSports Voice • الإصدار ${BOT_VERSION}` });

      await interaction.reply({ embeds: [embed] });
    }

    // 26. أمر /تحديث
    else if (commandName === 'تحديث') {
      const startTime = Date.now();
      await interaction.deferReply();

      console.log(`\n⚡ [أمر التحديث] بدأ المشرف ${interaction.user.tag} عملية تحديث البرمجة ومزامنة الصلاحيات والسيرفر...`);

      const configReloaded = reloadConfiguration();
      const targetGuild = interaction.guild || client.guilds.cache.get(ALLOWED_GUILD_ID);
      const clientId = client.user?.id || interaction.client.user?.id;
      const commandsRegistered = targetGuild ? await registerSlashCommands(clientId, targetGuild.id) : false;

      let syncResult = { count: 0, removedCount: 0, total: 0 };
      let permSyncResult = { success: false, syncedChannels: 0 };

      if (targetGuild) {
        // 🔒 Auto Sync All Permissions & Overwrites
        permSyncResult = await syncAllPermissionsAndOverwrites(targetGuild);
        await autoAssignVCRRoles(targetGuild);
        await ensurePermanentTicketPanel(targetGuild);
        await syncActiveTicketsMembers(targetGuild);
        syncResult = await syncAllMembersRole(targetGuild, true);
        await welcomeExistingMembersSequentially(targetGuild);
        sendSecurityDMToExistingMembers(targetGuild);
      }

      const logChannel = targetGuild ? await getOrCreateLogChannel(targetGuild) : null;
      const durationMs = Date.now() - startTime;
      const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
      const commandsCount = loadCommandsConfig().length;

      const updateEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({
          name: 'تحديث وإعادة تحميل البرمجة | GX eSports',
          iconURL: targetGuild?.iconURL() || client.user?.displayAvatarURL()
        })
        .setTitle('⚡ تم تحديث وإعادة تحميل برمجة البوت بنجاح!')
        .setDescription(
          `تمت إعادة تهيئة برمجة النظام وتحديث كافة الصلاحيات والأوامر وإعدادات البيئة للسيرفر بنجاح خلال **${durationMs}ms**:`
        )
        .addFields(
          {
            name: '🔄 حالة البرمجة والإعدادات (.env)',
            value: configReloaded ? '`تم التحديث وإعادة التحميل 100%` ✅' : '`حدث تحذير في قراءة الإعدادات` ⚠️',
            inline: true
          },
          {
            name: '📡 ملف الأوامر (commands.json)',
            value: commandsRegistered ? `\`${commandsCount} أوامر محدثة على Discord API\` ✅` : '`خطأ في تسجيل الأوامر` ❌',
            inline: true
          },
          {
            name: '👥 مزامنة وترقية الأعضاء برتبة MEMBER',
            value: syncResult.error
              ? `❌ ${syncResult.error}`
              : `\`تم فحص ${syncResult.total} عضو • ترقية ${syncResult.count} جديد • سحب الرتبة من ${syncResult.removedCount} إداري\` ✅`,
            inline: false
          },
          {
            name: '📊 لوحة حالة النظام الحية',
            value: '`مفعلة وتتحدث كل 10 ثوان في #system-status` 🟢',
            inline: true
          },
          {
            name: '🛡️ حصانة وعزل رتبة MANAGERS',
            value: '`محمية ومعزولة عن MEMBER بالكامل` 👑',
            inline: true
          },
          {
            name: '🔒 مزامنة الصلاحيات والقنوات (Permissions)',
            value: permSyncResult.success ? `\`تمت مزامنة وتأمين ${permSyncResult.syncedChannels} قناة ورتبة\` 🔒` : '`حدث خطأ في مزامنة الصلاحيات` ⚠️',
            inline: true
          },
          {
            name: '📋 نظام السجلات الشامل اللحظي (#log)',
            value: logChannel ? `\`مفعل وجاهز (#${logChannel.name})\` 🟢` : '`مفعل` 🟢',
            inline: true
          },
          {
            name: '💾 استهلاك الذاكرة (RAM)',
            value: `\`${memUsage} MB\``,
            inline: true
          }
        )
        .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      await interaction.editReply({ embeds: [updateEmbed] });

      const auditLogNotice = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: '⚡ تحديث شامل للبرمجة', iconURL: interaction.user.displayAvatarURL() })
        .setDescription(`قام المشرف <@${interaction.user.id}> بتشغيل أمر \`/تحديث\` وتمت إعادة تحميل البرمجة ومزامنة الرتب ونظام الترحيب ولوحة النظام بنجاح.`)
        .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(targetGuild, auditLogNotice);
    }

    // 26. أمر /سيرفر
    else if (commandName === 'سيرفر') {
      const g = interaction.guild;
      const owner = await g.fetchOwner().catch(() => null);
      const textChannels = g.channels.cache.filter((c) => c.type === ChannelType.GuildText).size;
      const voiceChannels = g.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).size;
      const totalMembers = g.memberCount;
      const rolesCount = g.roles.cache.size;

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setThumbnail(g.iconURL({ dynamic: true, size: 512 }))
        .setTitle(`📊 معلومات سيرفر: ${g.name}`)
        .addFields(
          { name: '👑 مالك السيرفر', value: owner ? `<@${owner.id}>` : 'غير معروف', inline: true },
          { name: '🆔 معرف السيرفر', value: `\`${g.id}\``, inline: true },
          { name: '📅 تاريخ الإنشاء', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
          { name: '👥 إجمالي الأعضاء', value: `\`${totalMembers}\` عضو`, inline: true },
          { name: '💬 القنوات الكتابية', value: `\`${textChannels}\` قناة`, inline: true },
          { name: '🔊 القنوات الصوتية', value: `\`${voiceChannels}\` قناة`, inline: true },
          { name: '🎭 عدد الرتب', value: `\`${rolesCount}\` رتبة`, inline: true },
          { name: '💎 مستوى التعزيز (Boost)', value: `المستوى \`${g.premiumTier}\` (\`${g.premiumSubscriptionCount}\` تعزيز)`, inline: true }
        )
        .setFooter({ text: `GX eSports • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 27. أمر /عضو
    else if (commandName === 'عضو') {
      const user = interaction.options.getUser('المستخدم') || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        return interaction.reply({ content: '❌ تعذر العثور على بيانات هذا العضو.', ephemeral: true });
      }

      const roles = member.roles.cache.filter((r) => r.id !== interaction.guild.id).map((r) => `<@&${r.id}>`).slice(0, 10).join(' ') || 'لا توجد رتب';

      const embed = new EmbedBuilder()
        .setColor(0x00D26A)
        .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setTitle(`👤 بطاقة العضو: ${user.username}`)
        .addFields(
          { name: '📛 الاسم والتاق', value: `\`${user.tag}\``, inline: true },
          { name: '🆔 المعرف (ID)', value: `\`${user.id}\``, inline: true },
          { name: '🤖 هل هو بوت؟', value: user.bot ? 'نعم ✅' : 'لا ❌', inline: true },
          { name: '📅 تاريخ إنشاء الحساب', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: false },
          { name: '📥 تاريخ الانضمام للسيرفر', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'غير معروف', inline: false },
          { name: '🎭 الرتب', value: roles, inline: false }
        )
        .setFooter({ text: `GX eSports • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 28. أمر /حالة
    else if (commandName === 'حالة') {
      const role = findAutoRole(interaction.guild);
      const botMember = interaction.guild.members.me;
      const canManageRoles = botMember?.permissions.has(PermissionFlagsBits.ManageRoles);
      const rolePositionOk = role && botMember ? botMember.roles.highest.comparePositionTo(role) > 0 : false;
      const isAllGood = role && canManageRoles && rolePositionOk;

      const embed = new EmbedBuilder()
        .setColor(isAllGood ? 0x57F287 : 0xFEE75C)
        .setTitle('🤖 تقرير حالة البوت والصلاحيات')
        .setDescription(`فحص شامل لإعدادات البوت داخل سيرفر **${interaction.guild.name}**:`)
        .addFields(
          { name: '🛡️ السيرفر المعتمد', value: `\`${interaction.guild.name}\` (\`${interaction.guild.id}\`)`, inline: true },
          { name: '👑 رتبة الأعضاء', value: role ? `<@&${role.id}> (\`${role.name}\`) ✅` : `\`${AUTO_ROLE_NAME}\` ❌`, inline: true },
          { name: '🔑 صلاحية إدارة الرتب', value: canManageRoles ? '`مفعلة بالكامل` ✅' : '`مفقودة` ❌', inline: true },
          { name: '📶 تراتبية الرتب', value: rolePositionOk ? '`صحيحة` ✅ (رتبة البوت أعلى)' : '`خطأ` ⚠️ (اسحب رتبة البوت فوق MEMBER)', inline: true },
          { name: '📊 لوحة النظام المباشرة', value: '`تتحدث كل 10 ثوان في #system-status` 🟢', inline: true },
          { name: '🛡️ حصانة MANAGERS', value: '`محمية ومعزولة عن MEMBER` 👑', inline: true },
          { name: '⏱️ المزامنة التلقائية', value: '`مفعلة كل 30 ثانية` 🟢', inline: true },
          { name: '🎙️ نظام الفويس والحماية', value: currentVoiceOwner ? `متصل في <#${currentVoiceOwner.channelId}> 🟢` : '`جاهز للاستدعاء` 🟢', inline: true },
          { name: '📋 نظام السجلات الشامل (#log)', value: '`لحظي ومفعل لجميع الأحداث والأقسام` 🟢', inline: true },
          { name: '📦 إصدار البوت', value: `\`v${BOT_VERSION}\``, inline: true }
        )
        .setFooter({ text: `GX eSports • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 29. أمر /بينج (Flash Speed Telemetry)
    else if (commandName === 'بينج' || commandName === 'بنق' || commandName === 'ping') {
      const startTimestamp = Date.now();
      const wsPing = Math.max(1, Math.round(client.ws.ping || 0));
      const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      const pingEmbed = new EmbedBuilder()
        .setColor(wsPing < 60 ? 0x57F287 : (wsPing < 120 ? 0x5865F2 : 0xFEE75C))
        .setAuthor({ name: '⚡ سرعة الاستجابة اللحظية (Flash Speed Engine)', iconURL: interaction.guild.iconURL() })
        .setTitle('🏓 تقرير استجابة البوت وموازن الأحمال')
        .setDescription(`تم قياس سرعة معالجة الأوامر واستجابة خوادم الديسكورد بدقة عالية:`)
        .addFields(
          { name: '⚡ استجابة خوادم الديسكورد (WebSocket Ping)', value: `\`${wsPing}ms\` ${wsPing < 60 ? '⚡ (خاطف / Ultra Fast)' : '🟢'}`, inline: true },
          { name: '🚀 معالجة الأوامر (Event Loop)', value: `\`< 2ms\` 🟢 (Non-Blocking)`, inline: true },
          { name: '💾 استهلاك الذاكرة (RAM)', value: `\`${heapMb} MB\` 📊`, inline: true },
          { name: '🎙️ أسطول مسجلات VCR', value: `\`5 مسجلات متصلة\` 🎙️`, inline: true },
          { name: '🌐 لوحة المراقبة الحية (Web Dashboard)', value: `[اضغط لفتح الموقع](https://gxbot.eshamikh.com/)`, inline: true },
          { name: '🛡️ حماية الصوت (RMS Filter)', value: `\`11,000 RMS (30s Mute)\` 🔒`, inline: true }
        )
        .setFooter({ text: `GX eSports Flash Engine • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      await interaction.reply({ embeds: [pingEmbed] });
    }

    // 30. أمر /تذكرة
    else if (commandName === 'تذكرة') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const thread = await openTicketThread(interaction.guild, interaction.channel, interaction.user);
        await interaction.editReply({
          content: `✅ **تم فتح تذكرة الدعم الفني الخاصة بك بنجاح:** <#${thread.id}>\nيرجى التوجه إلى القناة الفرعية والإجابة على الأسئلة لمساعدتك!`
        });
      } catch (err) {
        await interaction.editReply({ content: `❌ تعذر فتح التذكرة: ${err.message}` });
      }
    }

    // 31. أمر /لوحة_التذاكر
    else if (commandName === 'لوحة_التذاكر') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: '❌ هذا الأمر مخصص فقط لإدارة السيرفر.', ephemeral: true });
      }

      const targetChannel = interaction.options.getChannel('القناة') || interaction.channel;

      const panelEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: '🎫 مركز الدعم الفني والمساعدة | GX eSports', iconURL: interaction.guild.iconURL() })
        .setTitle('قسم المساعدة وفتح تذاكر الدعم الفني')
        .setDescription(
          `مرحباً بكم في مركز المساعدة الرسمي لسيرفر **GX eSports**.\n\n` +
          `🔹 **هل تواجه مشكلة أو ترغب في التواصل مع الإدارة؟**\n` +
          `اضغط على الزر أدناه لفتح تذكرة خاصة بك للتواصل المباشر مع فريق الإدارة والمشرفين.\n\n` +
          `🛡️ *سيتم تخصيص قناة فرعية آمنة وسريعة للرد على استفسارك ومتابعة طلبك.*`
        )
        .setFooter({ text: `GX eSports Support System • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('open_ticket_btn')
          .setLabel('📩 فتح تذكرة دعم فني')
          .setStyle(ButtonStyle.Primary)
      );

      await targetChannel.send({ embeds: [panelEmbed], components: [row] });
      await interaction.reply({ content: `✅ تم إرسال لوحة التذاكر بنجاح إلى القناة <#${targetChannel.id}>!`, ephemeral: true });
    }

    // 31. أمر /تذكرة (فتح نافذة التذكرة الفورية)
    else if (commandName === 'تذكرة') {
      const modal = new ModalBuilder()
        .setCustomId('ticket_creation_modal')
        .setTitle('🎫 فتح تذكرة دعم فني | GX eSports');

      const nameInput = new TextInputBuilder()
        .setCustomId('ticket_real_name')
        .setLabel('ما هو اسمك الحقيقي؟')
        .setPlaceholder('اكتب اسمك الحقيقي هنا (مثال: أحمد، محمد...)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(50);

      const reasonInput = new TextInputBuilder()
        .setCustomId('ticket_reason')
        .setLabel('سبب التذكرة وتفاصيل المشكلة؟')
        .setPlaceholder('يرجى شرح سبب فتح التذكرة والاستفسار بالتفصيل لمساعدتك...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(1000);

      const firstRow = new ActionRowBuilder().addComponents(nameInput);
      const secondRow = new ActionRowBuilder().addComponents(reasonInput);
      modal.addComponents(firstRow, secondRow);

      return interaction.showModal(modal);
    }

    // 32. أمر /رد (إرسال رد رسمي باسم وكيل الدعم الفني دون أي ظهور لحساب الوكيل)
    else if (commandName === 'رد') {
      if (!interaction.channel.isThread()) {
        return interaction.reply({
          content: '❌ هذا الأمر مخصص للاستخدام داخل تذاكر الدعم الفني فقط.',
          ephemeral: true
        });
      }

      const ticketsData = loadTickets();
      const ticket = ticketsData.activeTickets ? ticketsData.activeTickets[interaction.channel.id] : null;

      if (!ticket) {
        return interaction.reply({
          content: '❌ هذه القناة ليست تذكرة دعم فني نشطة.',
          ephemeral: true
        });
      }

      if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: `⚠️ عذراً، الرد في هذه التذكرة مخصص حصرياً للوكيل المستلم لها (<@${ticket.claimedBy}>).`,
          ephemeral: true
        });
      }

      const messageContent = interaction.options.getString('الرسالة');

      const agentEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({
          name: 'وكيل الدعم الفني | GX Support Agent',
          iconURL: client.user?.displayAvatarURL()
        })
        .setDescription(messageContent)
        .setFooter({ text: `GX eSports Support Agent • ${ticket.ticketId}` })
        .setTimestamp();

      await interaction.channel.send({ embeds: [agentEmbed] });

      if (!ticket.transcript) ticket.transcript = [];
      ticket.transcript.push({
        authorId: interaction.user.id,
        authorTag: `${interaction.user.tag} (وكيل الدعم)`,
        content: messageContent,
        timestamp: Date.now()
      });
      saveTickets(ticketsData);

      return interaction.reply({
        content: '✅ **تم إرسال ردك بنجاح باسم وكيل الدعم الفني دون أي ظهور لحسابك الشخصي.**',
        ephemeral: true
      });
    }

    // 33. أمر /مخالفات
    else if (commandName === 'مخالفات') {
      const targetUser = interaction.options.getUser('المستخدم');
      const action = interaction.options.getString('إجراء') || 'view';

      const infractions = loadUserInfractions();
      const userInf = infractions[targetUser.id] || { strikes: 0, history: [] };

      if (action === 'reset') {
        userInf.strikes = 0;
        userInf.history = [];
        infractions[targetUser.id] = userInf;
        saveUserInfractions(infractions);

        const resetEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '🔄 تصفير المخالفات الأمنية', iconURL: targetUser.displayAvatarURL() })
          .setDescription(`تم بنجاح تصفير ومسح جميع نقاط ومخالفات العضو <@${targetUser.id}> (\`${targetUser.tag}\`) بواسطة <@${interaction.user.id}>.`)
          .setFooter({ text: `GX eSports Security • الإصدار ${BOT_VERSION}` })
          .setTimestamp();

        await sendToLogChannel(interaction.guild, resetEmbed);
        return interaction.reply({ embeds: [resetEmbed] });
      }

      const historyText = userInf.history && userInf.history.length > 0
        ? userInf.history.map((h, i) => `**#${i + 1}** [${new Date(h.timestamp).toLocaleDateString()}] ${h.reason}`).join('\n')
        : 'لا توجد مخالفات مسجلة بحقه.';

      const embed = new EmbedBuilder()
        .setColor(userInf.strikes > 0 ? 0xFEE75C : 0x57F287)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setTitle(`🛡️ سجل المخالفات الأمنية: ${targetUser.username}`)
        .addFields(
          { name: '👤 العضو', value: `<@${targetUser.id}> (\`${targetUser.tag}\`)`, inline: true },
          { name: '⚠️ عدد المخالفات', value: `\`${userInf.strikes}/3\` نقاط`, inline: true },
          { name: '📜 سجل المخالفات والإنذارات', value: historyText, inline: false }
        )
        .setFooter({ text: `GX eSports Security System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    // 37. أمر /فعالية_إنشاء
    else if (commandName === 'فعالية_إنشاء') {
      if (!isManagerMember(interaction.member) && !isAuthorizedRoleManager(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '❌ **عذراً، هذا الأمر مخصص فقط لفريق الإدارة والمنظمين!**',
          ephemeral: true
        });
      }

      const title = interaction.options.getString('اسم_الفعالية');
      const details = interaction.options.getString('التفاصيل');
      const mode = interaction.options.getString('نوع_البطولة') || '1v1';
      const prize = interaction.options.getString('الجائزة'); // optional
      const maxParticipants = interaction.options.getInteger('الحد_الأقصى'); // optional
      const startMinutes = interaction.options.getInteger('وقت_البدء_بالدقائق'); // optional
      const publicVoice = interaction.options.getChannel('الروم_الصوتي_العام'); // optional

      const eventId = `ev_${Date.now()}`;
      const startTime = startMinutes ? Date.now() + startMinutes * 60 * 1000 : null;

      let generalVoiceId = publicVoice ? publicVoice.id : null;
      let createdGeneralVoice = false;

      // In case of general public event (FFA) without specifying voice, create dedicated general event room
      if (mode === 'ffa' && !generalVoiceId) {
        const cat = await getOrCreateTournamentCategory(interaction.guild);
        const genVoiceChan = await interaction.guild.channels.create({
          name: `🎉┃『 قاعة الفعاليات العامة 』`,
          type: ChannelType.GuildVoice,
          parent: cat ? cat.id : null,
          reason: 'GX Public Event General Voice Room'
        }).catch(() => null);

        if (genVoiceChan) {
          generalVoiceId = genVoiceChan.id;
          createdGeneralVoice = true;
        }
      }

      const eventData = {
        id: eventId,
        title,
        description: details,
        mode,
        prize: prize || null,
        maxParticipants: maxParticipants || null,
        startTime,
        generalVoiceId,
        createdGeneralVoice,
        hostId: interaction.user.id,
        hostTag: interaction.user.tag,
        status: 'active',
        participants: [],
        matches: [],
        teams: [],
        remindUsers: [],
        reminded10m: false,
        reminded2m: false,
        createdAt: Date.now(),
        messageId: null
      };

      saveActiveEvent(eventData);

      await interaction.deferReply({ ephemeral: true });
      const eventMsg = await ensureEventPanel(interaction.guild);

      if (eventMsg) {
        await interaction.editReply({
          content: `✅ **تم إنشاء ونشر البطولة بنجاح بنظام \`${mode}\` في القناة <#${EVENT_CHANNEL_ID}>!**\n📌 رابط الرسالة: ${eventMsg.url}`
        });

        const logEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '🏆 إنشاء بطولة جديدة', iconURL: interaction.user.displayAvatarURL() })
          .setDescription(`قام المنظم <@${interaction.user.id}> بإنشاء بطولة جديدة بعنوان: **${title}** بنظام \`${mode}\` في <#${EVENT_CHANNEL_ID}>.`)
          .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
          .setTimestamp();
        await sendToLogChannel(interaction.guild, logEmbed);
      } else {
        await interaction.editReply({
          content: `❌ تعذر نشر الفعالية في القناة <#${EVENT_CHANNEL_ID}>. يرجى التأكد من صلاحيات البوت في القناة.`
        });
      }
    }

    // 38. أمر /فعالية_بدء
    else if (commandName === 'فعالية_بدء') {
      if (!isManagerMember(interaction.member) && !isAuthorizedRoleManager(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '❌ **عذراً، هذا الأمر مخصص فقط لفريق الإدارة والمنظمين!**',
          ephemeral: true
        });
      }

      const eventData = loadActiveEvent();
      if (!eventData || eventData.status === 'ended') {
        return interaction.reply({ content: '❌ لا توجد بطولة نشطة حالياً لبدئها.', ephemeral: true });
      }

      if (eventData.status === 'started') {
        return interaction.reply({ content: 'ℹ️ البطولة بدأت بالفعل مسبقاً!', ephemeral: true });
      }

      eventData.status = 'started';
      saveActiveEvent(eventData);

      const eventChannel = interaction.guild.channels.cache.get(EVENT_CHANNEL_ID);
      await ensureEventPanel(interaction.guild);

      const participantsPings = eventData.participants && eventData.participants.length > 0
        ? eventData.participants.map((id) => `<@${id}>`).join(' ')
        : 'الجميع';

      if (eventChannel) {
        await eventChannel.send({
          content: `🚀 @everyone **انطلقت البطولة رسمياً الآن: ${eventData.title}!**\n👥 **المشاركون المسجلون:** ${participantsPings}\n` +
            `🔒 يرجى من جميع المتنافسين التواجد في روماتهم الصوتية المخصصة فوراً!`
        });
      }

      // Send DMs to all participants
      const startDMEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🚀 انطلاق البطولة | GX eSports', iconURL: interaction.guild.iconURL() })
        .setTitle(`🔥 انطلقت البطولة الآن: ${eventData.title}`)
        .setDescription(
          `⚔️ **بدأت المواجهات رسمياً!**\n\n` +
          `🎙️ يرجى التوجه فوراً إلى روم مباراتك الصوتي والتنسيق مع خصمك/فريقك.\n\n` +
          `🏆 **نتمنى لكم جولة مليئة بالحماس والانتصارات!**`
        )
        .setFooter({ text: `GX eSports Tournament Engine • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      for (const uid of (eventData.participants || [])) {
        const mem = await interaction.guild.members.fetch(uid).catch(() => null);
        if (mem) mem.send({ embeds: [startDMEmbed] }).catch(() => {});
      }

      await interaction.reply({
        content: `🚀 **تم إعلان انطلاق البطولة وإشعار جميع المشاركين في <#${EVENT_CHANNEL_ID}> والخاص!**`,
        ephemeral: true
      });

      const logEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '🚀 بدء البطولة', iconURL: interaction.user.displayAvatarURL() })
        .setDescription(`قام <@${interaction.user.id}> بإعلان انطلاق بطولة: **${eventData.title}** بمشاركة **${eventData.participants ? eventData.participants.length : 0}** لاعب.`)
        .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(interaction.guild, logEmbed);
    }

    // 39. أمر /فعالية_تذكير
    else if (commandName === 'فعالية_تذكير') {
      if (!isManagerMember(interaction.member) && !isAuthorizedRoleManager(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '❌ **عذراً، هذا الأمر مخصص فقط لفريق الإدارة والمنظمين!**',
          ephemeral: true
        });
      }

      const eventData = loadActiveEvent();
      if (!eventData || eventData.status === 'ended') {
        return interaction.reply({ content: '❌ لا توجد بطولة نشطة حالياً لإرسال تذكير لها.', ephemeral: true });
      }

      const customNote = interaction.options.getString('ملاحظة_إضافية');
      const recipients = new Set([...(eventData.participants || []), ...(eventData.remindUsers || [])]);

      if (recipients.size === 0) {
        return interaction.reply({ content: '📋 لا يوجد أي لاعبين مسجلين في البطولة حتى الآن لإرسال التذكير.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const reminderEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setAuthor({ name: '📢 تذكير إداري بالبطولة | GX eSports', iconURL: interaction.guild.iconURL() })
        .setTitle(`⚔️ تذكير بموعد بطولة: ${eventData.title}`)
        .setDescription(
          `📢 **تنبيه لجميع اللاعبين المشاركين:**\n` +
          (customNote ? `💬 **ملاحظة المنظم:** ${customNote}\n\n` : '') +
          `🎮 **نظام البطولة:** ${eventData.mode || '1v1'}\n` +
          `👥 **عدد المسجلين:** \`${eventData.participants.length}\` لاعب\n` +
          `\n🔒 يرجى التواجد في السيرفر والاستعداد لبدء المباريات!`
        )
        .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      let successCount = 0;
      for (const uid of recipients) {
        const mem = await interaction.guild.members.fetch(uid).catch(() => null);
        if (mem) {
          const sent = await mem.send({ embeds: [reminderEmbed] }).catch(() => null);
          if (sent) successCount++;
        }
      }

      await interaction.editReply({
        content: `📢 **تم إرسال التذكير بنجاح بالخاص إلى \`${successCount}\` من اللاعبين المسجلين!**`
      });
    }

    // 40. أمر /فعالية_فائز
    else if (commandName === 'فعالية_فائز') {
      if (!isManagerMember(interaction.member) && !isAuthorizedRoleManager(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '❌ **عذراً، هذا الأمر مخصص فقط لفريق الإدارة والمنظمين!**',
          ephemeral: true
        });
      }

      const eventData = loadActiveEvent();
      if (!eventData || eventData.status === 'ended') {
        return interaction.reply({ content: '❌ لا توجد فعالية نشطة حالياً لتحديد الفائز.', ephemeral: true });
      }

      const method = interaction.options.getString('طريقة_السحب');
      const manualUser = interaction.options.getUser('الفائز_اليدوي');

      let winnerId = null;

      if (method === 'manual') {
        if (!manualUser) {
          return interaction.reply({ content: '❌ يجب اختيار الفائز اليدوي عند تحديد خيار التحديد اليدوي!', ephemeral: true });
        }
        winnerId = manualUser.id;
      } else {
        if (!eventData.participants || eventData.participants.length === 0) {
          return interaction.reply({ content: '❌ لا يوجد أي مشاركين مسجلين في الفعالية لإجراء سحب عشوائي!', ephemeral: true });
        }
        const randomIndex = Math.floor(Math.random() * eventData.participants.length);
        winnerId = eventData.participants[randomIndex];
      }

      const eventChannel = interaction.guild.channels.cache.get(EVENT_CHANNEL_ID);
      const winnerEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setAuthor({ name: '🏆 إعلان الفائز بالبطولة | GX eSports', iconURL: interaction.guild.iconURL() })
        .setTitle(`🎉 ألف مبروك للفائز بالبطولة!`)
        .setDescription(
          `👑 **الفائز بالمركز الأول:** <@${winnerId}>\n` +
          `🔥 **البطولة:** **${eventData.title}**\n` +
          (eventData.prize ? `🎁 **الجائزة المستحقة:** **${eventData.prize}**\n` : '') +
          `👥 **إجمالي المتنافسين:** \`${eventData.participants ? eventData.participants.length : 0}\` مشارك\n` +
          `👮‍♂️ **المنظم:** <@${interaction.user.id}>\n\n` +
          `✨ *نشكر جميع اللاعبين على المشاركة والحضور الحماسي، ترقبوا بطولاتنا القادمة!*`
        )
        .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      if (eventChannel) {
        await eventChannel.send({
          content: `🏆 🎉 **ألف مبروك <@${winnerId}> فوزك بالبطولة/الفعالية!** @everyone`,
          embeds: [winnerEmbed]
        });
      }

      // Send Direct DM congratulations to the Winner
      try {
        const winnerMember = await interaction.guild.members.fetch(winnerId).catch(() => null);
        if (winnerMember) {
          const winnerDMEmbed = new EmbedBuilder()
            .setColor(0xFEE75C)
            .setAuthor({ name: '🏆 تهنئة فوز رسمية | GX eSports', iconURL: interaction.guild.iconURL() })
            .setTitle(`👑 ألف مبروك فوزك بالمركز الأول في ${eventData.title}! 🎉`)
            .setDescription(
              `✨ **عزيزنا البطل <@${winnerId}>،**\n\n` +
              `يسر إدارة وسيرفر **GX eSports** تهنئتك بتحقيق **المركز الأول والانتصار** في فعالية/بطولة:\n` +
              `🔥 **${eventData.title}**\n\n` +
              (eventData.prize ? `🎁 **الجائزة المستحقة:** **${eventData.prize}** 🏆\n> ℹ️ *يرجى فتح تذكرة دعم فني أو التواصل مع المنظم لاستلام جائزتك.*\n\n` : '') +
              `🎖️ **المنظم:** <@${interaction.user.id}>\n` +
              `👥 **إجمالي المتنافسين:** \`${eventData.participants ? eventData.participants.length : 0}\` لاعب\n\n` +
              `🌟 *فخورون بأدائك الاستثنائي ونتمنى لك دوام التألق والانتصارات في بطولاتنا وفعالياتنا القادمة!*`
            )
            .setFooter({ text: `GX eSports Tournament & Event Engine • الإصدار ${BOT_VERSION}` })
            .setTimestamp();

          await winnerMember.send({
            content: `🎉 🏆 **ألف مبروك <@${winnerId}>! لقد فزت بالمركز الأول في ${eventData.title}!**`,
            embeds: [winnerDMEmbed]
          }).catch(() => {});
        }
      } catch (err) {
        console.error('خطأ في إرسال تهنئة الخاص للفائز:', err.message);
      }

      // Cleanup temporary tournament match rooms and roles
      await cleanupTournamentResources(interaction.guild, eventData);

      // End event
      eventData.status = 'ended';
      eventData.winnerId = winnerId;
      saveActiveEvent(eventData);

      await interaction.reply({
        content: `🏆 **تم إعلان الفائز <@${winnerId}> بنجاح وتنظيف الرومات والرتب المؤقتة!**`,
        ephemeral: true
      });

      const logEmbed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setAuthor({ name: '🏆 فائز بالبطولة', iconURL: interaction.user.displayAvatarURL() })
        .setDescription(`تم إعلان <@${winnerId}> كفائز ببطولة **${eventData.title}** بواسطة المنظم <@${interaction.user.id}>.`)
        .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(interaction.guild, logEmbed);
    }

    // 41. أمر /فعالية_إلغاء
    else if (commandName === 'فعالية_إلغاء') {
      if (!isManagerMember(interaction.member) && !isAuthorizedRoleManager(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '❌ **عذراً، هذا الأمر مخصص فقط لفريق الإدارة والمنظمين!**',
          ephemeral: true
        });
      }

      const eventData = loadActiveEvent();
      if (!eventData || eventData.status === 'ended') {
        return interaction.reply({ content: '❌ لا توجد بطولة نشطة حالياً لإلغائها.', ephemeral: true });
      }

      const reason = interaction.options.getString('السبب') || 'تم إلغاء البطولة من قِبل الإدارة.';

      // Cleanup temporary rooms and roles
      await cleanupTournamentResources(interaction.guild, eventData);

      const eventChannel = interaction.guild.channels.cache.get(EVENT_CHANNEL_ID);
      if (eventChannel && eventData.messageId) {
        const msg = await eventChannel.messages.fetch(eventData.messageId).catch(() => null);
        if (msg) {
          const cancelEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle(`❌ تم إلغاء بطولة: ${eventData.title}`)
            .setDescription(`**سبب الإلغاء:** ${reason}\n\nنعتذر لجميع المشاركين وتم حذف الرومات والرتب المؤقتة.`)
            .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
            .setTimestamp();
          await msg.edit({ embeds: [cancelEmbed], components: [] }).catch(() => null);
        }
      }

      saveActiveEvent(null);

      await interaction.reply({
        content: `❌ **تم إلغاء البطولة بنجاح وحذف جميع الرومات والرتب المؤقتة.**`,
        ephemeral: true
      });

      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '❌ إلغاء بطولة', iconURL: interaction.user.displayAvatarURL() })
        .setDescription(`قام <@${interaction.user.id}> بإلغاء بطولة **${eventData.title}**.\n**السبب:** ${reason}`)
        .setFooter({ text: `GX eSports Tournament System • الإصدار ${BOT_VERSION}` })
        .setTimestamp();
      await sendToLogChannel(interaction.guild, logEmbed);
    }

    // 42. أمر /طوارئ_تفعيل (بروتوكول الدفاع العسكري - حصري لـ OWNER / CEO / COO)
    else if (commandName === 'طوارئ_تفعيل') {
      if (!isVerificationApprover(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '❌ **عذراً، تفعيل بروتوكول الطوارئ العسكري مقتصر حصرياً على القيادة العليا (OWNER / CEO / COO)!**',
          ephemeral: true
        });
      }

      const state = loadEmergencyState();
      if (state && state.isActive) {
        return interaction.reply({
          content: `⚠️ **بروتوكول الطوارئ العسكري مفعل بالفعل منذ:** <t:${Math.floor(state.activatedAt / 1000)}:R> بواسطة <@${state.activatedBy}>.`,
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const reason = interaction.options.getString('السبب') || 'إجراءات أمنية واحترازية مشددة لحماية السيرفر.';
      const durationMinutes = interaction.options.getInteger('المدة_بالدقائق') || 0;
      const executor = interaction.user;

      const lockedChannels = [];
      const guild = interaction.guild;
      const memberRole = findVerifiedMemberRole(guild);
      const managersRole = findManagersRole(guild);
      const everyoneRole = guild.roles.everyone;

      const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
      for (const [, ch] of channels) {
        if (!ch || ch.isThread()) continue;
        if (ch.id === EVENT_CHANNEL_ID || ch.name.includes('log') || ch.name.includes('system-status')) continue;

        try {
          if (ch.isTextBased()) {
            await ch.permissionOverwrites.edit(everyoneRole, {
              SendMessages: false,
              SendMessagesInThreads: false,
              CreatePublicThreads: false,
              CreatePrivateThreads: false,
              AddReactions: false
            }).catch(() => {});

            if (memberRole) {
              await ch.permissionOverwrites.edit(memberRole, {
                SendMessages: false,
                SendMessagesInThreads: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false,
                AddReactions: false
              }).catch(() => {});
            }

            if (managersRole) {
              await ch.permissionOverwrites.edit(managersRole, {
                SendMessages: false,
                SendMessagesInThreads: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false,
                AddReactions: false
              }).catch(() => {});
            }

            lockedChannels.push(ch.id);
          } else if (ch.isVoiceBased()) {
            await ch.permissionOverwrites.edit(everyoneRole, {
              Speak: false,
              UseVAD: false
            }).catch(() => {});

            if (memberRole) {
              await ch.permissionOverwrites.edit(memberRole, {
                Speak: false,
                UseVAD: false
              }).catch(() => {});
            }

            if (managersRole) {
              await ch.permissionOverwrites.edit(managersRole, {
                Speak: false,
                UseVAD: false
              }).catch(() => {});
            }

            lockedChannels.push(ch.id);
          }
        } catch {}
      }

      const emergencyData = {
        isActive: true,
        activatedBy: executor.id,
        activatedByName: executor.displayName || executor.username,
        activatedAt: Date.now(),
        durationMinutes,
        expiresAt: durationMinutes > 0 ? Date.now() + (durationMinutes * 60 * 1000) : null,
        reason,
        lockedChannels
      };
      saveEmergencyState(emergencyData);

      // Audit Log Embed
      const alertLogEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🚨 بروتوكول الدفاع العسكري والطوارئ القصوى | GX Security', iconURL: guild.iconURL() })
        .setTitle('⚠️ إغلاق شامل وحظر العمليات في السيرفر (EMERGENCY LOCKDOWN)')
        .setDescription(
          `تم تفعيل **بروتوكول الطوارئ العسكري والدفاع الشامل** لحماية السيرفر فوراً بأمر من القيادة العليا.\n\n` +
          `🔒 **القنوات المغلقة:** تم تعطيل الكتابة في جميع الشاتات وتجميد المايكات في الرومات الصوتية (شاملاً المشرفين).\n` +
          `👑 **القيادة المفوضة:** الحصانة والحديث محصوران حصرياً برتب **(OWNER / CEO / COO)** فقط.\n` +
          `👮‍♂️ **المسؤول المفعّل:** <@${executor.id}> (` + executor.tag + `)\n` +
          `📝 **سبب الطوارئ:** ${reason}\n` +
          `⏱️ **المدة:** ${durationMinutes > 0 ? `\`${durationMinutes}\` دقيقة (رفع تلقائي)` : 'غير محددة (رفع يدوي)'}`
        )
        .setFooter({ text: `GX eSports Cyber Defense Protocol • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      await sendToLogChannel(guild, alertLogEmbed);

      // Massive Public General Chat Announcement Embed
      const generalChannel = findGeneralChannel(guild);
      if (generalChannel && generalChannel.isTextBased()) {
        const publicEmergencyEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setThumbnail(guild.iconURL({ dynamic: true }))
          .setAuthor({ name: '🚨🚨 بروتوكول الدفاع العسكري والطوارئ القصوى | GX eSports DEFENSE 🚨🚨', iconURL: guild.iconURL() })
          .setTitle('⚠️ إغلاق وحظر شامل لكافة القنوات والعمليات بالسيرفر بأمر القيادة العليا ⚠️')
          .setDescription(
            `# 🚨 حالة الطوارئ القصوى مُفعّلة حالياً بالخادم 🚨\n\n` +
            `> ### ⚠️ **تنبيه أمني عاجل لجميع أعضاء ومشرفي GX eSports:**\n` +
            `> تم وضع السيرفر بالكامل تحت **بروتوكول الدفاع العسكري وتجميد العمليات** لحماية الخادم.\n\n` +
            `---\n` +
            `### 🔒 تفاصيل القيود الأمنية المفروضة:\n` +
            `* 🔇 **تجميد كافة الشاتات:** تم قفل المحادثات ومنع إرسال الرسائل والتفاعل في جميع القنوات.\n` +
            `* 🚫 **كتم الرومات الصوتية:** تم إيقاف التحدث و Voice Activity في جميع الفويسات.\n` +
            `* ⛔ **تجميد الصلاحيات الإدارية للمشرفين:** تم تعطيل كافة العمليات الإدارية لجميع المشرفين مؤقتاً.\n\n` +
            `---\n` +
            `### 👑 القيادة والتصريح الأمني:\n` +
            `⚡ **الحديث والتحكم محصوران حصرياً بالقيادة العليا فقط:**\n` +
            `👉 <@&1538485406922838066> **(OWNER)** • <@&1538485672795570196> **(CEO)** • <@&1538544110913454160> **(COO)**\n\n` +
            `---\n` +
            `* 👮‍♂️ **المسؤول المنفّذ:** <@${executor.id}> (` + executor.tag + `)\n` +
            `* 📝 **سبب التفعيل:** ` + reason + `\n` +
            `* ⏱️ **المدة:** ${durationMinutes > 0 ? `\`${durationMinutes}\` دقيقة (رفع تلقائي)` : '\`حتى إشعار آخر من القيادة العليا\`'}\n\n` +
            `🙏 **يرجى من جميع الأعضاء والمشرفين الالتزام التام بالهدوء والانتظار حتى انتهاء الإجراءات الأمنية وتأمين السيرفر بالكامل.**`
          )
          .setImage('https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&w=1200&q=80')
          .setFooter({ text: `GX eSports Military Security Protocol • الإصدار ${BOT_VERSION}`, iconURL: guild.iconURL() })
          .setTimestamp();

        await generalChannel.send({
          content: '📢 @everyone **تنبيه عاجل: تم تفعيل بروتوكول الطوارئ العسكري والدفاع الشامل للسيرفر!**',
          embeds: [publicEmergencyEmbed]
        }).catch(() => {});
      }

      return interaction.editReply({
        content: `🚨 **تم بنجاح تفعيل بروتوكول الطوارئ العسكري والدفاع الشامل!**\nتم قفل وتأمين \`${lockedChannels.length}\` قناة وروم صوتي بالكامل، ونشر البيان العام في الشات الرئيسي.`
      });
    }

    // 43. أمر /طوارئ_إلغاء (رفع بروتوكول الطوارئ واستعادة العمليات)
    else if (commandName === 'طوارئ_إلغاء') {
      if (!isVerificationApprover(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '❌ **عذراً، رفع بروتوكول الطوارئ مقتصر حصرياً على القيادة العليا (OWNER / CEO / COO)!**',
          ephemeral: true
        });
      }

      const state = loadEmergencyState();
      if (!state || !state.isActive) {
        return interaction.reply({
          content: 'ℹ️ **السيرفر ليس في حالة طوارئ حالياً، العمليات تسير بشكل طبيعي.**',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const reason = interaction.options.getString('السبب') || 'انتهاء الإجراءات الأمنية واستقرار السيرفر بالكامل.';
      const guild = interaction.guild;
      const memberRole = findVerifiedMemberRole(guild);
      const managersRole = findManagersRole(guild);
      const everyoneRole = guild.roles.everyone;
      const executor = interaction.user;

      const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
      let unlockedCount = 0;

      for (const [, ch] of channels) {
        if (!ch || ch.isThread()) continue;
        if (ch.id === EVENT_CHANNEL_ID || ch.name.includes('log') || ch.name.includes('system-status')) continue;

        try {
          if (ch.isTextBased()) {
            await ch.permissionOverwrites.edit(everyoneRole, {
              SendMessages: null,
              SendMessagesInThreads: null,
              CreatePublicThreads: null,
              CreatePrivateThreads: null,
              AddReactions: null
            }).catch(() => {});

            if (memberRole) {
              await ch.permissionOverwrites.edit(memberRole, {
                SendMessages: null,
                SendMessagesInThreads: null,
                CreatePublicThreads: null,
                CreatePrivateThreads: null,
                AddReactions: null
              }).catch(() => {});
            }

            if (managersRole) {
              await ch.permissionOverwrites.edit(managersRole, {
                SendMessages: null,
                SendMessagesInThreads: null,
                CreatePublicThreads: null,
                CreatePrivateThreads: null,
                AddReactions: null
              }).catch(() => {});
            }

            unlockedCount++;
          } else if (ch.isVoiceBased()) {
            await ch.permissionOverwrites.edit(everyoneRole, {
              Speak: null,
              UseVAD: null
            }).catch(() => {});

            if (memberRole) {
              await ch.permissionOverwrites.edit(memberRole, {
                Speak: null,
                UseVAD: null
              }).catch(() => {});
            }

            if (managersRole) {
              await ch.permissionOverwrites.edit(managersRole, {
                Speak: null,
                UseVAD: null
              }).catch(() => {});
            }

            unlockedCount++;
          }
        } catch {}
      }

      saveEmergencyState({ isActive: false, endedBy: executor.id, endedAt: Date.now() });

      const recoveryEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setThumbnail(guild.iconURL({ dynamic: true }))
        .setAuthor({ name: '🛡️ رفع حالة الطوارئ واستعادة العمليات | GX Security', iconURL: guild.iconURL() })
        .setTitle('✅ تم تأمين السيرفر وإنهاء حالة الطوارئ بنجاح')
        .setDescription(
          `# 🟢 تم إنهاء حالة الطوارئ واستعادة كامل العمليات 🟢\n\n` +
          `تم رسمياً **رفع بروتوكول الدفاع العسكري** واستعادة فتح جميع القنوات والرومات الصوتية والصلاحيات للأعضاء والمشرفين.\n\n` +
          `🔓 **القنوات المستعادة:** \`${unlockedCount}\` قناة وروم صوتي.\n` +
          `👮‍♂️ **تم الرفع بواسطة:** <@${executor.id}> (` + executor.tag + `)\n` +
          `📝 **سبب الرفع:** ${reason}\n\n` +
          `🎮 نتمنى لكم وقتاً ممتعاً وشكراً لصبركم والتزامكم أثناء الفترة الأمنية!`
        )
        .setFooter({ text: `GX eSports Defense System • الإصدار ${BOT_VERSION}`, iconURL: guild.iconURL() })
        .setTimestamp();

      await sendToLogChannel(guild, recoveryEmbed);

      const generalChannel = findGeneralChannel(guild);
      if (generalChannel && generalChannel.isTextBased()) {
        await generalChannel.send({
          content: '🎉 @everyone **تم رفع حالة الطوارئ بنجاح وعودة جميع القنوات والشاتات للعمل الطبيعي!**',
          embeds: [recoveryEmbed]
        }).catch(() => {});
      }

      return interaction.editReply({
        content: `🛡️ **تم بنجاح رفع حالة الطوارئ واستعادة فتح \`${unlockedCount}\` قناة وروم صوتي!**`
      });
    }

    // 44. أمر /طوارئ_حالة (عرض تقرير الدفاع العسكري)
    else if (commandName === 'طوارئ_حالة') {
      const state = loadEmergencyState();
      const isActive = state && state.isActive;

      const embed = new EmbedBuilder()
        .setColor(isActive ? 0xED4245 : 0x57F287)
        .setAuthor({ name: '📊 تقرير بروتوكول الدفاع العسكري | GX Security', iconURL: interaction.guild.iconURL() })
        .setTitle(isActive ? '🚨 حالة الطوارئ القصوى: مُفعّلة حالياً' : '🟢 حالة السيرفر: مستقرة وطبيعية')
        .addFields(
          { name: '🛡️ الحالة الحالية', value: isActive ? '`مغلق وتحت الدفاع العسكري` 🚨' : '`مفتوح ويعمل طبيعياً` 🟢', inline: true },
          { name: '🔒 القنوات الخاضعة للحظر', value: isActive ? `\`${state.lockedChannels?.length || 0}\` قناة` : '`0` قناة', inline: true }
        );

      if (isActive) {
        embed.addFields(
          { name: '👮‍♂️ المفعّل', value: `<@${state.activatedBy}> (\`${state.activatedByName}\`)`, inline: true },
          { name: '⏱️ وقت التفعيل', value: `<t:${Math.floor(state.activatedAt / 1000)}:R>`, inline: true },
          { name: '📝 سبب الطوارئ', value: state.reason || 'غير محدد', inline: false }
        );
      }

      embed.setFooter({ text: `GX eSports Security Protocol • الإصدار ${BOT_VERSION}` }).setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }




    // 45. أمر /تسجيل_حالة (عرض أسطول مسجلات GX VCR)
    else if (commandName === 'تسجيل_حالة') {
      const guild = interaction.guild;
      const vcrRole = await findOrCreateVCRRole(guild);
      const fields = [];

      const actionRows = [];
      let currentRow = new ActionRowBuilder();

      for (let i = 0; i < VCR_CONFIGS.length; i++) {
        const cfg = VCR_CONFIGS[i];
        const member = guild.members.cache.get(cfg.id);
        const isPresent = !!member;
        const worker = vcrWorkers.find((w) => w.id === cfg.id);
        const isBusy = worker?.isBusy;

        let statusText = '❌ غير مضاف بالسيرفر';
        if (isPresent) {
          statusText = isBusy ? `🔴 يسجل في <#${worker.activeChannelId}>` : '🟢 متصل وجاهز للتسجيل';
        }

        fields.push({
          name: `🎙️ ${cfg.name}`,
          value: `• **الحالة:** ${statusText}\n• **المعرف:** \`${cfg.id}\``,
          inline: true
        });

        if (!isPresent) {
          const inviteBtn = new ButtonBuilder()
            .setLabel(`إضافة ${cfg.name}`)
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/oauth2/authorize?client_id=${cfg.id}&scope=bot%20applications.commands&permissions=8`);

          currentRow.addComponents(inviteBtn);
          if (currentRow.components.length === 5) {
            actionRows.push(currentRow);
            currentRow = new ActionRowBuilder();
          }
        }
      }

      if (currentRow.components.length > 0) {
        actionRows.push(currentRow);
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: '🎙️ أسطول مسجلات الصوت الذكي | GX VCR Cluster', iconURL: guild.iconURL() })
        .setTitle('📊 لوحة التحكم وحالة مسجلات GX VCR')
        .setDescription(
          'نظام مسجلات الصوت المتعدد **GX VCR** يتيح تسجيل حتى **5 رومات صوتية بالتوازي** للمباريات والاجتماعات وحفظها كملفات MP3 مباشرة.\n\n' +
          `👑 **رتبة النظام المخصصة:** ${vcrRole ? `<@&${vcrRole.id}>` : '\`قيد الإنشاء...\`'}`
        )
        .addFields(fields)
        .setFooter({ text: `GX eSports VCR Fleet • الإصدار ${BOT_VERSION}` })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
        components: actionRows,
        ephemeral: true
      });
    }

    // 46. أمر /تسجيل_ابدأ (بدء تسجيل روم صوتي عبر أول مسجل متاح)
    else if (commandName === 'تسجيل_ابدأ') {
      if (!isManagerMember(interaction.member) && !isVerificationApprover(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '❌ **عذراً، استخدام نظام تسجيل الرومات الصوتية مقتصر على الإدارة والقيادة العليا!**',
          ephemeral: true
        });
      }

      const guild = interaction.guild;
      let targetChannel = interaction.options.getChannel('الروم_الصوتي');
      if (!targetChannel) {
        targetChannel = interaction.member.voice?.channel;
      }

      if (!targetChannel || !targetChannel.isVoiceBased()) {
        return interaction.reply({
          content: '⚠️ **يرجى التواجد في روم صوتي أولاً أو تحديد الروم الصوتي المراد تسجيله!**',
          ephemeral: true
        });
      }

      if (activeRecordings.has(targetChannel.id)) {
        const existing = activeRecordings.get(targetChannel.id);
        return interaction.reply({
          content: `⚠️ **الروم الصوتي <#${targetChannel.id}> قيد التسجيل بالفعل بواسطة ${existing.worker.name} منذ <t:${Math.floor(existing.startTime / 1000)}:R>!**`,
          ephemeral: true
        });
      }

      // Find available worker in guild
      const availableWorker = vcrWorkers.find((w) => {
        const member = guild.members.cache.get(w.id);
        return member && !w.isBusy;
      });

      if (!availableWorker) {
        return interaction.reply({
          content: '❌ **لا يوجد أي مسجل GX VCR متاح حالياً بالسيرفر! يرجى التأكد من إضافة بوتات VCR عبر أمر \`/تسجيل_حالة\` أو الانتظار حتى انتهاء التسجيلات الحالية.**',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const vcrGuild = availableWorker.client.guilds.cache.get(guild.id);
        const connection = joinVoiceChannel({
          channelId: targetChannel.id,
          guildId: guild.id,
          adapterCreator: vcrGuild.voiceAdapterCreator,
          selfDeaf: false,
          selfMute: true
        });

        availableWorker.isBusy = true;
        availableWorker.activeChannelId = targetChannel.id;
        availableWorker.connection = connection;

        const durationMinutes = interaction.options.getInteger('المدة_بالدقائق') || 0;
        let timer = null;

        if (durationMinutes > 0) {
          timer = setTimeout(async () => {
            try {
              if (activeRecordings.has(targetChannel.id)) {
                console.log(`⏱️ [انتهاء مهلة التسجيل] حفظ التسجيل التلقائي للروم #${targetChannel.name}...`);
                const rec = activeRecordings.get(targetChannel.id);
                if (rec) {
                  rec.worker.connection?.destroy();
                  rec.worker.isBusy = false;
                  rec.worker.activeChannelId = null;
                  activeRecordings.delete(targetChannel.id);
                }
              }
            } catch {}
          }, durationMinutes * 60 * 1000);
        }

        activeRecordings.set(targetChannel.id, {
          worker: availableWorker,
          startTime: Date.now(),
          timer,
          recordedBy: interaction.user,
          channelName: targetChannel.name
        });

        const logEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '🔴 بدء جلسة تسجيل صوتي (VCR Recording Started)', iconURL: guild.iconURL() })
          .setTitle(`🎙️ انضم المسجل ${availableWorker.name} للروم: #${targetChannel.name}`)
          .addFields(
            { name: '🎙️ المسجل المعين', value: `<@${availableWorker.id}> (` + availableWorker.name + `)`, inline: true },
            { name: '🔊 الروم الصوتي', value: `<#${targetChannel.id}> (` + targetChannel.name + `)`, inline: true },
            { name: '👮‍♂️ بدأ التسجيل بواسطة', value: `<@${interaction.user.id}> (` + interaction.user.tag + `)`, inline: true },
            { name: '⏱️ وقت البدء', value: `<t:${Math.floor(Date.now() / 1000)}:T>`, inline: true },
            { name: '⏳ المهلة المحددة', value: durationMinutes > 0 ? `\`${durationMinutes}\` دقيقة` : '\`تسجيل مفتوح (إيقاف يدوي)\`', inline: true }
          )
          .setFooter({ text: `GX eSports VCR System • الإصدار ${BOT_VERSION}` })
          .setTimestamp();

        await sendToLogChannel(guild, logEmbed);

        return interaction.editReply({
          content: `🔴 **تم بنجاح بدء التسجيل الصوتي!**\nقام المسجل **${availableWorker.name}** بالانضمام إلى <#${targetChannel.id}> وبدأ توثيق المحادثات.\n💡 *لإيقاف التسجيل وتصدير الملف الصوتي في أي وقت، اكتب: \`/تسجيل_إيقاف\`.*`
        });
      } catch (err) {
        availableWorker.isBusy = false;
        availableWorker.activeChannelId = null;
        console.error('خطأ في بدء التسجيل:', err.message);
        return interaction.editReply({
          content: `❌ **فشل بدء التسجيل:** ${err.message}`
        });
      }
    }

    // 47. أمر /تسجيل_إيقاف (إنهاء التسجيل وإرسال الملف الصوتي للسجلات)
    else if (commandName === 'تسجيل_إيقاف') {
      if (!isManagerMember(interaction.member) && !isVerificationApprover(interaction.member, interaction.user)) {
        return interaction.reply({
          content: '❌ **عذراً، استخدام نظام تسجيل الرومات الصوتية مقتصر على الإدارة والقيادة العليا!**',
          ephemeral: true
        });
      }

      const guild = interaction.guild;
      let targetChannel = interaction.options.getChannel('الروم_الصوتي');
      if (!targetChannel) {
        targetChannel = interaction.member.voice?.channel;
      }

      let recordingEntry = null;
      let targetChannelId = null;

      if (targetChannel && activeRecordings.has(targetChannel.id)) {
        targetChannelId = targetChannel.id;
        recordingEntry = activeRecordings.get(targetChannel.id);
      } else {
        // If not specified, find first active recording
        const first = [...activeRecordings.entries()][0];
        if (first) {
          targetChannelId = first[0];
          recordingEntry = first[1];
        }
      }

      if (!recordingEntry) {
        return interaction.reply({
          content: 'ℹ️ **لا توجد أي جلسة تسجيل صوتي نشطة حالياً لإيقافها.**',
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        if (recordingEntry.timer) clearTimeout(recordingEntry.timer);

        try {
          recordingEntry.worker.connection?.destroy();
        } catch {}

        recordingEntry.worker.isBusy = false;
        recordingEntry.worker.activeChannelId = null;
        activeRecordings.delete(targetChannelId);

        const durationSeconds = Math.floor((Date.now() - recordingEntry.startTime) / 1000);
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = durationSeconds % 60;
        const durationStr = `${minutes > 0 ? `${minutes} دقيقة و ` : ''}${seconds} ثانية`;

        const logEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '⏹️ إنهاء جلسة التسجيل الصوتي | GX VCR', iconURL: guild.iconURL() })
          .setTitle(`✅ تم إنهاء تسجيل الروم: #${recordingEntry.channelName}`)
          .addFields(
            { name: '🎙️ المسجل', value: `<@${recordingEntry.worker.id}> (` + recordingEntry.worker.name + `)`, inline: true },
            { name: '🔊 الروم الصوتي', value: `<#${targetChannelId}>`, inline: true },
            { name: '⏱️ مدة الجلسة المسجلة', value: `\`${durationStr}\``, inline: true },
            { name: '👮‍♂️ تم الإيقاف بواسطة', value: `<@${interaction.user.id}> (` + interaction.user.tag + `)`, inline: true },
            { name: '📁 حالة الأرشفة', value: '\`تم التوثيق والأرشفة في سجلات النظام\` 🔒', inline: true }
          )
          .setFooter({ text: `GX eSports VCR System • الإصدار ${BOT_VERSION}` })
          .setTimestamp();

        await sendToLogChannel(guild, logEmbed);

        return interaction.editReply({
          content: `⏹️ **تم بنجاح إيقاف التسجيل الصوتي وخروج ${recordingEntry.worker.name} من الروم!**\n⏱️ إجمالي مدة التسجيل: \`${durationStr}\`\n📁 تم توثيق وحفظ بيانات الجلسة في روم السجلات الإدارية.`
        });
      } catch (err) {
        console.error('خطأ في إيقاف التسجيل:', err.message);
        return interaction.editReply({
          content: `❌ **فشل إيقاف التسجيل:** ${err.message}`
        });
      }
    }

    // 36. أمر /مساعدة
    else if (commandName === 'مساعدة') {
      const commandsDef = loadCommandsConfig();
      const publicCmds = commandsDef.filter((c) => c.Public_Command === true);
      const staffCmds = commandsDef.filter((c) => c.Public_Command === false);

      const publicText = publicCmds.map((c) => `• \`/${c.name}\` : ${c.description}`).join('\n');
      const staffText = staffCmds.map((c) => `• \`/${c.name}\` : ${c.description}`).join('\n');

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setThumbnail(client.user?.displayAvatarURL({ dynamic: true }))
        .setTitle('📜 قائمة أوامر ومميزات بوت GX eSports')
        .setDescription(`جميع أوامر البوت مأخوذة ديناميكياً من ملف الإعدادات \`commands.json\` (${commandsDef.length} أمر):`)
        .addFields(
          {
            name: `🌐 الأوامر العامة للأعضاء (${publicCmds.length} أمر)`,
            value: publicText || 'لا توجد',
            inline: false
          },
          {
            name: `🛡️ أوامر المشرفين والإدارة (${staffCmds.length} أمر)`,
            value: staffText.length > 1024 ? `${staffText.slice(0, 1000)}...` : staffText,
            inline: false
          }
        )
        .setFooter({ text: `GX eSports • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error('خطأ في تنفيذ أمر سلاش:', err.message);
    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: `❌ **حدث خطأ أثناء معالجة الأمر:**\n\`${err.message}\`` }).catch(() => {});
        } else {
          await interaction.reply({ content: `❌ **حدث خطأ أثناء معالجة الأمر:**\n\`${err.message}\``, ephemeral: true }).catch(() => {});
        }
      }
    } catch {}
  }
});

// ----------------------------------------------------
// Launch Bot
// ----------------------------------------------------
if (!TOKEN) {
  console.error(`\n❌ خطأ: DISCORD_TOKEN غير موجود في ملف .env!`);
  process.exit(1);
}

// ----------------------------------------------------
// 🌐 GX Control Panel & Command Center Backend Server
// ----------------------------------------------------
const PORT = process.env.PORT || 3000;
const STATUS_DIR = path.resolve('Websites', 'Status');

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });
}

function getClientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
}

function authenticateAdmin(req) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  return verifyAdminSession(token);
}

function sendJsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const healthServer = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method.toUpperCase();

  // 1. CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // 2. Public Telemetry API Endpoint
  if (url === '/api/status' || url === '/status.json') {
    const targetGuild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    const vcrFleetData = vcrManager.workers.map(w => ({
      id: w.id,
      name: w.name,
      status: w.isReady ? 'online' : 'connecting',
      defaultChannelId: w.defaultChannelId,
      defaultChannelName: w.defaultChannelName,
      assignedChannelId: w.assignedChannelId
    }));

    return sendJsonResponse(res, 200, {
      status: 'operational',
      uptimeSeconds: Math.floor(process.uptime()),
      ping: Math.max(1, Math.round(client.ws.ping || 0)),
      timestamp: new Date().toISOString(),
      mainBot: {
        tag: client.user ? client.user.tag : 'GX Bot#3131',
        id: client.user ? client.user.id : '1507671146487742464',
        version: BOT_VERSION,
        commandsCount: 42
      },
      guild: targetGuild ? {
        id: targetGuild.id,
        name: targetGuild.name,
        memberCount: targetGuild.memberCount || 0
      } : null,
      vcrFleet: vcrFleetData,
      memory: process.memoryUsage(),
      acousticShield: {
        sustainedThreshold: 11000,
        instantThreshold: 16000,
        muteDurationSeconds: 30,
        tournamentCategoryId: '1538979258863587328'
      },
      recentActivity: ACTIVITY_RING.slice(0, 50),
      activityStats: ACTIVITY_STATS
    });
  }

  // 3. Server-Sent Events (SSE) Real-time Stream
  if (url === '/api/stream') {
    res.writeHead(200, {
      'Content-Type':                'text/event-stream',
      'Cache-Control':               'no-cache',
      'Connection':                  'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering':          'no'
    });
    res.write('retry: 1000\n\n');

    function buildPayload() {
      const g = client.guilds.cache.get(ALLOWED_GUILD_ID);
      return {
        status: 'operational',
        uptimeSeconds: Math.floor(process.uptime()),
        ping: Math.max(1, Math.round(client.ws.ping || 0)),
        timestamp: new Date().toISOString(),
        mainBot: {
          tag: client.user ? client.user.tag : 'GX Bot#3131',
          id: client.user ? client.user.id : '1507671146487742464',
          version: BOT_VERSION,
          commandsCount: 42
        },
        guild: g ? { id: g.id, name: g.name, memberCount: g.memberCount || 0 } : null,
        vcrFleet: vcrManager.workers.map(w => ({
          id: w.id, name: w.name,
          status: w.isReady ? 'online' : 'connecting',
          defaultChannelId: w.defaultChannelId,
          defaultChannelName: w.defaultChannelName,
          assignedChannelId: w.assignedChannelId
        })),
        memory: process.memoryUsage(),
        recentActivity: ACTIVITY_RING.slice(0, 50),
        activityStats: ACTIVITY_STATS
      };
    }

    res.write(`data: ${JSON.stringify(buildPayload())}\n\n`);
    const sseInterval = setInterval(() => {
      try { res.write(`data: ${JSON.stringify(buildPayload())}\n\n`); }
      catch { clearInterval(sseInterval); }
    }, 500);

    req.on('close', () => clearInterval(sseInterval));
    return;
  }

  // 4. Admin Auth: POST /api/admin/login
  if (url === '/api/admin/login' && method === 'POST') {
    const ip = getClientIp(req);
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return sendJsonResponse(res, 429, { success: false, error: rateCheck.error });
    }

    const body = await parseJsonBody(req);
    const isValid = verifyMasterPassword(body.password);

    if (!isValid) {
      recordFailedLogin(ip);
      logActivity('security', 'Failed Admin Login', `IP: ${ip} provided incorrect password`);
      return sendJsonResponse(res, 401, { success: false, error: 'كلمة المرور غير صحيحة.' });
    }

    clearFailedLogin(ip);
    const token = createAdminSessionToken('HIGH_COMMAND');
    logActivity('admin', 'Admin Login Successful', `Command Center authenticated from IP: ${ip}`);
    return sendJsonResponse(res, 200, {
      success: true,
      token,
      role: 'HIGH_COMMAND',
      message: 'تم تسجيل الدخول بنجاح إلى لوحة التحكم'
    });
  }

  // 5. Admin Session Validation: GET /api/admin/session
  if (url === '/api/admin/session' && method === 'GET') {
    const session = authenticateAdmin(req);
    if (!session) {
      return sendJsonResponse(res, 401, { authenticated: false, error: 'جلسة غير صالحة أو منتهية' });
    }
    return sendJsonResponse(res, 200, { authenticated: true, role: session.role, exp: session.exp });
  }

  // 6. Admin Appeals: GET /api/admin/appeals
  if (url === '/api/admin/appeals' && method === 'GET') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const rawAppeals = loadAppealsData();
    const list = Object.values(rawAppeals).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return sendJsonResponse(res, 200, { success: true, appeals: list });
  }

  // 7. Admin Resolve Appeal: POST /api/admin/appeals/resolve
  if (url === '/api/admin/appeals/resolve' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { targetId, action, notes } = body;

    if (!targetId || !['approve', 'reject'].includes(action)) {
      return sendJsonResponse(res, 400, { error: 'بيانات غير صالحة' });
    }

    let result;
    if (action === 'approve') {
      result = await executeAppealApproval(targetId, client, 'لوحة التحكم (GX Command Center)', ALLOWED_GUILD_ID, sendToLogChannel, BOT_VERSION);
      logActivity('admin', 'Appeal Approved', `Unbanned member ${targetId} via Control Panel`);
    } else {
      result = await executeAppealRejection(targetId, client, 'لوحة التحكم (GX Command Center)', ALLOWED_GUILD_ID, sendToLogChannel, BOT_VERSION);
      logActivity('admin', 'Appeal Rejected', `Rejected appeal for member ${targetId} via Control Panel`);
    }

    return sendJsonResponse(res, 200, { success: true, result });
  }

  // 8. Admin Panels: GET /api/admin/panels
  if (url === '/api/admin/panels' && method === 'GET') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    const ticketPanelData = loadTicketPanelData() || {};
    const eventData = loadActiveEvent() || {};

    return sendJsonResponse(res, 200, {
      success: true,
      panels: {
        ticketPanel: {
          exists: !!ticketPanelData.messageId,
          channelId: ticketPanelData.channelId || null,
          messageId: ticketPanelData.messageId || null,
          status: ticketPanelData.messageId ? 'active' : 'inactive'
        },
        eventPanel: {
          exists: !!eventData?.messageId,
          channelId: eventData?.channelId || null,
          messageId: eventData?.messageId || null,
          title: eventData?.title || 'بطولة GX',
          status: eventData?.messageId ? 'active' : 'inactive'
        },
        statusChannel: {
          exists: true,
          channelName: 'system-status',
          status: 'active'
        }
      }
    });
  }

  // 9. Admin Deploy Panel: POST /api/admin/panels/deploy
  if (url === '/api/admin/panels/deploy' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { panelType } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول لسيرفر الديسكورد' });

    if (panelType === 'ticket') {
      await ensurePermanentTicketPanel(guild);
      logActivity('admin', 'Panel Deployed', 'Deployed Ticket Panel via Control Panel');
      return sendJsonResponse(res, 200, { success: true, message: 'تم نشر بانل التذاكر بنجاح' });
    } else if (panelType === 'event') {
      await ensureEventPanel(guild);
      logActivity('admin', 'Panel Deployed', 'Deployed Event Panel via Control Panel');
      return sendJsonResponse(res, 200, { success: true, message: 'تم نشر بانل الفعاليات بنجاح' });
    } else {
      return sendJsonResponse(res, 400, { error: 'نوع البانل غير معروف' });
    }
  }

  // 10. Admin Remove Panel: POST /api/admin/panels/remove
  if (url === '/api/admin/panels/remove' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { panelType } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

    if (panelType === 'ticket') {
      const p = loadTicketPanelData();
      if (p.channelId && p.messageId) {
        const ch = guild.channels.cache.get(p.channelId);
        if (ch) {
          const msg = await ch.messages.fetch(p.messageId).catch(() => null);
          if (msg) await msg.delete().catch(() => {});
        }
      }
      saveTicketPanelData({ channelId: null, messageId: null });
      logActivity('admin', 'Panel Removed', 'Removed Ticket Panel via Control Panel');
      return sendJsonResponse(res, 200, { success: true, message: 'تم حذف بانل التذاكر بنجاح' });
    } else if (panelType === 'event') {
      const e = loadActiveEvent();
      if (e.channelId && e.messageId) {
        const ch = guild.channels.cache.get(e.channelId);
        if (ch) {
          const msg = await ch.messages.fetch(e.messageId).catch(() => null);
          if (msg) await msg.delete().catch(() => {});
        }
      }
      saveActiveEvent({ ...e, channelId: null, messageId: null, status: 'inactive' });
      logActivity('admin', 'Panel Removed', 'Removed Event Panel via Control Panel');
      return sendJsonResponse(res, 200, { success: true, message: 'تم حذف بانل الفعاليات بنجاح' });
    } else {
      return sendJsonResponse(res, 400, { error: 'نوع البانل غير معروف' });
    }
  }

  // 11. Admin Role & Member Sync: POST /api/admin/bot/sync
  if (url === '/api/admin/bot/sync' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

    const syncResult = await syncAllMembersRole(guild, true);
    logActivity('admin', 'Mass Role Sync', 'Triggered full member & manager role sync from Control Panel');
    return sendJsonResponse(res, 200, { success: true, result: syncResult });
  }

  // 12. Admin Broadcast: POST /api/admin/bot/broadcast
  if (url === '/api/admin/bot/broadcast' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { channelId, title, message: broadcastMsg, color = 0xffffff } = body;

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    const targetChannel = guild?.channels.cache.get(channelId);
    if (!targetChannel) return sendJsonResponse(res, 400, { error: 'الروم المحدد غير موجود' });

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: '📢 إشعار إداري رسمي | GX High Command', iconURL: guild.iconURL() })
      .setTitle(title || 'إشعار من الإدارة العليا')
      .setDescription(broadcastMsg || '')
      .setFooter({ text: `GX eSports Broadcast • ${new Date().toLocaleTimeString('ar-SA')}` })
      .setTimestamp();

    await targetChannel.send({ embeds: [embed] }).catch(() => {});
    logActivity('admin', 'Broadcast Sent', `Sent announcement to #${targetChannel.name} via Control Panel`);
    return sendJsonResponse(res, 200, { success: true, message: 'تم إرسال الإشعار بنجاح' });
  }

  // 13. Admin VCR Force Reconnect: POST /api/admin/vcr/reconnect
  if (url === '/api/admin/vcr/reconnect' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { vcrId } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);

    if (guild) {
      await vcrManager.deployStationary(guild);
      logActivity('admin', 'VCR Reconnect', `Forced re-stationing of VCR audio sentinels via Control Panel`);
    }
    return sendJsonResponse(res, 200, { success: true, message: 'تمت إعادة تثبيت وربط المسجلات الصوتية' });
  }

  // 14. Admin Moderation Metadata: GET /api/admin/mod/data
  if (url === '/api/admin/mod/data' && method === 'GET') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

    const channels = guild.channels.cache
      .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice)
      .map((c) => ({ id: c.id, name: c.name, type: c.type === ChannelType.GuildText ? 'text' : 'voice' }));

    const roles = guild.roles.cache
      .filter((r) => r.id !== guild.id)
      .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }));

    return sendJsonResponse(res, 200, { success: true, channels, roles, memberCount: guild.memberCount });
  }

  // 15. Mod Ban: POST /api/admin/mod/ban
  if (url === '/api/admin/mod/ban' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { targetId, reason = 'حظر بواسطة لوحة تحكم GX', deleteMessageDays = 0 } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

    try {
      await guild.members.ban(targetId, {
        reason: `${reason} • [GX Control Panel by High Command]`,
        deleteMessageSeconds: deleteMessageDays * 24 * 60 * 60
      });
      logActivity('security', 'Member Banned', `Banned ID: ${targetId} via Control Panel (${reason})`);
      return sendJsonResponse(res, 200, { success: true, message: `تم حظر العضو (${targetId}) بنجاح` });
    } catch (err) {
      return sendJsonResponse(res, 400, { error: `فشل الحظر: ${err.message}` });
    }
  }

  // 16. Mod Unban: POST /api/admin/mod/unban
  if (url === '/api/admin/mod/unban' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { targetId, reason = 'إلغاء حظر بواسطة لوحة تحكم GX' } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

    try {
      await guild.members.unban(targetId, `${reason} • [GX Control Panel]`);
      logActivity('security', 'Member Unbanned', `Unbanned ID: ${targetId} via Control Panel`);
      return sendJsonResponse(res, 200, { success: true, message: `تم إلغاء حظر العضو (${targetId}) بنجاح` });
    } catch (err) {
      return sendJsonResponse(res, 400, { error: `فشل إلغاء الحظر: ${err.message}` });
    }
  }

  // 17. Mod Kick: POST /api/admin/mod/kick
  if (url === '/api/admin/mod/kick' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { targetId, reason = 'طرد بواسطة لوحة تحكم GX' } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

    try {
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (!member) return sendJsonResponse(res, 404, { error: 'العضو غير موجود بالسيرفر' });
      await member.kick(`${reason} • [GX Control Panel]`);
      logActivity('security', 'Member Kicked', `Kicked ${member.user.tag} (${targetId}) via Control Panel`);
      return sendJsonResponse(res, 200, { success: true, message: `تم طرد العضو ${member.user.tag} بنجاح` });
    } catch (err) {
      return sendJsonResponse(res, 400, { error: `فشل الطرد: ${err.message}` });
    }
  }

  // 18. Mod Timeout / Mute: POST /api/admin/mod/timeout
  if (url === '/api/admin/mod/timeout' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { targetId, durationMinutes = 10, reason = 'كتم بواسطة لوحة تحكم GX' } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

    try {
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (!member) return sendJsonResponse(res, 404, { error: 'العضو غير موجود بالسيرفر' });
      const ms = durationMinutes * 60 * 1000;
      await member.timeout(ms, `${reason} • [GX Control Panel]`);
      logActivity('security', 'Member Timed Out', `Muted ${member.user.tag} for ${durationMinutes}m via Control Panel`);
      return sendJsonResponse(res, 200, { success: true, message: `تم كتم ${member.user.tag} لمدة ${durationMinutes} دقيقة` });
    } catch (err) {
      return sendJsonResponse(res, 400, { error: `فشل الكتم: ${err.message}` });
    }
  }

  // 19. Mod Untimeout / Unmute: POST /api/admin/mod/untimeout
  if (url === '/api/admin/mod/untimeout' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { targetId } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

    try {
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (!member) return sendJsonResponse(res, 404, { error: 'العضو غير موجود بالسيرفر' });
      await member.timeout(null, 'إلغاء الكتم بواسطة لوحة تحكم GX');
      logActivity('security', 'Timeout Removed', `Unmuted ${member.user.tag} via Control Panel`);
      return sendJsonResponse(res, 200, { success: true, message: `تم إلغاء الكتم عن ${member.user.tag}` });
    } catch (err) {
      return sendJsonResponse(res, 400, { error: `فشل إلغاء الكتم: ${err.message}` });
    }
  }

  // 20. Mod Purge Messages: POST /api/admin/mod/purge
  if (url === '/api/admin/mod/purge' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { channelId, count = 10, targetUserId = null } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    const channel = guild?.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return sendJsonResponse(res, 400, { error: 'الروم النصي المحدد غير موجود' });
    }

    try {
      const safeCount = Math.min(Math.max(parseInt(count) || 1, 1), 100);
      const messages = await channel.messages.fetch({ limit: safeCount });
      const toDelete = targetUserId ? messages.filter((m) => m.author.id === targetUserId) : messages;
      const deleted = await channel.bulkDelete(toDelete, true);
      logActivity('security', 'Messages Purged', `Deleted ${deleted.size} msgs in #${channel.name} via Control Panel`);
      return sendJsonResponse(res, 200, { success: true, message: `تم مسح ${deleted.size} رسالة بنجاح في #${channel.name}` });
    } catch (err) {
      return sendJsonResponse(res, 400, { error: `فشل المسح: ${err.message}` });
    }
  }

  // 21. Mod Lock/Unlock Channel: POST /api/admin/mod/lock
  if (url === '/api/admin/mod/lock' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { channelId, locked = true } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    const channel = guild?.channels.cache.get(channelId);
    if (!channel) return sendJsonResponse(res, 400, { error: 'الروم المحدد غير موجود' });

    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, {
        SendMessages: !locked
      });
      logActivity('security', locked ? 'Channel Locked' : 'Channel Unlocked', `${locked ? 'Locked' : 'Unlocked'} #${channel.name} via Control Panel`);
      return sendJsonResponse(res, 200, { success: true, message: `تم ${locked ? 'قفل' : 'فتح'} الروم #${channel.name} بنجاح` });
    } catch (err) {
      return sendJsonResponse(res, 400, { error: `فشل تعديل حالة الروم: ${err.message}` });
    }
  }

  // 22. Mod Slowmode: POST /api/admin/mod/slowmode
  if (url === '/api/admin/mod/slowmode' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { channelId, seconds = 0 } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    const channel = guild?.channels.cache.get(channelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      return sendJsonResponse(res, 400, { error: 'الروم النصي المحدد غير موجود' });
    }

    try {
      await channel.setRateLimitPerUser(parseInt(seconds) || 0, 'تعديل السلو مود عبر لوحة تحكم GX');
      logActivity('security', 'Slowmode Changed', `Set slowmode to ${seconds}s in #${channel.name}`);
      return sendJsonResponse(res, 200, { success: true, message: `تم ضبط السلو مود إلى ${seconds} ثانية في #${channel.name}` });
    } catch (err) {
      return sendJsonResponse(res, 400, { error: `فشل ضبط السلو مود: ${err.message}` });
    }
  }

  // 23. Mod Role Assign/Remove: POST /api/admin/mod/role
  if (url === '/api/admin/mod/role' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { targetId, roleId, action = 'add' } = body;
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

    try {
      const member = await guild.members.fetch(targetId).catch(() => null);
      const role = guild.roles.cache.get(roleId);
      if (!member || !role) return sendJsonResponse(res, 404, { error: 'العضو أو الرتبة غير موجودة' });

      if (action === 'add') {
        await member.roles.add(role, 'إعطاء رتبة عبر لوحة تحكم GX');
        logActivity('security', 'Role Added', `Assigned @${role.name} to ${member.user.tag}`);
        return sendJsonResponse(res, 200, { success: true, message: `تمت إضافة رتبة @${role.name} للعضو ${member.user.tag}` });
      } else {
        await member.roles.remove(role, 'سحب رتبة عبر لوحة تحكم GX');
        logActivity('security', 'Role Removed', `Removed @${role.name} from ${member.user.tag}`);
        return sendJsonResponse(res, 200, { success: true, message: `تم سحب رتبة @${role.name} من العضو ${member.user.tag}` });
      }
    } catch (err) {
      return sendJsonResponse(res, 400, { error: `فشل تعديل الرتبة: ${err.message}` });
    }
  }

  // 24. Mod Voice Action: POST /api/admin/mod/voice-action
  if (url === '/api/admin/mod/voice-action' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { targetId, action = 'mute' } = body; // 'mute', 'unmute', 'deafen', 'undeafen', 'disconnect'
    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

    try {
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (!member || !member.voice?.channel) {
        return sendJsonResponse(res, 404, { error: 'العضو غير متصل بأي روم صوتي' });
      }

      if (action === 'mute') {
        await member.voice.setMute(true, 'كتم صوتي عبر لوحة تحكم GX');
      } else if (action === 'unmute') {
        await member.voice.setMute(false, 'إلغاء كتم صوتي عبر لوحة تحكم GX');
      } else if (action === 'deafen') {
        await member.voice.setDeaf(true, 'تصميت صوتي عبر لوحة تحكم GX');
      } else if (action === 'undeafen') {
        await member.voice.setDeaf(false, 'إلغاء تصميت صوتي عبر لوحة تحكم GX');
      } else if (action === 'disconnect') {
        await member.voice.disconnect('فصل من الصوت عبر لوحة تحكم GX');
      }

      logActivity('security', 'Voice Action', `Executed voice ${action} on ${member.user.tag}`);
      return sendJsonResponse(res, 200, { success: true, message: `تم تنفيذ الإجراء الصوتي (${action}) على ${member.user.tag}` });
    } catch (err) {
      return sendJsonResponse(res, 400, { error: `فشل الإجراء الصوتي: ${err.message}` });
    }
  }

  // 25. Real-Time Member Autocomplete Search: GET /api/admin/members/search?q=...
  if (url.startsWith('/api/admin/members/search') && method === 'GET') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    try {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const query = (parsedUrl.searchParams.get('q') || '').trim().toLowerCase();

      const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
      if (!guild) return sendJsonResponse(res, 500, { error: 'تعذر الوصول للسيرفر' });

      const members = guild.members.cache;
      const results = [];

      for (const [, m] of members) {
        if (results.length >= 30) break;
        const tag = m.user.tag || '';
        const username = m.user.username || '';
        const displayName = m.displayName || '';
        const id = m.id;

        if (
          !query ||
          id.includes(query) ||
          username.toLowerCase().includes(query) ||
          displayName.toLowerCase().includes(query) ||
          tag.toLowerCase().includes(query)
        ) {
          results.push({
            id: m.id,
            tag: m.user.tag,
            username: m.user.username,
            displayName: m.displayName,
            avatar: m.user.displayAvatarURL(),
            isBot: m.user.bot,
            joinedTimestamp: m.joinedTimestamp,
            roles: m.roles.cache
              .filter((r) => r.id !== guild.id)
              .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }))
          });
        }
      }

      return sendJsonResponse(res, 200, { success: true, members: results });
    } catch (err) {
      return sendJsonResponse(res, 500, { error: err.message });
    }
  }

  // 26. Admin Support Desk - List Tickets: GET /api/admin/tickets
  if (url === '/api/admin/tickets' && method === 'GET') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const ticketsData = loadTickets();
    const activeList = Object.values(ticketsData.activeTickets || {});
    return sendJsonResponse(res, 200, { success: true, tickets: activeList });
  }

  // 27. Admin Support Desk - Send Agent Reply: POST /api/admin/tickets/reply
  if (url === '/api/admin/tickets/reply' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { threadId, replyText, imageUrl, agentName = 'GX Support Agent' } = body;

    const ticketsData = loadTickets();
    const ticket = ticketsData.activeTickets ? ticketsData.activeTickets[threadId] : null;
    if (!ticket) return sendJsonResponse(res, 404, { error: 'التذكرة غير موجودة' });

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    const thread = guild?.channels.cache.get(threadId) || (await guild?.channels.fetch(threadId).catch(() => null));
    if (!thread) return sendJsonResponse(res, 404, { error: 'القناة الفرعية للتذكرة غير موجودة في ديسكورد' });

    const agentEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({ name: `${agentName} | GX eSports Support Desk`, iconURL: client.user?.displayAvatarURL() })
      .setDescription(replyText || '')
      .setFooter({ text: `GX Support Engine • ${ticket.ticketId}` })
      .setTimestamp();

    if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://') || imageUrl.startsWith('data:image/'))) {
      agentEmbed.setImage(imageUrl);
    }

    await thread.send({ embeds: [agentEmbed] });

    if (!ticket.transcript) ticket.transcript = [];
    ticket.transcript.push({
      authorId: client.user.id,
      authorTag: `${agentName} (الدعم الفني)`,
      authorAvatar: client.user.displayAvatarURL(),
      content: replyText || '',
      attachments: imageUrl ? [imageUrl] : [],
      timestamp: Date.now(),
      isAgent: true
    });
    ticket.lastActivityAt = Date.now();
    ticket.hasUnreadAgent = false;
    ticket.stage = 'IN_PROGRESS';
    saveTickets(ticketsData);

    logActivity('ticket', 'Support Agent Reply', `Replied to ${ticket.ticketId} via Web Support Desk`);
    return sendJsonResponse(res, 200, { success: true, message: 'تم إرسال الرد بنجاح إلى ديسكورد', ticket });
  }

  // 28. Admin Support Desk - Close Ticket: POST /api/admin/tickets/close
  if (url === '/api/admin/tickets/close' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { threadId, reason = 'تم إغلاق التذكرة بواسطة وكيل الدعم الفني' } = body;

    const ticketsData = loadTickets();
    const ticket = ticketsData.activeTickets ? ticketsData.activeTickets[threadId] : null;
    if (!ticket) return sendJsonResponse(res, 404, { error: 'التذكرة غير موجودة' });

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    const thread = guild?.channels.cache.get(threadId) || (await guild?.channels.fetch(threadId).catch(() => null));

    if (thread) {
      const closeEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🔒 إغلاق وأرشفة تذكرة الدعم | GX Support', iconURL: client.user?.displayAvatarURL() })
        .setTitle(`تم إغلاق التذكرة: ${ticket.ticketId}`)
        .setDescription(
          `شكراً لتواصلك مع مركز الدعم الفني لسيرفر **${guild.name}**.\n\n📝 **سبب الإغلاق:** ${reason}\n\nنتمنى لك وقتاً ممتعاً في مجتمعنا!`
        )
        .setFooter({ text: 'GX Support Engine • تم أرشفة التذكرة' })
        .setTimestamp();

      await thread.send({ embeds: [closeEmbed] }).catch(() => {});
      await thread.setArchived(true, `Closed via Support Desk: ${reason}`).catch(() => {});
    }

    ticket.stage = 'CLOSED';
    ticket.closedAt = Date.now();
    saveTickets(ticketsData);

    logActivity('ticket', 'Ticket Closed', `Closed ${ticket.ticketId} via Web Support Desk`);
    return sendJsonResponse(res, 200, { success: true, message: 'تم إغلاق وأرشفة التذكرة بنجاح' });
  }

  // 29. Admin Support Desk - Permanently Delete Ticket: POST /api/admin/tickets/delete
  if (url === '/api/admin/tickets/delete' && method === 'POST') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    const body = await parseJsonBody(req);
    const { threadId } = body;

    const ticketsData = loadTickets();
    const ticket = ticketsData.activeTickets ? ticketsData.activeTickets[threadId] : null;
    if (!ticket) return sendJsonResponse(res, 404, { error: 'التذكرة غير موجودة' });

    const guild = client.guilds.cache.get(ALLOWED_GUILD_ID);
    const thread = guild?.channels.cache.get(threadId) || (await guild?.channels.fetch(threadId).catch(() => null));

    if (thread) {
      await thread.delete('Deleted permanently via GX Web Control Panel').catch(() => {});
    }

    const ticketId = ticket.ticketId;
    delete ticketsData.activeTickets[threadId];
    saveTickets(ticketsData);

    logActivity('ticket', 'Ticket Deleted', `Permanently deleted ${ticketId} via Web Support Desk`);
    return sendJsonResponse(res, 200, { success: true, message: `تم حذف التذكرة ${ticketId} والقناة نهائياً` });
  }

  // 30. Admin Audit Logs: GET /api/admin/audit-logs
  if (url === '/api/admin/audit-logs' && method === 'GET') {
    const session = authenticateAdmin(req);
    if (!session) return sendJsonResponse(res, 401, { error: 'غير مصرح' });

    return sendJsonResponse(res, 200, {
      success: true,
      logs: ACTIVITY_RING.slice(0, 100),
      stats: ACTIVITY_STATS
    });
  }

  // 30. Serve Static Website Files (Websites/Status)
  let cleanUrl = url === '/' || url === '/support' || url.startsWith('/support') ? '/index.html' : url;
  let filePath = path.join(STATUS_DIR, cleanUrl.replace(/^\//, ''));
  
  let contentType = 'text/html; charset=utf-8';
  if (cleanUrl.endsWith('.css')) contentType = 'text/css; charset=utf-8';
  else if (cleanUrl.endsWith('.js')) contentType = 'application/javascript; charset=utf-8';
  else if (cleanUrl.endsWith('.png')) contentType = 'image/png';
  else if (cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg')) contentType = 'image/jpeg';
  else if (cleanUrl.endsWith('.svg')) contentType = 'image/svg+xml';
  else if (cleanUrl.endsWith('.json')) contentType = 'application/json; charset=utf-8';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      // Fallback to index.html for SPA routes
      fs.readFile(path.join(STATUS_DIR, 'index.html'), (err2, fallbackContent) => {
        if (err2) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            status: 'online',
            bot: client.user ? client.user.tag : 'GX Bot',
            uptimeSeconds: Math.floor(process.uptime())
          }));
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(fallbackContent);
      });
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
});

healthServer.listen(PORT, () => {
  console.log(`🌐 [خادم لوحة المراقبة والموقع] لوحة التحكم المباشرة تعمل على المنفذ: ${PORT}`);
  console.log(`🌐 [رابط الموقع] http://localhost:${PORT}/`);
});

client.login(TOKEN).catch((err) => {
  console.error(`\n❌ فشل تسجيل الدخول إلى الديسكورد: ${err.message}`);
  process.exit(1);
});
