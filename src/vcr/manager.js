import { ChannelType, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder, AuditLogEvent } from 'discord.js';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { VoiceConnectionStatus } from '@discordjs/voice';
import {
  VCR_CONFIGS,
  VCR_ROLE_NAME,
  SECRET_VCR_CHANNEL_NAME,
  SECRET_VCR_CHANNEL_ID,
  MUTE_COOLDOWN_MS,
  MUTE_DURATION_MS,
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
    this.activeSessions = new Map(); // channelId -> session
    this.userMuteCooldowns = new Map(); // userId -> timestamp
    this.activeMuteTimers = new Map(); // userId -> NodeJS.Timeout
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
        return TOP_EXEC_ROLE_NAMES.some(tier => name === tier || name.includes(tier));
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
    if (!session.membersPresence.has(userId)) {
      const u = guild.members.cache.get(userId);
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

  async handleLoudSoundViolation(guild, channel, member, speakerInfo, energyValue) {
    if (!member || !member.voice?.channel) return;
    
    // Strict COO, CEO, OWNER Immunity
    if (this.isVCRImmuneExecutive(member)) {
      return;
    }

    const userId = member.id;
    const lastMute = this.userMuteCooldowns.get(userId) || 0;
    if (Date.now() - lastMute < MUTE_COOLDOWN_MS) return;
    this.userMuteCooldowns.set(userId, Date.now());

    console.warn(`🚨 [رصد صوت عالي / صراخ] تم رصد صراخ حاد (${energyValue} RMS) في #${channel.name} من ${member.user.tag}. تطبيق ميوت 30 ثانية...`);

    try {
      const mainGuild = this.mainClient.guilds.cache.get(guild.id) || await this.mainClient.guilds.fetch(guild.id).catch(() => null);
      const targetMember = mainGuild ? (await mainGuild.members.fetch(userId).catch(() => null)) : member;

      if (targetMember && targetMember.voice?.channel && mainGuild.members.me?.permissions.has(PermissionFlagsBits.MuteMembers)) {
        await targetMember.voice.setMute(true, 'رصد أصوات عالية / صراخ حاد في الفويس (كتم صوتي إجباري لمدة 30 ثانية)');

        if (this.activeMuteTimers.has(userId)) {
          clearTimeout(this.activeMuteTimers.get(userId));
        }

        const timer = setTimeout(async () => {
          try {
            this.activeMuteTimers.delete(userId);
            const freshMem = await mainGuild.members.fetch(userId).catch(() => null);
            if (freshMem && freshMem.voice?.serverMute) {
              await freshMem.voice.setMute(false, 'انتهاء مهلة الكتم الصوتي الـ 30 ثانية');
            }
          } catch (err) {}
        }, MUTE_DURATION_MS);

        this.activeMuteTimers.set(userId, timer);
      }

      const userDMEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '⚠️ تنبيه أمني صوتي | GX VCR Defense', iconURL: guild.iconURL() })
        .setTitle('🔇 تم تطبيق كتم صوتي مؤقت (Server Mute)')
        .setDescription(
          `مرحباً <@${member.id}>،\n\n` +
          `تم رصد **صوت صاخب جداً / صراخ حاد ومفاجئ** صادر من المايكروفون الخاص بك في الروم الصوتي <#${channel.id}>.\n\n` +
          `🛑 **الإجراء المتخذ:** تم تطبيق كتم صوتي إجباري على مستوى السيرفر لمدة **30 ثانية فقط**.\n` +
          `⏱️ **انتهاء الكتم:** سيتم فك الكتم عنك تلقائياً وبشكل فوري بعد انتهاء الـ 30 ثانية.\n\n` +
          `🙏 يرجى ضبط حساسية المايكروفون والالتزام بالهدوء لراحة جميع الأعضاء المتواجدين.`
        )
        .setFooter({ text: `GX eSports Voice Sentinel • الإصدار ${this.botVersion}` })
        .setTimestamp();

      await member.send({ embeds: [userDMEmbed] }).catch(() => {});
    } catch (err) {}
  }

  async mixMultiTrackAudioToOgg(userTracksMap) {
    return new Promise((resolve) => {
      if (!userTracksMap || userTracksMap.size === 0) return resolve(null);

      const validTracks = [...userTracksMap.values()].filter(t => t.pcmChunks && t.pcmChunks.length > 0);
      if (validTracks.length === 0) return resolve(null);

      if (validTracks.length === 1) {
        const fullPcm = Buffer.concat(validTracks[0].pcmChunks);
        const proc = spawn(ffmpegStatic, [
          '-y',
          '-f', 's16le',
          '-ar', '48000',
          '-ac', '2',
          '-i', 'pipe:0',
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-vbr', 'on',
          '-application', 'audio',
          '-f', 'ogg',
          'pipe:1'
        ]);

        const outputChunks = [];
        proc.stdout.on('data', chunk => outputChunks.push(chunk));
        proc.on('close', (code) => {
          if (code === 0 && outputChunks.length > 0) resolve(Buffer.concat(outputChunks));
          else resolve(null);
        });
        proc.on('error', () => resolve(null));

        proc.stdin.write(fullPcm);
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
        '-c:a', 'libopus',
        '-b:a', '128k',
        '-vbr', 'on',
        '-application', 'audio',
        '-f', 'ogg',
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
        const fullUserPcm = Buffer.concat(validTracks[i].pcmChunks);
        const pipeStream = proc.stdio[3 + i];
        if (pipeStream) {
          pipeStream.write(fullUserPcm);
          pipeStream.end();
        }
      }
    });
  }

  async finalizeAndSendRecording(channelId, reason = 'مغادرة الأعضاء وانتهاء الجلسة') {
    const session = this.activeSessions.get(channelId);
    if (!session || session.isFinalizing) return;

    session.isFinalizing = true;
    this.activeSessions.delete(channelId);

    if (session.worker) {
      session.worker.cleanupSubscriptions();
    }

    const durationSeconds = Math.floor((Date.now() - session.startTime) / 1000);
    const hasRecordedAudio = (session.totalRecordedBytes || 0) > 4000;

    if (durationSeconds < 3 || session.membersPresence.size === 0 || (!session.hasSpoken && !hasRecordedAudio)) {
      session.isFinalizing = false;
      return;
    }

    try {
      const guild = session.guild;
      const logChannel = await this.findOrCreateVCRLogChannel(guild);
      if (!logChannel) return;

      const minutes = Math.floor(durationSeconds / 60);
      const seconds = durationSeconds % 60;
      const durationStr = `${minutes > 0 ? `${minutes} دقيقة و ` : ''}${seconds} ثانية`;

      const memberTimelines = [...session.membersPresence.values()].map((m, idx) => {
        const joinStr = `<t:${Math.floor(m.joinTime / 1000)}:T>`;
        const leaveStr = m.leaveTime ? `<t:${Math.floor(m.leaveTime / 1000)}:T>` : `<t:${Math.floor(Date.now() / 1000)}:T>`;
        return `**${idx + 1}.** <@${m.id}> (` + m.tag + `)\n   • 📥 **الدخول:** ${joinStr} ➔ 📤 **الخروج:** ${leaveStr}\n   • 🗣️ **عدد مرات التحدث:** \`${m.totalSpokenCount}\` مرة`;
      }).join('\n\n') || 'لا توجد بيانات مسجلة';

      const oggBuffer = await this.mixMultiTrackAudioToOgg(session.userAudioTracks);

      const files = [];
      if (oggBuffer) {
        const safeName = session.channelName.replace(/[^a-zA-Z0-9_-]/g, '_');
        files.push(new AttachmentBuilder(oggBuffer, { name: `GX_Voice_Rec_${safeName}_${Date.now()}.ogg` }));
      }

      const reportEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: '🎙️ تقرير الجلسة الصوتية وملف التسجيل عالي النقاء | GX VCR Archive', iconURL: guild.iconURL() })
        .setTitle(`📁 أرشفة الجلسة الصوتية في روم: #${session.channelName}`)
        .setDescription(
          `تم إنهاء الجلسة وتوليد الملف الصوتي وسجل الدخول والخروج بدقة متناهية.\n\n` +
          `🔊 **الروم الصوتي:** <#${session.channelId}> (\`#${session.channelName}\`)\n` +
          `⏱️ **إجمالي مدة الجلسة:** \`${durationStr}\`\n` +
          `📅 **بداية الجلسة:** <t:${Math.floor(session.startTime / 1000)}:F>\n` +
          `🏁 **نهاية الجلسة:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
          `🎵 **ملف التسجيل الصوتي:** ${oggBuffer ? '✅ مرفق بصيغة OGG Opus النقية (128kbps Audio) أدناه' : '⚠️ لم يتم رصد تسجيل مسموع'}\n` +
          `📝 **سبب الأرشفة:** ${reason}\n\n` +
          `👥 **سجل الأعضاء والتوقيتات (${session.membersPresence.size} أعضاء):**\n${memberTimelines}`
        )
        .setFooter({ text: `GX eSports Autonomous Surveillance • ${session.worker.name}` })
        .setTimestamp();

      await logChannel.send({ embeds: [reportEmbed], files }).catch(() => {});
      console.log(`📁 [أرشفة VCR سحابية] تم بنجاح إرسال تقرير وتسجيل الروم #${session.channelName}.`);
    } catch (err) {
      console.error('خطأ في أرشفة التقرير الصوتي:', err.message);
    } finally {
      session.isFinalizing = false;
      session.userAudioTracks.clear();
    }
  }

  async onVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const member = newState.member || oldState.member;
    if (!guild || !member) return;

    // A. If the updated member is one of our 5 VCR Bots
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

    // B. Human Member Voice Session Tracking
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
        if (humanMembers.size <= 1 && (session.hasSpoken || (session.totalRecordedBytes || 0) > 0)) {
          const reason = humanMembers.size === 0 
            ? 'مغادرة جميع الأعضاء للروم الصوتي' 
            : 'بقاء عضو واحد فقط بالروم وانخفاض العدد عن الحد الأدنى للتسجيل';
          await this.finalizeAndSendRecording(oldCh.id, reason);
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

    // Run watchdog only every 10 seconds to avoid spamming Discord
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

      // Ensure each VCR bot is connected ONLY if actually disconnected
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

        // ONLY rejoin if completely missing from voice
        if (!currentVoiceId || !isConnected) {
          if (Date.now() - worker.lastJoinAttempt > 5000) {
            await worker.joinChannel(targetChannel, guild, true);
          }
        }
      }
    } catch {}
  }
}
