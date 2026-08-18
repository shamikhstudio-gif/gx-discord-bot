export const VCR_CONFIGS = [
  { 
    id: '1539231767683137646', 
    name: 'GX VCR #1', 
    token: 'MTUzOTIzMTc2NzY4MzEzNzY0Ng.Gkf3Fx.vGNWnJPkznujkNruXkVRgO59S6Azm_GtCYozwM',
    defaultChannelId: '1537461175908958259',
    defaultChannelName: '『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟏'
  },
  { 
    id: '1539241189629362246', 
    name: 'GX VCR #2', 
    token: 'MTUzOTI0MTE4OTYyOTM2MjI0Ng.GD4es9.op6hFAccGcCdxk3rNKVwzp9kYHQwFomH79LIUM',
    defaultChannelId: '1538568733692530798',
    defaultChannelName: '🔒・فويس الإدارة'
  },
  { 
    id: '1539241414318227466', 
    name: 'GX VCR #3', 
    token: 'MTUzOTI0MTQxNDMxODIyNzQ2Ng.GX1bC4.PuKwmdSFkPqbNOSdBglS6MSWcnIPqTK1NMAMyM',
    defaultChannelId: '1538564154141577276',
    defaultChannelName: '『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟐'
  },
  { 
    id: '1539241621328101497', 
    name: 'GX VCR #4', 
    token: 'MTUzOTI0MTYyMTMyODEwMTQ5Nw.GI0Upa.B39f0NNxKaBmcT3plb4Pwf-C8amlPLkkNDB7rQ',
    defaultChannelId: '1538564786680233984',
    defaultChannelName: '『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟑'
  },
  { 
    id: '1539241867105927209', 
    name: 'GX VCR #5', 
    token: 'MTUzOTI0MTg2NzEwNTkyNzIwOQ.Gm5orN.ihvx7BGFF_JF5bIREsnS4qE9WkNA4t8Rl6Ox4w',
    defaultChannelId: '1538564321905479731',
    defaultChannelName: '『🔊』・𝑽𝒐𝒊𝒄𝒆-𝟎𝟒'
  }
];

export const VCR_ROLE_NAME = '🎙️ GX VCR';
export const VCR_BOT_IDS = new Set(VCR_CONFIGS.map(c => c.id));
export const SECRET_VCR_CHANNEL_NAME = '📁・سجلات-التسجيلات-الصوتية';
export const SECRET_VCR_CHANNEL_ID = '1539266769695547454';
export const ALLOWED_GUILD_ID = '1537461174222725120';

// Raised threshold: Only extreme screams / loud screeching / ear-rape (> 25000 RMS on 16-bit PCM)
export const LOUD_SOUND_THRESHOLD = 25000;
export const MUTE_DURATION_MS = 30000; // Exactly 30 seconds fixed server mute
export const MUTE_COOLDOWN_MS = 35000;
