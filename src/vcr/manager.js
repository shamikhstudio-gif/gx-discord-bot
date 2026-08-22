import { ChannelType, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder, AuditLogEvent } from 'discord.js';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { VoiceConnectionStatus } from '@discordjs/voice';
import {
  VCR_CONFIGS,
  VCR_ROLE_NAME,
  SECRET_VCR_CHANNEL_NAME,
  SECRET_VCR_CHANNEL_ID,
  VCR_BOT_IDS,
  TOP_EXEC_ROLE_IDS,
  TOP_EXEC_ROLE_NAMES,
  TOP_EXEC_USER_IDS,
  TOP_EXEC_USERNAMES
} from './config.js';
import { VCRWorker } from './worker.js';

export class VCRManager {
  constructor(mainClient, mainBotVersion = '1.0', loggerCallback = null) {
    this.mainClient = mainClient;
    this.botVersion = mainBotVersion;
    this.loggerCallback = loggerCallback;
    this.workers = [];
    this.activeSessions = new Map();
    this.userMuteCooldowns = new Map();
    this.activeMuteTimers = new Map();
    this.lastWatchdogRun = 0;
  }

  setLogger(loggerCallback) {
    this.loggerCallback = loggerCallback;
  }

  async logToAdmin(guild, embed) {
    if (this.loggerCallback && guild) {
      try {
        await this.loggerCallback(guild, embed);
      } catch {}
    }
  }

  /**
   * 🏆 Checks if a voice channel is located in the TOURNAMENTS & MATCHES category.
   */
  isTournamentOrMatchChannel(channel) {
    if (!channel) return false;
    if (channel.parentId === '1538979258863587328') return true;
    const parentName = (channel.parent?.name || '').toLowerCase();
    if (parentName.includes('tournament') || parentName.includes('match') || parentName.includes('بطول') || parentName.includes('مبار')) {
      return true;
    }
    const channelName = (channel.name || '').toLowerCase();
    if (channelName.includes('tournament') || channelName.includes('match') || channelName.includes('بطول') || channelName.includes('مبار')) {
      return true;
    }
    return false;
  }

  isVCRImmuneExecutive(member, user) {
    const u = user || member?.user || { id: member?.id };
    if (!u || !u.id) return false;
    const guild = member?.guild;
    if (guild && guild.ownerId === u.id) return true;
    if (TOP_EXEC_USER_IDS.includes(u.id)) return true;
    const username = u.username?.toLowerCase() || '';
    if (TOP_EXEC_USERNAMES.includes(username)) return true;
    if (member && member.roles?.cache) {
      if (member.roles.cache.some(r => TOP_EXEC_ROLE_IDS.includes(r.id))) return true;
      if (member.roles.cache.some(r => {
        const name = r.name.toLowerCase().trim();
        return TOP_EXEC_ROLE_NAMES.some(tier => name === tier || name === `👑 ${tier}` || name.startsWith(`${tier} `) || name.endsWith(` ${tier}`));
      })) return true;
    }
    return false;
  }

  async init(guild) {
    console.log('🔄 جارٍ تشغيل وربط أسطول مسجلات الصوت (5 مسجلات GX VCR)...');
    for (const cfg of VCR_CONFIGS) {
      const worker = new VCRWorker(cfg, this);
      await worker.init();
      this.workers.push(worker);
    }
    console.log(`✅ اكتمل تشغيل ${this.workers.length} مسجلات صوتية بنجاح!`);

    if (guild) {
      await this.autoAssignVCRRoles(guild);
      await this.findOrCreateVCRLogChannel(guild);
      console.log('🎙️ [تثبيت تلقائي] جارٍ إدخال المسجلات الخمسة في الرومات الصوتية الآن...');
      await this.deployStationary(guild);
    }
  }

