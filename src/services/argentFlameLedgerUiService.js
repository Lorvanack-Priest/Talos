import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';

export const LEDGER_PANEL_BUTTON_ID = 'ledger_contribute_start';
export const LEDGER_COIN_BUTTON_ID = 'ledger_contribute_coin';
export const LEDGER_RESOURCE_BUTTON_ID = 'ledger_contribute_resource';
export const LEDGER_TAX_BUTTON_ID = 'ledger_contribute_tax';
export const LEDGER_COIN_MODAL_ID = 'ledger_contribution_coin_modal';
export const LEDGER_RESOURCE_MODAL_ID = 'ledger_contribution_resource_modal';
export const LEDGER_TAX_MODAL_ID = 'ledger_contribution_tax_modal';

export function formatSeptims(value) {
  return `${Number(value || 0).toLocaleString('en-US')} septims`;
}

export function buildLedgerPanelPayload() {
  return {
    embeds: [createEmbed({
      title: 'Argent Flame Guild Contributions',
      description: [
        'Record coin, materials, or a direct property-tax payment in the guild ledger.',
        '',
        'Your Discord account must be linked to your active roster name before you submit.',
      ].join('\n'),
      color: 'primary',
      fields: [
        {
          name: 'How it works',
          value: 'Select **Record Contribution**, choose the contribution type, and complete the private form.',
        },
      ],
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(LEDGER_PANEL_BUTTON_ID)
        .setLabel('Record Contribution')
        .setStyle(ButtonStyle.Primary),
    )],
  };
}

export function buildContributionTypePayload() {
  return {
    embeds: [createEmbed({
      title: 'Record a guild contribution',
      description: 'Choose what you contributed. The form and final receipt are visible only to you.',
      color: 'primary',
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(LEDGER_COIN_BUTTON_ID)
        .setLabel('Coin')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(LEDGER_RESOURCE_BUTTON_ID)
        .setLabel('Resource')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(LEDGER_TAX_BUTTON_ID)
        .setLabel('Direct Tax')
        .setStyle(ButtonStyle.Secondary),
    )],
  };
}

function textInput(customId, label, options = {}) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(options.style || TextInputStyle.Short)
    .setRequired(options.required !== false);

  if (options.placeholder) input.setPlaceholder(options.placeholder);
  if (options.minLength) input.setMinLength(options.minLength);
  if (options.maxLength) input.setMaxLength(options.maxLength);
  return new ActionRowBuilder().addComponents(input);
}

export function buildContributionModal(kind) {
  if (kind === 'coin') {
    return new ModalBuilder()
      .setCustomId(LEDGER_COIN_MODAL_ID)
      .setTitle('Record Coin Contribution')
      .addComponents(
        textInput('amount', 'Septims donated', {
          placeholder: 'Example: 200',
          maxLength: 10,
        }),
        textInput('note', 'Optional note', {
          style: TextInputStyle.Paragraph,
          required: false,
          maxLength: 500,
        }),
      );
  }

  const isTax = kind === 'tax';
  return new ModalBuilder()
    .setCustomId(isTax ? LEDGER_TAX_MODAL_ID : LEDGER_RESOURCE_MODAL_ID)
    .setTitle(isTax ? 'Record Direct Tax Payment' : 'Record Resource Contribution')
    .addComponents(
      textInput('item', isTax ? 'Property or tax item' : 'Resource item', {
        placeholder: isTax ? 'Example: Windhelm House' : 'Example: Corundum Ore',
        maxLength: 100,
      }),
      textInput('units', 'Units contributed', {
        placeholder: 'Example: 20',
        maxLength: 10,
      }),
      textInput('note', 'Optional note', {
        style: TextInputStyle.Paragraph,
        required: false,
        maxLength: 500,
      }),
    );
}

export function parsePositiveWholeNumber(value, label) {
  const normalized = String(value || '').trim();
  if (!/^\d+$/.test(normalized)) {
    throw createError(
      `${label} is not a positive whole number`,
      ErrorTypes.USER_INPUT,
      `${label} must be a positive whole number.`,
      { expected: true },
    );
  }

  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 1_000_000_000) {
    throw createError(
      `${label} is outside the allowed range`,
      ErrorTypes.USER_INPUT,
      `${label} must be between 1 and 1,000,000,000.`,
      { expected: true },
    );
  }
  return number;
}

export function resolveLedgerItem(items, requestedName, kind) {
  const query = String(requestedName || '').trim().toLowerCase();
  const exact = items.find((item) => item.name.toLowerCase() === query);
  if (exact) return exact;

  const matches = items.filter((item) => item.name.toLowerCase().includes(query));
  if (matches.length === 1) return matches[0];

  if (matches.length > 1) {
    const examples = matches.slice(0, 8).map((item) => `**${item.name}**`).join(', ');
    throw createError(
      `Multiple ${kind} items matched ${requestedName}`,
      ErrorTypes.USER_INPUT,
      `That name matches several items: ${examples}. Enter a more specific item name.`,
      { expected: true },
    );
  }

  throw createError(
    `No ${kind} item matched ${requestedName}`,
    ErrorTypes.USER_INPUT,
    `I could not find **${String(requestedName || '').trim()}** in the ${kind} catalog. Check the item name and try again.`,
    { expected: true },
  );
}

export function buildContributionReceipt(result, kind) {
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

  return embed;
}
