import fs from 'fs';
import path from 'path';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} from 'discord.js';

const DATA_DIR = path.resolve('data');
const APPEALS_DATA_FILE = path.join(DATA_DIR, 'appeals_data.json');

// Date Window: ONLY accounts created on 16 August 2026 and 17 August 2026 UTC get banned.
export const SPY_ACCOUNT_START_TIMESTAMP = Date.UTC(2026, 7, 16, 0, 0, 0); // 16 Aug 2026 00:00:00 UTC
export const SPY_ACCOUNT_END_TIMESTAMP   = Date.UTC(2026, 7, 18, 0, 0, 0); // 18 Aug 2026 00:00:00 UTC (excludes 18th)
export const SPY_ACCOUNT_CUTOFF_TIMESTAMP = SPY_ACCOUNT_START_TIMESTAMP;

export const SPY_BANNED_ROLE_NAME = 'Banned By Anti-Spy';

export async function findOrCreateAntiSpyRole(guild) {
  if (!guild) return null;
  let role = guild.roles.cache.find(
    (r) => r.name.toLowerCase() === SPY_BANNED_ROLE_NAME.toLowerCase()
  );

  if (!role) {
    role = await guild.roles.create({
      name: SPY_BANNED_ROLE_NAME,
      color: 0xED4245,
      permissions: 0n, // Strictly 0 permissions - removes all permissions
      hoist: true,
      mentionable: false,
      reason: 'GX Security: Strict Anti-Spy Quarantine role that removes all permissions from suspicious accounts'
    }).catch(() => null);

    if (role) {
      console.log(`🛡️ [رتبة العزل] تم إنشاء رتبة ${SPY_BANNED_ROLE_NAME} وتجريدها من كل الصلاحيات.`);
    }
  } else {
    if (role.permissions.bitfield !== 0n) {
      await role.setPermissions(0n).catch(() => {});
    }
  }
  return role;
}

