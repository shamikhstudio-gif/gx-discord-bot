import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, entersState } from '@discordjs/voice';
import { Readable } from 'stream';
import prism from 'prism-media';
import { LOUD_SOUND_THRESHOLD } from './config.js';

/**
 * Standard WebRTC Timed Silence Stream (1 Opus frame every 20ms = 50 packets/sec).
 * Prevents UDP buffer flooding, packet loss, and RTC desync that triggers the yellow "!" icon!
 */
class TimedSilenceStream extends Readable {
  constructor(options = {}) {
    super(options);
    this.interval = null;
  }

  _read() {
    if (!this.interval) {
      this.interval = setInterval(() => {
        try {
          const pushOk = this.push(Buffer.from([0xF8, 0xFF, 0xFE]));
          if (!pushOk) {
            clearInterval(this.interval);
            this.interval = null;
          }
        } catch {
          clearInterval(this.interval);
          this.interval = null;
        }
      }, 20);
    }
  }

  _destroy(err, callback) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    callback(err);
  }
}

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
    this.player = null;
    this.assignedChannelId = config.defaultChannelId;
    this.isReady = false;
    this.isReconnecting = false;
    this.activeUserSubscriptions = new Map(); // userId -> { opusStream, opusDecoder }
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

  createKeepAlivePlayer() {
    const player = createAudioPlayer();
    const playSilence = () => {
      try {
        const resource = createAudioResource(new TimedSilenceStream(), { inputType: StreamType.Opus });
        player.play(resource);
      } catch {}
    };

    playSilence();
    player.on('error', () => {});
    player.on(AudioPlayerStatus.Idle, playSilence);
    return player;
  }

  cleanupSubscriptions() {
    for (const [userId, sub] of this.activeUserSubscriptions) {
      try {
        if (sub.opusDecoder) sub.opusDecoder.destroy();
        if (sub.opusStream) sub.opusStream.destroy();
      } catch {}
    }
    this.activeUserSubscriptions.clear();
  }

  async joinChannel(channel, guild, isAutoRestored = false) {
    if (!channel || !guild) return false;

    let vGuild = this.client.guilds.cache.get(guild.id);
    if (!vGuild) {
      vGuild = await this.client.guilds.fetch(guild.id).catch(() => null);
    }
    if (!vGuild) {
      console.warn(`⚠️ [VCR انضمام] البوت ${this.name} لم يتمكن من الوصول لسيرفر ${guild.id}`);
      return false;
    }

    try {
      this.cleanupSubscriptions();

      // Cleanly destroy any existing voice connection before joining
      if (this.connection) {
        try {
          if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
            this.connection.destroy();
          }
        } catch {}
        this.connection = null;
      }

      this.connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: vGuild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
        group: this.id // Multi-bot isolated voice group
      });

      this.player = this.createKeepAlivePlayer();
      this.connection.subscribe(this.player);

      this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
            entersState(this.connection, VoiceConnectionStatus.Connecting, 5000)
          ]);
        } catch {
          console.warn(`⚡ [إعادة اتصال فوري] انقطع اتصال ${this.name} من #${channel.name}. جارٍ إعادة الربط النظيف...`);
          try {
            if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
              this.connection.destroy();
            }
          } catch {}
          this.connection = null;

          if (!this.isReconnecting) {
            this.isReconnecting = true;
            setTimeout(async () => {
              this.isReconnecting = false;
              await this.joinChannel(channel, guild, true).catch(() => {});
            }, 800);
          }
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

      return true;
    } catch (err) {
      console.error(`❌ خطأ في تثبيت ${this.name}:`, err.message);
      return false;
    }
  }

  attachReceiver(connection, channel, guild) {
    if (!connection || !connection.receiver) return;
    const receiver = connection.receiver;

    receiver.speaking.on('start', async (userId) => {
      const session = this.manager.getOrCreateSession(channel, guild, this);
      if (!session || session.isFinalizing) return;

      const humanMembers = channel.members.filter(m => !m.user.bot);
      const humanCount = humanMembers.size;
      const allMuted = humanMembers.every(m => m.voice.selfMute || m.voice.serverMute);

      // Rule: Do NOT record if only 1 member or if all members are muted
      if (humanCount < 2 || allMuted) {
        return;
      }

      session.lastActivityTime = Date.now();
      session.hasSpoken = true;

      const presence = this.manager.trackMemberPresence(session, userId, guild);
      if (presence) presence.totalSpokenCount++;

      // Persistent subscription: Only create if not already active to prevent audio chopping
      if (!this.activeUserSubscriptions.has(userId)) {
        try {
          const opusStream = receiver.subscribe(userId, {
            end: {
              behavior: EndBehaviorType.Manual // Continuous persistent stream without 1s silence tears
            }
          });

          // Pure uncorrupted 48kHz Stereo 16-bit PCM decoder
          const opusDecoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
          const pcmStream = opusStream.pipe(opusDecoder);

          this.activeUserSubscriptions.set(userId, { opusStream, opusDecoder });

          pcmStream.on('data', (pcmChunk) => {
            if (!pcmChunk || pcmChunk.length === 0) return;

            // 1. Store in multi-track audio session with timeline synchronization
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

            // 2. Exact 16-bit PCM RMS Loudness / Scream Detection
            let sumSquares = 0;
            const sampleCount = pcmChunk.length / 2;
            for (let i = 0; i < pcmChunk.length; i += 2) {
              const sample = pcmChunk.readInt16LE(i);
              sumSquares += sample * sample;
            }
            const rms = Math.sqrt(sumSquares / sampleCount);

            // Scream / Ear-Rape Trigger (> 25,000 RMS)
            if (rms > LOUD_SOUND_THRESHOLD) {
              const violatingMember = guild.members.cache.get(userId);
              if (violatingMember) {
                // Strict check: Is member COO, CEO, or OWNER?
                if (this.manager.isVCRImmuneExecutive(violatingMember)) {
                  // Completely immune!
                  return;
                }
                this.manager.handleLoudSoundViolation(guild, channel, violatingMember, presence, Math.round(rms));
              }
            }
          });

          opusStream.on('error', () => {
            this.activeUserSubscriptions.delete(userId);
          });
          opusDecoder.on('error', () => {
            this.activeUserSubscriptions.delete(userId);
          });
        } catch (err) {
          console.warn(`⚠️ Error subscribing to voice of ${userId}:`, err.message);
        }
      }
    });
  }
}
