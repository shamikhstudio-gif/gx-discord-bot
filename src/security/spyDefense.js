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

// Cutoff Date: 16 August 2026 00:00:00 UTC
// Accounts created ON or AFTER this date are strictly classified as suspicious/spy accounts and banned immediately.
export const SPY_ACCOUNT_CUTOFF_TIMESTAMP = Date.UTC(2026, 7, 16, 0, 0, 0);

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
 * 🛡️ Scans and enforces ban on suspicious accounts created on or after August 16, 2026.
 * Sends private DM with appeal button, then bans the account and logs it.
 * Does NOT reveal that account creation date is the reason.
 */
export async function enforceSuspiciousAccountBan(member, guild, client, sendToLogChannel, isOwnerOrCeo, botVersion = '1.0') {
  if (!member || !guild || member.user.bot) return false;
  if (isOwnerOrCeo && isOwnerOrCeo(member)) return false;

  const createdTs = member.user.createdTimestamp;
  if (createdTs >= SPY_ACCOUNT_CUTOFF_TIMESTAMP) {
    console.warn(`🚨 [رصد حساب تجسس مشبوه] العضو ${member.user.tag} (${member.id}) تاريخ إنشائه ${new Date(createdTs).toISOString()}. جارٍ الطرد والحظر التلقائي...`);

    // 1. Send Security DM with interactive Appeal Button (Without revealing creation date reason)
    const securityDMEmbed = new EmbedBuilder()
      .setColor(0xED4245)
      .setAuthor({ name: 'نظام أمان GX eSports | Security Sentinel', iconURL: guild.iconURL() })
      .setTitle('⛔ تنبيه أمني عالي الحساسية')
      .setDescription(
        `مرحباً <@${member.id}>،\n\n` +
        `⚠️ **رصدت أنظمة الأمان حساب تجسس مشبوه، وهو ما أدى إلى طردك وحظرك نهائياً من السيرفر.**\n\n` +
        `⚖️ إذا كنت ترى أن هذا الإجراء تم عن طريق الخطأ، يمكنك الضغط على زر **تقديم طعن** أدناه لشرح موقفك، وسيتم تحويل طعنك مباشرة إلى القيادة العليا للمراجعة والبت في طلبك.`
      )
      .setFooter({ text: 'GX eSports Security Engine • نظام الحماية التلقائي' })
      .setTimestamp();

    const appealRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`appeal_ban_${member.id}`)
        .setLabel('⚖️ تقديم طعن أمني')
        .setStyle(ButtonStyle.Secondary)
    );

    try {
      await member.send({
        content: '⚠️ **إشعار أمني رسمي من إدارة GX eSports:**',
        embeds: [securityDMEmbed],
        components: [appealRow]
      }).catch(() => {});
    } catch {}

    // 2. Ban from Guild
    try {
      if (guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
        await guild.bans.create(member.id, {
          reason: 'رصد حساب تجسس مشبوه عبر نظام الأمان التلقائي (غير مطابق لمعايير الأمان)'
        });
        console.log(`🔨 [حظر مشبوه] تم بنجاح حظر الحساب المشبوه: ${member.user.tag} (${member.id})`);
      } else {
        await member.kick('رصد حساب تجسس مشبوه عبر نظام الأمان');
      }
    } catch (err) {
      console.error(`خطأ في حظر الحساب المشبوه ${member.user.tag}:`, err.message);
    }

    // 3. Log to Admin Audit Channel
    if (sendToLogChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setAuthor({ name: '🚨 رصد وطرد حساب تجسس مشبوه', iconURL: member.user.displayAvatarURL() })
        .setTitle('🔨 تم حظر حساب مشبوه غير مصرح به')
        .addFields(
          { name: '👤 الحساب المشبوه', value: `<@${member.id}> (` + '\`' + member.user.tag + '\`' + `)`, inline: true },
          { name: '🆔 المعرف (ID)', value: `\`${member.id}\``, inline: true },
          { name: '📅 تاريخ إنشاء الحساب', value: `<t:${Math.floor(createdTs / 1000)}:F> (<t:${Math.floor(createdTs / 1000)}:R>)`, inline: false },
          { name: '🛡️ الإجراء المتخذ', value: 'تم إرسال إشعار الأمان في الخاص وحظر الحساب نهائياً مع إتاحة زر تقديم طعن للقيادة العليا.', inline: false }
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

    const appealModal = new ModalBuilder()
      .setCustomId(`modal_appeal_${targetId}`)
      .setTitle('⚖️ تقديم طعن أمني | GX Security');

    const appealReasonInput = new TextInputBuilder()
      .setCustomId('appeal_statement')
      .setLabel('سبب الطعن والتوضيح للإدارة العليا:')
      .setPlaceholder('اشرح بالتفصيل سبب وجودك وما إذا كان الحساب يخصك لنقله للقيادة العليا...')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMinLength(5)
      .setMaxLength(1000);

    const row = new ActionRowBuilder().addComponents(appealReasonInput);
    appealModal.addComponents(row);

    await interaction.showModal(appealModal);
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
 */
export async function handleAppealModalSubmit(interaction, client, getExecutiveMembers, allowedGuildId) {
  if (!interaction.customId.startsWith('modal_appeal_')) return false;

  const targetId = interaction.customId.replace('modal_appeal_', '');
  const statement = interaction.fields.getTextInputValue('appeal_statement');
  const guild = client.guilds.cache.get(allowedGuildId);

  if (!guild) {
    await interaction.reply({ content: '❌ حدث خطأ في الوصول لبيانات السيرفر.', ephemeral: true });
    return true;
  }

  const executives = await getExecutiveMembers(guild);
  if (!executives || executives.size === 0) {
    await interaction.reply({ content: '⚠️ تعذر العثور على أفراد القيادة العليا حالياً.', ephemeral: true });
    return true;
  }

  const appealsData = loadAppealsData();
  appealsData[targetId] = {
    targetId,
    userTag: interaction.user.tag,
    statement,
    status: 'pending',
    messages: [],
    handledBy: null,
    handledByName: null,
    createdAt: Date.now()
  };

  const appealForwardEmbed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setAuthor({ name: '⚖️ طعن أمني جديد بحاجة للبت | GX High Command', iconURL: interaction.user.displayAvatarURL() })
    .setTitle(`طعن من العضو المحظور: ${interaction.user.tag}`)
    .setDescription(
      `👤 **صاحب الطعن:** <@${targetId}> (` + '\`' + interaction.user.tag + '\`' + `)\n` +
      `🆔 **المعرف (ID):** \`${targetId}\`\n` +
      `📅 **تاريخ إنشاء الحساب:** <t:${Math.floor(interaction.user.createdTimestamp / 1000)}:F>\n\n` +
      `📝 **نص الطعن والتوضيح المقدم من العضو:**\n` +
      `>>> ${statement}\n\n` +
      `⚡ **الصلاحية:** مخصصة لكم حصرياً كـ **OWNER / CEO / COO** (أول موافق أو رافض يبت في القرار فوراً).`
    )
    .setFooter({ text: `GX eSports Appeal Sentinel • ${targetId}` })
    .setTimestamp();

  const appealRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`appeal_approve_${targetId}`)
      .setLabel('✅ قبول الطعن وإلغاء الحظر')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`appeal_reject_${targetId}`)
      .setLabel('❌ رفض وتثبيت الحظر')
      .setStyle(ButtonStyle.Danger)
  );

  for (const [, execMember] of executives) {
    try {
      const dmMsg = await execMember.send({
        content: `🔔 **طعن أمني جديد من العضو المحظور \`${interaction.user.tag}\` بحاجة لقرارك:**`,
        embeds: [appealForwardEmbed],
        components: [appealRow]
      }).catch(() => null);

      if (dmMsg) {
        appealsData[targetId].messages.push({
          execUserId: execMember.id,
          channelId: dmMsg.channelId,
          messageId: dmMsg.id
        });
      }
    } catch {}
  }

  saveAppealsData(appealsData);

  await interaction.reply({
    content: '✅ **تم استلام طعنك بنجاح وإرساله مباشرة إلى القيادة العليا (OWNER, CEO, COO) لمراجعته.** ستصلك رسالة بالقرار فور اتخاذه.',
    ephemeral: true
  });
  return true;
}
