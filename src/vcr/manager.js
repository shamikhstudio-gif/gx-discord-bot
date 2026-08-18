import { ChannelType, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
import path from 'path';
import { VCR_CONFIGS, VCR_ROLE_NAME, SECRET_VCR_CHANNEL_NAME, SECRET_VCR_CHANNEL_ID, MUTE_COOLDOWN_MS, MUTE_DURATION_MS, VCR_RECORDS_DIR } from './config.js';
import { VCRWorker } from './worker.js';

if (!fs.existsSync(VCR_RECORDS_DIR)) {
  fs.mkdirSync(VCR_RECORDS_DIR, { recursive: true });
}

export class VCRManager {
  constructor(mainClient, mainBotVersion = '1.0') {
    this.mainClient = mainClient;
    this.botVersion = mainBotVersion;
    this.workers = [];
    this.activeSessions = new Map(); // channelId -> session
    this.userMuteCooldowns = new Map(); // userId -> timestamp
    this.activeMuteTimers = new Map(); // userId -> NodeJS.Timeout
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

        for (const roleId of ['1538485406922838066', '1538485672795570196', '1538544110913454160']) {
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
      const targetChannel = voiceList[i] || voiceList[voiceList.length - 1];
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
      const pcmPath = path.join(VCR_RECORDS_DIR, `rec_${channel.id}_${timestamp}.pcm`);
      const pcmStream = fs.createWriteStream(pcmPath, { flags: 'a' });

      session = {
        worker,
        channelId: channel.id,
        channelName: channel.name,
        guild,
        startTime: timestamp,
        pcmFilePath: pcmPath,
        pcmWriteStream: pcmStream,
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

  /**
   * Centralized Server Mute & Unmute executed directly by the MAIN BOT (GX Bot)
   * Ensures reliable unmute even if the user moves between voice rooms.
   */
  async handleLoudSoundViolation(guild, channel, member, speakerInfo, energyValue) {
    if (!member || !member.voice?.channel) return;
    const userId = member.id;

    const lastMute = this.userMuteCooldowns.get(userId) || 0;
    if (Date.now() - lastMute < MUTE_COOLDOWN_MS) return;
    this.userMuteCooldowns.set(userId, Date.now());

    console.warn(`🚨 [رصد صوت عالي / صراخ] تم رصد صراخ حاد (${energyValue} RMS) في #${channel.name} من ${member.user.tag}. تطبيق ميوت 30 ثانية عبر البوت الأساسي...`);

    try {
      // Fetch fresh member via Main Bot Client to ensure global guild control
      const mainGuild = this.mainClient.guilds.cache.get(guild.id) || await this.mainClient.guilds.fetch(guild.id).catch(() => null);
      const targetMember = mainGuild ? (await mainGuild.members.fetch(userId).catch(() => null)) : member;

      if (targetMember && targetMember.voice?.channel && mainGuild.members.me?.permissions.has(PermissionFlagsBits.MuteMembers)) {
        await targetMember.voice.setMute(true, 'رصد أصوات عالية / صراخ حاد في الفويس (كتم صوتي إجباري لمدة 30 ثانية)');
        console.log(`🔇 [كتم مركزي] تم كتم العضو ${targetMember.user.tag} لمدة 30 ثانية بواسطة البوت الأساسي.`);

        // Clear existing timer if any
        if (this.activeMuteTimers.has(userId)) {
          clearTimeout(this.activeMuteTimers.get(userId));
        }

        // Global unmute timer on Main Bot
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

      const adminTierRoleIds = ['1538485406922838066', '1538485672795570196', '1538544110913454160'];
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

  async convertPcmToMp3(pcmPath, mp3Path) {
    return new Promise((resolve) => {
      if (!fs.existsSync(pcmPath) || fs.statSync(pcmPath).size === 0) {
        return resolve(false);
      }

      const proc = spawn(ffmpegStatic, [
        '-y',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-i', pcmPath,
        '-b:a', '128k',
        mp3Path
      ]);

      proc.on('close', (code) => {
        resolve(code === 0 && fs.existsSync(mp3Path) && fs.statSync(mp3Path).size > 0);
      });

      proc.on('error', () => resolve(false));
    });
  }

  async finalizeAndSendRecording(channelId, reason = 'مغادرة الأعضاء وانتهاء الجلسة') {
    const session = this.activeSessions.get(channelId);
    if (!session || session.isFinalizing) return;

    session.isFinalizing = true;
    this.activeSessions.delete(channelId);

    if (session.pcmWriteStream) {
      try { session.pcmWriteStream.end(); } catch {}
    }

    const durationSeconds = Math.floor((Date.now() - session.startTime) / 1000);
    const hasRecordedAudio = (session.totalRecordedBytes || 0) > 4000;

    if (durationSeconds < 3 || session.membersPresence.size === 0 || (!session.hasSpoken && !hasRecordedAudio)) {
      if (fs.existsSync(session.pcmFilePath)) {
        try { fs.unlinkSync(session.pcmFilePath); } catch {}
      }
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

      const mp3Path = session.pcmFilePath.replace('.pcm', '.mp3');
      const mp3Converted = await this.convertPcmToMp3(session.pcmFilePath, mp3Path);

      const files = [];
      if (mp3Converted) {
        const safeName = session.channelName.replace(/[^a-zA-Z0-9_-]/g, '_');
        files.push(new AttachmentBuilder(mp3Path, { name: `GX_Voice_Rec_${safeName}_${Date.now()}.mp3` }));
      }

      const reportEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: '🎙️ تقرير الجلسة الصوتية وملف التسجيل MP3 | GX VCR Archive', iconURL: guild.iconURL() })
        .setTitle(`📁 أرشفة الجلسة الصوتية في روم: #${session.channelName}`)
        .setDescription(
          `تم إنهاء الجلسة وتوليد الملف الصوتي وسجل الدخول والخروج بدقة.\n\n` +
          `🔊 **الروم الصوتي:** <#${session.channelId}> (\`#${session.channelName}\`)\n` +
          `⏱️ **إجمالي مدة الجلسة:** \`${durationStr}\`\n` +
          `📅 **بداية الجلسة:** <t:${Math.floor(session.startTime / 1000)}:F>\n` +
          `🏁 **نهاية الجلسة:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
          `🎵 **ملف التسجيل الصوتي:** ${mp3Converted ? '✅ مرفق بصيغة MP3 أدناه' : '⚠️ لم يتم رصد تسجيل مسموع'}\n` +
          `📝 **سبب الأرشفة:** ${reason}\n\n` +
          `👥 **سجل الأعضاء والتوقيتات (${session.membersPresence.size} أعضاء):**\n${memberTimelines}`
        )
        .setFooter({ text: `GX eSports Autonomous Surveillance • ${session.worker.name}` })
        .setTimestamp();

      await logChannel.send({ embeds: [reportEmbed], files }).catch(() => {});
      console.log(`📁 [أرشفة VCR] تم بنجاح إرسال تقرير وتسجيل الروم #${session.channelName} بصيغة MP3.`);

      if (fs.existsSync(session.pcmFilePath)) {
        try { fs.unlinkSync(session.pcmFilePath); } catch {}
      }
      if (fs.existsSync(mp3Path)) {
        try { fs.unlinkSync(mp3Path); } catch {}
      }
    } catch (err) {
      console.error('خطأ في أرشفة التقرير الصوتي:', err.message);
    } finally {
      session.isFinalizing = false;
    }
  }

  /**
   * Real-time VoiceStateUpdate Handler:
   * Instantly triggered whenever a member leaves or transfers between voice rooms.
   * If remaining human members <= 1 -> immediately finalize and send recording!
   */
  async onVoiceStateUpdate(oldState, newState) {
    const oldCh = oldState.channel;
    const newCh = newState.channel;

    // Track leave from old channel
    if (oldCh && oldCh.isVoiceBased() && oldCh.id !== newCh?.id) {
      const session = this.activeSessions.get(oldCh.id);
      if (session) {
        const presence = session.membersPresence.get(oldState.member.id);
        if (presence && !presence.leaveTime) {
          presence.leaveTime = Date.now();
        }

        const humanMembers = oldCh.members.filter(m => !m.user.bot);
        // If remaining human members <= 1 -> FINALIZE AND SEND MP3 RECORDING IMMEDIATELY!
        if (humanMembers.size <= 1 && (session.hasSpoken || (session.totalRecordedBytes || 0) > 0)) {
          const reason = humanMembers.size === 0 
            ? 'مغادرة جميع الأعضاء للروم الصوتي' 
            : 'بقاء عضو واحد فقط بالروم وانخفاض العدد عن الحد الأدنى للتسجيل';
          await this.finalizeAndSendRecording(oldCh.id, reason);
        }
      }
    }

    // Track join to new channel
    if (newCh && newCh.isVoiceBased() && oldCh?.id !== newCh.id) {
      const session = this.activeSessions.get(newCh.id);
      if (session && !newState.member.user.bot) {
        this.trackMemberPresence(session, newState.member.id, newState.guild);
      }
    }
  }

  async runWatchdog(guild) {
    if (!guild) return;

    try {
      const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
      const voiceChannels = channels
        .filter(c => c && c.isVoiceBased() && !c.isThread())
        .sort((a, b) => a.position - b.position);

      const voiceList = [...voiceChannels.values()];

      for (let i = 0; i < this.workers.length; i++) {
        const worker = this.workers[i];
        const targetChannel = voiceList[i] || voiceList[voiceList.length - 1];
        if (!targetChannel) continue;

        const vGuild = worker.client.guilds.cache.get(guild.id);
        if (!vGuild) continue;

        const currentVoiceId = vGuild.members.me?.voice?.channelId;
        if (!currentVoiceId || currentVoiceId !== targetChannel.id || !worker.connection) {
          try {
            await worker.joinChannel(targetChannel, guild);
          } catch {}
        }
      }

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

          // In watchdog check: If human members <= 1 -> finalize recording
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
