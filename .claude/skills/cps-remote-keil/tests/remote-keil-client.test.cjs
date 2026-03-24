const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { executeEditBuild, executeVerifyBuild } = require('../lib/remote-keil-client.js');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

test('executeEditBuild sends strict_codex=false for natural-language edit requests', async () => {
  let createBody = null;

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/cps/remote_keil/jobs/edit_build') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        createBody = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, job_id: 'job-1' }));
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/cps/remote_keil/jobs/job-1/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        'data: {"type":"final","response":{"request_id":"req-1","build":{"success":true,"elapsed_sec":1,"output_files":{}}}}\n\n',
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    await executeEditBuild(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        request: '不改逻辑，只重新构建当前工程并导出 HEX。',
        workspace: '8610',
      },
    );

    assert.equal(createBody.strict_codex, false);
  } finally {
    await close(server);
  }
});

test('executeEditBuild treats final detail.error as a failure', async () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/cps/remote_keil/jobs/edit_build') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, job_id: 'job-2' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/cps/remote_keil/jobs/job-2/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        'data: {"type":"final","response":{"detail":{"error":"strict_codex=true requires a structured request (File/Replace/With). For natural language input, set strict_codex=false."},"notes":["workspace reset by git reset --hard after job"]}}\n\n',
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    const result = await executeEditBuild(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        request: '不改逻辑，只重新构建当前工程并导出 HEX。',
        workspace: '8610',
      },
    );

    assert.equal(result.success, false);
    assert.match(result.error, /strict_codex=true requires a structured request/);
  } finally {
    await close(server);
  }
});

test('executeEditBuild downloads the generated hex to a local path', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cps-remote-keil-'));
  const hexContent = '001122AABBCC';

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/cps/remote_keil/jobs/edit_build') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, job_id: 'job-3' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/cps/remote_keil/jobs/job-3/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        'data: {"type":"final","response":{"request_id":"req-3","edit_source":"codex","codex_ok":true,"codex_summary":"done","changed_files":[{"path":"code/main/main.c","diff":"stub"}],"build":{"success":true,"elapsed_sec":2,"output_files":{"hex_copied_to":"C:\\\\remote\\\\output\\\\verify.hex","hex_crc32":"0x12345678"}}}}\n\n',
      );
      return;
    }

    if (req.method === 'GET' && req.url === '/api/cps/remote_keil/output/download/verify.hex') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(hexContent);
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    const result = await executeEditBuild(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        request: '加一行注释然后构建。',
        workspace: '8610',
        download_dir: tmpDir,
      },
    );

    assert.equal(result.success, true);
    assert.equal(result.hex_crc32, '0x12345678');
    assert.equal(fs.existsSync(result.hex_local_path), true);
    assert.equal(fs.readFileSync(result.hex_local_path, 'utf8'), hexContent);
  } finally {
    await close(server);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('executeVerifyBuild fails when no local hex file is produced', async () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/cps/remote_keil/jobs/edit_build') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, job_id: 'job-4' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/cps/remote_keil/jobs/job-4/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(
        'data: {"type":"final","response":{"request_id":"req-4","edit_source":"codex","codex_ok":true,"codex_summary":"done","changed_files":[{"path":"code/main/main.c","diff":"stub"}],"build":{"success":true,"elapsed_sec":2,"output_files":{}}}}\n\n',
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await listen(server);
  const port = server.address().port;

  try {
    const result = await executeVerifyBuild(
      {
        MYAGENTS_MANAGEMENT_PORT: String(port),
        MYAGENTS_MANAGEMENT_TOKEN: 'secret-token',
      },
      {
        workspace: '8610',
      },
    );

    assert.equal(result.success, false);
    assert.match(result.error, /HEX download did not produce a local file|build succeeded but no local hex file was produced/i);
  } finally {
    await close(server);
  }
});
