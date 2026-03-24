const http = require('node:http');

const MANAGEMENT_API_UNAVAILABLE_MESSAGE =
  'MyAgents management API is not available. Run this skill inside MyAgents after signing in to CPS.';

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

function buildQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.page != null) {
    searchParams.set('page', String(params.page));
  }

  if (params.pageSize != null) {
    searchParams.set('page_size', String(params.pageSize));
  }

  if (params.name) {
    searchParams.set('name', String(params.name));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

function requestJson(env, method, requestPath, body) {
  const { host, port, token } = getManagementConfig(env);

  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const request = http.request(
      {
        host,
        port,
        path: requestPath,
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (response) => {
        const chunks = [];

        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const rawText = Buffer.concat(chunks).toString('utf8');
          let json;

          try {
            json = rawText ? JSON.parse(rawText) : {};
          } catch (error) {
            reject(new Error(`Invalid JSON response from MyAgents management API: ${error.message}`));
            return;
          }

          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(json.error || `MyAgents management API request failed with status ${response.statusCode}.`));
            return;
          }

          if (json.ok === false) {
            reject(new Error(json.error || 'MyAgents management API request failed.'));
            return;
          }

          resolve(json);
        });
      },
    );

    request.on('error', (error) => {
      reject(new Error(`Failed to reach MyAgents management API: ${error.message}`));
    });

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

async function getCpsAuthStatus(env = process.env) {
  return requestJson(env, 'GET', '/api/cps/auth/status');
}

async function listRagflowDatasets(env = process.env, options = {}) {
  const queryString = buildQueryString(options);
  return requestJson(env, 'GET', `/api/cps/ragflow/datasets${queryString}`);
}

async function queryRagflowRetrieval(env = process.env, body) {
  return requestJson(env, 'POST', '/api/cps/ragflow/retrieval', body);
}

module.exports = {
  MANAGEMENT_API_UNAVAILABLE_MESSAGE,
  getManagementConfig,
  getCpsAuthStatus,
  listRagflowDatasets,
  queryRagflowRetrieval,
};
