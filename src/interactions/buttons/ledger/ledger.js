import { MessageFlags } from 'discord.js';
import { assertLedgerGuild } from '../../../services/argentFlameLedgerService.js';
import {
  buildContributionModal,
  buildContributionTypePayload,
  LEDGER_COIN_BUTTON_ID,
  LEDGER_PANEL_BUTTON_ID,
  LEDGER_RESOURCE_BUTTON_ID,
  LEDGER_TAX_BUTTON_ID,
} from '../../../services/argentFlameLedgerUiService.js';
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
];
