import { createError, ErrorTypes } from '../utils/errorHandler.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const AUTOCOMPLETE_TIMEOUT_MS = 2_400;
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map();

function getConfig() {
  return {
    scriptUrl: process.env.ARGENT_LEDGER_SCRIPT_URL?.trim(),
    sharedSecret: process.env.ARGENT_LEDGER_SHARED_SECRET?.trim(),
    guildId: (process.env.ARGENT_LEDGER_GUILD_ID || process.env.GUILD_ID)?.trim(),
  };
}

function configurationError() {
  return createError(
    'Argent Flame ledger integration is not configured',
    ErrorTypes.CONFIGURATION,
    'The guild ledger connection is not configured yet. Ask an officer to finish the bot setup.',
    { service: 'argent_flame_ledger', expected: true },
  );
}

export function isLedgerGuild(guildId) {
  const configuredGuildId = getConfig().guildId;
  return !configuredGuildId || String(guildId || '') === configuredGuildId;
}

export function assertLedgerGuild(guildId) {
  if (!isLedgerGuild(guildId)) {
    throw createError(
      'Ledger command used outside the configured guild',
      ErrorTypes.PERMISSION,
      'The Argent Flame ledger is only available in its configured Discord server.',
      { guildId, expected: true },
    );
  }
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function invalidateMemberCache() {
  cache.delete('members');
}

function safeRemoteMessage(value) {
  const message = typeof value === 'string' ? value.trim() : '';
  if (!message) return null;
  return message.substring(0, 300);
}

export async function requestLedger(action, payload = {}, options = {}) {
  const { scriptUrl, sharedSecret } = getConfig();
  if (!scriptUrl || !sharedSecret) {
    throw configurationError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(scriptUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: sharedSecret,
        action,
        ...payload,
      }),
      redirect: 'follow',
      signal: controller.signal,
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw createError(
        `Ledger endpoint returned a non-JSON response (${response.status})`,
        ErrorTypes.NETWORK,
        'The guild ledger returned an unexpected response. Ask an officer to check the Google Apps Script deployment.',
        { service: 'argent_flame_ledger', status: response.status },
      );
    }

    if (!response.ok || data?.ok !== true) {
      const remoteMessage = safeRemoteMessage(data?.error);
      throw createError(
        `Ledger request failed: ${remoteMessage || response.status}`,
        response.ok ? ErrorTypes.VALIDATION : ErrorTypes.NETWORK,
        remoteMessage || 'The guild ledger is temporarily unavailable. Try again in a moment.',
        { service: 'argent_flame_ledger', status: response.status, action, expected: response.ok },
      );
    }

    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createError(
        'Ledger request timed out',
        ErrorTypes.NETWORK,
        'The guild ledger took too long to respond. Try again in a moment.',
        { service: 'argent_flame_ledger', action },
      );
    }
    if (error?.name !== 'TitanBotError') {
      throw createError(
        `Ledger network request failed: ${error?.message || error}`,
        ErrorTypes.NETWORK,
        'The guild ledger is temporarily unavailable. Try again in a moment.',
        { service: 'argent_flame_ledger', action },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLedgerItems(kind) {
  const normalizedKind = kind === 'tax' ? 'tax' : 'resource';
  const cacheKey = `items:${normalizedKind}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const result = await requestLedger('items', { kind: normalizedKind }, { timeoutMs: AUTOCOMPLETE_TIMEOUT_MS });
  return setCached(cacheKey, Array.isArray(result.items) ? result.items : []);
}

export async function getLedgerMembers() {
  const cached = getCached('members');
  if (cached) return cached;

  const result = await requestLedger('members', {}, { timeoutMs: AUTOCOMPLETE_TIMEOUT_MS });
  return setCached('members', Array.isArray(result.members) ? result.members : []);
}

export async function linkLedgerMember(payload) {
  const result = await requestLedger('link', payload);
  invalidateMemberCache();
  return result;
}

export async function unlinkLedgerMember(payload) {
  const result = await requestLedger('unlink', payload);
  invalidateMemberCache();
  return result;
}

export function recordLedgerContribution(payload) {
  return requestLedger('contribute', payload);
}
