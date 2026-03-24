#!/usr/bin/env node

/**
 * SMTP Email CLI
 * Send email via SMTP protocol. Works with Gmail, Outlook, 163.com, and any standard SMTP server.
 * Supports attachments, HTML content, and multiple recipients.
 */

const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');
const { parseArgs } = require('../lib/parse-args');
const { prepareSmtpContent } = require('../lib/prepare-smtp-content');
const {
  loadSkillEnv,
  getDebugEnabled,
  createSmtpConfig,
} = require('../lib/email-config');
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

async function loadSmtpRuntimeConfig({ env = process.env, skillEnv = SKILL_ENV } = {}) {
  const config = await createSmtpConfig({
    env,
    skillEnv,
  });

  debug(
    `[smtp-debug] Config: host=${config.host}, port=${config.port}, secure=${config.secure}, rejectUnauthorized=${config.tls.rejectUnauthorized}, hasUser=${!!config.auth.user}, hasPassword=${!!config.auth.pass}`
  );

  return config;
}

async function createTransporter(runtime = {}) {
  const config = await loadSmtpRuntimeConfig(runtime);
  return {
    transporter: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
      tls: config.tls,
    }),
    config,
  };
}

function closeTransporter(transporter) {
  if (!transporter || typeof transporter.close !== 'function') {
    return;
  }

  try {
    transporter.close();
  } catch (error) {
    debug('[smtp-debug] Failed to close transporter:', error instanceof Error ? error.message : String(error));
  }
}

async function verifyTransport(transporter) {
  try {
    await transporter.verify();
    debug('[smtp-debug] SMTP verification succeeded');
  } catch (error) {
    debug(
      '[smtp-debug] SMTP verify failed:',
      error instanceof Error ? error.message : String(error),
      'code:',
      error && typeof error === 'object' ? error.code : undefined,
      'responseCode:',
      error && typeof error === 'object' ? error.responseCode : undefined
    );
    throw normalizeRuntimeEmailError(error, { protocol: 'smtp' });
  }
}

async function sendEmail(options, runtime = {}) {
  const { transporter, config } = await createTransporter(runtime);

  try {
    await verifyTransport(transporter);

    const mailOptions = {
      from: options.from || config.from || config.auth.user,
      to: options.to,
      cc: options.cc || undefined,
      bcc: options.bcc || undefined,
      subject: options.subject || '(no subject)',
      text: options.text || undefined,
      html: options.html || undefined,
      attachments: options.attachments || [],
    };

    if (!mailOptions.text && !mailOptions.html) {
      mailOptions.text = options.body || '';
    }

    const info = await transporter.sendMail(mailOptions);

    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
      to: mailOptions.to,
    };
  } catch (error) {
    throw normalizeRuntimeEmailError(error, { protocol: 'smtp' });
  } finally {
    closeTransporter(transporter);
  }
}

function readAttachment(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Attachment file not found: ${filePath}`);
  }

  return {
    filename: path.basename(filePath),
    path: path.resolve(filePath),
  };
}

async function sendEmailWithContent(options, runtime = {}) {
  const preparedOptions = { ...options };

  if (preparedOptions.attach) {
    const attachFiles = preparedOptions.attach.split(',').map((file) => file.trim());
    preparedOptions.attachments = attachFiles.map((file) => readAttachment(file));
  }

  return sendEmail(preparedOptions, runtime);
}

async function testConnection(runtime = {}) {
  const { transporter, config } = await createTransporter(runtime);

  try {
    await verifyTransport(transporter);
    const info = await transporter.sendMail({
      from: config.from || config.auth.user,
      to: config.auth.user,
      subject: 'SMTP Connection Test',
      text: 'This is a test email from the IMAP/SMTP email skill.',
      html: '<p>This is a <strong>test email</strong> from the IMAP/SMTP email skill.</p>',
    });

    return {
      success: true,
      message: 'SMTP connection successful',
      messageId: info.messageId,
    };
  } catch (error) {
    throw normalizeRuntimeEmailError(error, { protocol: 'smtp' });
  } finally {
    closeTransporter(transporter);
  }
}

async function verifyConnection(runtime = {}) {
  const { transporter } = await createTransporter(runtime);

  try {
    debug('[smtp-debug] Verifying SMTP connection...');
    await verifyTransport(transporter);
    return {
      success: true,
      message: 'SMTP verification successful',
    };
  } finally {
    closeTransporter(transporter);
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { command } = parsed;
  let { options } = parsed;

  try {
    let result;

    switch (command) {
      case 'send':
        if (!options.to) {
          throw new Error('Missing required option: --to <email>');
        }
        if (!options.subject && !options['subject-file']) {
          throw new Error('Missing required option: --subject <text> or --subject-file <file>');
        }

        if (options['subject-file']) {
          options.subject = fs.readFileSync(options['subject-file'], 'utf8').trim();
        }

        if (options['body-file']) {
          const content = fs.readFileSync(options['body-file'], 'utf8');
          if (options['body-file'].endsWith('.html') || options.html) {
            options.html = content;
          } else {
            options.text = content;
          }
        } else if (options['html-file']) {
          options.html = fs.readFileSync(options['html-file'], 'utf8');
        }

        options = prepareSmtpContent(options);
        result = await sendEmailWithContent(options);
        break;

      case 'test':
        result = await testConnection();
        break;

      case 'verify':
        result = await verifyConnection();
        break;

      default:
        console.error('Unknown command:', command);
        console.error('Available commands: send, test, verify');
        console.error('\nUsage:');
        console.error('  bun --no-env-file --bun scripts/smtp.js send --to <email> --subject <text> [--body <text>] [--html] [--cc <email>] [--bcc <email>] [--attach <file>]');
        console.error('  bun --no-env-file --bun scripts/smtp.js send --to <email> --subject <text> --body-file <file> [--html-file <file>] [--attach <file>]');
        console.error('  bun --no-env-file --bun scripts/smtp.js test');
        console.error('  bun --no-env-file --bun scripts/smtp.js verify');
        console.error('  node scripts/smtp.js verify  # fallback if Bun is unavailable');
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const normalized = isEmailSkillError(error)
      ? error
      : normalizeRuntimeEmailError(error, { protocol: 'smtp' });
    console.error('Error:', isEmailSkillError(normalized) ? formatEmailSkillError(normalized) : normalized.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  loadSmtpRuntimeConfig,
  createTransporter,
  sendEmail,
  sendEmailWithContent,
  testConnection,
  verifyConnection,
};
