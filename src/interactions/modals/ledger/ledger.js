import { MessageFlags } from 'discord.js';
import {
  assertLedgerGuild,
  getLedgerItems,
  recordLedgerContribution,
} from '../../../services/argentFlameLedgerService.js';
import {
  buildContributionReceipt,
  LEDGER_COIN_MODAL_ID,
  LEDGER_RESOURCE_MODAL_ID,
  LEDGER_TAX_MODAL_ID,
  parsePositiveWholeNumber,
  resolveLedgerItem,
} from '../../../services/argentFlameLedgerUiService.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';

async function recordModalContribution(interaction, kind) {
  assertLedgerGuild(interaction.guildId);
  const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
  if (!deferred) return;

  const note = interaction.fields.getTextInputValue('note')?.trim() || '';
  let amount = 0;
  let item = '';
  let units = 0;

  if (kind === 'coin') {
    amount = parsePositiveWholeNumber(
      interaction.fields.getTextInputValue('amount'),
      'Coin amount',
    );
  } else {
    const requestedItem = interaction.fields.getTextInputValue('item');
    units = parsePositiveWholeNumber(
      interaction.fields.getTextInputValue('units'),
      'Units',
    );
    const items = await getLedgerItems(kind, { timeoutMs: 30_000 });
    item = resolveLedgerItem(items, requestedItem, kind).name;
  }

  const result = await recordLedgerContribution({
    submissionId: interaction.id,
    submittedAt: new Date().toISOString(),
    discordUserId: interaction.user.id,
    discordUsername: interaction.user.globalName || interaction.user.username,
    kind,
    amount,
    item,
    units,
    note,
  });

  await InteractionHelper.safeEditReply(interaction, {
    embeds: [buildContributionReceipt(result, kind)],
    components: [],
  });
}

export default [
  {
    name: LEDGER_COIN_MODAL_ID,
    execute: (interaction) => recordModalContribution(interaction, 'coin'),
  },
  {
    name: LEDGER_RESOURCE_MODAL_ID,
    execute: (interaction) => recordModalContribution(interaction, 'resource'),
  },
  {
    name: LEDGER_TAX_MODAL_ID,
    execute: (interaction) => recordModalContribution(interaction, 'tax'),
  },
];
