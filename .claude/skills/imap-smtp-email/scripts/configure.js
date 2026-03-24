#!/usr/bin/env node

const readline = require('node:readline');

const { parseArgs } = require('../lib/parse-args');
const {
  SKILL_ENV_PATH,
  loadSkillEnv,
  writeSkillEnv,
  resolveProviderContext,
  inspectResolvedConfig,
} = require('../lib/email-config');
const {
  getStoredEmailSecrets,
  setStoredEmailSecrets,
} = require('../lib/email-credentials-client');
const {
  buildConfigureHint,
  buildCps163Hint,
  isEmailSkillError,
  formatEmailSkillError,
} = require('../lib/email-errors');
const { listMailboxes } = require('./imap');
const { verifyConnection } = require('./smtp');

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptSecret(question) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return prompt(question);
  }

  return new Promise((resolve, reject) => {
    let value = '';

    const onData = (chunk) => {
      const input = chunk.toString('utf8');

      if (input === '\u0003') {
        cleanup();
        reject(new Error('Prompt cancelled'));
        return;
      }

      if (input === '\r' || input === '\n') {
        cleanup();
        process.stdout.write('\n');
        resolve(value);
        return;
      }

      if (input === '\u0008' || input === '\u007f') {
        value = value.slice(0, -1);
        return;
      }

      value += input;
    };

    const cleanup = () => {
      process.stdin.off('data', onData);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
    };

    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.setRawMode(true);
    process.stdin.on('data', onData);
  });
}

function toFlagBoolean(value) {
  return value === true || value === 'true';
}

async function resolveAuthCodes(options) {
  let imapAuthCode = options['auth-code'] || options['imap-auth-code'];
  let smtpAuthCode = options['smtp-auth-code'];

  if (!imapAuthCode) {
    imapAuthCode = await promptSecret('163 enterprise authorization code: ');
  }

  if (!imapAuthCode) {
    throw new Error('Missing required option: --auth-code <163_authorization_code>');
  }

  if (!smtpAuthCode) {
    smtpAuthCode = imapAuthCode;
  }

  return {
    imapAuthCode,
    smtpAuthCode,
  };
}

