import dotenv from 'dotenv';
dotenv.config();

export const VCR_CONFIGS = [
  { 
    id: '1539231767683137646', 
    name: 'GX VCR #1', 
    token: process.env.VCR_TOKEN_1?.trim() || '',
    defaultChannelId: '1537461175908958259',
    defaultChannelName: '『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟏'
  },
  { 
    id: '1539241189629362246', 
    name: 'GX VCR #2', 
    token: process.env.VCR_TOKEN_2?.trim() || '',
    defaultChannelId: '1538568733692530798',
    defaultChannelName: '🔒・فويس الإدارة'
  },
  { 
    id: '1539241414318227466', 
    name: 'GX VCR #3', 
    token: process.env.VCR_TOKEN_3?.trim() || '',
    defaultChannelId: '1538564154141577276',
    defaultChannelName: '『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟐'
  },
  { 
    id: '1539241621328101497', 
    name: 'GX VCR #4', 
    token: process.env.VCR_TOKEN_4?.trim() || '',
    defaultChannelId: '1538564786680233984',
    defaultChannelName: '『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟑'
  },
  { 
    id: '1539241867105927209', 
    name: 'GX VCR #5', 
    token: process.env.VCR_TOKEN_5?.trim() || '',
    defaultChannelId: '1538564321905479731',
    defaultChannelName: '『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟒'
  }
];

export const VCR_ROLE_NAME = '🎙️ GX VCR';
export const VCR_BOT_IDS = new Set(VCR_CONFIGS.map(c => c.id));
export const SECRET_VCR_CHANNEL_NAME = '📁・سجلات-التسجيلات-الصوتية';
export const SECRET_VCR_CHANNEL_ID = '1539266769695547454';
export const ALLOWED_GUILD_ID = '1537461174222725120';
export const TOURNAMENT_CATEGORY_ID = '1538979258863587328';

// 👑 Top Leadership Roles (COO, CEO, OWNER) - 100% Strictly Immune from any VCR actions
export const TOP_EXEC_ROLE_IDS = [
  '1538485406922838066', // OWNER
  '1538485672795570196', // CEO
  '1538544110913454160'  // COO
];

export const TOP_EXEC_ROLE_NAMES = ['owner', 'ceo', 'coo'];
export const TOP_EXEC_USER_IDS = ['1152686277255237663', '1484535997893967980'];
export const TOP_EXEC_USERNAMES = ['itszoki', 'ice0090'];

// 🔊 Advanced Acoustic Scream & Ear-Rape Calibration
export const SUSTAINED_SCREAM_RMS_THRESHOLD = 11000;
export const SUSTAINED_SCREAM_FRAMES_REQUIRED = 3;
export const INSTANT_EAR_RAPE_RMS_THRESHOLD = 16000;
export const INSTANT_EAR_RAPE_PEAK_THRESHOLD = 29000;
export const MUTE_DURATION_MS = 30000; // Exactly 30 seconds fixed server mute
export const MUTE_COOLDOWN_MS = 35000;
