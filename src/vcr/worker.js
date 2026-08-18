import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import { joinVoiceChannel, VoiceConnectionStatus, EndBehaviorType, createAudioPlayer, createAudioResource, StreamType, AudioPlayerStatus } from '@discordjs/voice';
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
    this.manager = manager;
    this.client = null;
    this.connection = null;
    this.player = null;
    this.assignedChannelId = null;
    this.isReady = false;
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

  async joinChannel(channel, guild) {
    let vGuild = this.client.guilds.cache.get(guild.id);
    if (!vGuild) {
      vGuild = await this.client.guilds.fetch(guild.id).catch(() => null);
    }
    if (!vGuild) {
      console.warn(`⚠️ [VCR انضمام] البوت ${this.name} لم يتمكن من الوصول لسيرفر ${guild.id}`);
      return false;
    }

    try {
      console.log(`🎙️ [تثبيت VCR دائم] انضمام ${this.name} للروم: #${channel.name} (${channel.id})...`);
      if (this.connection) {
        try { this.connection.destroy(); } catch {}
      }

      this.connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: vGuild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
        group: this.id // Multi-bot per guild isolated voice connection group
      });

      this.player = this.createKeepAlivePlayer();
      this.connection.subscribe(this.player);

      this.connection.on('error', (err) => {
        console.warn(`⚠️ [اتصال صوت ${this.name}]`, err.message);
      });

      this.assignedChannelId = channel.id;
      this.attachReceiver(this.connection, channel, guild);
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

      const opusStream = receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: 1000
        }
      });

      // Decode compressed Opus stream to 16-bit 48kHz Stereo PCM
      const opusDecoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
      const pcmStream = opusStream.pipe(opusDecoder);

      pcmStream.on('data', (pcmChunk) => {
        if (!pcmChunk || pcmChunk.length === 0) return;

        // 1. Write to Session PCM Stream for MP3 generation
        if (session.pcmWriteStream && !session.isFinalizing) {
          session.pcmWriteStream.write(pcmChunk);
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

        // Scream / Ear-Rape Trigger (> 16,000 RMS)
        if (rms > LOUD_SOUND_THRESHOLD) {
          const violatingMember = guild.members.cache.get(userId);
          if (violatingMember) {
            this.manager.handleLoudSoundViolation(guild, channel, violatingMember, presence, Math.round(rms));
          }
        }
      });

      opusStream.on('error', () => {});
      opusDecoder.on('error', () => {});
    });
  }
}
