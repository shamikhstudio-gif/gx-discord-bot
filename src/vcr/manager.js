import { ChannelType, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { VCR_CONFIGS, VCR_ROLE_NAME, SECRET_VCR_CHANNEL_NAME, MUTE_COOLDOWN_MS, MUTE_DURATION_MS } from './config.js';
import { VCRWorker } from './worker.js';

export class VCRManager {
  constructor(mainClient, mainBotVersion = '1.0') {
    this.mainClient = mainClient;
    this.botVersion = mainBotVersion;
    this.workers = [];
    this.activeSessions = new Map(); // channelId -> session
    this.userMuteCooldowns = new Map(); // userId -> timestamp
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
    let ch = guild.channels.cache.find(c => c && (c.name === SECRET_VCR_CHANNEL_NAME || c.name.includes('سجلات-التسجيلات')));
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
      session = {
        worker,
        channelId: channel.id,
        channelName: channel.name,
        guild,
        startTime: Date.now(),
        membersPresence: new Map(),
        lastActivityTime: Date.now(),
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

  async handleLoudSoundViolation(guild, channel, member, speakerInfo) {
    if (!member || !member.voice?.channel) return;
    const userId = member.id;

    const lastMute = this.userMuteCooldowns.get(userId) || 0;
    if (Date.now() - lastMute < MUTE_COOLDOWN_MS) return;
    this.userMuteCooldowns.set(userId, Date.now());

    console.warn(`🚨 [رصد صوت عالي / صراخ] تم رصد صراخ حاد في #${channel.name} من ${member.user.tag}. تطبيق ميوت 30 ثانية...`);

    try {
      if (guild.members.me?.permissions.has(PermissionFlagsBits.MuteMembers)) {
        await member.voice.setMute(true, 'رصد أصوات عالية / صراخ حاد في الفويس (كتم صوتي إجباري لمدة 30 ثانية)');
        console.log(`🔇 [كتم صوتي] تم كتم العضو ${member.user.tag} لمدة 30 ثانية بنجاح.`);

        setTimeout(async () => {
          try {
            const freshMem = await guild.members.fetch(userId).catch(() => null);
            if (freshMem && freshMem.voice?.serverMute) {
              await freshMem.voice.setMute(false, 'انتهاء مهلة الكتم الصوتي الـ 30 ثانية');
              console.log(`🔊 [فك الكتم الصوتي] تم فك الكتم تلقائياً عن ${freshMem.user.tag} بعد 30 ثانية.`);
            }
          } catch (err) {
            console.error('خطأ في فك الكتم الصوتي:', err.message);
          }
        }, MUTE_DURATION_MS);
      }

      const userDMEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '⚠️ تنبيه أمني صوتي | GX VCR Defense', iconURL: guild.iconURL() })
        .setTitle('🔇 تم تطبيق كتم صوتي مؤقت (Server Mute)')
        .setDescription(
          `مرحباً <@${member.id}>،\n\n` +
          `تم رصد **صوت صاخب جداً / صراخ حاد ومفاجئ** صادر من المايكروفون الخاص بك في الروم الصوتي <#${channel.id}>.\n\n` +
          `🛑 **الإجراء المتخذ:** تم تطبيق كتم صوتي إجباري على مستوى السيرفر لمدة **30 ثانية فقط** (غير قابلة للزيادة).\n` +
          `⏱️ **انتهاء الكتم:** سيتم فك الكتم عنك تلقائياً وبشكل فوري بعد انتهاء الـ 30 ثانية.\n\n` +
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
          `تم رصد ارتفاع حاد في مستوى الصوت (Loud Sound / dB Peak) في أحد الرومات الصوتية وتم اتخاذ الإجراء التلقائي فوراً.\n\n` +
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

  async finalizeAndSendRecording(channelId, reason = 'مغادرة جميع الأعضاء وانتهاء الجلسة') {
    const session = this.activeSessions.get(channelId);
    if (!session || session.isFinalizing) return;

    session.isFinalizing = true;
    this.activeSessions.delete(channelId);

    const durationSeconds = Math.floor((Date.now() - session.startTime) / 1000);
    if (durationSeconds < 5 || session.membersPresence.size === 0 || !session.hasSpoken) {
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

      const reportEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setAuthor({ name: '🎙️ تقرير الجلسة الصوتية وسجل الحضور | GX VCR Archive', iconURL: guild.iconURL() })
        .setTitle(`📁 أرشفة الجلسة الصوتية في روم: #${session.channelName}`)
        .setDescription(
          `تم إنهاء الجلسة الصوتية وتوثيق جدول دخول وخروج كافة الأعضاء وتوقيتاتهم بدقة.\n\n` +
          `🔊 **الروم الصوتي:** <#${session.channelId}> (\`#${session.channelName}\`)\n` +
          `⏱️ **إجمالي مدة الجلسة:** \`${durationStr}\`\n` +
          `📅 **بداية الجلسة:** <t:${Math.floor(session.startTime / 1000)}:F>\n` +
          `🏁 **نهاية الجلسة:** <t:${Math.floor(Date.now() / 1000)}:F>\n` +
          `📝 **سبب الإنهاء والأرشفة:** ${reason}\n\n` +
          `👥 **سجل الأعضاء والتوقيتات (${session.membersPresence.size} أعضاء):**\n${memberTimelines}`
        )
        .setFooter({ text: `GX eSports Autonomous Surveillance • ${session.worker.name}` })
        .setTimestamp();

      await logChannel.send({ embeds: [reportEmbed] }).catch(() => {});
      console.log(`📁 [أرشفة VCR] تم بنجاح إرسال تقرير الروم #${session.channelName} مع سجل الأعضاء والتوقيتات.`);
    } catch (err) {
      console.error('خطأ في أرشفة التقرير الصوتي:', err.message);
    } finally {
      session.isFinalizing = false;
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

          if (humanMembers.size === 0 && session.hasSpoken) {
            await this.finalizeAndSendRecording(vCh.id, 'مغادرة جميع الأعضاء للروم الصوتي');
          }
        }
      }
    } catch {}
  }
}
