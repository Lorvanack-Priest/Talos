const LEDGER = Object.freeze({
  spreadsheetId: '1KUcOnPS13IUlmQmy-i7rBJoFwFqEJPiabAzkMoxKR6w',
  contributionsSheet: 'Contributions',
  membersSheet: 'Members',
  discordMembersSheet: 'Discord Members',
  submissionsSheet: 'Discord Submissions',
  setupSheet: 'Setup',
  inventorySheet: 'Material Inventory',
  contributionFirstRow: 7,
  contributionLastRow: 506,
  memberFirstRow: 7,
  memberLastRow: 56,
  itemFirstRow: 17,
  itemLastRow: 116,
  priceFirstRow: 17,
  priceLastRow: 216,
  discordMemberFirstRow: 5,
  submissionFirstRow: 5,
  inventoryFirstRow: 7,
  inventoryLastRow: 106,
  inventoryCountedThroughCell: 'G3',
});

var LEDGER_SPREADSHEET = null;

function doGet() {
  return json_({ ok: true, service: 'Argent Flame Ledger', version: 2 });
}

function doPost(event) {
  try {
    const request = parseRequest_(event);
    authorize_(request.secret);

    switch (request.action) {
      case 'health':
        return json_({ ok: true, spreadsheet: spreadsheet_().getName(), version: 2 });
      case 'items':
        return json_({ ok: true, items: listItems_(request.kind) });
      case 'inventory':
        return json_(listInventory_());
      case 'members':
        return json_({ ok: true, members: listActiveMembers_() });
      case 'link':
        return json_(linkMember_(request));
      case 'unlink':
        return json_(unlinkMember_(request));
      case 'contribute':
        return json_(recordContribution_(request));
      default:
        throw new Error('Unknown ledger action.');
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return json_({ ok: false, error: safeError_(error) });
  }
}

function generateLedgerSecret() {
  const secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('LEDGER_SHARED_SECRET', secret);
  console.log('ARGENT_LEDGER_SHARED_SECRET=' + secret);
  return secret;
}

function testLedgerConnection() {
  const members = listActiveMembers_();
  const resources = listItems_('resource');
  const taxes = listItems_('tax');
  const inventory = listInventory_();
  const result = {
    spreadsheet: spreadsheet_().getName(),
    activeMembers: members.length,
    resourceItems: resources.length,
    taxItems: taxes.length,
    stockedItems: inventory.stockedItems,
    totalInventoryUnits: inventory.totalUnits,
  };
  console.log(JSON.stringify(result));
  return result;
}

function parseRequest_(event) {
  if (!event || !event.postData || !event.postData.contents) {
    throw new Error('Missing request body.');
  }
  try {
    return JSON.parse(event.postData.contents);
  } catch (error) {
    throw new Error('Request body must be valid JSON.');
  }
}

function authorize_(providedSecret) {
  const expectedSecret = PropertiesService.getScriptProperties().getProperty('LEDGER_SHARED_SECRET');
  if (!expectedSecret) {
    throw new Error('Ledger shared secret has not been generated.');
  }
  if (!providedSecret || String(providedSecret) !== expectedSecret) {
    throw new Error('Ledger authorization failed.');
  }
}

function spreadsheet_() {
  if (!LEDGER_SPREADSHEET) {
    LEDGER_SPREADSHEET = SpreadsheetApp.openById(LEDGER.spreadsheetId);
  }
  return LEDGER_SPREADSHEET;
}

function sheet_(name) {
  const sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Required sheet tab is missing: ' + name);
  return sheet;
}

function listActiveMembers_() {
  const rowCount = LEDGER.memberLastRow - LEDGER.memberFirstRow + 1;
  return sheet_(LEDGER.membersSheet)
    .getRange(LEDGER.memberFirstRow, 1, rowCount, 4)
    .getDisplayValues()
    .filter(function (row) {
      return row[0] && String(row[3]).trim().toLowerCase() === 'active';
    })
    .map(function (row) { return String(row[0]).trim(); });
}

function listItems_(kind) {
  const normalizedKind = String(kind || 'resource').toLowerCase();
  const rowCount = LEDGER.itemLastRow - LEDGER.itemFirstRow + 1;
  const rows = sheet_(LEDGER.setupSheet)
    .getRange(LEDGER.itemFirstRow, 1, rowCount, 5)
    .getValues();

  return rows
    .filter(function (row) {
      if (!row[0]) return false;
      const isTax = String(row[1]).trim().toLowerCase() === 'tax';
      return normalizedKind === 'tax' ? isTax : !isTax;
    })
    .map(function (row) {
      return {
        name: String(row[0]).trim(),
        category: String(row[1]).trim(),
        unitCredit: number_(row[3]),
        bundleQuantity: number_(row[4]),
      };
    });
}

function listInventory_() {
  SpreadsheetApp.flush();
  const inventorySheet = sheet_(LEDGER.inventorySheet);
  const rowCount = LEDGER.inventoryLastRow - LEDGER.inventoryFirstRow + 1;
  const rows = inventorySheet
    .getRange(LEDGER.inventoryFirstRow, 1, rowCount, 7)
    .getValues();

  const items = rows
    .filter(function (row) { return String(row[0] || '').trim() !== ''; })
    .map(function (row) {
      return {
        name: String(row[0]).trim(),
        category: String(row[1] || 'Other').trim() || 'Other',
        countedStock: number_(row[2]),
        addedSinceCount: number_(row[3]),
        usedSinceCount: number_(row[4]),
        currentStock: number_(row[5]),
        stockValue: number_(row[6]),
      };
    });

  const countedThrough = inventorySheet
    .getRange(LEDGER.inventoryCountedThroughCell)
    .getValue();

  return {
    ok: true,
    countedThrough: formatDate_(countedThrough, 'M/d/yyyy'),
    refreshedAt: new Date().toISOString(),
    trackedItems: items.length,
    stockedItems: items.filter(function (item) { return item.currentStock !== 0; }).length,
    totalUnits: items.reduce(function (total, item) { return total + item.currentStock; }, 0),
    totalValue: items.reduce(function (total, item) { return total + item.stockValue; }, 0),
    items: items,
  };
}

function linkMember_(request) {
  const discordUserId = requiredId_(request.discordUserId, 'Discord user ID');
  const member = requiredText_(request.member, 'Member', 100);
  const activeMembers = listActiveMembers_();
  if (activeMembers.indexOf(member) === -1) {
    throw new Error('Select an active member from the ledger roster.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = sheet_(LEDGER.discordMembersSheet);
    const row = findDiscordMemberRow_(sheet, discordUserId) || Math.max(sheet.getLastRow() + 1, LEDGER.discordMemberFirstRow);
    const now = new Date();
    const values = [[
      discordUserId,
      safeCellText_(request.discordUsername, 100),
      member,
      safeCellText_(request.linkedBy, 100),
      now,
      'Active',
    ]];
    sheet.getRange(row, 1).setNumberFormat('@');
    sheet.getRange(row, 1, 1, 6).setValues(values);
    sheet.getRange(row, 5).setNumberFormat('m/d/yyyy h:mm am/pm');
    return { ok: true, member: member, discordUserId: discordUserId };
  } finally {
    lock.releaseLock();
  }
}

function unlinkMember_(request) {
  const discordUserId = requiredId_(request.discordUserId, 'Discord user ID');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = sheet_(LEDGER.discordMembersSheet);
    const row = findDiscordMemberRow_(sheet, discordUserId);
    if (!row) throw new Error('That Discord account is not linked to a ledger member.');
    const member = String(sheet.getRange(row, 3).getDisplayValue()).trim();
    sheet.getRange(row, 4).setValue(safeCellText_(request.unlinkedBy, 100));
    sheet.getRange(row, 5).setValue(new Date()).setNumberFormat('m/d/yyyy h:mm am/pm');
    sheet.getRange(row, 6).setValue('Inactive');
    return { ok: true, member: member, discordUserId: discordUserId };
  } finally {
    lock.releaseLock();
  }
}

function recordContribution_(request) {
  const submissionId = requiredId_(request.submissionId, 'Submission ID');
  const discordUserId = requiredId_(request.discordUserId, 'Discord user ID');
  const kind = String(request.kind || '').trim().toLowerCase();
  if (['coin', 'resource', 'tax'].indexOf(kind) === -1) {
    throw new Error('Contribution kind must be coin, resource, or tax.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var submissionRow = null;
  try {
    const duplicate = findSubmission_(submissionId);
    if (duplicate) return duplicateReceipt_(duplicate);

    const link = resolveLinkedMember_(discordUserId);
    const submittedAt = parseDate_(request.submittedAt) || new Date();
    const weekStart = mondayFor_(submittedAt);
    const amount = kind === 'coin' ? positiveWholeNumber_(request.amount, 'Coin amount') : 0;
    const item = kind === 'coin' ? '' : requiredText_(request.item, 'Contribution item', 100);
    const units = kind === 'coin' ? 0 : positiveWholeNumber_(request.units, 'Units');

    if (kind !== 'coin') {
      validateItem_(item, kind, weekStart);
    }

    const contributionSheet = sheet_(LEDGER.contributionsSheet);
    const contributionRow = firstBlankContributionRow_(contributionSheet);
    if (!contributionRow) {
      throw new Error('The Contributions sheet has no open rows. Ask an officer to expand the ledger.');
    }

    submissionRow = appendSubmission_({
      submissionId: submissionId,
      submittedAt: submittedAt,
      weekStart: weekStart,
      discordUserId: discordUserId,
      discordUsername: request.discordUsername,
      member: link.member,
      kind: kind,
      gold: amount,
      item: item,
      units: units,
      contributionRow: '',
      status: 'Processing',
      note: request.note,
    });

    prepareContributionRow_(contributionSheet, contributionRow);
    const note = buildContributionNote_(request.discordUsername, request.note);
    contributionSheet.getRange(contributionRow, 1, 1, 5).setValues([[
      weekStart,
      link.member,
      amount || '',
      item,
      units || '',
    ]]);
    contributionSheet.getRange(contributionRow, 11).setValue(note);
    contributionSheet.getRange(contributionRow, 1).setNumberFormat('m/d/yyyy');
    SpreadsheetApp.flush();

    const calculated = contributionSheet.getRange(contributionRow, 6, 1, 5).getValues()[0];
    const receipt = {
      ok: true,
      duplicate: false,
      member: link.member,
      weekStart: formatDate_(weekStart, 'M/d/yyyy'),
      kind: kind,
      gold: amount,
      item: item,
      units: units,
      unitCredit: number_(calculated[0]),
      resourceCredit: number_(calculated[3]),
      totalValue: number_(calculated[4]),
      contributionRow: contributionRow,
    };

    completeSubmission_(submissionRow, contributionRow);
    updateLinkedUsername_(link.row, request.discordUsername);
    return receipt;
  } catch (error) {
    if (submissionRow) failSubmission_(submissionRow);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function resolveLinkedMember_(discordUserId) {
  const sheet = sheet_(LEDGER.discordMembersSheet);
  const row = findDiscordMemberRow_(sheet, discordUserId);
  if (!row) {
    throw new Error('Your Discord account is not linked to the guild roster. Ask an officer to use /ledger link-member.');
  }
  const values = sheet.getRange(row, 3, 1, 4).getDisplayValues()[0];
  const member = String(values[0]).trim();
  const status = String(values[3]).trim().toLowerCase();
  if (status !== 'active') {
    throw new Error('Your ledger link is inactive. Ask an officer to link it again.');
  }
  if (listActiveMembers_().indexOf(member) === -1) {
    throw new Error('Your linked roster member is not currently active. Ask an officer to update the link.');
  }
  return { row: row, member: member };
}

function findDiscordMemberRow_(sheet, discordUserId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < LEDGER.discordMemberFirstRow) return null;
  const values = sheet.getRange(LEDGER.discordMemberFirstRow, 1, lastRow - LEDGER.discordMemberFirstRow + 1, 1).getDisplayValues();
  for (var index = 0; index < values.length; index += 1) {
    if (String(values[index][0]).trim() === discordUserId) {
      return LEDGER.discordMemberFirstRow + index;
    }
  }
  return null;
}

function updateLinkedUsername_(row, username) {
  try {
    sheet_(LEDGER.discordMembersSheet).getRange(row, 2).setValue(safeCellText_(username, 100));
  } catch (error) {
    console.error('Could not refresh linked Discord username: ' + safeError_(error));
  }
}

function validateItem_(item, kind, weekStart) {
  const setup = sheet_(LEDGER.setupSheet);
  const itemRowCount = LEDGER.itemLastRow - LEDGER.itemFirstRow + 1;
  const catalog = setup.getRange(LEDGER.itemFirstRow, 1, itemRowCount, 2).getDisplayValues();
  var category = null;
  for (var index = 0; index < catalog.length; index += 1) {
    if (String(catalog[index][0]).trim() === item) {
      category = String(catalog[index][1]).trim();
      break;
    }
  }
  if (category === null) throw new Error('Select an item from the Setup catalog.');

  const isTax = category.toLowerCase() === 'tax';
  if (kind === 'tax' && !isTax) throw new Error('That item is not categorized as Tax in Setup.');
  if (kind === 'resource' && isTax) throw new Error('Tax items must be submitted as a direct tax payment.');

  const priceRowCount = LEDGER.priceLastRow - LEDGER.priceFirstRow + 1;
  const prices = setup.getRange(LEDGER.priceFirstRow, 11, priceRowCount, 3).getValues();
  var effectivePrice = null;
  var effectiveDate = null;
  prices.forEach(function (row) {
    const priceItem = String(row[0] || '').trim();
    const priceDate = row[1] instanceof Date ? row[1] : null;
    const price = number_(row[2]);
    if (priceItem === item && priceDate && priceDate.getTime() <= weekStart.getTime()) {
      if (!effectiveDate || priceDate.getTime() > effectiveDate.getTime()) {
        effectiveDate = priceDate;
        effectivePrice = price;
      }
    }
  });
  if (!(effectivePrice > 0)) {
    throw new Error('That item has no positive price effective for this contribution week.');
  }
}

function firstBlankContributionRow_(sheet) {
  const rowCount = LEDGER.contributionLastRow - LEDGER.contributionFirstRow + 1;
  const values = sheet.getRange(LEDGER.contributionFirstRow, 1, rowCount, 5).getDisplayValues();
  for (var index = 0; index < values.length; index += 1) {
    if (values[index].every(function (value) { return String(value).trim() === ''; })) {
      return LEDGER.contributionFirstRow + index;
    }
  }
  return null;
}

function prepareContributionRow_(sheet, row) {
  if (row === LEDGER.contributionFirstRow) return;
  sheet.getRange(LEDGER.contributionFirstRow, 1, 1, 13)
    .copyTo(sheet.getRange(row, 1, 1, 13), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  sheet.getRange(LEDGER.contributionFirstRow, 6, 1, 5)
    .copyTo(sheet.getRange(row, 6, 1, 5), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
  sheet.getRange(LEDGER.contributionFirstRow, 12, 1, 2)
    .copyTo(sheet.getRange(row, 12, 1, 2), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
}

function appendSubmission_(entry) {
  const sheet = sheet_(LEDGER.submissionsSheet);
  const row = Math.max(sheet.getLastRow() + 1, LEDGER.submissionFirstRow);
  sheet.getRange(row, 1).setNumberFormat('@');
  sheet.getRange(row, 1, 1, 13).setValues([[
    entry.submissionId,
    entry.submittedAt,
    entry.weekStart,
    entry.discordUserId,
    safeCellText_(entry.discordUsername, 100),
    entry.member,
    entry.kind,
    entry.gold || '',
    entry.item,
    entry.units || '',
    entry.contributionRow,
    entry.status || 'Recorded',
    safeCellText_(entry.note, 500),
  ]]);
  sheet.getRange(row, 2, 1, 2).setNumberFormats([['m/d/yyyy h:mm am/pm', 'm/d/yyyy']]);
  return row;
}

function completeSubmission_(row, contributionRow) {
  sheet_(LEDGER.submissionsSheet).getRange(row, 11, 1, 2).setValues([[
    contributionRow,
    'Recorded',
  ]]);
}

function failSubmission_(row) {
  try {
    sheet_(LEDGER.submissionsSheet).getRange(row, 12).setValue('Failed');
  } catch (error) {
    console.error('Could not mark failed ledger submission: ' + safeError_(error));
  }
}

function findSubmission_(submissionId) {
  const sheet = sheet_(LEDGER.submissionsSheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < LEDGER.submissionFirstRow) return null;
  const values = sheet.getRange(LEDGER.submissionFirstRow, 1, lastRow - LEDGER.submissionFirstRow + 1, 13).getValues();
  for (var index = 0; index < values.length; index += 1) {
    if (String(values[index][0]).trim() === submissionId) {
      return { row: LEDGER.submissionFirstRow + index, values: values[index] };
    }
  }
  return null;
}

function duplicateReceipt_(submission) {
  const row = submission.values;
  const status = String(row[11] || '').trim().toLowerCase();
  if (status === 'processing') {
    throw new Error('This contribution is still being processed. Wait a moment before checking the ledger.');
  }
  if (status !== 'recorded') {
    throw new Error('The previous contribution attempt did not complete. Start a new submission.');
  }
  const contributionRow = number_(row[10]);
  const contribution = contributionRow
    ? sheet_(LEDGER.contributionsSheet).getRange(contributionRow, 1, 1, 10).getValues()[0]
    : [];
  return {
    ok: true,
    duplicate: true,
    member: String(row[5] || ''),
    weekStart: formatDate_(row[2], 'M/d/yyyy'),
    kind: String(row[6] || ''),
    gold: number_(row[7]),
    item: String(row[8] || ''),
    units: number_(row[9]),
    unitCredit: number_(contribution[5]),
    resourceCredit: number_(contribution[8]),
    totalValue: number_(contribution[9]),
    contributionRow: contributionRow,
  };
}

function mondayFor_(date) {
  const timeZone = spreadsheet_().getSpreadsheetTimeZone();
  const localDate = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
  const noonUtc = new Date(localDate + 'T12:00:00Z');
  const daysSinceMonday = (noonUtc.getUTCDay() + 6) % 7;
  noonUtc.setUTCDate(noonUtc.getUTCDate() - daysSinceMonday);

  const mondayDate = Utilities.formatDate(noonUtc, 'UTC', 'yyyy-MM-dd');
  return Utilities.parseDate(mondayDate, timeZone, 'yyyy-MM-dd');
}

function formatDate_(date, pattern) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, spreadsheet_().getSpreadsheetTimeZone(), pattern);
}

function parseDate_(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function buildContributionNote_(username, note) {
  const prefix = 'Discord: ' + String(username || 'unknown').trim();
  const suffix = String(note || '').trim();
  return safeCellText_(suffix ? prefix + ' — ' + suffix : prefix, 500);
}

function requiredText_(value, label, maxLength) {
  const text = String(value || '').trim();
  if (!text) throw new Error(label + ' is required.');
  if (text.length > maxLength) throw new Error(label + ' is too long.');
  return text;
}

function requiredId_(value, label) {
  const id = requiredText_(value, label, 100);
  if (!/^\d+$/.test(id)) throw new Error(label + ' is invalid.');
  return id;
}

function positiveWholeNumber_(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(label + ' must be a positive whole number.');
  }
  return number;
}

function number_(value) {
  const number = Number(value);
  return isFinite(number) ? number : 0;
}

function safeCellText_(value, maxLength) {
  var text = String(value || '').trim().substring(0, maxLength);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return text;
}

function safeError_(error) {
  const message = error && error.message ? String(error.message) : 'Unknown ledger error.';
  return message.substring(0, 300);
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