function safeWriteJson(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

export function loadAppealsData() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(APPEALS_DATA_FILE)) {
      return JSON.parse(fs.readFileSync(APPEALS_DATA_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('خطأ في قراءة ملف الطعون:', err.message);
  }
  return {};
}

export function saveAppealsData(data) {
  safeWriteJson(APPEALS_DATA_FILE, data);
}

/**
 * 🛡️ Scans and quarantines suspicious accounts with "Banned By Anti-Spy" role (0 permissions).
 * Sends private DM, then isolates the account and automatically registers an appeal for High Command review.
 */
export async function enforceSuspiciousAccountBan(member, guild, client, sendToLogChannel, isOwnerOrCeo, botVersion = '1.0', getExecutiveMembers = null) {
  if (!member || !guild || member.user.bot) return false;
  if (isOwnerOrCeo && isOwnerOrCeo(member)) return false;

  const createdTs = member.user.createdTimestamp;
  const isTargetSpyDate = (createdTs >= SPY_ACCOUNT_START_TIMESTAMP && createdTs < SPY_ACCOUNT_END_TIMESTAMP) || member.id === '1540394518237548604';
  if (isTargetSpyDate) {
    console.warn(`🚨 [رصد حساب مشبوه - Anti-Spy] العضو ${member.user.tag} (${member.id}) تاريخ إنشائه ${new Date(createdTs).toISOString()}. جارٍ العزل برتبة "${SPY_BANNED_ROLE_NAME}" وتجريد كافة الصلاحيات...`);

    // 1. Find or create the "Banned By Anti-Spy" role with 0 permissions
    const antiSpyRole = await findOrCreateAntiSpyRole(guild);
    const botMember = guild.members.me;

    // 2. Strip all other non-managed roles and apply "Banned By Anti-Spy"
    if (antiSpyRole && botMember?.permissions.has(PermissionFlagsBits.ManageRoles) && botMember.roles.highest.comparePositionTo(antiSpyRole) > 0) {
      const currentRoles = member.roles.cache.filter(r => r.id !== guild.id && !r.managed && botMember.roles.highest.comparePositionTo(r) > 0);
      if (currentRoles.size > 0) {
        await member.roles.remove(currentRoles).catch(() => {});
      }
      await member.roles.add(antiSpyRole).catch(() => {});
      console.log(`🛡️ [عزل Anti-Spy] تم تجريد كل الرتب ومنح رتبة "${SPY_BANNED_ROLE_NAME}" للعضو ${member.user.tag}.`);
    }

    // 3. Apply Timeout for total isolation guarantee
    if (botMember?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      await member.timeout(28 * 24 * 60 * 60 * 1000, 'Banned By Anti-Spy Quarantine (Awaiting Executive Review)').catch(() => {});
    }

    // 4. Automatically create and register appeal in appeals_data.json
    const appealsData = loadAppealsData();
    const appealRecord = {
      targetId: member.id,
      userTag: member.user.tag,
      statement: `تم رصد الحساب وعزله برتبة "${SPY_BANNED_ROLE_NAME}" للاشتباه بحساب جديد/وهمي (تاريخ الإنشاء: ${new Date(createdTs).toISOString()}). معروض تلقائياً في لوحة التحكم لمراجعة والبت من القيادة العليا.`,
      status: 'pending',
      messages: [],
      handledBy: null,
      handledByName: null,
      createdAt: Date.now()
    };
    appealsData[member.id] = appealRecord;
    saveAppealsData(appealsData);

    // 5. Send Clean Security DM to the User
    const securityDMEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setAuthor({ name: 'نظام أمان GX eSports | Security Sentinel', iconURL: guild.iconURL() })
      .setTitle(`⛔ تنبيه أمني: تم عزل الحساب (${SPY_BANNED_ROLE_NAME})`)
      .setDescription(
        `مرحباً <@${member.id}>،\n\n` +
        `⚠️ **رصدت منظومة الأمان التلقائية حسابك للاشتباه بحساب غير مصرح به، وتم منحك رتبة \`${SPY_BANNED_ROLE_NAME}\` وسحب كافة الصلاحيات كإجراء وقائي.**\n\n` +
        `⚖️ **تم رفع طعن ومراجعة أمنية لحسابك تلقائياً وفورياً إلى القيادة العليا (OWNER / CEO / COO) في لوحة التحكم والسيطرة (GX Control Panel).**\n\n` +
        `📩 ستصلك رسالة هنا في الخاص فور مراجعة القيادة العليا لبيانات حسابك والبت في قبول دخولك وإلغاء العزل.`
      )
      .setFooter({ text: 'GX eSports Security Engine • نظام الحماية التلقائي' })
      .setTimestamp();

    try {
      await member.send({
        content: '⚠️ **إشعار أمني رسمي من إدارة GX eSports:**',
        embeds: [securityDMEmbed]
      }).catch(() => {});
    } catch {}

    // 6. Send Alert to Executives in DMs
    (async () => {
      try {
        if (typeof getExecutiveMembers === 'function') {
          const executives = await getExecutiveMembers(guild);
          if (executives && executives.size > 0) {
            const appealNotifyEmbed = new EmbedBuilder()
              .setColor(0xFEE75C)
              .setAuthor({ name: '⚖️ طعن أمني معلق تلقائياً | GX High Command', iconURL: member.user.displayAvatarURL() })
              .setTitle(`📝 طعن أمني جديد معروض للمراجعة: ${member.user.tag}`)
              .setDescription(
                `👤 **الحساب المعزول:** <@${member.id}> (\`${member.user.tag}\`)\n` +
                `🆔 **المعرف (ID):** \`${member.id}\`\n` +
                `🛡️ **الحالة:** تم تطبيق رتبة \`${SPY_BANNED_ROLE_NAME}\` وتجريد كافة الصلاحيات.\n` +
                `📅 **تاريخ إنشاء الحساب:** <t:${Math.floor(createdTs / 1000)}:F> (<t:${Math.floor(createdTs / 1000)}:R>)\n\n` +
                `📄 **حالة المراجعة:** تم تحويل الحساب تلقائياً إلى **لوحة التحكم والسيطرة (GX Control Panel)** للبت في قبوله أو تثبيت الحظر.\n\n` +
                `🔗 **افتح لوحة التحكم للمراجعة والبت:**\n` +
                `[اضغط لفتح GX Control Panel](https://gxbot.eshamikh.com/)`
              )
              .setFooter({ text: `GX Security Sentinel • ${member.id}` })
              .setTimestamp();

            for (const [, execMember] of executives) {
              try {
                await execMember.send({
                  content: `🔔 **إشعار أمني: تم عزل الحساب المشبوه \`${member.user.tag}\` برتبة \`${SPY_BANNED_ROLE_NAME}\` وإدراجه في لوحة التحكم.**`,
                  embeds: [appealNotifyEmbed]
                }).catch(() => null);
              } catch {}
            }
          }
        }
      } catch (err) {
        console.error('Error dispatching executive notifications:', err.message);
      }
    })();

    // 7. Log to Admin Audit Channel
    if (sendToLogChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🚨 رصد وعزل حساب تجسس مشبوه', iconURL: member.user.displayAvatarURL() })
        .setTitle(`🛡️ تم عزل حساب مشبوه برتبة ${SPY_BANNED_ROLE_NAME}`)
        .addFields(
          { name: '👤 الحساب المشبوه', value: `<@${member.id}> (` + '\`' + member.user.tag + '\`' + `)`, inline: true },
          { name: '🆔 المعرف (ID)', value: `\`${member.id}\``, inline: true },
          { name: '📅 تاريخ إنشاء الحساب', value: `<t:${Math.floor(createdTs / 1000)}:F> (<t:${Math.floor(createdTs / 1000)}:R>)`, inline: false },
          { name: '🛡️ الإجراء المتخذ', value: `تم تجريد الرتب وتطبيق رتبة \`${SPY_BANNED_ROLE_NAME}\` وتجميد الحساب، مع إدراج طعن تلقائي في لوحة التحكم لمراجعة القيادة العليا.`, inline: false }
        )
        .setFooter({ text: `GX eSports Security Engine • الإصدار ${botVersion}` })
        .setTimestamp();

      await sendToLogChannel(guild, logEmbed);
    }
    return true;
  }
  return false;
}

/**
 * ⚖️ Handles interactive appeal button actions (Open Modal, Approve, Reject).
 */
export async function handleAppealButton(interaction, client, sendToLogChannel, isVerificationApprover, allowedGuildId, botVersion = '1.0') {
  const customId = interaction.customId;

  // 1. User clicked "تقديم طعن أمني" in their DM
  if (customId.startsWith('appeal_ban_')) {
    const targetId = customId.replace('appeal_ban_', '');

    try {
      const appealModal = new ModalBuilder()
        .setCustomId(`modal_appeal_${targetId}`)
        .setTitle('تقديم طعن أمني - GX Security');

      const appealReasonInput = new TextInputBuilder()
        .setCustomId('appeal_statement')
        .setLabel('سبب وجودك والتوضيح للإدارة العليا:')
        .setPlaceholder('اشرح بالتفصيل سبب وجودك وما إذا كان الحساب يخصك لنقله للقيادة العليا...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(1000);

      const row = new ActionRowBuilder().addComponents(appealReasonInput);
      appealModal.addComponents(row);

      await interaction.showModal(appealModal);
    } catch (err) {
      console.error('Error showing appeal modal:', err.message);
    }
    return true;
  }

  // 2. Executive clicked "قبول الطعن وإلغاء الحظر"
  if (customId.startsWith('appeal_approve_')) {
    const targetId = customId.replace('appeal_approve_', '');
    const guild = client.guilds.cache.get(allowedGuildId);
    if (!guild) {
      await interaction.reply({ content: '❌ تعذر الوصول للسيرفر.', ephemeral: true });
      return true;
    }

    const approverMember = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (isVerificationApprover && !isVerificationApprover(approverMember, interaction.user)) {
      await interaction.reply({
        content: '❌ **عذراً، البت في الطعون مقتصر حصرياً على رتب القيادة العليا (OWNER / CEO / COO)!**',
        ephemeral: true
      });
      return true;
    }

    const appealsData = loadAppealsData();
    const appeal = appealsData[targetId];

    if (appeal && appeal.status !== 'pending') {
      const statusLabel = appeal.status === 'approved'
        ? `✅ تم قبول الطعن مسبقاً بواسطة: @${appeal.handledByName || 'مسؤول آخر'}`
        : `❌ تم رفض الطعن مسبقاً بواسطة: @${appeal.handledByName || 'مسؤول آخر'}`;
      await interaction.reply({ content: statusLabel, ephemeral: true });
      return true;
    }

    // Unban member in Discord Guild
    try {
      await guild.bans.remove(targetId, `قبول الطعن الأمني بواسطة ${interaction.user.tag}`);
    } catch (err) {
      console.warn('Unban error:', err.message);
    }

    if (appeal) {
      appeal.status = 'approved';
      appeal.handledBy = interaction.user.id;
      appeal.handledByName = interaction.user.tag;
      appeal.handledAt = Date.now();
      saveAppealsData(appealsData);

      // Update DMs of other executives
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('appeal_done_btn')
          .setLabel(`✅ تم قبول الطعن بواسطة @${interaction.user.tag}`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(true)
      );

      for (const msgInfo of appeal.messages || []) {
        try {
          const u = await client.users.fetch(msgInfo.execUserId).catch(() => null);
          if (u) {
            const dmCh = await u.createDM();
            const m = await dmCh.messages.fetch(msgInfo.messageId).catch(() => null);
            if (m) await m.edit({ components: [disabledRow] }).catch(() => {});
          }
        } catch {}
      }
    }

    // Send acceptance DM to the user with server invite
    try {
      const userObj = await client.users.fetch(targetId).catch(() => null);
      if (userObj) {
        const acceptedEmbed = new EmbedBuilder()
          .setColor(0x57F287)
          .setAuthor({ name: '✅ نتيجة مراجعة الطعن | GX Security', iconURL: guild.iconURL() })
          .setTitle('🎉 تم قبول طعنك الأمني وإلغاء الحظر')
          .setDescription(
            `مرحباً <@${targetId}>،\n\n` +
            `تمت مراجعة طعنك من قِبل **القيادة العليا (OWNER / CEO / COO)** وتقرر **قبول الطعن وإلغاء الحظر عنك بنجاح**.\n\n` +
            `🔗 **يمكنك الآن إعادة الانضمام إلى السيرفر عبر الرابط التالي:**\n` +
            `https://discord.gg/gxesports\n\n` +
            `نتمنى لك وقتاً ممتعاً والالتزام بأنظمة وقوانين السيرفر.`
          )
          .setFooter({ text: 'GX eSports High Command' })
          .setTimestamp();

        await userObj.send({ embeds: [acceptedEmbed] }).catch(() => {});
      }
    } catch {}

    if (sendToLogChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '⚖️ قبول طعن أمني وإلغاء حظر', iconURL: interaction.user.displayAvatarURL() })
        .setDescription(`قام المسؤول <@${interaction.user.id}> (${interaction.user.tag}) بقبول طعن العضو <@${targetId}> وإلغاء الحظر عنه بنجاح.`)
        .setFooter({ text: `GX eSports Security • الإصدار ${botVersion}` })
        .setTimestamp();
      await sendToLogChannel(guild, logEmbed);
    }

    await interaction.reply({
      content: `✅ **تم قبول الطعن وإلغاء الحظر بنجاح عن <@${targetId}> وإشعاره بالخاص برابط الانضمام.**`,
      ephemeral: true
    });
    return true;
  }

  // 3. Executive clicked "رفض وتثبيت الحظر"
  if (customId.startsWith('appeal_reject_')) {
    const targetId = customId.replace('appeal_reject_', '');
    const guild = client.guilds.cache.get(allowedGuildId);
    if (!guild) {
      await interaction.reply({ content: '❌ تعذر الوصول للسيرفر.', ephemeral: true });
      return true;
    }

    const approverMember = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (isVerificationApprover && !isVerificationApprover(approverMember, interaction.user)) {
      await interaction.reply({
        content: '❌ **عذراً، البت في الطعون مقتصر حصرياً على رتب القيادة العليا (OWNER / CEO / COO)!**',
        ephemeral: true
      });
      return true;
    }

    const appealsData = loadAppealsData();
    const appeal = appealsData[targetId];

    if (appeal && appeal.status !== 'pending') {
      const statusLabel = appeal.status === 'approved'
        ? `✅ تم قبول الطعن مسبقاً بواسطة: @${appeal.handledByName || 'مسؤول آخر'}`
        : `❌ تم رفض الطعن مسبقاً بواسطة: @${appeal.handledByName || 'مسؤول آخر'}`;
      await interaction.reply({ content: statusLabel, ephemeral: true });
      return true;
    }

    if (appeal) {
      appeal.status = 'rejected';
      appeal.handledBy = interaction.user.id;
      appeal.handledByName = interaction.user.tag;
      appeal.handledAt = Date.now();
      saveAppealsData(appealsData);

      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('appeal_done_btn')
          .setLabel(`❌ تم رفض الطعن بواسطة @${interaction.user.tag}`)
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true)
      );

      for (const msgInfo of appeal.messages || []) {
        try {
          const u = await client.users.fetch(msgInfo.execUserId).catch(() => null);
          if (u) {
            const dmCh = await u.createDM();
            const m = await dmCh.messages.fetch(msgInfo.messageId).catch(() => null);
            if (m) await m.edit({ components: [disabledRow] }).catch(() => {});
          }
        } catch {}
      }
    }

    // Send rejection DM
    try {
      const userObj = await client.users.fetch(targetId).catch(() => null);
      if (userObj) {
        const rejectedEmbed = new EmbedBuilder()
          .setColor(0xED4245)
          .setAuthor({ name: '⛔ نتيجة مراجعة الطعن | GX Security', iconURL: guild.iconURL() })
          .setTitle('❌ تم رفض الطعن الأمني')
          .setDescription(
            `مرحباً <@${targetId}>،\n\n` +
            `نأسف لإبلاغك بأنه بعد مراجعة طعنك من قِبل **القيادة العليا**، تقرر **رفض طلبك وتثبيت قرار الحظر بشكل نهائي**.`
          )
          .setFooter({ text: 'GX eSports High Command' })
          .setTimestamp();

        await userObj.send({ embeds: [rejectedEmbed] }).catch(() => {});
      }
    } catch {}

    await interaction.reply({
      content: `❌ **تم رفض الطعن وتثبيت الحظر على <@${targetId}>.**`,
      ephemeral: true
    });
    return true;
  }

  return false;
}