  async findOrCreateVCRLogChannel(guild) {
    if (!guild) return null;
    let ch = guild.channels.cache.get(SECRET_VCR_CHANNEL_ID) ||
             guild.channels.cache.find(c => c && (c.name === SECRET_VCR_CHANNEL_NAME || c.name.includes('سجلات-التسجيلات')));

    if (!ch) {
      try {
        const botMember = guild.members.me;
        const everyoneRole = guild.roles.everyone;
        const overwrites = [
          { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] }
        ];

        for (const roleId of ['1538485406922838066', '1538485672795570196', '1538544110913454160', '1538569735057178745']) {
          const r = guild.roles.cache.get(roleId);
          if (r) {
            overwrites.push({ id: r.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
          }
        }

        ch = await guild.channels.create({
          name: SECRET_VCR_CHANNEL_NAME,
          type: ChannelType.GuildText,
          permissionOverwrites: overwrites,
          reason: 'إنشاء القناة السرية لسجلات وملفات التسجيل الصوتي GX VCR'
        });
        console.log(`📁 [قناة التسجيلات] تم بنجاح إنشاء القناة السرية: #${ch.name} (${ch.id})`);
      } catch (err) {
        console.error('خطأ في إنشاء قناة التسجيلات السرية:', err.message);
        ch = guild.channels.cache.find(c => c.name.includes('log')) || null;
      }
    }
    return ch;
  }

  async findOrCreateVCRRole(guild) {
    if (!guild) return null;
    let role = guild.roles.cache.find(r => r.name === VCR_ROLE_NAME || r.name.toLowerCase() === 'gx vcr');
    if (!role) {
      try {
        const botMember = guild.members.me;
        if (botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
          role = await guild.roles.create({
            name: VCR_ROLE_NAME,
            color: 0x5865F2,
            hoist: true,
            mentionable: false,
            permissions: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.UseVAD,
              PermissionFlagsBits.MuteMembers
            ],
            reason: 'إنشاء رتبة أسطول مسجلات GX VCR الرسمية'
          });
          console.log(`🎙️ [رتبة VCR] تم بنجاح إنشاء رتبة "${VCR_ROLE_NAME}" (${role.id})!`);
        }
      } catch (err) {
        console.error('خطأ في إنشاء رتبة VCR:', err.message);
      }
    }
    return role;
  }

  async autoAssignVCRRoles(guild) {
    if (!guild) return;
    const vcrRole = await this.findOrCreateVCRRole(guild);
    if (!vcrRole) return;

    for (const vcr of VCR_CONFIGS) {
      const member = await guild.members.fetch(vcr.id).catch(() => null);
      if (member && !member.roles.cache.has(vcrRole.id)) {
        try {
          await member.roles.add(vcrRole);
          console.log(`🎙️ [رتبة VCR] تم منح رتبة "${VCR_ROLE_NAME}" للبوت ${vcr.name} تلقائياً.`);
        } catch {}
      }
    }
  }

  async deployStationary(guild) {
    if (!guild) return { joined: 0, total: 5 };

    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    const voiceChannels = channels
      .filter(c => c && c.isVoiceBased() && !c.isThread())
      .sort((a, b) => a.position - b.position);

    const voiceList = [...voiceChannels.values()];
    let joinedCount = 0;

    for (let i = 0; i < this.workers.length; i++) {
      const worker = this.workers[i];
      const targetChannel = guild.channels.cache.get(worker.defaultChannelId) ||
                            voiceList.find(c => c.id === worker.defaultChannelId) ||
                            voiceList[i];
      if (!targetChannel) continue;

      const success = await worker.joinChannel(targetChannel, guild);
      if (success) joinedCount++;
      await new Promise(r => setTimeout(r, 600));
    }

    return { joined: joinedCount, total: this.workers.length };
  }

  getOrCreateSession(channel, guild, worker) {
    let session = this.activeSessions.get(channel.id);
    if (!session) {
      const timestamp = Date.now();
      session = {
        worker,
        channelId: channel.id,
        channelName: channel.name,
        guild,
        startTime: timestamp,
        userAudioTracks: new Map(),
        totalRecordedBytes: 0,
        membersPresence: new Map(),
        lastActivityTime: timestamp,
        hasSpoken: false,
        isFinalizing: false
      };
      this.activeSessions.set(channel.id, session);
    }
    return session;
  }

