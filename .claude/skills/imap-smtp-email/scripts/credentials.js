#!/usr/bin/env node

const readline = require('node:readline');

const { parseArgs } = require('../lib/parse-args');
const {
  setStoredEmailSecrets,
  clearStoredEmailSecrets,
} = require('../lib/email-credentials-client');

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

async function resolveSecrets(options) {
  let imapPass = options['imap-pass'];
  let smtpPass = options['smtp-pass'];

  if (!imapPass) {
    imapPass = await promptSecret('IMAP password / authorization code: ');
  }

  if (!smtpPass) {
    smtpPass = await promptSecret('SMTP password / authorization code (leave blank to reuse IMAP): ');
    if (!smtpPass) {
      smtpPass = imapPass;
    }
  }

  if (!imapPass && !smtpPass) {
    throw new Error('No credentials provided.');
  }

  return {
    ...(imapPass ? { imapPass } : {}),
    ...(smtpPass ? { smtpPass } : {}),
  };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  try {
    switch (command) {
      case 'set': {
        const secrets = await resolveSecrets(options);
        await setStoredEmailSecrets(process.env, secrets);
        console.log(JSON.stringify({
          success: true,
          stored: Object.keys(secrets),
        }, null, 2));
        return;
      }

      case 'clear': {
        const targets = [];
        if (options.imap) {
          targets.push('imap');
        }
        if (options.smtp) {
          targets.push('smtp');
        }

        await clearStoredEmailSecrets(process.env, targets);
        console.log(JSON.stringify({
          success: true,
          cleared: targets.length ? targets : ['imap', 'smtp'],
        }, null, 2));
        return;
      }

      default:
        console.error('Unknown command:', command);
        console.error('Available commands: set, clear');
        console.error('\nUsage:');
        console.error('  bun --no-env-file --bun scripts/credentials.js set [--imap-pass <secret>] [--smtp-pass <secret>]');
        console.error('  bun --no-env-file --bun scripts/credentials.js clear [--imap] [--smtp]');
        console.error('  node scripts/credentials.js set ...  # fallback if Bun is unavailable');
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveSecrets,
};
