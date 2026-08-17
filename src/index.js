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
  AudioPlayerStatus
} from '@discordjs/voice';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

let BOT_VERSION = '1.0';
let TOKEN = process.env.DISCORD_TOKEN;
let ALLOWED_GUILD_ID = process.env.ALLOWED_GUILD_ID?.trim();
let AUTO_ROLE_NAME = process.env.AUTO_ROLE_NAME?.trim() || 'MEMBER';
let AUTO_ROLE_ID = process.env.AUTO_ROLE_ID?.trim();
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
const COMMANDS_CONFIG_FILE = path.resolve('src', 'commands.json');

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
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WELCOMED_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.error('خطأ في حفظ ملف الأعضاء المرحب بهم:', err.message);
  }
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
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WELCOME_TRACKER_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
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
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATUS_MSG_FILE, JSON.stringify({ messageId }), 'utf-8');
  } catch {}
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
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WARNINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
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
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TICKETS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
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
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TICKET_PANEL_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
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
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DM_SECURITY_SENT_FILE, JSON.stringify(list, null, 2), 'utf-8');
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
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USER_INFRACTIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
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
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INFRACTIONS_META_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
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
    GatewayIntentBits.GuildMessageReactions
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

/**
 * Checks if a member has the MANAGERS role or Administrator permission (Voice Immunity).
 */
function isManagerMember(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
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

// ----------------------------------------------------
// 📜 Slash Commands Generator from JSON
// ----------------------------------------------------
function buildSlashCommandsFromJson() {
  const commandsDef = loadCommandsConfig();

  return commandsDef.map((def) => {
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

    const audioPath = path.resolve('assets', 'audio', 'loop_track.mp3');
    if (fs.existsSync(audioPath)) {
      currentAudioResource = createAudioResource(audioPath, { inlineVolume: true });
      if (currentAudioResource.volume) {
        currentAudioResource.volume.setVolume(currentVolumeLevel);
      }
      currentVoicePlayer.play(currentAudioResource);
      connection.subscribe(currentVoicePlayer);
      console.log(`🎶 [البث الصوتي] تشغيل مقطع الصوت الهادئ بمستوى صوت منخفض (${Math.round(currentVolumeLevel * 100)}%) بنظام التكرار المستمر.`);
    } else {
      console.warn('⚠️ [تنبيه] ملف الصوت loop_track.mp3 غير موجود في مجلد assets/audio/');
    }
  } catch (err) {
    console.error('❌ خطأ في تشغيل البث الصوتي:', err.message);
  }
}

function connectToVoiceChannel(channel) {
  try {
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    });

    currentVoiceConnection = connection;

    connection.on(VoiceConnectionStatus.Ready, () => {
      console.log(`🔊 [الفويس] البوت متصل وجاهز في #${channel.name}. جارٍ بدء تشغيل الصوت في حلقة لا نهائية...`);
      playLoopAudio(connection);
    });

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      console.log('🔌 تم فصل اتصال البوت الصوتي.');
      disconnectVoice();
    });

    // Start playing immediately
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