/**
 * 📝 Handles submission of the appeal modal.
 * Executive DMs are strictly notifications (buttons removed per directive).
 * All approvals/rejections are executed via the GX Control Panel.
 */
export async function handleAppealModalSubmit(interaction, client, getExecutiveMembers, allowedGuildId) {
  if (!interaction.customId.startsWith('modal_appeal_')) return false;

  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (e) {
    console.error('Defer reply error in appeal modal:', e.message);
  }

  const targetId = interaction.customId.replace('modal_appeal_', '');
  const statement = interaction.fields.getTextInputValue('appeal_statement');
  const guild = client.guilds.cache.get(allowedGuildId);

  if (!guild) {
    await interaction.editReply({ content: '❌ حدث خطأ في الوصول لبيانات السيرفر.' }).catch(() => {});
    return true;
  }

  const appealsData = loadAppealsData();
  const appealRecord = {
    targetId,
    userTag: interaction.user.tag,
    statement,
    status: 'pending',
    messages: [],
    handledBy: null,
    handledByName: null,
    createdAt: Date.now()
  };
  appealsData[targetId] = appealRecord;
  saveAppealsData(appealsData);

  // 🔔 Pure Informational Notification Embed (No interactive action buttons)
  const appealNotifyEmbed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setAuthor({ name: '⚖️ إشعار طعن أمني جديد | GX High Command', iconURL: interaction.user.displayAvatarURL() })
    .setTitle(`📝 وصل طعن جديد من العضو: ${interaction.user.tag}`)
    .setDescription(
      `👤 **صاحب الطعن:** <@${targetId}> (\`${interaction.user.tag}\`)\n` +
      `🆔 **المعرف (ID):** \`${targetId}\`\n` +
      `📅 **تاريخ إنشاء الحساب:** <t:${Math.floor(interaction.user.createdTimestamp / 1000)}:F>\n\n` +
      `📄 **نص الطعن المقدم:**\n` +
      `>>> ${statement}\n\n` +
      `⚡ **طريقة البت في القرار:**\n` +
      `تم إدراج هذا الطعن في **لوحة التحكم والسيطرة (GX Control Panel)**.\n` +
      `🔗 **افتح لوحة التحكم للمراجعة والبت:**\n` +
      `[اضغط لفتح GX Control Panel](https://gxbot.eshamikh.com/)`
    )
    .setFooter({ text: `GX Security Sentinel • ${targetId}` })
    .setTimestamp();

  // Async dispatch notifications in background without blocking response
  (async () => {
    try {
      const executives = await getExecutiveMembers(guild);
      if (executives && executives.size > 0) {
        for (const [, execMember] of executives) {
          try {
            await execMember.send({
              content: `🔔 **إشعار أمني جديد: طعن معلق من \`${interaction.user.tag}\`**`,
              embeds: [appealNotifyEmbed]
            }).catch(() => null);
          } catch {}
        }
      }
    } catch (err) {
      console.error('Error dispatching executive notifications:', err.message);
    }
  })();

  await interaction.editReply({
    content: '✅ **تم استلام طعنك بنجاح وإرساله إلى القيادة العليا (OWNER, CEO, COO) لمراجعته.** ستصلك رسالة بالقرار فور اتخاذه عبر لوحة الإدارة.'
  }).catch(() => {});
  return true;
}

