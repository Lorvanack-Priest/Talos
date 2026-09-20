import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
  assertLedgerGuild,
  getLedgerItems,
  getLedgerMembers,
  isLedgerGuild,
  linkLedgerMember,
  recordLedgerContribution,
  unlinkLedgerMember,
} from '../../services/argentFlameLedgerService.js';

const MAX_AUTOCOMPLETE_CHOICES = 25;

function requireGuildManager(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw createError(
      'Member-link command requires Manage Server',
      ErrorTypes.PERMISSION,
      'You need the Manage Server permission to link or unlink ledger members.',
      { expected: true },
    );
  }
}

function filterChoices(values, query, valueSelector = (value) => value) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  return values
    .filter((entry) => String(valueSelector(entry) || '').toLowerCase().includes(normalizedQuery))
    .slice(0, MAX_AUTOCOMPLETE_CHOICES);
}

function formatSeptims(value) {
  return `${Number(value || 0).toLocaleString('en-US')} septims`;
}

async function handleContribution(interaction) {
  const kind = interaction.options.getString('kind', true);
  const amount = interaction.options.getInteger('amount');
  const item = interaction.options.getString('item');
  const units = interaction.options.getInteger('units');
  const note = interaction.options.getString('note') || '';

  if (kind === 'coin') {
    if (!amount) {
      throw createError(
        'Coin contribution is missing amount',
        ErrorTypes.USER_INPUT,
        'Enter the number of septims donated in the `amount` field.',
        { expected: true },
      );
    }
    if (item || units) {
      throw createError(
        'Coin contribution included resource fields',
        ErrorTypes.USER_INPUT,
        'For a coin donation, use `amount` and leave `item` and `units` empty.',
        { expected: true },
      );
    }
  } else {
    if (!item || !units) {
      throw createError(
        `${kind} contribution is missing item or units`,
        ErrorTypes.USER_INPUT,
        `For a ${kind} contribution, select an item and enter the number of units.`,
        { expected: true },
      );
    }
    if (amount) {
      throw createError(
        `${kind} contribution included a coin amount`,
        ErrorTypes.USER_INPUT,
        `For a ${kind} contribution, use \`item\` and \`units\`, and leave \`amount\` empty.`,
        { expected: true },
      );
    }
  }

  const result = await recordLedgerContribution({
    submissionId: interaction.id,
    submittedAt: new Date().toISOString(),
    discordUserId: interaction.user.id,
    discordUsername: interaction.user.globalName || interaction.user.username,
    kind,
    amount: amount || 0,
    item: item || '',
    units: units || 0,
    note,
  });

  const contributionDescription = kind === 'coin'
    ? formatSeptims(result.gold)
    : `${Number(result.units).toLocaleString('en-US')} × ${result.item}`;

  const embed = createEmbed({
    title: result.duplicate ? 'Contribution already recorded' : 'Contribution recorded',
    description: result.duplicate
      ? 'This Discord submission was already in the ledger, so no duplicate row was added.'
      : 'Your weekly contribution has been added to the Argent Flame ledger.',
    color: result.duplicate ? 'warning' : 'success',
    fields: [
      { name: 'Member', value: result.member, inline: true },
      { name: 'Week', value: result.weekStart, inline: true },
      { name: 'Contribution', value: contributionDescription, inline: false },
      { name: 'Credited value', value: formatSeptims(result.totalValue), inline: true },
      { name: 'Ledger row', value: String(result.contributionRow), inline: true },
    ],
  });

  if (kind === 'tax') {
    embed.addFields({
      name: 'Tax effect',
      value: `${formatSeptims(result.resourceCredit)} paid directly; this reduces the guild's cash tax due for the week.`,
      inline: false,
    });
  }

  await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
}

async function handleLink(interaction) {
  requireGuildManager(interaction);
  const user = interaction.options.getUser('user', true);
  const member = interaction.options.getString('member', true);

  if (user.bot) {
    throw createError(
      'Attempted to link a bot account',
      ErrorTypes.USER_INPUT,
      'Select a human Discord member, not a bot account.',
      { expected: true },
    );
  }

  const result = await linkLedgerMember({
    discordUserId: user.id,
    discordUsername: user.globalName || user.username,
    member,
    linkedBy: interaction.user.globalName || interaction.user.username,
  });

  await InteractionHelper.safeEditReply(interaction, {
    embeds: [createEmbed({
      title: 'Ledger member linked',
      description: `${user} will now record contributions as **${result.member}**.`,
      color: 'success',
    })],
  });
}