  trackMemberPresence(session, userId, guild) {
    if (userId === this.mainClient?.user?.id || VCR_BOT_IDS.has(userId)) return null;
    const u = guild.members.cache.get(userId);
    if (u?.user?.bot) return null;
    if (!session.membersPresence.has(userId)) {
      session.membersPresence.set(userId, {
        id: userId,
        tag: u ? u.user.tag : userId,
        displayName: u ? (u.displayName || u.user.username) : userId,
        joinTime: Date.now(),
        leaveTime: null,
        totalSpokenCount: 0
      });
    }
    return session.membersPresence.get(userId);
  }


  /**
   * ⏱️ Assembles continuous timeline PCM buffer with accurate silence gaps for a single user track.
   */
  buildUserTimelinePcm(chunks, windowStart, windowEnd) {
    if (!chunks || chunks.length === 0) return null;
    const filtered = chunks.filter(c => c.timestamp >= windowStart && c.timestamp <= windowEnd);
    if (filtered.length === 0) return null;

    const userFirstTs = filtered[0].timestamp;
    const startOffsetMs = Math.max(0, userFirstTs - windowStart);

    const buffers = [];
    let lastChunkEndTs = userFirstTs;

    for (const chunk of filtered) {
      // 48000 Hz, 16-bit, 2 channels = 192,000 bytes per second = 192 bytes per ms
      const chunkDurationMs = chunk.data.length / 192;
      const gapMs = chunk.timestamp - lastChunkEndTs;

      // If gap between speech bursts > 20ms, insert zero-filled silence buffer
      if (gapMs > 20) {
        const silenceBytes = Math.min(Math.round(gapMs * 192), 192 * 300000); // capped at 5 mins
        if (silenceBytes > 0) {
          buffers.push(Buffer.alloc(silenceBytes));
        }
      }

      buffers.push(chunk.data);
      lastChunkEndTs = chunk.timestamp + chunkDurationMs;
    }

    return {
      pcmBuffer: Buffer.concat(buffers),
      startOffsetMs
    };
  }

