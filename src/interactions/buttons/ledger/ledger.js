import { MessageFlags } from 'discord.js';
import {
  assertLedgerGuild,
  getLedgerInventory,
} from '../../../services/argentFlameLedgerService.js';
import {
  buildContributionModal,
  buildContributionTypePayload,
  buildMaterialStockPanelPayload,
  LEDGER_COIN_BUTTON_ID,
  LEDGER_PANEL_BUTTON_ID,
  LEDGER_RESOURCE_BUTTON_ID,
  LEDGER_TAX_BUTTON_ID,
  LEDGER_STOCK_REFRESH_BUTTON_ID,
} from '../../../services/argentFlameLedgerUiService.js';
import { createEmbed } from '../../../utils/embeds.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';

export default [
  {
    name: LEDGER_PANEL_BUTTON_ID,
    async execute(interaction) {
      assertLedgerGuild(interaction.guildId);
      await InteractionHelper.safeReply(interaction, {
        ...buildContributionTypePayload(),
        flags: MessageFlags.Ephemeral,
      });
    },
  },
  {
    name: LEDGER_COIN_BUTTON_ID,
    async execute(interaction) {
      assertLedgerGuild(interaction.guildId);
      await interaction.showModal(buildContributionModal('coin'));
    },
  },
  {
    name: LEDGER_RESOURCE_BUTTON_ID,
    async execute(interaction) {
      assertLedgerGuild(interaction.guildId);
      await interaction.showModal(buildContributionModal('resource'));
    },
  },
  {
    name: LEDGER_TAX_BUTTON_ID,
    async execute(interaction) {
      assertLedgerGuild(interaction.guildId);
      await interaction.showModal(buildContributionModal('tax'));
    },
  },
  {
    name: LEDGER_STOCK_REFRESH_BUTTON_ID,
    async execute(interaction) {
      assertLedgerGuild(interaction.guildId);
      const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
      if (!deferred) return;

      const inventory = await getLedgerInventory();
      await interaction.message.edit(buildMaterialStockPanelPayload(inventory));
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [createEmbed({
          title: 'Material stock refreshed',
          description: 'The public guild material panel now shows the latest Current stock values from the ledger.',
          color: 'success',
        })],
      });
    },
  },
];
