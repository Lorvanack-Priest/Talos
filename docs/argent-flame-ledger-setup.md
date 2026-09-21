# Argent Flame Discord Ledger Setup

Talos includes one global `/ledger` command with five subcommands:

- `/ledger contribute` records coin, resources, or a direct tax payment.
- `/ledger link-member` links a Discord account to an active name on the `Members` tab. It requires **Manage Server**.
- `/ledger unlink-member` deactivates that link without changing history. It requires **Manage Server**.
- `/ledger setup-panel` posts or moves the permanent contribution panel. It requires **Manage Server**.
- `/ledger refresh-panel` repairs or reposts the configured panel. It requires **Manage Server**.

The bot never receives Google account credentials. It sends signed JSON requests to a Google Apps Script web app, and that script writes to the existing `Contributions`, `Discord Members`, and `Discord Submissions` tabs.

## 1. Install the Google Apps Script

1. Open the [Argent Flame Weekly Guild Ledger](https://docs.google.com/spreadsheets/d/1KUcOnPS13IUlmQmy-i7rBJoFwFqEJPiabAzkMoxKR6w/edit).
2. Choose **Extensions → Apps Script**.
3. Replace the editor contents with [`integrations/google-apps-script/Code.gs`](../integrations/google-apps-script/Code.gs), then save.
4. Select `generateLedgerSecret` at the top of the Apps Script editor and click **Run**.
5. Approve the Google authorization prompt. Copy the `ARGENT_LEDGER_SHARED_SECRET=...` value from the execution log.
6. Select `testLedgerConnection` and click **Run**. The log should report the spreadsheet name plus counts for members, resources, and tax items.

## 2. Deploy the web app

1. In Apps Script, choose **Deploy → New deployment**.
2. Select **Web app**.
3. Set **Execute as** to **Me**.
4. Set **Who has access** to **Anyone**.
5. Deploy and copy the URL ending in `/exec`.

The web app is public only at the network level. Every write still requires the long shared secret generated above.

## 3. Configure the running bot

Add these variables to the hosting service that runs Talos. Do not put their real values in GitHub.

```env
ARGENT_LEDGER_SCRIPT_URL=https://script.google.com/macros/s/REPLACE_ME/exec
ARGENT_LEDGER_SHARED_SECRET=REPLACE_WITH_GENERATED_SECRET
ARGENT_LEDGER_GUILD_ID=REPLACE_WITH_DISCORD_SERVER_ID
```

`ARGENT_LEDGER_GUILD_ID` keeps the ledger command usable only in the Argent Flame server. If omitted, Talos falls back to `GUILD_ID`.

Redeploy or restart Talos after saving the variables. The command is registered globally, so Discord may take up to an hour to show it after the first deployment.

## 4. Create the permanent contribution panel

1. Run `/ledger setup-panel` and select the channel where members should submit donations.
2. Talos posts an **Argent Flame Guild Contributions** panel with a permanent **Record Contribution** button.
3. Members select the button, choose Coin, Resource, or Direct Tax, and complete the private form.

The panel uses global interaction handlers rather than a temporary collector, so it continues working after Talos restarts. If the message is deleted or its components need to be repaired, run `/ledger refresh-panel`. Running `/ledger setup-panel` again moves the panel to a different channel and disables the old button.

Talos needs **View Channel**, **Send Messages**, **Embed Links**, and **Read Message History** in the selected channel.

## 5. Link members and test

1. An officer runs `/ledger link-member`, selects the Discord user, and chooses the matching active roster name.
2. That member uses the panel button or runs `/ledger contribute`.
3. Confirm the entry appears on `Contributions` and the audit record appears on `Discord Submissions`.

Examples:

- Coin: `/ledger contribute kind:Coin amount:200`
- Materials: `/ledger contribute kind:Resource item:Corundum Ore units:100`
- Direct tax: `/ledger contribute kind:Direct tax payment item:Windhelm House units:1`

Resource and tax prices come from the dated Price History on `Setup`, so changing a future price does not recalculate older Discord submissions. Items categorized exactly as `Tax` reduce that week's remaining cash tax obligation while still receiving contribution credit.

## Security and recovery

- Never commit the Discord token or ledger shared secret.
- If the secret is exposed, run `generateLedgerSecret` again, update the bot environment variable, and redeploy.
- Each Discord interaction ID is recorded in `Discord Submissions`; retries cannot create a duplicate contribution.
- Submission audit rows are reserved before the contribution is written and finalized as `Recorded`, which prevents a slow Sheet response from losing the audit trail.
- Removing a link marks it inactive. It does not delete old contributions or dividends.