function findAutoRole(guild) {
  if (!guild) return null;
  if (AUTO_ROLE_ID) {
    const roleById = guild.roles.cache.get(AUTO_ROLE_ID);
    if (roleById) return roleById;
  }
  return guild.roles.cache.find(
    (r) => r.name.toLowerCase() === AUTO_ROLE_NAME.toLowerCase()
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

  const managersRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'managers' || r.name.toLowerCase() === 'manager');

  let thread;
  try {
    thread = await baseChannel.threads.create({
      name: ticketCode,
      autoArchiveDuration: 1440,
      type: ChannelType.PrivateThread,
      reason: `تذكرة دعم فني جديدة بواسطة ${user.tag}`
    });
  } catch (e) {
    thread = await baseChannel.threads.create({
      name: ticketCode,
      autoArchiveDuration: 1440,
      type: ChannelType.PublicThread,
      reason: `تذكرة دعم فني جديدة بواسطة ${user.tag}`
    });
  }

  // 1. جلب كافة الأعضاء وإضافة صاحب التذكرة وجميع الإداريين
  const allMembers = await guild.members.fetch().catch(() => guild.members.cache);
  await thread.members.add(user.id).catch(() => {});
  for (const [, m] of allMembers) {
    if (isManagerMember(m)) {
      await thread.members.add(m.id).catch(() => {});
    }
  }

  if (!ticketsData.activeTickets) ticketsData.activeTickets = {};
  ticketsData.activeTickets[thread.id] = {
    ticketId: ticketCode,
    threadId: thread.id,
    userId: user.id,
    userTag: user.tag,
    channelId: baseChannel.id,
    stage: 'WAITING_CLAIM',
    realName: realName,
    reason: reason,
    claimedBy: null,
    claimedByTag: null,
    openedAt: Date.now(),
    transcript: []
  };
  saveTickets(ticketsData);

  // 1. رسالة الانتظار الكبيرة لصاحب التذكرة
  const waitingEmbed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle('⏳ في انتظار وكيل الدعم للحضور...')
    .setDescription(
      `# ⏳ مرحباً بك يا <@${user.id}>\n` +
      `> ### 📢 تم تسجيل طلبك وإشعار فريق الإدارة بنجاح.\n` +
      `> ### يرجى الانتظار في هذه القناة، سيتصل بك وكيل الدعم قريباً لمساعدتك!`
    )
    .setFooter({ text: `GX eSports Support Engine • ${ticketCode}` })
    .setTimestamp();

  await thread.send({
    content: `<@${user.id}>`,
    embeds: [waitingEmbed]
  });

  // 2. بطاقة التقرير الإداري للمشرفين مع زر السحب
  const summaryEmbed = new EmbedBuilder()
    .setColor(0x00D26A)
    .setAuthor({ name: '📋 تقرير وبيانات طلب الدعم الفني', iconURL: user.displayAvatarURL() })
    .setTitle(`تقرير التذكرة: ${ticketCode}`)
    .setDescription(
      `# 📋 بيانات الملف الإداري للطلب:\n` +
      `> 👤 **صاحب التذكرة:** <@${user.id}> (\`${user.tag}\`)\n` +
      `> 📛 **الاسم الحقيقي:** \`${realName}\`\n` +
      `> 📝 **سبب التذكرة:** ${reason}\n` +
      `> ⏰ **وقت الفتح:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
      `> 🌐 **عنوان IP:** \`محمي بسياسة خصوصية Discord API\` 🛡️`
    )
    .setFooter({ text: `GX eSports Support Engine • اضغط أدناه لسحب واستلام التذكرة` })
    .setTimestamp();

  const claimBtn = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_ticket_${thread.id}`)
      .setLabel('🙋‍♂️ سحب التذكرة واستلام الطلب')
      .setStyle(ButtonStyle.Primary)
  );

  await thread.send({
    content: `${managersRole ? `<@&${managersRole.id}>` : '@MANAGERS'} • تذكرة جديدة جاهزة للاستلام!`,
    embeds: [summaryEmbed],
    components: [claimBtn],
    allowedMentions: { parse: ['roles', 'users'] }
  });

  const logEmbed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setAuthor({ name: '🎫 فتح تذكرة دعم جديدة', iconURL: user.displayAvatarURL() })
    .setDescription(`قام العضو <@${user.id}> (\`${user.tag}\`) بفتح تذكرة جديدة: <#${thread.id}> (\`${ticketCode}\`).`)
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
 * Fetches recent audit log executor for an action immediately.
 */
async function fetchAuditExecutor(guild, auditType) {
  try {
    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;

    const fetchedLogs = await guild.fetchAuditLogs({
      limit: 1,
      type: auditType
    });
    const entry = fetchedLogs.entries.first();
    if (entry && (Date.now() - entry.createdTimestamp) < 8000) {
      return entry.executor;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Syncs the MEMBER role to regular server members, and removes MEMBER from MANAGERS.
 */
async function syncAllMembersRole(guild, fetchRemote = false) {
  if (!guild || isSyncingRoles) return { count: 0, total: 0, removedCount: 0 };

  isSyncingRoles = true;

  try {
    const role = findAutoRole(guild);
    if (!role) {
      isSyncingRoles = false;
      return { count: 0, total: 0, removedCount: 0, error: `الرتبة "${AUTO_ROLE_NAME}" غير موجودة بالسيرفر` };
    }

    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles) || botMember.roles.highest.comparePositionTo(role) <= 0) {
      isSyncingRoles = false;
      return { count: 0, total: 0, removedCount: 0, error: 'صلاحيات إدارة الرتب غير مكتملة أو رتبة البوت أدنى من رتبة MEMBER' };
    }

    const members = fetchRemote ? await guild.members.fetch().catch(() => guild.members.cache) : guild.members.cache;
    const humanMembers = members.filter((m) => !m.user.bot);

    let givenCount = 0;
    let removedCount = 0;

    for (const [, member] of humanMembers) {
      const isManager = isManagerMember(member);
      const hasMemberRole = member.roles.cache.has(role.id);

      // 1. If Manager has MEMBER role -> REMOVE IT!
      if (isManager && hasMemberRole) {
        try {
          await member.roles.remove(role);
          removedCount++;
          console.log(`🗑️ [إزالة رتبة] تم بنجاح سحب رتبة "${role.name}" من العضو الإداري (${member.user.tag}) لحمله رتبة MANAGERS.`);

          const logEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setAuthor({ name: '👑 إزالة رتبة الأعضاء من الإدارة', iconURL: member.user.displayAvatarURL() })
            .setDescription(`تم سحب رتبة <@&${role.id}> من الإداري <@${member.id}> (\`${member.user.tag}\`) لحمله رتبة **MANAGERS** 🛡️.`)
            .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
            .setTimestamp();
          await sendToLogChannel(guild, logEmbed);

          await new Promise((res) => setTimeout(res, 400));
        } catch (err) {
          console.error(`❌ تعذر إزالة الرتبة من الإداري ${member.user.tag}:`, err.message);
        }
      }

      // 2. If Regular Member doesn't have MEMBER role -> ADD IT!
      else if (!isManager && !hasMemberRole) {
        try {
          await member.roles.add(role);
          givenCount++;
          console.log(`✅ [ترقية عضو] تم إعطاء رتبة "${role.name}" للعضو: ${member.user.tag}`);

          const logEmbed = new EmbedBuilder()
            .setColor(0x57F287)
            .setAuthor({ name: '👑 ترقية عضو تلقائياً', iconURL: member.user.displayAvatarURL() })
            .setDescription(`تم منح رتبة <@&${role.id}> للعضو <@${member.id}> (\`${member.user.tag}\`).`)
            .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
            .setTimestamp();
          await sendToLogChannel(guild, logEmbed);

          await new Promise((res) => setTimeout(res, 400));
        } catch (err) {
          console.error(`❌ تعذر إعطاء الرتبة للعضو ${member.user.tag}:`, err.message);
        }
      }
    }

    isSyncingRoles = false;
    return { count: givenCount, removedCount, total: humanMembers.size };
  } catch (err) {
    console.error('خطأ أثناء مزامنة الرتب:', err.message);
    isSyncingRoles = false;
    return { count: 0, removedCount: 0, total: 0, error: err.message };
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

// ----------------------------------------------------
// EVENT: Ready
// ----------------------------------------------------
client.once(Events.ClientReady, async (c) => {
  console.log(`\n======================================================`);
  console.log(`🤖 تم تسجيل الدخول بنجاح باسم: ${c.user.tag} (المعرف: ${c.user.id})`);
  console.log(`📦 إصدار البوت: ${BOT_VERSION}`);
  console.log(`🛡️  معرف السيرفر المعتمد: ${ALLOWED_GUILD_ID || '[غير محدد]'}`);
  console.log(`👑 رتبة العضو التلقائية: "${AUTO_ROLE_NAME}"`);
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
      await syncActiveTicketsMembers(guild);
      await syncAllMembersRole(guild, true);
      await welcomeExistingMembersSequentially(guild);
      await checkAndResetBiweeklyInfractions(guild);
      sendSecurityDMToExistingMembers(guild);

      // Start 30s recurring role sync & security check
      setInterval(async () => {
        try {
          await syncAllMembersRole(guild, false);
          await checkAndResetBiweeklyInfractions(guild);
        } catch (err) {
          console.error('خطأ في المزامنة الدورية:', err.message);
        }
      }, 30 * 1000);
      console.log(`⏱️ [المزامنة التلقائية] تم تفعيل فحص وترقية الأعضاء كل 30 ثانية في الخلفية.`);

      // Start 10-second live system status loop
      setInterval(async () => {
        try {
          await updateLiveSystemStatus(guild);
        } catch (err) {
          // ignore
        }
      }, 10 * 1000);
      console.log(`📊 [لوحة النظام الحية] تم تفعيل التحديث التلقائي كل 10 ثوان في #system-status.`);
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
  if (newState.guild.id !== ALLOWED_GUILD_ID) return;
  const member = newState.member;
  if (!member) return;

  const botMember = newState.guild.members.me;
  const botVoiceChannelId = botMember?.voice?.channelId;

  // 1. Anti-Drag & Anti-Disconnect Protection for Bot
  if (member.id === client.user.id) {
    // A. Anti-Drag (Moved manually to another room without authorization)
    if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      if (!isAuthorizedBotMove) {
        console.warn(`🛡️ [حماية الفويس] تم رصد محاولة سحب يدوي للبوت من #${oldState.channel?.name} إلى #${newState.channel?.name}. جارٍ العودة فوراً...`);

        const previousChannel = oldState.channel;
        if (previousChannel) {
          setAuthorizedMove();
          connectToVoiceChannel(previousChannel);

          const executor = await fetchAuditExecutor(newState.guild, AuditLogEvent.MemberMove);

          const returnEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setAuthor({ name: '🛡️ نظام حماية الفويس | GX eSports', iconURL: client.user?.displayAvatarURL() })
            .setTitle('⛔ منع السحب اليدوي للبوت (Anti-Drag Protection)')
            .setDescription(
              `تم رصد محاولة سحب يدوي للبوت من قِبل ${executor ? `<@${executor.id}> (\`${executor.tag}\`)` : 'أحد الأعضاء'} إلى الروم **#${newState.channel?.name}**.\n\n` +
              `🔒 **البوت مملوك حصرياً للمستدعي الأول (<@${currentVoiceOwner?.userId || 'المستدعي'}>) وقام بالعودة فوراً إلى رومه:** <#${previousChannel.id}> (\`#${previousChannel.name}\`).`
            )
            .setFooter({ text: `GX eSports Voice Security • الإصدار ${BOT_VERSION}` })
            .setTimestamp();

          await sendToLogChannel(newState.guild, returnEmbed);
        }
        return;
      }
    }

    // B. Anti-Disconnect (Disconnected manually without /مغادرة by owner)
    if (oldState.channelId && !newState.channelId) {
      if (!isAuthorizedBotMove && currentVoiceOwner) {
        const previousChannel = oldState.channel || newState.guild.channels.cache.get(currentVoiceOwner.channelId);
        const ownerMember = previousChannel ? previousChannel.members.get(currentVoiceOwner.userId) : null;

        if (previousChannel && ownerMember) {
          console.warn(`🛡️ [حماية الفويس] تم رصد فصل يدوي غير مصرح به للبوت أثناء تواجد مالكه ${currentVoiceOwner.userTag}. جارٍ إعادة الاتصال فوراً...`);

          setAuthorizedMove();
          connectToVoiceChannel(previousChannel);

          const executor = await fetchAuditExecutor(newState.guild, AuditLogEvent.MemberDisconnect);

          const reconEmbed = new EmbedBuilder()
            .setColor(0xED4245)
            .setAuthor({ name: '🛡️ نظام حماية الفويس | GX eSports', iconURL: client.user?.displayAvatarURL() })
            .setTitle('⛔ منع الفصل اليدوي للبوت (Anti-Disconnect Protection)')
            .setDescription(
              `تم رصد محاولة فصل يدوي للبوت من قِبل ${executor ? `<@${executor.id}> (\`${executor.tag}\`)` : 'أحد الأعضاء'}.\n\n` +
              `🔒 **البوت مملوك حصرياً للمستدعي الأول <@${currentVoiceOwner.userId}> ولن يغادر طالما مالكه متواجد بالروم!**\n` +
              `✅ تمت إعادة اتصال البوت وتشغيل الصوت فوراً في: <#${previousChannel.id}>.`
            )
            .setFooter({ text: `GX eSports Voice Security • الإصدار ${BOT_VERSION}` })
            .setTimestamp();

          await sendToLogChannel(newState.guild, reconEmbed);
          return;
        }
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
client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== ALLOWED_GUILD_ID) return;
  console.log(`👋 انضمام عضو جديد: ${member.user.tag} (${member.id})`);

  try {
    if (member.partial) await member.fetch();

    const role = findAutoRole(member.guild);
    const botMember = member.guild.members.me;

    if (role && botMember?.permissions.has(PermissionFlagsBits.ManageRoles) && botMember.roles.highest.comparePositionTo(role) > 0) {
      if (!member.user.bot && !isManagerMember(member)) {
        await member.roles.add(role);
        console.log(`✅ [إعطاء رتبة] تم بنجاح منح رتبة "${role.name}" للعضو ${member.user.tag}!`);
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
    }

    // 2. Audit Log
    const isManager = isManagerMember(member);
    const logEmbed = new EmbedBuilder()
      .setColor(0x57F287)
      .setAuthor({ name: '📥 انضمام عضو جديد وترقيته', iconURL: member.user.displayAvatarURL() })
      .addFields(
        { name: '👤 العضو', value: `<@${member.id}> (\`${member.user.tag}\`)`, inline: true },
        { name: '🆔 المعرف (ID)', value: `\`${member.id}\``, inline: true },
        { name: '👑 الرتبة الممنوحة', value: isManager ? '`مستثنى (يحمل رتبة MANAGERS)` 🛡️' : (role ? `<@&${role.id}>` : 'لا توجد'), inline: true },
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
    changes.push(`**تغيير الاسم:** من \`${oldRole.name}\` ⬅️ إلى \`${newRole.name}\``);
  }
  if (oldRole.hexColor !== newRole.hexColor) {
    changes.push(`**تغيير اللون:** من \`${oldRole.hexColor}\` ⬅️ إلى \`${newRole.hexColor}\``);
  }
  if (oldRole.hoist !== newRole.hoist) {
    changes.push(`**فصل الرتبة في قائمة الأعضاء:** \`${newRole.hoist ? 'مفعل' : 'ملغى'}\``);
  }
  if (oldRole.mentionable !== newRole.mentionable) {
    changes.push(`**إمكانية المنشن للرتبة:** \`${newRole.mentionable ? 'مسموح للجميع' : 'مغلق'}\``);
  }
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
    changes.push(`**تم تعديل صلاحيات الرتبة.**`);
  }

  if (changes.length === 0) return;

  const logEmbed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setAuthor({ name: '👑 تعديل رتبة (Role Update)', iconURL: newRole.guild.iconURL() })
    .setTitle(`تم تعديل الرتبة: <@&${newRole.id}> (\`${newRole.name}\`)`)
    .addFields(
      { name: '🆔 معرف الرتبة', value: `\`${newRole.id}\``, inline: true },
      { name: '🎨 اللون الحالي', value: `\`${newRole.hexColor}\``, inline: true },
      { name: '📝 التغييرات التي تمت', value: changes.join('\n'), inline: false }
    );

  if (executor) {
    logEmbed.addFields({ name: '👮‍♂️ تم التعديل بواسطة', value: `<@${executor.id}> (\`${executor.tag}\`)`, inline: true });
  }

  logEmbed.setFooter({ text: `GX eSports Instant Logs • الإصدار ${BOT_VERSION}` }).setTimestamp();
  await sendToLogChannel(newRole.guild, logEmbed);
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

    // Auto-strip MEMBER role if user is/became a MANAGER
    if (isManagerMember(newMember)) {
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
        await interaction.reply({ embeds: [embed], flags: [1 << 6] }).catch(() => {});
      }
      if (interaction.guild) await handleUnauthorizedGuild(interaction.guild);
      return;
    }

    // ----------------------------------------------------
    // 🪟 MODAL SUBMIT HANDLER (Ticket Creation & Agent Reply)
    // ----------------------------------------------------
    if (interaction.isModalSubmit()) {
      // 1. استلام نافذة فتح التذكرة الخاصة (مرئية للمشتكي فقط 100%)
      if (interaction.customId === 'ticket_creation_modal') {
        await interaction.deferReply({ flags: [1 << 6] });

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
          flags: [1 << 6]
        });
      }


    }

    // ----------------------------------------------------
    // 🎫 BUTTON INTERACTIONS HANDLER (Tickets)
    // ----------------------------------------------------
    if (interaction.isButton()) {
      // 1. زر فتح تذكرة دعم فني (عرض نافذة إدخال خاصة ومباشرة)
      if (interaction.customId === 'open_ticket_btn') {
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
            flags: [1 << 6]
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
            flags: [1 << 6]
          });
        }

        const threadId = interaction.customId.replace('claim_ticket_', '');
        const ticketsData = loadTickets();
        const ticket = ticketsData.activeTickets ? ticketsData.activeTickets[threadId] : null;

        if (!ticket) {
          return interaction.reply({ content: '❌ لم يتم العثور على بيانات هذه التذكرة أو تم إغلاقها.', flags: [1 << 6] });
        }

        // 🛡️ فحص التنافس: في حال سبق وكيل آخر بسحب التذكرة
        if (ticket.claimedBy) {
          return interaction.reply({
            content: `⚠️ **عذراً يا زميلنا العزيز <@${interaction.user.id}>**، تم استلام وسحب هذه التذكرة بالفعل من قِبل الوكيل <@${ticket.claimedBy}> قبل لحظات. شكراً لسرعة استجابتك!`,
            flags: [1 << 6]
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
          flags: [1 << 6]
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
          return interaction.reply({ content: '❌ لم يتم العثور على بيانات هذه التذكرة.', flags: [1 << 6] });
        }

        const isAgent = ticket.claimedBy && interaction.user.id === ticket.claimedBy;
        const isCreator = interaction.user.id === ticket.userId;

        if (!isAgent && !isCreator && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({
            content: `⚠️ **عذراً يا زميلنا**، لا يمكن إغلاق هذه التذكرة إلا من قبل الوكيل المستلم لها (<@${ticket.claimedBy}>) أو صاحب التذكرة!`,
            flags: [1 << 6]
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
    }

    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    // 1. أمر /مسح و /clear
    if (commandName === 'clear' || commandName === 'مسح') {
      const amount = interaction.options.getInteger('العدد');
      const targetUser = interaction.options.getUser('المستخدم');

      await interaction.deferReply({ flags: [1 << 6] });

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

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو في السيرفر.', flags: [1 << 6] });
      }

      const botMember = interaction.guild.members.me;
      if (!targetMember.kickable || botMember.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0) {
        return interaction.reply({ content: '❌ لا يمكن طرد هذا العضو لأن رتبته أعلى من البوت أو يملك صلاحيات محمية.', flags: [1 << 6] });
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

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const botMember = interaction.guild.members.me;

      if (targetMember && (!targetMember.bannable || botMember.roles.highest.comparePositionTo(targetMember.roles.highest) <= 0)) {
        return interaction.reply({ content: '❌ لا يمكن حظر هذا العضو لأن رتبته أعلى من البوت أو يملك صلاحيات محمية.', flags: [1 << 6] });
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
        await interaction.reply({ content: `❌ تعذر فك الحظر: قد لا يكون هذا المعرف محظوراً أو غير صحيح (${err.message})`, flags: [1 << 6] });
      }
    }

    // 5. أمر /عزل
    else if (commandName === 'عزل') {
      const targetUser = interaction.options.getUser('المستخدم');
      const durationSeconds = parseInt(interaction.options.getString('المدة'));
      const reason = interaction.options.getString('السبب') || 'مخالفة القوانين';

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو.', flags: [1 << 6] });
      }

      if (isManagerMember(targetMember)) {
        return interaction.reply({ content: '❌ لا يمكن تطبيق تايم آوت على المشرفين والإدارة!', flags: [1 << 6] });
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
        return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو.', flags: [1 << 6] });
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
          flags: [1 << 6]
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
        await interaction.reply({ content: `❌ تعذر قفل القناة: ${err.message}`, flags: [1 << 6] });
      }
    }

    // 11. أمر /فتح
    else if (commandName === 'فتح') {
      try {
        await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
          SendMessages: null
        });

        const embed = new EmbedBuilder()
          .setColor(0x57F287)
          .setTitle('🔓 تم فتح القناة')
          .setDescription(`تم فتح القناة <#${interaction.channelId}> للجميع بواسطة <@${interaction.user.id}>.`)
          .setFooter({ text: `GX eSports • الإصدار ${BOT_VERSION}` });

        await interaction.reply({ embeds: [embed] });

        const logEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '🔓 فتح قناة', iconURL: interaction.user.displayAvatarURL() })
          .setDescription(`قام المشرف <@${interaction.user.id}> بفتح القناة <#${interaction.channelId}>.`)
          .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}` })
          .setTimestamp();
        await sendToLogChannel(interaction.guild, logEmbed);
      } catch (err) {
        await interaction.reply({ content: `❌ تعذر فتح القناة: ${err.message}`, flags: [1 << 6] });
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
      await interaction.deferReply();
      let unlockedCount = 0;

      const textChannels = interaction.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText);
      for (const [, ch] of textChannels) {
        try {
          await ch.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
          unlockedCount++;
        } catch {}
      }

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🔓 تم فتح جميع قنوات السيرفر')
        .setDescription(`تم فتح **${unlockedCount}** قناة نصية وإتاحة الكتابة للأعضاء بواسطة <@${interaction.user.id}>.`)
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` });

      await interaction.editReply({ embeds: [embed] });
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
        return interaction.reply({ content: '❌ لم يتم العثور على هذا العضو.', flags: [1 << 6] });
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
      const targetUser = interaction.options.getUser('المستخدم');
      const targetRole = interaction.options.getRole('الرتبة');

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const botMember = interaction.guild.members.me;

      if (botMember.roles.highest.comparePositionTo(targetRole) <= 0) {
        return interaction.reply({ content: '❌ رتبة البوت أدنى من هذه الرتبة ولا يمكنه منحها.', flags: [1 << 6] });
      }

      await targetMember.roles.add(targetRole);

      const embed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('👑 تم منح الرتبة بنجاح')
        .setDescription(`تم منح رتبة <@&${targetRole.id}> للعضو <@${targetUser.id}> بنجاح.`)
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` });

      await interaction.reply({ embeds: [embed] });
    }

    // 17. أمر /سحب_رتبة
    else if (commandName === 'سحب_رتبة') {
      const targetUser = interaction.options.getUser('المستخدم');
      const targetRole = interaction.options.getRole('الرتبة');

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const botMember = interaction.guild.members.me;

      if (botMember.roles.highest.comparePositionTo(targetRole) <= 0) {
        return interaction.reply({ content: '❌ رتبة البوت أدنى من هذه الرتبة ولا يمكنه سحبها.', flags: [1 << 6] });
      }

      await targetMember.roles.remove(targetRole);

      const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🗑️ تم سحب الرتبة بنجاح')
        .setDescription(`تم سحب رتبة <@&${targetRole.id}> من العضو <@${targetUser.id}> بنجاح.`)
        .setFooter({ text: `GX eSports Moderation • الإصدار ${BOT_VERSION}` });

      await interaction.reply({ embeds: [embed] });
    }


    // 19. أمر /استدعاء
    else if (commandName === 'استدعاء') {
      const member = interaction.member;
      const targetVoiceChannel = member?.voice?.channel;

      if (!targetVoiceChannel) {
        return interaction.reply({
          content: '❌ **يجب أن تكون متواجداً داخل روم صوتي لاستدعاء البوت!**',
          flags: [1 << 6]
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
          flags: [1 << 6]
        });
      }

      // إذا كان المستدعي الأصلي لا يزال في الروم، يُمنع منعاً باتاً سحب أو نقل البوت لأي عضو آخر
      if (isOwnerStillInChannel) {
        return interaction.reply({
          content: `🔒 **البوت مملوك ومستدعى حالياً بواسطة <@${currentVoiceOwner.userId}> في الروم <#${currentBotVoiceId}>!**\nلا يمكن سحب أو نقل البوت لأي روم آخر طالما المستدعي الأصلي متواجد معه في الفويس. يمكنك انتظار خروجه أو الانضمام إليهم.`,
          flags: [1 << 6]
        });
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
        return interaction.reply({ content: '❌ البوت ليس متواجداً في أي روم صوتي حالياً.', flags: [1 << 6] });
      }

      const isOwner = currentVoiceOwner && currentVoiceOwner.userId === interaction.user.id;
      const isGuildOwner = interaction.user.id === interaction.guild.ownerId;

      if (!isOwner && !isGuildOwner) {
        return interaction.reply({
          content: `❌ **عذراً، البوت مملوك حالياً للمستدعي الأول (<@${currentVoiceOwner?.userId}>).**\nفقط من قام باستدعاء البوت يمكنه فصله من الروم!`,
          flags: [1 << 6]
        });
      }

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
        return interaction.reply({ content: 'ℹ️ البوت ليس متصلاً بأي روم صوتي حالياً. يمكنك استخدام `/استدعاء` لاستدعائه.', flags: [1 << 6] });
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
        return interaction.reply({ content: '❌ البوت ليس متصلاً بروم صوتي حالياً.', flags: [1 << 6] });
      }

      const isOwner = currentVoiceOwner && currentVoiceOwner.userId === interaction.user.id;
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

      if (!isOwner && !isAdmin) {
        return interaction.reply({
          content: `❌ فقط المتحكم الحالي بالبوت (<@${currentVoiceOwner?.userId}>) أو الإدارة يمكنهم نقل صلاحية التحكم!`,
          flags: [1 << 6]
        });
      }

      const targetUser = interaction.options.getUser('المستخدم');
      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      if (!targetMember || targetMember.voice?.channelId !== botVoiceId) {
        return interaction.reply({
          content: `❌ يجب أن يكون العضو <@${targetUser.id}> متواجداً معك في نفس الروم الصوتي لنقل التحكم إليه!`,
          flags: [1 << 6]
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
        return interaction.reply({ content: '❌ البوت ليس متواجداً في روم صوتي حالياً.', flags: [1 << 6] });
      }

      const voiceChannel = interaction.guild.channels.cache.get(botVoiceId);
      const isOwner = currentVoiceOwner && currentVoiceOwner.userId === interaction.user.id;
      const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.MuteMembers);

      if (!isOwner && !hasPermission) {
        return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر.', flags: [1 << 6] });
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
        return interaction.reply({ content: '❌ البوت ليس متواجداً في روم صوتي حالياً.', flags: [1 << 6] });
      }

      const voiceChannel = interaction.guild.channels.cache.get(botVoiceId);
      const isOwner = currentVoiceOwner && currentVoiceOwner.userId === interaction.user.id;
      const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.MuteMembers);

      if (!isOwner && !hasPermission) {
        return interaction.reply({ content: '❌ ليس لديك صلاحية لاستخدام هذا الأمر.', flags: [1 << 6] });
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
          flags: [1 << 6]
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

      console.log(`\n⚡ [أمر التحديث] بدأ المشرف ${interaction.user.tag} عملية تحديث البرمجة والسيرفر...`);

      const configReloaded = reloadConfiguration();
      const targetGuild = interaction.guild || client.guilds.cache.get(ALLOWED_GUILD_ID);
      const clientId = client.user?.id || interaction.client.user?.id;
      const commandsRegistered = targetGuild ? await registerSlashCommands(clientId, targetGuild.id) : false;

      let syncResult = { count: 0, removedCount: 0, total: 0 };
      if (targetGuild) {
        await getOrCreateLogChannel(targetGuild);
        await getOrCreateSystemStatusChannel(targetGuild);
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
        return interaction.reply({ content: '❌ تعذر العثور على بيانات هذا العضو.', flags: [1 << 6] });
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

    // 29. أمر /بينج
    else if (commandName === 'بينج') {
      const pingEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setTitle('🏓 سرعة استجابة البوت (Ping)')
        .addFields(
          { name: '🌐 استجابة خوادم ديسكورد (API)', value: `\`${Math.round(client.ws.ping)}ms\``, inline: true },
          { name: '🟢 حالة النظام', value: '`يعمل بكفاءة ومستقر`', inline: true }
        )
        .setFooter({ text: `GX eSports System • الإصدار ${BOT_VERSION}`, iconURL: client.user?.displayAvatarURL() })
        .setTimestamp();

      await interaction.reply({ embeds: [pingEmbed] });
    }

    // 30. أمر /تذكرة
    else if (commandName === 'تذكرة') {
      await interaction.deferReply({ flags: [1 << 6] });
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
        return interaction.reply({ content: '❌ هذا الأمر مخصص فقط لإدارة السيرفر.', flags: [1 << 6] });
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
      await interaction.reply({ content: `✅ تم إرسال لوحة التذاكر بنجاح إلى القناة <#${targetChannel.id}>!`, flags: [1 << 6] });
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
          flags: [1 << 6]
        });
      }

      const ticketsData = loadTickets();
      const ticket = ticketsData.activeTickets ? ticketsData.activeTickets[interaction.channel.id] : null;

      if (!ticket) {
        return interaction.reply({
          content: '❌ هذه القناة ليست تذكرة دعم فني نشطة.',
          flags: [1 << 6]
        });
      }

      if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({
          content: `⚠️ عذراً، الرد في هذه التذكرة مخصص حصرياً للوكيل المستلم لها (<@${ticket.claimedBy}>).`,
          flags: [1 << 6]
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
        flags: [1 << 6]
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
          await interaction.reply({ content: `❌ **حدث خطأ أثناء معالجة الأمر:**\n\`${err.message}\``, flags: [1 << 6] }).catch(() => {});
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

client.login(TOKEN).catch((err) => {
  console.error(`\n❌ فشل تسجيل الدخول إلى الديسكورد: ${err.message}`);
  process.exit(1);
});