  /**
   * 🎚️ Multi-Track Audio Mixing Engine (FFmpeg MP3/OGG)
   */
  async mixMultiTrackAudio(validTracks, outputFormat = 'mp3') {
    return new Promise((resolve) => {
      if (!validTracks || validTracks.length === 0) return resolve(null);

      const isMp3 = outputFormat === 'mp3';
      const codecArgs = isMp3 
        ? ['-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3']
        : ['-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-application', 'audio', '-f', 'ogg'];

      if (validTracks.length === 1) {
        const proc = spawn(ffmpegStatic, [
          '-y',
          '-f', 's16le',
          '-ar', '48000',
          '-ac', '2',
          '-i', 'pipe:0',
          ...codecArgs,
          'pipe:1'
        ]);

        const outputChunks = [];
        proc.stdout.on('data', chunk => outputChunks.push(chunk));
        proc.on('close', (code) => {
          if (code === 0 && outputChunks.length > 0) resolve(Buffer.concat(outputChunks));
          else resolve(null);
        });
        proc.on('error', () => resolve(null));

        proc.stdin.write(validTracks[0].pcmBuffer);
        proc.stdin.end();
        return;
      }

      const args = ['-y'];
      for (let i = 0; i < validTracks.length; i++) {
        args.push('-thread_queue_size', '512', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', `pipe:${3 + i}`);
      }

      let filterStr = '';
      for (let i = 0; i < validTracks.length; i++) {
        const delay = Math.max(0, Math.round(validTracks[i].startOffsetMs || 0));
        filterStr += `[${i}:a]adelay=${delay}|${delay}[a${i}];`;
      }
      for (let i = 0; i < validTracks.length; i++) {
        filterStr += `[a${i}]`;
      }
      filterStr += `amix=inputs=${validTracks.length}:dropout_transition=0:normalize=0[out]`;

      args.push(
        '-filter_complex', filterStr,
        '-map', '[out]',
        ...codecArgs,
        'pipe:1'
      );

      const stdio = ['ignore', 'pipe', 'ignore'];
      for (let i = 0; i < validTracks.length; i++) {
        stdio.push('pipe');
      }

      const proc = spawn(ffmpegStatic, args, { stdio });

      const outputChunks = [];
      proc.stdout.on('data', chunk => outputChunks.push(chunk));
      proc.on('close', (code) => {
        if (code === 0 && outputChunks.length > 0) resolve(Buffer.concat(outputChunks));
        else resolve(null);
      });
      proc.on('error', () => resolve(null));

      for (let i = 0; i < validTracks.length; i++) {
        const pipeStream = proc.stdio[3 + i];
        if (pipeStream) {
          pipeStream.write(validTracks[i].pcmBuffer);
          pipeStream.end();
        }
      }
    });
  }

  /**
   * 📦 Exports the multi-track rolling audio buffer for a given voice channel (last 5 minutes by default).
   * Dynamically aligns to the earliest spoken audio frame so recordings of any length (e.g. 10s, 1m, 5m) start instantly at 0:00 without dead silence.
   */
  async exportRollingRecording(channelId, windowMs = 5 * 60 * 1000, outputFormat = 'mp3') {
    const session = this.activeSessions.get(channelId);
    const now = Date.now();
    const maxLookback = now - windowMs;

    if (!session || !session.userAudioTracks || session.userAudioTracks.size === 0) {
      return {
        audioBuffer: null,
        durationSec: 0,
        membersPresence: session ? [...session.membersPresence.values()] : [],
        hasAudio: false,
        channelName: session?.channelName || 'Voice'
      };
    }

    const userTracksWithAudio = [];
    let globalEarliestSpeechTs = Infinity;

    for (const [, track] of session.userAudioTracks) {
      if (!track.chunks || track.chunks.length === 0) continue;
      const filtered = track.chunks.filter(c => c.timestamp >= maxLookback && c.timestamp <= now);
      if (filtered.length > 0) {
        userTracksWithAudio.push({ track, filtered });
        if (filtered[0].timestamp < globalEarliestSpeechTs) {
          globalEarliestSpeechTs = filtered[0].timestamp;
        }
      }
    }

    if (userTracksWithAudio.length === 0 || globalEarliestSpeechTs === Infinity) {
      return {
        audioBuffer: null,
        durationSec: 0,
        membersPresence: [...session.membersPresence.values()],
        hasAudio: false,
        channelName: session.channelName
      };
    }

    // Reference start aligns exactly to earliest spoken audio (or max 5 min lookback)
    const timelineReferenceStart = Math.max(globalEarliestSpeechTs, maxLookback);

    const validTracks = [];
    for (const { track, filtered } of userTracksWithAudio) {
      const timeline = this.buildUserTimelinePcm(filtered, timelineReferenceStart, now);
      if (timeline && timeline.pcmBuffer.length > 0) {
        validTracks.push({
          userId: track.userId,
          pcmBuffer: timeline.pcmBuffer,
          startOffsetMs: timeline.startOffsetMs
        });
      }
    }

    if (validTracks.length === 0) {
      return {
        audioBuffer: null,
        durationSec: 0,
        membersPresence: [...session.membersPresence.values()],
        hasAudio: false,
        channelName: session.channelName
      };
    }

    const audioBuffer = await this.mixMultiTrackAudio(validTracks, outputFormat);
    const durationSec = Math.max(1, Math.round((now - timelineReferenceStart) / 1000));

    return {
      audioBuffer,
      durationSec,
      membersPresence: [...session.membersPresence.values()],
      hasAudio: !!audioBuffer,
      channelName: session.channelName
    };
  }

  async finalizeAndSendRecording(channelId, reason = 'مغادرة الأعضاء وانتهاء الجلسة') {
    // 🛑 AUTO-RECORD POSTING IS DISABLED.
    // Audio recordings are strictly exported & submitted only when /ابلاغ is executed.
    const session = this.activeSessions.get(channelId);
    if (!session) return;

    this.activeSessions.delete(channelId);
    if (session.worker) {
      session.worker.cleanupSubscriptions();
    }
    if (session.userAudioTracks) {
      session.userAudioTracks.clear();
    }
  }

  async onVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const member = newState.member || oldState.member;
    if (!guild || !member) return;

    if (VCR_BOT_IDS.has(member.id)) {
      const worker = this.workers.find(w => w.id === member.id);
      if (!worker || worker.isInternalSwitching) return;

      const defaultTargetCh = guild.channels.cache.get(worker.defaultChannelId) ||
                              guild.channels.cache.find(c => c.id === worker.assignedChannelId);

      // Anti-Server Mute
      if (newState.serverMute) {
        try { await newState.setMute(false, 'حصانة مسجلات VCR: ممنوع الكتم الإجباري'); } catch {}
      }

      // Anti-Server Deafen
      if (newState.serverDeaf) {
        try { await newState.setDeaf(false, 'حصانة مسجلات VCR: ممنوع التصميت الإجباري'); } catch {}
      }

      // Manual Disconnect Protection (with debounce)
      if (oldState.channelId && !newState.channelId) {
        const now = Date.now();
        if (now - worker.lastJoinAttempt > 4000) {
          console.warn(`🛡️ [حماية مسجلات VCR] تم رصد فصل المسجل ${worker.name}. إعادة التثبيت خلال 2 ثانية...`);
          setTimeout(async () => {
            if (defaultTargetCh) {
              await worker.joinChannel(defaultTargetCh, guild, true);
            }
          }, 2000);
        }
        return;
      }

      // Manual Drag Protection
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        if (defaultTargetCh && newState.channelId !== defaultTargetCh.id) {
          const now = Date.now();
          if (now - worker.lastJoinAttempt > 4000) {
            console.warn(`🛡️ [حماية مسجلات VCR] تم رصد سحب المسجل ${worker.name}. إرجاعه للروم الرسمي...`);
            setTimeout(async () => {
              await worker.joinChannel(defaultTargetCh, guild, true);
            }, 2000);
          }
          return;
        }
      }
    }

