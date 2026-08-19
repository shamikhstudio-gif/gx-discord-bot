import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, entersState } from '@discordjs/voice';
import prism from 'prism-media';
import {
  SUSTAINED_SCREAM_RMS_THRESHOLD,
  SUSTAINED_SCREAM_FRAMES_REQUIRED,
  INSTANT_EAR_RAPE_RMS_THRESHOLD,
  INSTANT_EAR_RAPE_PEAK_THRESHOLD,
  VCR_BOT_IDS
} from './config.js';

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

      // Direct auto-unmute and auto-undeafen listener
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

      const humanMembers = channel.members.filter(m => !m.user.bot);
      const humanCount = humanMembers.size;
      const allMuted = humanMembers.every(m => m.voice.selfMute || m.voice.serverMute);

      if (humanCount < 2 || allMuted) {
        return;
      }

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

            // 1. Multi-Track Audio Session Storage (Always Records 100% in all categories!)
            if (session.userAudioTracks && !session.isFinalizing) {
              if (!session.userAudioTracks.has(userId)) {
                session.userAudioTracks.set(userId, {
                  userId,
                  firstTimestamp: Date.now(),
                  startOffsetMs: Math.max(0, Date.now() - session.startTime),
                  pcmChunks: []
                });
              }
              const track = session.userAudioTracks.get(userId);
              track.pcmChunks.push(pcmChunk);
              session.totalRecordedBytes = (session.totalRecordedBytes || 0) + pcmChunk.length;
            }

            // 2. Tournament & Matches Exemption Check
            if (this.manager.isTournamentOrMatchChannel(channel)) {
              return;
            }

            // 3. Exact 16-bit PCM RMS & Peak Audio Analysis
            let sumSquares = 0;
            let peakSample = 0;
            const sampleCount = pcmChunk.length / 2;
            for (let i = 0; i < pcmChunk.length; i += 2) {
              const sample = Math.abs(pcmChunk.readInt16LE(i));
              sumSquares += sample * sample;
              if (sample > peakSample) peakSample = sample;
            }
            const rms = Math.sqrt(sumSquares / sampleCount);

            // Sustained Scream Detection Counter (Requires 3 consecutive frames of RMS >= 11000)
            let loudCount = this.userLoudFrameCounters.get(userId) || 0;
            if (rms >= SUSTAINED_SCREAM_RMS_THRESHOLD) {
              loudCount++;
            } else {
              loudCount = 0;
            }
            this.userLoudFrameCounters.set(userId, loudCount);

            const isSustainedScream = loudCount >= SUSTAINED_SCREAM_FRAMES_REQUIRED;
            const isInstantEarRape = rms >= INSTANT_EAR_RAPE_RMS_THRESHOLD || peakSample >= INSTANT_EAR_RAPE_PEAK_THRESHOLD;

            if (isSustainedScream || isInstantEarRape) {
              this.userLoudFrameCounters.set(userId, 0); // Reset counter

              const violatingMember = guild.members.cache.get(userId);
              if (violatingMember) {
                // Immunity Check: OWNER, CEO, COO are 100% immune! MANAGERS and other staff CAN be affected!
                if (this.manager.isVCRImmuneExecutive(violatingMember)) {
                  return;
                }
                const energyReport = Math.round(Math.max(rms, peakSample / 2));
                const detectionType = isInstantEarRape ? 'تفجير صوتي مفاجئ (Ear-Rape / Distortion)' : 'صراخ حاد ومستمر (Sustained Scream)';
                this.manager.handleLoudSoundViolation(guild, channel, violatingMember, presence, energyReport, detectionType);
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