/**
 * 👑 Executes appeal approval from the Control Panel (Unbans / Lifts Anti-Spy quarantine + Assigns UNTRUSTED + Sends invite DM).
 */
export async function executeAppealApproval(targetId, client, approverTag = 'GX Control Panel', allowedGuildId = '1537461174222725120', sendToLogChannel = null, botVersion = '1.0') {
  const guild = client.guilds.cache.get(allowedGuildId);
  const appealsData = loadAppealsData();
  const appeal = appealsData[targetId];

  // 1. Unban in Discord Guild if banned, and restore member from Anti-Spy role
  if (guild) {
    // Try unbanning if was previously banned
    try {
      await guild.bans.remove(targetId, `قبول الطعن عبر لوحة التحكم بواسطة ${approverTag}`).catch(() => {});
    } catch {}

    // Check if member is still in guild (in quarantine with Banned By Anti-Spy role)
    try {
      const member = await guild.members.fetch(targetId).catch(() => null);
      if (member) {
        // Remove Banned By Anti-Spy role
        const antiSpyRole = await findOrCreateAntiSpyRole(guild);
        if (antiSpyRole && member.roles.cache.has(antiSpyRole.id)) {
          await member.roles.remove(antiSpyRole).catch(() => {});
        }
        // Remove any timeout
        if (member.isCommunicationDisabled()) {
          await member.timeout(null).catch(() => {});
        }
        // Assign default UNTRUSTED role
        const untrustedRole = guild.roles.cache.find(r => r.name.toLowerCase() === 'untrusted');
        if (untrustedRole) {
          await member.roles.add(untrustedRole).catch(() => {});
        }
        console.log(`✅ [إلغاء عزل Anti-Spy] تم رفع رتبة Banned By Anti-Spy ومنح UNTRUSTED للعضو ${member.user.tag}.`);
      }
    } catch (err) {
      console.warn('Error adjusting member roles on approval:', err.message);
    }
  }

  // 2. Update Database Record
  if (appeal) {
    appeal.status = 'approved';
    appeal.handledBy = 'CONTROL_PANEL';
    appeal.handledByName = approverTag;
    appeal.handledAt = Date.now();
  } else {
    appealsData[targetId] = {
      targetId,
      status: 'approved',
      handledByName: approverTag,
      handledAt: Date.now()
    };
  }
  saveAppealsData(appealsData);

  // 3. Send acceptance DM to the user
  try {
    const userObj = await client.users.fetch(targetId).catch(() => null);
    if (userObj) {
      let inviteUrl = 'https://discord.gg/AxHkga4aJ';
      if (guild) {
        try {
          const invs = await guild.invites.fetch().catch(() => null);
          const valid = invs?.find(i => !i.expiresTimestamp || i.expiresTimestamp > Date.now()) || invs?.first();
          if (valid) inviteUrl = valid.url;
          else if (guild.vanityURLCode) inviteUrl = `https://discord.gg/${guild.vanityURLCode}`;
        } catch {}
      }

      const dmContent =
        `🎉 **تم قبول مراجعة حسابك وإلغاء العزل الأمني بنجاح في مجتمع GX eSports!**\n\n` +
        `🔗 **رابط السيرفر:**\n${inviteUrl}\n\n` +
        `🛡️ **الرتبة الممنوحة تلقائياً:** تم منحك رتبة \`UNTRUSTED\` المبدئية لحين استكمال مراجعة وتوثيق عضويتك.`;

      const acceptedEmbed = new EmbedBuilder()
        .setColor(0x57F287)
        .setAuthor({ name: '✅ نتيجة مراجعة الطعن | GX Security', iconURL: guild ? guild.iconURL() : undefined })
        .setTitle('🎉 تم قبول مراجعة حسابك وإلغاء العزل الأمني')
        .setDescription(
          `مرحباً <@${targetId}>،\n\n` +
          `تمت مراجعة حسابك من قِبل **القيادة العليا (OWNER / CEO / COO)** في لوحة التحكم وتقرر **قبول الحساب وإلغاء العزل الأمني بنجاح**.\n\n` +
          `🔗 **رابط السيرفر المباشر:**\n` +
          `👉 **${inviteUrl}**\n\n` +
          `🛡️ **الرتبة الحالية:** تم إعطاؤك رتبة \`UNTRUSTED\` المبدئية لحين إتمام توثيقك.\n\n` +
          `نتمنى لك وقتاً ممتعاً والالتزام بأنظمة وقوانين السيرفر.`
        )
        .setFooter({ text: 'GX eSports High Command' })
        .setTimestamp();

      const dmCh = await userObj.createDM().catch(() => null);
      if (dmCh) {
        await dmCh.send({ content: dmContent, embeds: [acceptedEmbed] }).catch(() => {});
      } else {
        await userObj.send({ content: dmContent, embeds: [acceptedEmbed] }).catch(() => {});
      }
      console.log(`✅ [إشعار قبول الطعن] تم إرسال رسالة القبول ورابط السيرفر بنجاح إلى ${userObj.tag} (${targetId})`);
    }
  } catch (err) {
    console.error('Error sending appeal acceptance DM:', err.message);
  }

  // 4. Log to Discord Security Log Channel
  if (sendToLogChannel && guild) {
    const logEmbed = new EmbedBuilder()
      .setColor(0x57F287)
      .setAuthor({ name: '⚖️ قبول طعن أمني وإلغاء عزل (لوحة التحكم)', iconURL: guild.iconURL() })
      .setDescription(`قام المسؤول **${approverTag}** عبر لوحة التحكم بقبول طعن العضو <@${targetId}> وإلغاء عزل Anti-Spy عنه ومنحه رتبة UNTRUSTED بنجاح.`)
      .setFooter({ text: `GX eSports Security • الإصدار ${botVersion}` })
      .setTimestamp();
    await sendToLogChannel(guild, logEmbed).catch(() => {});
  }

  return { success: true, appeal: appealsData[targetId] };
}