    // Human Member Voice Session Tracking
    const oldCh = oldState.channel;
    const newCh = newState.channel;

    if (oldCh && oldCh.isVoiceBased() && oldCh.id !== newCh?.id) {
      const session = this.activeSessions.get(oldCh.id);
      if (session) {
        const presence = session.membersPresence.get(oldState.member.id);
        if (presence && !presence.leaveTime) {
          presence.leaveTime = Date.now();
        }

        const humanMembers = oldCh.members.filter(m => !m.user.bot);
        if (humanMembers.size === 0) {
          if (session.worker) session.worker.cleanupSubscriptions();
          if (session.userAudioTracks) session.userAudioTracks.clear();
          this.activeSessions.delete(oldCh.id);
        }
      }
    }

    if (newCh && newCh.isVoiceBased() && oldCh?.id !== newCh.id) {
      const session = this.activeSessions.get(newCh.id);
      if (session && !newState.member.user.bot) {
        this.trackMemberPresence(session, newState.member.id, newState.guild);
      }
    }
  }

  async runWatchdog(guild) {
    if (!guild) return;

    const now = Date.now();
    if (now - this.lastWatchdogRun < 10000) return;
    this.lastWatchdogRun = now;

    try {
      const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
      const voiceChannels = channels
        .filter(c => c && c.isVoiceBased() && !c.isThread())
        .sort((a, b) => a.position - b.position);

      const voiceList = [...voiceChannels.values()];
      if (voiceList.length === 0) return;

      for (let i = 0; i < this.workers.length; i++) {
        const worker = this.workers[i];
        if (worker.isInternalSwitching) continue;

        const targetChannel = guild.channels.cache.get(worker.defaultChannelId) ||
                              voiceList.find(c => c.id === worker.defaultChannelId) ||
                              voiceList[i];
        if (!targetChannel) continue;

        const vGuild = worker.client.guilds.cache.get(guild.id);
        if (!vGuild) continue;

        const currentVoiceId = vGuild.members.me?.voice?.channelId;
        const isConnected = worker.connection && 
                            worker.connection.state.status !== VoiceConnectionStatus.Destroyed &&
                            worker.connection.state.status !== VoiceConnectionStatus.Disconnected;

        if (!currentVoiceId || !isConnected) {
          if (Date.now() - worker.lastJoinAttempt > 5000) {
            await worker.joinChannel(targetChannel, guild, true);
          }
        }
      }
    } catch {}
  }
}
