const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  loadSkillEnv,
  inspectResolvedConfig,
  createImapConfig,
  createSmtpConfig,
} = require('../lib/email-config');

test('loadSkillEnv reads allowed keys and ignores password fields from .env', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imap-smtp-email-'));
  const envPath = path.join(tempDir, '.env');

  fs.writeFileSync(
    envPath,
    [
      'IMAP_HOST=imap.example.com',
      'IMAP_USER=user@example.com',
      'IMAP_PASS=file-secret',
      'SMTP_HOST=smtp.example.com',
      'SMTP_PASS=file-secret',
      'EMAIL_SKILL_DEBUG=true',
    ].join('\n'),
    'utf8'
  );

  const env = loadSkillEnv(envPath);

  assert.equal(env.IMAP_HOST, 'imap.example.com');
  assert.equal(env.IMAP_USER, 'user@example.com');
  assert.equal(env.SMTP_HOST, 'smtp.example.com');
  assert.equal(env.EMAIL_SKILL_DEBUG, 'true');
  assert.equal(env.IMAP_PASS, undefined);
  assert.equal(env.SMTP_PASS, undefined);
});

test('inspectResolvedConfig infers CPS 163 enterprise preset from convenientpower mailbox', () => {
  const snapshot = inspectResolvedConfig({
    env: {
      IMAP_USER: 'alice@convenientpower.com',
      SMTP_USER: 'alice@convenientpower.com',
    },
    skillEnv: {},
  });

  assert.equal(snapshot.providerKey, 'cps-163-enterprise');
  assert.equal(snapshot.imap.host, 'imap.qiye.163.com');
  assert.equal(snapshot.imap.port, 993);
  assert.equal(snapshot.smtp.host, 'smtp.qiye.163.com');
  assert.equal(snapshot.smtp.port, 465);
  assert.equal(snapshot.imap.mailbox, 'INBOX');
});

test('createImapConfig prefers explicit process env secrets over stored credentials', async () => {
  let storedSecretsCalls = 0;

  const config = await createImapConfig({
    env: {
      IMAP_HOST: 'imap.example.com',
      IMAP_PORT: '993',
      IMAP_TLS: 'true',
      IMAP_USER: 'user@example.com',
      IMAP_PASS: 'direct-secret',
    },
    skillEnv: {
      IMAP_MAILBOX: 'Inbox/Subfolder',
    },
    loadStoredSecrets: async () => {
      storedSecretsCalls += 1;
      return { imapPass: 'stored-secret' };
    },
  });

  assert.equal(storedSecretsCalls, 0);
  assert.equal(config.host, 'imap.example.com');
  assert.equal(config.port, 993);
  assert.equal(config.secure, true);
  assert.equal(config.auth.user, 'user@example.com');
  assert.equal(config.auth.pass, 'direct-secret');
  assert.equal(config.mailbox, 'Inbox/Subfolder');
});

test('createSmtpConfig falls back to stored credentials when env secret is missing', async () => {
  const config = await createSmtpConfig({
    env: {
      SMTP_HOST: 'smtp.example.com',
      SMTP_USER: 'user@example.com',
    },
    skillEnv: {
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_FROM: 'sender@example.com',
    },
    loadStoredSecrets: async () => ({
      smtpPass: 'stored-secret',
    }),
  });

  assert.equal(config.host, 'smtp.example.com');
  assert.equal(config.port, 465);
  assert.equal(config.secure, true);
  assert.equal(config.auth.user, 'user@example.com');
  assert.equal(config.auth.pass, 'stored-secret');
  assert.equal(config.from, 'sender@example.com');
});

test('createImapConfig returns EMAIL_CONFIG_MISSING when host cannot be inferred', async () => {
  await assert.rejects(
    () =>
      createImapConfig({
        env: {
          IMAP_USER: 'user@unknown-domain.example',
        },
        skillEnv: {},
        loadStoredSecrets: async () => ({}),
      }),
    (error) => error && error.code === 'EMAIL_CONFIG_MISSING' && /Missing IMAP_HOST/.test(error.message)
  );
});

test('createImapConfig returns EMAIL_SECRET_MISSING when no authorization code is available', async () => {
  await assert.rejects(
    () =>
      createImapConfig({
        env: {
          IMAP_USER: 'user@convenientpower.com',
        },
        skillEnv: {},
        loadStoredSecrets: async () => ({}),
      }),
    (error) => error && error.code === 'EMAIL_SECRET_MISSING' && /bun --no-env-file --bun scripts\/configure\.js apply/.test(error.hint)
  );
});

test('createSmtpConfig validates SMTP user before checking stored credentials', async () => {
  let storedSecretsCalls = 0;

  await assert.rejects(
    () =>
      createSmtpConfig({
        env: {
          SMTP_HOST: 'smtp.example.com',
        },
        skillEnv: {},
        loadStoredSecrets: async () => {
          storedSecretsCalls += 1;
          return { smtpPass: 'stored-secret' };
        },
      }),
    (error) => error && error.code === 'EMAIL_CONFIG_MISSING' && /Missing SMTP_USER/.test(error.message)
  );

  assert.equal(storedSecretsCalls, 0);
});
