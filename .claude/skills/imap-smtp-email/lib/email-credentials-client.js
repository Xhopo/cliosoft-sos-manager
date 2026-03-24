const http = require('node:http');

const MANAGEMENT_API_UNAVAILABLE_MESSAGE =
  'MyAgents management API is not available. Run "bun --no-env-file --bun scripts/credentials.js set" inside MyAgents, or set IMAP_PASS/SMTP_PASS in the current environment. If Bun is unavailable, fall back to "node scripts/credentials.js set".';

function getManagementConfig(env = process.env) {
  const rawPort = env.MYAGENTS_MANAGEMENT_PORT;
  const token = env.MYAGENTS_MANAGEMENT_TOKEN || env.MYAGENTS_EMAIL_SECRET_TOKEN;

  if (!rawPort || !token) {
    throw new Error(MANAGEMENT_API_UNAVAILABLE_MESSAGE);
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('MYAGENTS_MANAGEMENT_PORT must be a positive integer.');
  }

  return {
    host: '127.0.0.1',
    port,
    token,
  };
}

function postJson(env, requestPath, body) {
  const { host, port, token } = getManagementConfig(env);

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body ?? {});
    const req = http.request(
      {
        host,
        port,
        path: requestPath,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks = [];

        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const responseText = Buffer.concat(chunks).toString('utf8');
          let json;

          try {
            json = responseText ? JSON.parse(responseText) : {};
          } catch (error) {
            reject(new Error(`Invalid JSON response from MyAgents management API: ${error.message}`));
            return;
          }

          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(json.error || `MyAgents management API request failed with status ${res.statusCode}.`));
            return;
          }

          if (json.ok === false) {
            reject(new Error(json.error || 'MyAgents management API request failed.'));
            return;
          }

          resolve(json);
        });
      }
    );

    req.on('error', (error) => {
      reject(new Error(`Failed to reach MyAgents management API: ${error.message}`));
    });

    req.write(payload);
    req.end();
  });
}

async function getStoredEmailSecrets(env = process.env) {
  const json = await postJson(env, '/api/email/credentials/get', {});
  return {
    imapPass: json.imapPass || undefined,
    smtpPass: json.smtpPass || undefined,
  };
}

async function setStoredEmailSecrets(env = process.env, { imapPass, smtpPass } = {}) {
  if (!imapPass && !smtpPass) {
    throw new Error('At least one of imapPass or smtpPass must be provided.');
  }

  return postJson(env, '/api/email/credentials/set', {
    ...(imapPass ? { imapPass } : {}),
    ...(smtpPass ? { smtpPass } : {}),
  });
}

async function clearStoredEmailSecrets(env = process.env, targets = []) {
  return postJson(env, '/api/email/credentials/clear', {
    ...(targets.length ? { targets } : {}),
  });
}

module.exports = {
  MANAGEMENT_API_UNAVAILABLE_MESSAGE,
  getManagementConfig,
  getStoredEmailSecrets,
  setStoredEmailSecrets,
  clearStoredEmailSecrets,
};
