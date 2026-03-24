#!/usr/bin/env node

/**
 * IMAP Email CLI
 * Works with any standard IMAP server (Gmail, ProtonMail Bridge, Fastmail, etc.)
 * Supports IMAP ID extension (RFC 2971) for 163.com and other servers
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const path = require('path');
const fs = require('fs');
const { parseArgs } = require('../lib/parse-args');
const {
  loadSkillEnv,
  getDebugEnabled,
  createImapConfig,
} = require('../lib/email-config');
const {
  splitSearchFilters,
  hasClientSideHeaderFilters,
  matchesClientSideHeaderFilters,
} = require('../lib/imap-search-filters');
const {
  normalizeRuntimeEmailError,
  isEmailSkillError,
  formatEmailSkillError,
} = require('../lib/email-errors');

const SKILL_ENV = loadSkillEnv();
const DEBUG = getDebugEnabled(process.env, SKILL_ENV);

function debug(...args) {
  if (DEBUG) {
    console.error(...args);
  }
}

// IMAP ID information for 163.com compatibility
const IMAP_ID = {
  name: 'moltbot',
  version: '0.0.1',
  vendor: 'netease',
  'support-email': 'kefu@188.com'
};

function getDefaultMailbox(env = process.env, skillEnv = SKILL_ENV) {
  return env.IMAP_MAILBOX || skillEnv.IMAP_MAILBOX || 'INBOX';
}

async function loadImapRuntimeConfig({ env = process.env, skillEnv = SKILL_ENV } = {}) {
  const config = await createImapConfig({
    env,
    skillEnv,
  });

  debug(
    `[imap-debug] Config: host=${config.host}, port=${config.port}, secure=${config.secure}, rejectUnauthorized=${config.tls.rejectUnauthorized}, hasUser=${!!config.auth.user}, hasPassword=${!!config.auth.pass}`
  );

  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    tls: config.tls,
    clientInfo: IMAP_ID,
    logger: false,
  };
}

async function connect(runtime = {}) {
  const config = await loadImapRuntimeConfig(runtime);
  const client = new ImapFlow(config);
  debug('[imap-debug] Connecting...');
  try {
    await client.connect();
  } catch (error) {
    try {
      client.close();
    } catch {
      // ignore close errors during failed connect
    }
    throw normalizeRuntimeEmailError(error, { protocol: 'imap' });
  }
  debug('[imap-debug] Connection ready');
  return client;
}

async function closeClient(client) {
  if (!client) {
    return;
  }

  try {
    if (client.usable) {
      await client.logout();
      return;
    }
  } catch (err) {
    debug('[imap-debug] Logout failed:', err.message);
  }

  try {
    client.close();
  } catch (err) {
    debug('[imap-debug] Close failed:', err.message);
  }
}

async function withMailbox(mailbox, callback, runtime = {}) {
  const client = await connect(runtime);
  let lock;

  try {
    lock = await client.getMailboxLock(mailbox);
    return await callback(client);
  } finally {
    if (lock) {
      lock.release();
    }
    await closeClient(client);
  }
}

function parseRelativeTime(timeStr) {
  const match = timeStr.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error('Invalid time format. Use: 30m, 2h, 7d');
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];
  const now = new Date();

  switch (unit) {
    case 'm':
      return new Date(now.getTime() - value * 60 * 1000);
    case 'h':
      return new Date(now.getTime() - value * 60 * 60 * 1000);
    case 'd':
      return new Date(now.getTime() - value * 24 * 60 * 60 * 1000);
    default:
      throw new Error('Unknown time unit');
  }
}

function formatDate(date) {
  if (!date) {
    return null;
  }

  try {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) {
      return null;
    }

    const pad = (n) => String(n).padStart(2, '0');
    const tzOffset = -d.getTimezoneOffset();
    const sign = tzOffset >= 0 ? '+' : '-';
    const tzHours = pad(Math.floor(Math.abs(tzOffset) / 60));
    const tzMinutes = pad(Math.abs(tzOffset) % 60);

    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
      + `${sign}${tzHours}:${tzMinutes}`;
  } catch (err) {
    return null;
  }
}

async function parseEmail(source, { includeAttachments = false, summaryOnly = false } = {}) {
  const parsed = await simpleParser(source);
  const snippet = parsed.text
    ? parsed.text.slice(0, 200)
    : (parsed.html ? parsed.html.slice(0, 200).replace(/<[^>]*>/g, '') : '');

  const result = {
    from: parsed.from?.text || 'Unknown',
    to: parsed.to?.text,
    subject: parsed.subject || '(no subject)',
    date: formatDate(parsed.date),
    snippet,
    attachments: parsed.attachments?.map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      content: includeAttachments ? attachment.content : undefined,
      cid: attachment.cid,
    })) || [],
  };

  if (!summaryOnly) {
    result.text = parsed.text;
    result.html = parsed.html;
  }

  return result;
}

function buildSearchQuery(options = {}, { unreadOnly = false } = {}) {
  const query = {};

  if (unreadOnly || options.unseen === true || options.unseen === 'true') {
    query.seen = false;
  } else if (options.seen === true || options.seen === 'true') {
    query.seen = true;
  } else {
    query.all = true;
  }

  if (options.from) {
    query.from = options.from;
  }
  if (options.subject) {
    query.subject = options.subject;
  }
  if (options.recent) {
    query.since = parseRelativeTime(options.recent);
  } else {
    if (options.since) {
      query.since = options.since;
    }
    if (options.before) {
      query.before = options.before;
    }
  }

  return query;
}

async function fetchMessagesByUid(client, uids, { summaryOnly = false, includeAttachments = false } = {}) {
  const results = [];

  for (const uid of uids) {
    const message = await client.fetchOne(String(uid), {
      uid: true,
      flags: true,
      envelope: true,
      internalDate: true,
      source: true,
    }, { uid: true });

    if (!message || !message.source) {
      continue;
    }

    const parsed = await parseEmail(message.source, { summaryOnly, includeAttachments });
    results.push({
      uid: message.uid || Number(uid),
      ...parsed,
      flags: Array.from(message.flags || []),
      internalDate: message.internalDate ? new Date(message.internalDate).toISOString() : null,
    });
  }

  results.sort((a, b) => {
    const dateA = a.internalDate ? new Date(a.internalDate).getTime() : 0;
    const dateB = b.internalDate ? new Date(b.internalDate).getTime() : 0;
    return dateB - dateA;
  });

  return results;
}

function formatEnvelopeAddresses(addresses = []) {
  const parts = [];

  for (const entry of addresses) {
    if (!entry) {
      continue;
    }

    if (entry.name && entry.address) {
      parts.push(`${entry.name} <${entry.address}>`);
      continue;
    }

    if (entry.address) {
      parts.push(entry.address);
      continue;
    }

    if (entry.name) {
      parts.push(entry.name);
    }
  }

  return parts.join(', ') || 'Unknown';
}

async function fetchEnvelopeSummariesByUid(client, uids) {
  const results = [];

  for (const uid of uids) {
    const message = await client.fetchOne(String(uid), {
      uid: true,
      flags: true,
      envelope: true,
      internalDate: true,
    }, { uid: true });

    if (!message) {
      continue;
    }

    results.push({
      uid: message.uid || Number(uid),
      from: formatEnvelopeAddresses(message.envelope?.from || []),
      subject: message.envelope?.subject || '(no subject)',
      flags: Array.from(message.flags || []),
      internalDate: message.internalDate ? new Date(message.internalDate).toISOString() : null,
    });
  }

  results.sort((a, b) => {
    const dateA = a.internalDate ? new Date(a.internalDate).getTime() : 0;
    const dateB = b.internalDate ? new Date(b.internalDate).getTime() : 0;
    return dateB - dateA;
  });

  return results;
}

async function checkEmails(mailbox, limit = 10, recentTime = null, unreadOnly = false, runtime = {}) {
  const resolvedMailbox = mailbox || getDefaultMailbox(runtime.env, runtime.skillEnv);
  return withMailbox(resolvedMailbox, async (client) => {
    const query = buildSearchQuery(recentTime ? { recent: recentTime } : {}, { unreadOnly });
    const uids = await client.search(query, { uid: true }) || [];
    const selectedUids = uids.slice(-limit).reverse();
    return fetchMessagesByUid(client, selectedUids, { summaryOnly: true });
  }, runtime);
}

async function fetchEmail(uid, mailbox, runtime = {}) {
  const resolvedMailbox = mailbox || getDefaultMailbox(runtime.env, runtime.skillEnv);
  return withMailbox(resolvedMailbox, async (client) => {
    const messages = await fetchMessagesByUid(client, [uid], { summaryOnly: false });
    if (!messages.length) {
      throw new Error(`Message UID ${uid} not found`);
    }
    return messages[0];
  }, runtime);
}

async function downloadAttachments(uid, mailbox, outputDir = '.', specificFilename = null, runtime = {}) {
  const resolvedMailbox = mailbox || getDefaultMailbox(runtime.env, runtime.skillEnv);
  return withMailbox(resolvedMailbox, async (client) => {
    const messages = await fetchMessagesByUid(client, [uid], {
      summaryOnly: false,
      includeAttachments: true,
    });

    if (!messages.length) {
      throw new Error(`Message UID ${uid} not found`);
    }

    const message = messages[0];
    if (!message.attachments.length) {
      return {
        uid,
        downloaded: [],
        message: 'No attachments found',
      };
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const downloaded = [];
    for (const attachment of message.attachments) {
      if (specificFilename && attachment.filename !== specificFilename) {
        continue;
      }
      if (!attachment.content || !attachment.filename) {
        continue;
      }

      const filePath = path.join(outputDir, attachment.filename);
      fs.writeFileSync(filePath, attachment.content);
      downloaded.push({
        filename: attachment.filename,
        path: filePath,
        size: attachment.size,
      });
    }

    if (specificFilename && downloaded.length === 0) {
      const availableFiles = message.attachments.map((attachment) => attachment.filename).filter(Boolean).join(', ');
      return {
        uid,
        downloaded: [],
        message: `File "${specificFilename}" not found. Available attachments: ${availableFiles}`,
      };
    }

    return {
      uid,
      downloaded,
      message: `Downloaded ${downloaded.length} attachment(s)`,
    };
  }, runtime);
}

async function searchEmails(options, runtime = {}) {
  const mailbox = options.mailbox || getDefaultMailbox(runtime.env, runtime.skillEnv);
  return withMailbox(mailbox, async (client) => {
    const { serverOptions, clientFilters } = splitSearchFilters(options);
    const query = buildSearchQuery(serverOptions);
    const limit = parseInt(options.limit, 10) || 20;
    const uids = await client.search(query, { uid: true }) || [];
    const orderedUids = uids.slice().reverse();

    if (!hasClientSideHeaderFilters(clientFilters)) {
      return fetchMessagesByUid(client, orderedUids.slice(0, limit), { summaryOnly: true });
    }

    debug(`[imap-debug] Falling back to client-side header filtering for ${orderedUids.length} candidate message(s)`);

    const summaries = await fetchEnvelopeSummariesByUid(client, orderedUids);
    const selectedUids = summaries
      .filter((message) => matchesClientSideHeaderFilters(message, clientFilters))
      .slice(0, limit)
      .map((message) => message.uid);

    return fetchMessagesByUid(client, selectedUids, { summaryOnly: true });
  }, runtime);
}

async function markAsRead(uids, mailbox, runtime = {}) {
  const resolvedMailbox = mailbox || getDefaultMailbox(runtime.env, runtime.skillEnv);
  return withMailbox(resolvedMailbox, async (client) => {
    const targets = uids.map((uid) => Number(uid));
    await client.messageFlagsAdd(targets, ['\\Seen'], { uid: true });
    return { success: true, uids: targets, action: 'marked as read' };
  }, runtime);
}

async function markAsUnread(uids, mailbox, runtime = {}) {
  const resolvedMailbox = mailbox || getDefaultMailbox(runtime.env, runtime.skillEnv);
  return withMailbox(resolvedMailbox, async (client) => {
    const targets = uids.map((uid) => Number(uid));
    await client.messageFlagsRemove(targets, ['\\Seen'], { uid: true });
    return { success: true, uids: targets, action: 'marked as unread' };
  }, runtime);
}

async function listMailboxes(runtime = {}) {
  const client = await connect(runtime);
  try {
    const boxes = await client.list();
    return boxes.map((box) => ({
      name: box.path,
      delimiter: box.delimiter,
      attributes: Array.from(box.flags || []),
    }));
  } finally {
    await closeClient(client);
  }
}

async function main() {
  const { command, options, positional } = parseArgs(process.argv.slice(2));

  try {
    let result;
    const mailbox = options.mailbox || getDefaultMailbox();

    switch (command) {
      case 'check':
        result = await checkEmails(
          mailbox,
          parseInt(options.limit, 10) || 10,
          options.recent || null,
          options.unseen === true || options.unseen === 'true'
        );
        break;

      case 'fetch':
        if (!positional[0]) {
          throw new Error('UID required: bun --no-env-file --bun scripts/imap.js fetch <uid>');
        }
        result = await fetchEmail(positional[0], mailbox);
        break;

      case 'download':
        if (!positional[0]) {
          throw new Error('UID required: bun --no-env-file --bun scripts/imap.js download <uid>');
        }
        result = await downloadAttachments(positional[0], mailbox, options.dir || '.', options.file || null);
        break;

      case 'search':
        result = await searchEmails(options);
        break;

      case 'mark-read':
        if (positional.length === 0) {
          throw new Error('UID(s) required: bun --no-env-file --bun scripts/imap.js mark-read <uid> [uid2...]');
        }
        result = await markAsRead(positional, mailbox);
        break;

      case 'mark-unread':
        if (positional.length === 0) {
          throw new Error('UID(s) required: bun --no-env-file --bun scripts/imap.js mark-unread <uid> [uid2...]');
        }
        result = await markAsUnread(positional, mailbox);
        break;

      case 'list-mailboxes':
        result = await listMailboxes();
        break;

      default:
        console.error('Unknown command:', command);
        console.error('Available commands: check, fetch, download, search, mark-read, mark-unread, list-mailboxes');
        console.error('\nExamples:');
        console.error('  bun --no-env-file --bun scripts/imap.js check --limit 10');
        console.error('  bun --no-env-file --bun scripts/imap.js search --unseen --recent 2h');
        console.error('  node scripts/imap.js check  # fallback if Bun is unavailable');
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    const normalized = isEmailSkillError(err)
      ? err
      : normalizeRuntimeEmailError(err, { protocol: 'imap' });
    console.error('Error:', isEmailSkillError(normalized) ? formatEmailSkillError(normalized) : normalized.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  checkEmails,
  fetchEmail,
  downloadAttachments,
  searchEmails,
  markAsRead,
  markAsUnread,
  listMailboxes,
};
