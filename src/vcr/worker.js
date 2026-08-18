import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus, entersState } from '@discordjs/voice';
import { Readable } from 'stream';
import prism from 'prism-media';
import { LOUD_SOUND_THRESHOLD } from './config.js';

class SilenceStream extends Readable {
  _read() {
    this.push(Buffer.from([0xF8, 0xFF, 0xFE]));
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
        const resource = createAudioResource(new SilenceStream(), { inputType: StreamType.Opus });
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

      if (this.connection) {
        try { this.connection.destroy(); } catch {}
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
            entersState(this.connection, VoiceConnectionStatus.Signalling, 3000),
            entersState(this.connection, VoiceConnectionStatus.Connecting, 3000)
          ]);
        } catch {
          console.warn(`⚡ [إعادة اتصال فوري] انقطع اتصال ${this.name} من #${channel.name}. جارٍ إعادة الربط...`);
          setTimeout(() => {
            this.joinChannel(channel, guild, true).catch(() => {});
          }, 1000);
        }
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
