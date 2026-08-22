import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, entersState } from '@discordjs/voice';
import prism from 'prism-media';
import { VCR_BOT_IDS } from './config.js';

export class VCRWorker {
  constructor(config, manager) {
    this.id = config.id;
    this.name = config.name;
    this.token = config.token;
    this.defaultChannelId = config.defaultChannelId;
    this.defaultChannelName = config.defaultChannelName;
    this.manager = manager;
    this.client = null;
    this.connection = null;
    this.assignedChannelId = config.defaultChannelId;
    this.isReady = false;
    this.isInternalSwitching = false;
    this.lastJoinAttempt = 0;
    this.activeUserSubscriptions = new Map(); // userId -> { opusStream, opusDecoder }
    this.userLoudFrameCounters = new Map(); // userId -> consecutive frame count
  }

  async init() {
    return new Promise((resolve) => {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildVoiceStates
        ]
      });

      this.client.once(Events.ClientReady, (c) => {
        this.isReady = true;
        console.log(`🎙️ [مسجل متصل] تم تسجيل الدخول بنجاح للمسجل: ${c.user.tag} (ID: ${c.user.id})`);
        c.user.setActivity('🎙️ GX VCR Autonomous Sentinel', { type: ActivityType.Custom });
        resolve(true);
      });

