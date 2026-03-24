const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  getManagementConfig,
  getStoredEmailSecrets,
  clearStoredEmailSecrets,
} = require('../lib/email-credentials-client');

test('getManagementConfig rejects when the management API env is unavailable', () => {
  assert.throws(
    () => getManagementConfig({}),
    /MyAgents management API is not available/
  );
});

test('getStoredEmailSecrets sends bearer auth to the local management API', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        imapPass: 'imap-secret',
        smtpPass: 'smtp-secret',
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const secrets = await getStoredEmailSecrets({
      MYAGENTS_MANAGEMENT_PORT: String(port),
      MYAGENTS_EMAIL_SECRET_TOKEN: 'secret-token',
    });

    assert.deepEqual(secrets, {
      imapPass: 'imap-secret',
      smtpPass: 'smtp-secret',
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/email/credentials/get');
    assert.equal(requests[0].authorization, 'Bearer secret-token');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('getStoredEmailSecrets accepts MYAGENTS_MANAGEMENT_TOKEN as the bearer token source', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      requests.push(req.headers.authorization);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        imapPass: 'imap-secret',
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    await getStoredEmailSecrets({
      MYAGENTS_MANAGEMENT_PORT: String(port),
      MYAGENTS_MANAGEMENT_TOKEN: 'management-token',
    });

    assert.deepEqual(requests, ['Bearer management-token']);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('clearStoredEmailSecrets sends the requested targets', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    await clearStoredEmailSecrets(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_EMAIL_SECRET_TOKEN: 'secret-token',
      },
      ['smtp']
    );

    assert.deepEqual(requests, [{ targets: ['smtp'] }]);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
