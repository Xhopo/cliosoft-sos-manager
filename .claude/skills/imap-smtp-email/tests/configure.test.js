const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadSkillEnv } = require('../lib/email-config');
const { applyConfiguration, inspectConfiguration } = require('../scripts/configure');

test('applyConfiguration writes CPS defaults to .env and stores authorization codes', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'imap-smtp-email-configure-'));
  const envPath = path.join(tempDir, '.env');
  const secretWrites = [];

  const result = await applyConfiguration(
    {
      provider: 'cps-163-enterprise',
      email: 'alice@convenientpower.com',
      'auth-code': 'secret-code',
    },
    {
      env: {},
      envPath,
      setStoredEmailSecrets: async (env, secrets) => {
        secretWrites.push({ env, secrets });
      },
    }
  );

  const writtenEnv = loadSkillEnv(envPath);

  assert.equal(result.success, true);
  assert.equal(result.provider, 'cps-163-enterprise');
  assert.equal(result.mailbox, 'INBOX');
  assert.equal(writtenEnv.EMAIL_PROVIDER, 'cps-163-enterprise');
  assert.equal(writtenEnv.IMAP_HOST, 'imap.qiye.163.com');
  assert.equal(writtenEnv.SMTP_HOST, 'smtp.qiye.163.com');
  assert.equal(writtenEnv.IMAP_USER, 'alice@convenientpower.com');
  assert.equal(writtenEnv.SMTP_FROM, 'alice@convenientpower.com');
  assert.deepEqual(secretWrites, [
    {
      env: {},
      secrets: {
        imapPass: 'secret-code',
        smtpPass: 'secret-code',
      },
    },
  ]);
});

test('inspectConfiguration reports needs-config when mailbox settings are missing', async () => {
  const result = await inspectConfiguration(
    {},
    {
      env: {},
      skillEnv: {},
      loadStoredSecrets: async () => ({}),
    }
  );

  assert.equal(result.status, 'needs-config');
  assert.equal(result.managementApiAvailable, true);
  assert.ok(result.missing.includes('IMAP_USER'));
  assert.ok(result.missing.includes('SMTP_USER'));
  assert.ok(result.missing.includes('IMAP_HOST'));
  assert.ok(result.missing.includes('SMTP_HOST'));
});

test('inspectConfiguration reports needs-secret when config exists but authorization code is missing', async () => {
  const result = await inspectConfiguration(
    {},
    {
      env: {},
      skillEnv: {
        EMAIL_PROVIDER: 'cps-163-enterprise',
        IMAP_USER: 'alice@convenientpower.com',
        SMTP_USER: 'alice@convenientpower.com',
      },
      loadStoredSecrets: async () => ({}),
    }
  );

  assert.equal(result.status, 'needs-secret');
  assert.ok(result.missing.includes('IMAP_PASS'));
  assert.ok(result.missing.includes('SMTP_PASS'));
});

test('inspectConfiguration reports ready when config and authorization code are available', async () => {
  const result = await inspectConfiguration(
    {},
    {
      env: {},
      skillEnv: {
        EMAIL_PROVIDER: 'cps-163-enterprise',
        IMAP_USER: 'alice@convenientpower.com',
        SMTP_USER: 'alice@convenientpower.com',
      },
      loadStoredSecrets: async () => ({
        imapPass: 'imap-secret',
        smtpPass: 'smtp-secret',
      }),
    }
  );

  assert.equal(result.status, 'ready');
  assert.equal(result.provider, 'cps-163-enterprise');
  assert.equal(result.email, 'alice@convenientpower.com');
  assert.equal(result.hasImapSecret, true);
  assert.equal(result.hasSmtpSecret, true);
  assert.match(result.nextAction, /Run the mail action directly/);
});