      // Direct auto-unmute, auto-undeafen, and STRICT CHANNEL ANCHOR LOCK
      this.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
        if (newState.id === this.id) {
          if (newState.serverMute) {
            console.warn(`🛡️ [حماية VCR] إلغاء كتم السيرفر الإجباري عن ${this.name} فوراً...`);
            await newState.setMute(false, 'GX VCR Immune Policy: Un-Server-Mute').catch(() => {});
          }
          if (newState.serverDeaf) {
            console.warn(`🛡️ [حماية VCR] إلغاء تصميت السيرفر الإجباري عن ${this.name} فوراً...`);
            await newState.setDeaf(false, 'GX VCR Immune Policy: Un-Server-Deaf').catch(() => {});
          }

          // 🔒 STRICT CHANNEL ANCHOR LOCK: Prevent moving to any other room
          if (newState.channelId !== this.defaultChannelId) {
            const guild = newState.guild;
            const targetChannel = guild.channels.cache.get(this.defaultChannelId);
            if (targetChannel && !this.isInternalSwitching) {
              console.warn(`🛡️ [تثبيت VCR محكم] تم رصد محاولة نقل ${this.name} إلى روم (${newState.channel?.name || 'غير مخصص'}). إعادة التثبيت الفوري في #${targetChannel.name}...`);
              setTimeout(async () => {
                await this.joinChannel(targetChannel, guild, true).catch(() => {});
              }, 300);
            }
          }
        }
      });

      this.client.on(Events.Error, (err) => {
        console.warn(`⚠️ [تحذير مسجل ${this.name}]`, err.message);
      });

      this.client.login(this.token).catch((err) => {
        console.error(`❌ فشل تسجيل دخول ${this.name}:`, err.message);
        resolve(false);
      });
    });
  }

  cleanupSubscriptions() {
    for (const [userId, sub] of this.activeUserSubscriptions) {
      try {
        if (sub.opusDecoder) sub.opusDecoder.destroy();
        if (sub.opusStream) sub.opusStream.destroy();
      } catch {}
    }
    this.activeUserSubscriptions.clear();
    this.userLoudFrameCounters.clear();
  }

  async joinChannel(channel, guild, isAutoRestored = false) {
    if (!channel || !guild || !this.client) return false;

    const now = Date.now();
    if (now - this.lastJoinAttempt < 3000) {
      return false;
    }
    this.lastJoinAttempt = now;

    let vGuild = this.client.guilds.cache.get(guild.id);
    if (!vGuild) {
      vGuild = await this.client.guilds.fetch(guild.id).catch(() => null);
    }
    if (!vGuild) {
      console.warn(`⚠️ [VCR انضمام] البوت ${this.name} لم يتمكن من الوصول لسيرفر ${guild.id}`);
      return false;
    }

    const currentVoiceId = vGuild.members.me?.voice?.channelId;
    const isAlreadyConnected = this.connection && 
                               this.connection.state.status === VoiceConnectionStatus.Ready &&
                               currentVoiceId === channel.id;

    if (isAlreadyConnected) {
      return true;
    }

    try {
      this.isInternalSwitching = true;
      this.cleanupSubscriptions();

      if (this.connection) {
        try {
          this.connection.removeAllListeners();
          this.connection.destroy();
        } catch {}
        this.connection = null;
      }

      this.connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: vGuild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
        group: this.id
      });

      this.connection.setMaxListeners(50);

      this.connection.on(VoiceConnectionStatus.Ready, () => {
        this.isInternalSwitching = false;
      });

      this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        if (this.isInternalSwitching) return;
        try {
          await Promise.race([
            entersState(this.connection, VoiceConnectionStatus.Signalling, 4000),
            entersState(this.connection, VoiceConnectionStatus.Connecting, 4000)
          ]);
        } catch {
          if (this.isInternalSwitching) return;
          console.warn(`⚡ [إعادة اتصال VCR] انقطع اتصال ${this.name} من #${channel.name}. إعادة الربط خلال ثانيتين...`);
          setTimeout(async () => {
            await this.joinChannel(channel, guild, true).catch(() => {});
          }, 2000);
        }
      });

      this.connection.on(VoiceConnectionStatus.Destroyed, () => {
        this.cleanupSubscriptions();
      });

      this.connection.on('error', (err) => {
        console.warn(`⚠️ [اتصال صوت ${this.name}]`, err.message);
      });

      this.assignedChannelId = channel.id;
      this.attachReceiver(this.connection, channel, guild);

      if (isAutoRestored) {
        console.log(`🛡️ [حارس الاستقرار] تمت إعادة تثبيت ${this.name} في الروم المخصص: #${channel.name} بنجاح.`);
      } else {
        console.log(`🎙️ [تثبيت VCR دائم] انضمام ${this.name} للروم: #${channel.name} (${channel.id})...`);
      }

      setTimeout(() => {
        this.isInternalSwitching = false;
      }, 2000);

      return true;
    } catch (err) {
      this.isInternalSwitching = false;
      console.error(`❌ خطأ في تثبيت ${this.name}:`, err.message);
      return false;
    }
  }

  attachReceiver(connection, channel, guild) {
    if (!connection || !connection.receiver) return;
    const receiver = connection.receiver;

    receiver.speaking.on('start', async (userId) => {
      // 🚫 STRICT BOT EXCLUSION: Never record GX Main Bot, VCR bots, or ANY bot!
      if (userId === this.manager.mainClient?.user?.id || VCR_BOT_IDS.has(userId)) {
        return;
      }
      const speakerMember = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
      if (!speakerMember || speakerMember.user?.bot) {
        return;
      }

      const session = this.manager.getOrCreateSession(channel, guild, this);
      if (!session || session.isFinalizing) return;

      session.lastActivityTime = Date.now();
      session.hasSpoken = true;

      const presence = this.manager.trackMemberPresence(session, userId, guild);
      if (presence) presence.totalSpokenCount++;

      if (!this.activeUserSubscriptions.has(userId)) {
        try {
          const opusStream = receiver.subscribe(userId, {
            end: {
              behavior: EndBehaviorType.Manual
            }
          });

          const opusDecoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
          const pcmStream = opusStream.pipe(opusDecoder);

          this.activeUserSubscriptions.set(userId, { opusStream, opusDecoder });

          pcmStream.on('data', (pcmChunk) => {
            if (!pcmChunk || pcmChunk.length === 0) return;

            const now = Date.now();

            // 5-Minute Rolling Multi-Track Audio Storage (300,000 ms)
            if (session.userAudioTracks && !session.isFinalizing) {
              if (!session.userAudioTracks.has(userId)) {
                session.userAudioTracks.set(userId, {
                  userId,
                  firstTimestamp: now,
                  chunks: []
                });
              }
              const track = session.userAudioTracks.get(userId);
              track.chunks.push({ timestamp: now, data: pcmChunk });
              session.totalRecordedBytes = (session.totalRecordedBytes || 0) + pcmChunk.length;

              // Prune chunks older than 5 minutes (300 seconds)
              const cutoff = now - (5 * 60 * 1000);
              while (track.chunks.length > 0 && track.chunks[0].timestamp < cutoff) {
                const removed = track.chunks.shift();
                session.totalRecordedBytes = Math.max(0, (session.totalRecordedBytes || 0) - (removed.data?.length || 0));
              }
            }
          });

          opusStream.on('error', () => {
            this.activeUserSubscriptions.delete(userId);
            this.userLoudFrameCounters.delete(userId);
          });
          opusDecoder.on('error', () => {
            this.activeUserSubscriptions.delete(userId);
            this.userLoudFrameCounters.delete(userId);
          });
        } catch (err) {
          console.warn(`⚠️ Error subscribing to voice of ${userId}:`, err.message);
        }
      }
    });
  }
}
