const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const skillRoot = path.resolve(__dirname, '..');
const bunPath = process.versions.bun ? process.execPath : 'bun';

function runBunScript(args) {
  return spawnSync(bunPath, ['--no-env-file', '--bun', ...args], {
    cwd: skillRoot,
    env: {
      ...process.env,
    },
    encoding: 'utf8',
  });
}

test('imap CLI setup errors are bun-first', () => {
  const result = runBunScript(['scripts/imap.js', 'check']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EMAIL_CONFIG_MISSING/);
  assert.match(result.stderr, /bun --no-env-file --bun scripts\/configure\.js apply/);
  assert.match(result.stderr, /node scripts\/configure\.js apply/);
  assert.ok(
    result.stderr.indexOf('bun --no-env-file --bun scripts/configure.js apply')
    < result.stderr.indexOf('node scripts/configure.js apply')
  );
});

test('smtp CLI usage is bun-first with node fallback', () => {
  const result = runBunScript(['scripts/smtp.js', 'unknown-command']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /bun --no-env-file --bun scripts\/smtp\.js send/);
  assert.match(result.stderr, /node scripts\/smtp\.js verify/);
});

test('credentials CLI usage is bun-first with node fallback', () => {
  const result = runBunScript(['scripts/credentials.js', 'unknown-command']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /bun --no-env-file --bun scripts\/credentials\.js set/);
  assert.match(result.stderr, /node scripts\/credentials\.js set/);
});