async function inspectConfiguration(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const envPath = deps.envPath || SKILL_ENV_PATH;
  const skillEnv = deps.skillEnv || loadSkillEnv(envPath);
  const loadStoredSecrets = deps.loadStoredSecrets || getStoredEmailSecrets;
  const probeImap = deps.probeImap || (async ({ env: probeEnv, skillEnv: probeSkillEnv }) => listMailboxes({ env: probeEnv, skillEnv: probeSkillEnv }));
  const probeSmtp = deps.probeSmtp || (async ({ env: probeEnv, skillEnv: probeSkillEnv }) => verifyConnection({ env: probeEnv, skillEnv: probeSkillEnv }));

  const summary = inspectResolvedConfig({
    env,
    skillEnv,
    provider: options.provider,
    email: options.email,
  });

  let storedSecrets = {};
  let managementApiAvailable = true;

  try {
    storedSecrets = await loadStoredSecrets(env);
  } catch {
    storedSecrets = {};
    managementApiAvailable = false;
  }

  const hasImapSecret = Boolean(env.IMAP_PASS || storedSecrets.imapPass);
  const hasSmtpSecret = Boolean(env.SMTP_PASS || storedSecrets.smtpPass);
  const missing = [...summary.missing];

  if (!hasImapSecret) {
    missing.push('IMAP_PASS');
  }
  if (!hasSmtpSecret) {
    missing.push('SMTP_PASS');
  }

  const result = {
    success: true,
    status: missing.length === 0 ? 'ready' : (summary.missing.length > 0 ? 'needs-config' : 'needs-secret'),
    provider: summary.providerKey || null,
    email: summary.email || summary.imap.user || summary.smtp.user || null,
    mailbox: summary.imap.mailbox,
    managementApiAvailable,
    hasImapSecret,
    hasSmtpSecret,
    missing,
    config: {
      imap: summary.imap,
      smtp: summary.smtp,
    },
    nextAction: missing.length === 0
      ? 'Run the mail action directly, such as checking unread mail or sending mail.'
      : `${buildCps163Hint()} ${buildConfigureHint({
          provider: summary.providerKey || 'cps-163-enterprise',
          email: summary.email || 'your.name@convenientpower.com',
        })}`,
  };

  if (toFlagBoolean(options.probe) && missing.length === 0) {
    const probeEnv = {
      ...env,
      IMAP_PASS: env.IMAP_PASS || storedSecrets.imapPass,
      SMTP_PASS: env.SMTP_PASS || storedSecrets.smtpPass,
    };

    result.probe = {
      imap: { success: false },
      smtp: { success: false },
    };

    try {
      const mailboxes = await probeImap({ env: probeEnv, skillEnv });
      result.probe.imap = {
        success: true,
        mailboxCount: Array.isArray(mailboxes) ? mailboxes.length : undefined,
      };
    } catch (error) {
      result.probe.imap = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const smtpResult = await probeSmtp({ env: probeEnv, skillEnv });
      result.probe.smtp = {
        success: true,
        message: smtpResult?.message || 'SMTP verification successful',
      };
    } catch (error) {
      result.probe.smtp = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return result;
}

async function applyConfiguration(options = {}, deps = {}) {
  const env = deps.env || process.env;
  const envPath = deps.envPath || SKILL_ENV_PATH;
  const readEnv = deps.loadSkillEnv || loadSkillEnv;
  const persistEnv = deps.writeSkillEnv || writeSkillEnv;
  const storeSecrets = deps.setStoredEmailSecrets || setStoredEmailSecrets;

  const email = String(options.email || '').trim();
  if (!email) {
    throw new Error('Missing required option: --email <full_mailbox_address>');
  }

  const mailbox = String(options.mailbox || 'INBOX').trim() || 'INBOX';
  const providerContext = resolveProviderContext({
    env: {},
    skillEnv: {},
    provider: options.provider,
    email,
  });

  if (!providerContext.preset) {
    throw new Error(
      `Unable to infer an email provider for ${email}. Use --provider, for example: ${buildConfigureHint({ email })}`
    );
  }

  const { imapAuthCode, smtpAuthCode } = await resolveAuthCodes(options);
  const existingSkillEnv = readEnv(envPath);
  const nextSkillEnv = {
    ...(existingSkillEnv.EMAIL_SKILL_DEBUG ? { EMAIL_SKILL_DEBUG: existingSkillEnv.EMAIL_SKILL_DEBUG } : {}),
    EMAIL_PROVIDER: providerContext.providerKey,
    IMAP_HOST: providerContext.preset.imap.host,
    IMAP_PORT: String(providerContext.preset.imap.port),
    IMAP_USER: email,
    IMAP_TLS: String(providerContext.preset.imap.tls),
    IMAP_REJECT_UNAUTHORIZED: 'true',
    IMAP_MAILBOX: mailbox,
    SMTP_HOST: providerContext.preset.smtp.host,
    SMTP_PORT: String(providerContext.preset.smtp.port),
    SMTP_SECURE: String(providerContext.preset.smtp.secure),
    SMTP_USER: email,
    SMTP_FROM: email,
    SMTP_REJECT_UNAUTHORIZED: 'true',
  };

  persistEnv(nextSkillEnv, envPath);
  await storeSecrets(env, {
    imapPass: imapAuthCode,
    smtpPass: smtpAuthCode,
  });

  const result = {
    success: true,
    provider: providerContext.providerKey,
    email,
    mailbox,
    envPath,
  };

  if (toFlagBoolean(options.check)) {
    result.diagnostics = await inspectConfiguration(
      {
        provider: providerContext.providerKey,
        email,
        probe: true,
      },
      {
        env: {
          ...env,
          IMAP_PASS: imapAuthCode,
          SMTP_PASS: smtpAuthCode,
        },
        envPath,
        skillEnv: nextSkillEnv,
        loadStoredSecrets: async () => ({
          imapPass: imapAuthCode,
          smtpPass: smtpAuthCode,
        }),
      }
    );
  }

  return result;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  try {
    let result;

    switch (command) {
      case 'apply':
        result = await applyConfiguration(options);
        break;

      case 'doctor':
        result = await inspectConfiguration(options);
        break;

      default:
        console.error('Unknown command:', command);
        console.error('Available commands: apply, doctor');
        console.error('\nUsage:');
        console.error('  bun --no-env-file --bun scripts/configure.js apply --provider cps-163-enterprise --email your.name@convenientpower.com --auth-code <163_authorization_code> [--mailbox INBOX] [--check]');
        console.error('  bun --no-env-file --bun scripts/configure.js doctor [--probe]');
        console.error('  node scripts/configure.js apply ...  # fallback if Bun is unavailable');
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (isEmailSkillError(error)) {
      console.error('Error:', formatEmailSkillError(error));
    } else {
      console.error('Error:', error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  applyConfiguration,
  inspectConfiguration,
};