async function handleUnlink(interaction) {
  requireGuildManager(interaction);
  const user = interaction.options.getUser('user', true);
  const result = await unlinkLedgerMember({
    discordUserId: user.id,
    unlinkedBy: interaction.user.globalName || interaction.user.username,
  });

  await InteractionHelper.safeEditReply(interaction, {
    embeds: [createEmbed({
      title: 'Ledger member unlinked',
      description: `${user} is no longer linked to **${result.member}**. Historical entries remain unchanged.`,
      color: 'success',
    })],
  });
}

export default {
  data: new SlashCommandBuilder()
    .setName('ledger')
    .setDescription('Record Argent Flame contributions and manage member links')
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName('contribute')
      .setDescription('Record your coin, resource, or direct-tax contribution')
      .addStringOption((option) => option
        .setName('kind')
        .setDescription('What you contributed')
        .setRequired(true)
        .addChoices(
          { name: 'Coin', value: 'coin' },
          { name: 'Resource', value: 'resource' },
          { name: 'Direct tax payment', value: 'tax' },
        ))
      .addIntegerOption((option) => option
        .setName('amount')
        .setDescription('Septims donated (coin only)')
        .setMinValue(1)
        .setMaxValue(1_000_000_000))
      .addStringOption((option) => option
        .setName('item')
        .setDescription('Item from the Setup catalog (resource or tax only)')
        .setAutocomplete(true))
      .addIntegerOption((option) => option
        .setName('units')
        .setDescription('Number of items or tax units contributed')
        .setMinValue(1)
        .setMaxValue(1_000_000_000))
      .addStringOption((option) => option
        .setName('note')
        .setDescription('Optional note for the ledger')
        .setMaxLength(500)))
    .addSubcommand((subcommand) => subcommand
      .setName('link-member')
      .setDescription('Officer: link a Discord user to an active ledger member')
      .addUserOption((option) => option
        .setName('user')
        .setDescription('Discord user to link')
        .setRequired(true))
      .addStringOption((option) => option
        .setName('member')
        .setDescription('Exact active member from the ledger')
        .setRequired(true)
        .setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('unlink-member')
      .setDescription('Officer: deactivate a Discord-to-ledger member link')
      .addUserOption((option) => option
        .setName('user')
        .setDescription('Discord user to unlink')
        .setRequired(true))),

  async execute(interaction) {
    assertLedgerGuild(interaction.guildId);
    const deferSuccess = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferSuccess) return;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'contribute') {
      await handleContribution(interaction);
    } else if (subcommand === 'link-member') {
      await handleLink(interaction);
    } else if (subcommand === 'unlink-member') {
      await handleUnlink(interaction);
    }
  },

  async autocomplete(interaction) {
    if (!isLedgerGuild(interaction.guildId)) {
      await interaction.respond([]).catch(() => {});
      return;
    }

    const focused = interaction.options.getFocused(true);
    try {
      if (focused.name === 'item') {
        const kind = interaction.options.getString('kind');
        if (kind !== 'resource' && kind !== 'tax') {
          await interaction.respond([]).catch(() => {});
          return;
        }

        const items = await getLedgerItems(kind);
        const choices = filterChoices(items, focused.value, (item) => item.name)
          .map((item) => ({
            name: `${item.name} — ${formatSeptims(item.unitCredit)} each`.substring(0, 100),
            value: item.name.substring(0, 100),
          }));
        await interaction.respond(choices).catch(() => {});
        return;
      }

      if (focused.name === 'member') {
        const members = await getLedgerMembers();
        const choices = filterChoices(members, focused.value)
          .map((member) => ({ name: member.substring(0, 100), value: member.substring(0, 100) }));
        await interaction.respond(choices).catch(() => {});
        return;
      }
    } catch {
      // Autocomplete must answer within three seconds; command execution will show a full error.
    }

    await interaction.respond([]).catch(() => {});
  },
};