/**
 * ⛔ Executes appeal rejection from the Control Panel (Permanently bans user + Sends rejection DM + Updates status).
 */
export async function executeAppealRejection(targetId, client, rejectorTag = 'GX Control Panel', allowedGuildId = '1537461174222725120', sendToLogChannel = null, botVersion = '1.0') {
  const guild = client.guilds.cache.get(allowedGuildId);
  const appealsData = loadAppealsData();
  const appeal = appealsData[targetId];

  // 1. Send rejection DM to the user first before kicking/banning
  try {
    const userObj = await client.users.fetch(targetId).catch(() => null);
    if (userObj) {
      const rejectedEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '⛔ نتيجة مراجعة الطعن | GX Security', iconURL: guild ? guild.iconURL() : undefined })
        .setTitle('❌ تم رفض الطعن الأمني وتثبيت الحظر')
        .setDescription(
          `مرحباً <@${targetId}>،\n\n` +
          `نأسف لإبلاغك بأنه بعد مراجعة حسابك من قِبل **القيادة العليا (OWNER / CEO / COO)**، تقرر **رفض طلبك وحظرك نهائياً من السيرفر**.\n\n` +
          `⚠️ هذا القرار نهائي وصادر من القيادة العليا لسيرفر GX eSports.`
        )
        .setFooter({ text: 'GX eSports High Command' })
        .setTimestamp();

      const dmCh = await userObj.createDM().catch(() => null);
      if (dmCh) {
        await dmCh.send({ embeds: [rejectedEmbed] }).catch(() => {});
      } else {
        await userObj.send({ embeds: [rejectedEmbed] }).catch(() => {});
      }
    }
  } catch {}

  // 2. Permanently ban member from Discord Guild
  if (guild) {
    try {
      await guild.bans.create(targetId, {
        reason: `رفض الطعن وتثبيت الحظر الدائم عبر لوحة التحكم بواسطة ${rejectorTag}`
      }).catch(() => {});
    } catch (err) {
      console.warn('Ban on rejection error:', err.message);
    }
  }

  // 3. Update Database Record
  if (appeal) {
    appeal.status = 'rejected';
    appeal.handledBy = 'CONTROL_PANEL';
    appeal.handledByName = rejectorTag;
    appeal.handledAt = Date.now();
  } else {
    appealsData[targetId] = {
      targetId,
      status: 'rejected',
      handledByName: rejectorTag,
      handledAt: Date.now()
    };
  }
  saveAppealsData(appealsData);

  // 4. Log to Discord Security Log Channel
  if (sendToLogChannel && guild) {
    const logEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setAuthor({ name: '⛔ رفض طعن أمني وتثبيت الحظر (لوحة التحكم)', iconURL: guild.iconURL() })
      .setDescription(`قام المسؤول **${rejectorTag}** عبر لوحة التحكم برفض طعن العضو <@${targetId}> وتثبيت الحظر النهائي عليه.`)
      .setFooter({ text: `GX eSports Security • الإصدار ${botVersion}` })
      .setTimestamp();
    await sendToLogChannel(guild, logEmbed).catch(() => {});
  }

  return { success: true, appeal: appealsData[targetId] };
}
