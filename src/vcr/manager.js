import { ChannelType, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder, AuditLogEvent } from 'discord.js';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { VCR_CONFIGS, VCR_ROLE_NAME, SECRET_VCR_CHANNEL_NAME, SECRET_VCR_CHANNEL_ID, MUTE_COOLDOWN_MS, MUTE_DURATION_MS, VCR_BOT_IDS } from './config.js';
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
        userAudioTracks: new Map(), // userId -> { userId, firstTimestamp, startOffsetMs, pcmChunks: [] }
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
    const userId = member.id;

    const lastMute = this.userMuteCooldowns.get(userId) || 0;
    if (Date.now() - lastMute < MUTE_COOLDOWN_MS) return;
    this.userMuteCooldowns.set(userId, Date.now());

    console.warn(`🚨 [رصد صوت عالي / صراخ] تم رصد صراخ حاد (${energyValue} RMS) في #${channel.name} من ${member.user.tag}. تطبيق ميوت 30 ثانية عبر البوت الأساسي...`);

    try {
      const mainGuild = this.mainClient.guilds.cache.get(guild.id) || await this.mainClient.guilds.fetch(guild.id).catch(() => null);
      const targetMember = mainGuild ? (await mainGuild.members.fetch(userId).catch(() => null)) : member;

      if (targetMember && targetMember.voice?.channel && mainGuild.members.me?.permissions.has(PermissionFlagsBits.MuteMembers)) {
        await targetMember.voice.setMute(true, 'رصد أصوات عالية / صراخ حاد في الفويس (كتم صوتي إجباري لمدة 30 ثانية)');
        console.log(`🔇 [كتم مركزي] تم كتم العضو ${targetMember.user.tag} لمدة 30 ثانية بواسطة البوت الأساسي.`);

        if (this.activeMuteTimers.has(userId)) {
          clearTimeout(this.activeMuteTimers.get(userId));
        }

        const timer = setTimeout(async () => {
          try {
            this.activeMuteTimers.delete(userId);
            const freshMem = await mainGuild.members.fetch(userId).catch(() => null);
            if (freshMem && freshMem.voice?.serverMute) {
              await freshMem.voice.setMute(false, 'انتهاء مهلة الكتم الصوتي الـ 30 ثانية');
              console.log(`🔊 [فك الكتم المركزي] تم فك الكتم تلقائياً عن ${freshMem.user.tag} بعد 30 ثانية (أينما تواجد).`);
            }
          } catch (err) {
            console.error('خطأ في فك الكتم الصوتي المركزي:', err.message);
          }
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
          `🛑 **الإجراء المتخذ:** تم تطبيق كتم صوتي إجباري على مستوى السيرفر لمدة **30 ثانية فقط** (غير قابلة للزيادة).\n` +
          `⏱️ **انتهاء الكتم:** سيتم فك الكتم عنك تلقائياً وبشكل فوري بعد انتهاء الـ 30 ثانية حتى لو انتقلت لروم آخر.\n\n` +
          `🙏 يرجى ضبط حساسية المايكروفون والالتزام بالهدوء لراحة جميع الأعضاء المتواجدين.`
        )
        .setFooter({ text: `GX eSports Voice Sentinel • الإصدار ${this.botVersion}` })
        .setTimestamp();

      await member.send({ embeds: [userDMEmbed] }).catch(() => {});

      const adminTierRoleIds = ['1538485406922838066', '1538485672795570196', '1538544110913454160', '1538569735057178745'];
      const recipients = new Set();
      if (guild.ownerId) recipients.add(guild.ownerId);

      for (const [, mem] of guild.members.cache) {
        if (mem.user.bot) continue;
        if (mem.roles.cache.some(r => adminTierRoleIds.includes(r.id) || r.name.toLowerCase() === 'managers')) {
          recipients.add(mem.id);
        }
      }

      const adminAlertEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🚨 إنذار رصد إزعاج صوتي | GX VCR Sentinel', iconURL: member.user.displayAvatarURL() })
        .setTitle('⚠️ رصد صراخ / أصوات صاخبة وكتم المستخدم 30 ثانية')
        .setDescription(
          `تم رصد ارتفاع حاد في مستوى الصوت (Loud Sound / Peak: \`${energyValue} RMS\`) في أحد الرومات الصوتية وتم اتخاذ الإجراء التلقائي فوراً.\n\n` +
          `👤 **العضو المخالف:** <@${member.id}> (\`${member.user.tag}\`)\n` +
          `🔊 **الروم الصوتي:** <#${channel.id}> (\`#${channel.name}\`)\n` +
          `⏱️ **الإجراء التلقائي:** تم كتم العضو صوتياً (Server Mute) لمدة \`30 ثانية\` وتم إرسال تنبيه في الخاص له.\n` +
          `📅 **التوقيت:** <t:${Math.floor(Date.now() / 1000)}:T>`
        )
        .setFooter({ text: `GX eSports Management Alert • الإصدار ${this.botVersion}` })
        .setTimestamp();

      for (const uid of recipients) {
        try {
          const u = await this.mainClient.users.fetch(uid).catch(() => null);
          if (u) {
            await u.send({ embeds: [adminAlertEmbed] }).catch(() => {});
          }
        } catch {}
      }
    } catch (err) {
      console.error('خطأ في معالجة مخالفة الصوت الصاخب:', err.message);
    }
  }

  /**
   * 🎧 Multi-Speaker Synchronized Timeline Mixer:
   * Mixes each speaker's audio track at their exact time offset with crystal-clear 128kbps Opus broadcast audio.
   * Eliminates all chopping, speech distortion, dropped words, and robotic audio!
   */
  async mixMultiTrackAudioToOgg(userTracksMap) {
    return new Promise((resolve) => {
      if (!userTracksMap || userTracksMap.size === 0) return resolve(null);

      const validTracks = [...userTracksMap.values()].filter(t => t.pcmChunks && t.pcmChunks.length > 0);
      if (validTracks.length === 0) return resolve(null);

      // Single Speaker: Direct lossless conversion to 128kbps Studio Opus
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

      // Multiple Speakers: Precise Multi-Input Synchronized Timeline Mixing
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

      // Feed each speaker track into its dedicated input pipe
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

    // Cleanup worker active subscriptions for next session
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

      // 🎧 Studio Synchronized Multi-Track Timeline Mix
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
      console.log(`📁 [أرشفة VCR سحابية] تم بنجاح إرسال تقرير وتسجيل الروم #${session.channelName} بنقاء استوديو فائق وبدون أي تقطيع.`);
    } catch (err) {
      console.error('خطأ في أرشفة التقرير الصوتي:', err.message);
    } finally {
      session.isFinalizing = false;
      session.userAudioTracks.clear();
    }
  }

  /**
   * 🛡️ Voice State Update & Anti-Disconnect/Anti-Drag Guardian for VCR Bots
   */
  async onVoiceStateUpdate(oldState, newState) {
    const guild = newState.guild || oldState.guild;
    const member = newState.member || oldState.member;
    if (!guild || !member) return;

    // A. If the updated member is one of our 5 VCR Bots
    if (VCR_BOT_IDS.has(member.id)) {
      const worker = this.workers.find(w => w.id === member.id);
      if (!worker) return;

      const defaultTargetCh = guild.channels.cache.get(worker.defaultChannelId) ||
                              guild.channels.cache.find(c => c.id === worker.assignedChannelId);

      // 1. Anti-Disconnect Guardian
      if (oldState.channelId && !newState.channelId) {
        console.warn(`🛡️ [حماية مسجلات VCR] تم رصد محاولة فصل يدوي للمسجل ${worker.name} من #${oldState.channel?.name}. جارٍ إعادة الربط فوراً...`);
        
        setTimeout(async () => {
          if (defaultTargetCh) {
            await worker.joinChannel(defaultTargetCh, guild, true);
          }
        }, 800);

        setTimeout(async () => {
          try {
            const auditLogs = await guild.fetchAuditLogs({ limit: 4, type: AuditLogEvent.MemberDisconnect }).catch(() => null);
            const entry = auditLogs?.entries.find(e => e.target?.id === member.id && (Date.now() - e.createdTimestamp) < 10000);
            const executor = entry?.executor;

            const logEmbed = new EmbedBuilder()
              .setColor(0xED4245)
              .setAuthor({ name: '🛡️ تصدي لمحاولة فصل مسجل صوتي | VCR Guardian', iconURL: member.user.displayAvatarURL() })
              .setTitle(`⛔ تم منع فصل المسجل الصوتي: ${worker.name}`)
              .setDescription(
                `تم رصد محاولة لفصل البوت المسجل <@${member.id}> من الروم الصوتي <#${oldState.channelId}>.\n\n` +
                `🔒 **إجراء النظام:** قام نظام الحماية بإعادة البوت فوراً إلى رومه المخصص <#${worker.defaultChannelId}> واستئناف المراقبة.\n` +
                `👮‍♂️ **المسؤول عن الفصل:** ${executor ? `<@${executor.id}> (` + executor.tag + `)` : 'غير محدد'}`
              )
              .setFooter({ text: `GX eSports Security Sentinel • الإصدار ${this.botVersion}` })
              .setTimestamp();

            await this.logToAdmin(guild, logEmbed);
          } catch {}
        }, 1500);
        return;
      }

      // 2. Anti-Drag Guardian
      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        if (defaultTargetCh && newState.channelId !== defaultTargetCh.id) {
          console.warn(`🛡️ [حماية مسجلات VCR] تم رصد سحب غير مصرح به للمسجل ${worker.name} من #${oldState.channel?.name} إلى #${newState.channel?.name}. جارٍ الإرجاع...`);

          setTimeout(async () => {
            await worker.joinChannel(defaultTargetCh, guild, true);
          }, 800);

          setTimeout(async () => {
            try {
              const auditLogs = await guild.fetchAuditLogs({ limit: 4, type: AuditLogEvent.MemberMove }).catch(() => null);
              const entry = auditLogs?.entries.find(e => (Date.now() - e.createdTimestamp) < 10000);
              const executor = entry?.executor;

              const logEmbed = new EmbedBuilder()
                .setColor(0xFEE75C)
                .setAuthor({ name: '🛡️ تصدي لسحب مسجل صوتي | VCR Guardian', iconURL: member.user.displayAvatarURL() })
                .setTitle(`🔄 تم إرجاع المسجل ${worker.name} إلى رومه الرسمي`)
                .setDescription(
                  `تم رصد سحب البوت المسجل <@${member.id}> إلى <#${newState.channelId}>.\n\n` +
                  `🔒 **إجراء النظام:** تم إعادة البوت تلقائياً إلى رومه المعتمد <#${defaultTargetCh.id}>.\n` +
                  `👮‍♂️ **المنفذ:** ${executor ? `<@${executor.id}> (` + executor.tag + `)` : 'غير محدد'}`
                )
                .setFooter({ text: `GX eSports Security Sentinel • الإصدار ${this.botVersion}` })
                .setTimestamp();

              await this.logToAdmin(guild, logEmbed);
            } catch {}
          }, 1500);
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

  /**
   * 🔄 High-Frequency Watchdog (Stationing, Duplicates Guard, Health Check)
   */
  async runWatchdog(guild) {
    if (!guild) return;

    try {
      const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
      const voiceChannels = channels
        .filter(c => c && c.isVoiceBased() && !c.isThread())
        .sort((a, b) => a.position - b.position);

      const voiceList = [...voiceChannels.values()];
      if (voiceList.length === 0) return;

      // 1. Inspect for duplicate bots in the same channel
      const channelToWorkers = new Map();

      for (let i = 0; i < this.workers.length; i++) {
        const worker = this.workers[i];
        const vGuild = worker.client.guilds.cache.get(guild.id);
        const currentVoiceId = vGuild?.members.me?.voice?.channelId;

        if (currentVoiceId) {
          if (!channelToWorkers.has(currentVoiceId)) channelToWorkers.set(currentVoiceId, []);
          channelToWorkers.get(currentVoiceId).push(worker);
        }
      }

      for (const [chId, workersInCh] of channelToWorkers) {
        if (workersInCh.length > 1) {
          console.warn(`⚠️ [رصد تكرار] تم رصد ${workersInCh.length} مسجلات في نفس الروم الصوتي (${chId}). جارٍ إعادة التوزيع فوراً...`);
          for (let j = 1; j < workersInCh.length; j++) {
            const extraWorker = workersInCh[j];
            const emptyCh = voiceList.find(c => !channelToWorkers.has(c.id) || channelToWorkers.get(c.id).length === 0) ||
                            guild.channels.cache.get(extraWorker.defaultChannelId);
            if (emptyCh) {
              console.log(`🔄 [نقل مسجل] نقل ${extraWorker.name} إلى الروم المعتمد: #${emptyCh.name} (${emptyCh.id})`);
              await extraWorker.joinChannel(emptyCh, guild, true);
              channelToWorkers.set(emptyCh.id, [extraWorker]);

              const fixEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setAuthor({ name: '🔄 موازنة وتوزيع مسجلات الصوت | VCR Sentinel', iconURL: guild.iconURL() })
                .setTitle('✅ تم فك التكرار وتوزيع المسجلات بدقة')
                .setDescription(`تم رصد مسجلين في <#${chId}> وتم نقل البوت **${extraWorker.name}** فوراً إلى رومه المعتمد <#${emptyCh.id}>.`)
                .setFooter({ text: `GX eSports System • الإصدار ${this.botVersion}` })
                .setTimestamp();
              await this.logToAdmin(guild, fixEmbed);
            }
          }
        }
      }

      // 2. Ensure every voice channel has its dedicated VCR bot stationed
      for (let i = 0; i < this.workers.length; i++) {
        const worker = this.workers[i];
        const targetChannel = guild.channels.cache.get(worker.defaultChannelId) ||
                              voiceList.find(c => c.id === worker.defaultChannelId) ||
                              voiceList[i];
        if (!targetChannel) continue;

        const vGuild = worker.client.guilds.cache.get(guild.id);
        if (!vGuild) continue;

        const currentVoiceId = vGuild.members.me?.voice?.channelId;
        if (!currentVoiceId || !worker.connection || currentVoiceId !== targetChannel.id) {
          try {
            await worker.joinChannel(targetChannel, guild, true);
          } catch {}
        }
      }

      // 3. Track member presence & handle session finalization when <= 1 members remain
      for (const vCh of voiceList) {
        const humanMembers = vCh.members.filter(m => !m.user.bot);
        const session = this.activeSessions.get(vCh.id);

        if (session) {
          for (const [, mem] of humanMembers) {
            if (!session.membersPresence.has(mem.id)) {
              session.membersPresence.set(mem.id, {
                id: mem.id,
                tag: mem.user.tag,
                displayName: mem.displayName || mem.user.username,
                joinTime: Date.now(),
                leaveTime: null,
                totalSpokenCount: 0
              });
            }
          }

          for (const [uid, p] of session.membersPresence) {
            if (!humanMembers.has(uid) && !p.leaveTime) {
              p.leaveTime = Date.now();
            }
          }

          if (humanMembers.size <= 1 && (session.hasSpoken || (session.totalRecordedBytes || 0) > 0)) {
            const reason = humanMembers.size === 0 
              ? 'مغادرة جميع الأعضاء للروم الصوتي' 
              : 'بقاء عضو واحد فقط بالروم وانخفاض العدد عن الحد الأدنى للتسجيل';
            await this.finalizeAndSendRecording(vCh.id, reason);
          }
        }
      }
    } catch {}
  }
}
