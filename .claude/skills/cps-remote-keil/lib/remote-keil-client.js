const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MANAGEMENT_API_UNAVAILABLE_MESSAGE =
  'MyAgents management API is not available. Run this skill inside MyAgents after signing in to CPS.';

function extractFilename(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return '';
  }

  return path.basename(filePath.replace(/\\/g, '/'));
}

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
            reject(
              new Error(
                `Invalid JSON response from MyAgents management API: ${error.message}`
              )
            );
            return;
          }

          if (response.statusCode && response.statusCode >= 400) {
            reject(
              new Error(
                json.error ||
                  `MyAgents management API request failed with status ${response.statusCode}.`
              )
            );
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

    request.on('error', (error) => {
      reject(new Error(`Failed to reach MyAgents management API: ${error.message}`));
    });

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

function streamRequest(env, requestPath, onEvent, body = null) {
  const { host, port, token } = getManagementConfig(env);

  return new Promise((resolve, reject) => {
    const payload = body == null ? null : JSON.stringify(body);
    const request = http.request(
      {
        host,
        port,
        path: requestPath,
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'text/event-stream',
          ...(payload
            ? {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            const rawText = Buffer.concat(chunks).toString('utf8');
            let errorMsg = `HTTP ${response.statusCode}`;
            try {
              const json = JSON.parse(rawText);
              errorMsg = json.error || errorMsg;
            } catch {
              // ignore invalid error payloads
            }
            reject(new Error(errorMsg));
          });
          return;
        }

        let buffer = '';
        response.on('data', (chunk) => {
          buffer += chunk.toString();
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const evt of events) {
            const dataLine = evt
              .split('\n')
              .find((line) => line.startsWith('data: '));
            if (!dataLine) {
              continue;
            }

            try {
              onEvent(JSON.parse(dataLine.slice(6)));
            } catch {
              // ignore malformed SSE payloads
            }
          }
        });

        response.on('end', () => resolve());
      }
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

function streamGetRequest(env, requestPath, onEvent) {
  const { host, port, token } = getManagementConfig(env);

  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host,
        port,
        path: requestPath,
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'text/event-stream',
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () => {
            const rawText = Buffer.concat(chunks).toString('utf8');
            let errorMsg = `HTTP ${response.statusCode}`;
            try {
              const json = JSON.parse(rawText);
              errorMsg = json.error || errorMsg;
            } catch {
              // ignore invalid error payloads
            }
            reject(new Error(errorMsg));
          });
          return;
        }

        let buffer = '';
        response.on('data', (chunk) => {
          buffer += chunk.toString();
          const events = buffer.split('\n\n');
          buffer = events.pop() || '';

          for (const evt of events) {
            const dataLine = evt
              .split('\n')
              .find((line) => line.startsWith('data: '));
            if (!dataLine) {
              continue;
            }

            try {
              onEvent(JSON.parse(dataLine.slice(6)));
            } catch {
              // ignore malformed SSE payloads
            }
          }
        });

        response.on('end', () => resolve());
      }
    );

    request.on('error', (error) => {
      reject(new Error(`Failed to reach MyAgents management API: ${error.message}`));
    });

    request.end();
  });
}

async function downloadHex(env, filename, downloadDir) {
  const { host, port, token } = getManagementConfig(env);
  const targetDir = downloadDir || process.cwd();

  fs.mkdirSync(targetDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const localPath = path.join(targetDir, filename);
    const request = http.request(
      {
        host,
        port,
        path: `/api/cps/remote_keil/output/download/${encodeURIComponent(filename)}`,
        method: 'GET',
        headers: {
          authorization: `Bearer ${token}`,
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(new Error(`Download failed: HTTP ${response.statusCode}`));
          return;
        }

        const file = fs.createWriteStream(localPath);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(localPath);
        });
        file.on('error', (error) => {
          fs.unlink(localPath, () => {});
          reject(error);
        });
      }
    );

    request.on('error', reject);
    request.end();
  });
}

async function executeAsk(env, input) {
  const result = {
    success: false,
    summary: undefined,
    final_answer: undefined,
    steps: [],
    evidence: [],
    uncertain: false,
    quality_issues: [],
    answer_source: undefined,
    request_id: undefined,
    elapsed_ms: undefined,
    error: undefined,
  };

  const dedupePush = (arr, value) => {
    if (value?.trim() && !arr.includes(value)) {
      arr.push(value);
    }
  };

  const mergeEvidence = (entry) => {
    if (!entry?.file || !entry?.line_range) {
      return;
    }

    const key = `${entry.file}:${entry.line_range}`;
    const existing = result.evidence.find(
      (item) => `${item.file}:${item.line_range}` === key
    );

    if (existing) {
      if (!existing.snippet && entry.snippet) {
        existing.snippet = entry.snippet;
      }
      if (!existing.why_relevant && entry.why_relevant) {
        existing.why_relevant = entry.why_relevant;
      }
      return;
    }

    result.evidence.push(entry);
  };

  const mergeParsed = (next) => {
    if (!next) {
      return;
    }

    const summary = String(next.summary || '').trim();
    if (summary) {
      result.summary = result.summary ? `${result.summary}\n\n${summary}` : summary;
    }

    const finalAnswer = String(next.final_answer || '').trim();
    if (finalAnswer) {
      result.final_answer = finalAnswer;
    }

    (next.steps || []).forEach((value) => dedupePush(result.steps, value));
    (next.evidence || []).forEach(mergeEvidence);

    if (typeof next.uncertain === 'boolean') {
      result.uncertain ||= next.uncertain;
    }

    (next.quality_issues || []).forEach((value) =>
      dedupePush(result.quality_issues, value)
    );

    if (next.answer_source) {
      result.answer_source = String(next.answer_source);
    }
  };

  try {
    const workspace = input.workspace === 'auto' ? undefined : input.workspace;
    const chip = workspace || '8610';
    const payload = {
      question: input.question,
      workspace,
      chip,
      include_snippet: true,
      strict_codex: input.strict_codex || false,
    };

    await streamRequest(
      env,
      '/api/cps/remote_keil/ask/stream',
      (data) => {
        if (data.type === 'status') {
          const seconds = Math.floor((data.elapsed_ms || 0) / 1000);
          process.stderr.write(
            `[CPS] ${data.message}${seconds ? ` (${seconds}s)` : ''}\n`
          );
          return;
        }

        if (data.type === 'chunk') {
          try {
            const parsed = JSON.parse(data.text);
            if (parsed.summary) {
              mergeParsed(parsed);
            }
          } catch {
            // ignore chunk text that is not JSON
          }
          return;
        }

        if (data.type === 'final') {
          result.elapsed_ms = data.elapsed_ms;
          result.request_id = data.request_id;

          if (data.parsed_json) {
            mergeParsed(data.parsed_json);
          } else if (data.codex_last_message) {
            result.final_answer = data.codex_last_message;
          }
          return;
        }

        if (data.type === 'error') {
          result.error = data.message;
        }
      },
      payload
    );

    if (result.error) {
      return result;
    }

    result.success = true;
    result.steps = result.steps.length > 0 ? result.steps : undefined;
    result.evidence = result.evidence.length > 0 ? result.evidence : undefined;
    result.quality_issues =
      result.quality_issues.length > 0 ? result.quality_issues : undefined;
    return result;
  } catch (error) {
    result.error = String(error);
    return result;
  }
}

async function executeEditBuild(env, input) {
  const result = {
    success: false,
    request_id: undefined,
    job_id: undefined,
    edit_source: undefined,
    codex_ok: undefined,
    codex_summary: undefined,
    notes: undefined,
    changed_files: undefined,
    build: undefined,
    hex_local_path: undefined,
    hex_crc32: undefined,
    error: undefined,
  };

  let hexDownloadPromise = null;

  try {
    const conversationId = `conv_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2, 8)}`;

    const payload = {
      request: input.request,
      conversation_id: conversationId,
      workspace: input.workspace,
      run_build: input.run_build ?? true,
      clean: input.clean ?? false,
      strict_codex: input.strict_codex ?? false,
      force_codex: input.force_codex ?? false,
      codex_full_access: input.codex_full_access ?? true,
    };

    if (input.project_file) {
      payload.project_file = input.project_file;
    }

    process.stderr.write(`[CPS] Creating edit_build job for ${input.workspace}...\n`);

    const createResp = await requestJson(
      env,
      'POST',
      '/api/cps/remote_keil/jobs/edit_build',
      payload
    );

    const jobId = createResp?.job_id;
    if (!jobId) {
      result.error = '未返回 job_id';
      return result;
    }

    result.job_id = jobId;
    process.stderr.write(`[CPS] Job: ${jobId}\n`);

    await streamGetRequest(
      env,
      `/api/cps/remote_keil/jobs/${encodeURIComponent(jobId)}/stream`,
      (data) => {
        if (data.type === 'request') {
          process.stderr.write(`[CPS] Request: ${data.request_id}\n`);
          return;
        }

        if (data.type === 'status') {
          const queueSuffix =
            data.queue_position !== undefined ? ` (queue: ${data.queue_position})` : '';
          process.stderr.write(`[CPS] ${data.message}${queueSuffix}\n`);
          return;
        }

        if (data.type === 'error') {
          result.error = data.detail?.error || 'Unknown error';
          return;
        }

        if (data.type !== 'final') {
          return;
        }

        const response = data.response || {};
        const finalDetailError = response.detail?.error;
        if (finalDetailError) {
          result.success = false;
          result.request_id = response.detail?.request_id;
          result.error = finalDetailError;
          result.notes = response.notes;
          process.stderr.write(`[CPS] Edit build failed: ${finalDetailError}\n`);
          return;
        }

        const hexRemotePath = response.build?.output_files?.hex_copied_to;
        const hexCrc32 = response.build?.output_files?.hex_crc32;

        result.success = true;
        result.request_id = response.request_id;
        result.edit_source = response.edit_source;
        result.codex_ok = response.codex_ok;
        result.codex_summary = response.codex_summary;
        result.notes = response.notes;
        result.changed_files = response.changed_files;
        result.build = response.build;
        result.hex_crc32 = hexCrc32;

        if (response.changed_files?.length > 0) {
          process.stderr.write(`[CPS] Changed ${response.changed_files.length} file(s)\n`);
        }

        if (response.build?.success) {
          process.stderr.write(`[CPS] Build succeeded (${response.build.elapsed_sec}s)\n`);
        } else if (response.build) {
          process.stderr.write(`[CPS] Build failed: ${response.build.error}\n`);
        }

        if (hexRemotePath && response.build?.success) {
          const filename = extractFilename(hexRemotePath) || 'output.hex';
          hexDownloadPromise = downloadHex(env, filename, input.download_dir)
            .then((localPath) => {
              result.hex_local_path = localPath;
              process.stderr.write(`[CPS] HEX saved to: ${localPath}\n`);
            })
            .catch((error) => {
              const message = String(error);
              result.error = result.error || message;
              process.stderr.write(`[CPS] HEX download failed: ${message}\n`);
            });
        }
      }
    );

    if (hexDownloadPromise) {
      await hexDownloadPromise;
    }

    return result;
  } catch (error) {
    result.error = String(error);
    return result;
  }
}

function buildVerificationRequest(workspace, marker = null) {
  const suffix = marker || `codex remote keil verification ${Date.now()}`;
  return `在 ${workspace} 工程的 code/main/main.c 文件顶部增加一行注释 // ${suffix} ，其他逻辑不要改，然后构建并导出 HEX。`;
}

async function executeVerifyBuild(env, input) {
  const downloadDir = input.download_dir || path.join(process.cwd(), '.tmp-remote-keil');
  const request =
    input.request || buildVerificationRequest(input.workspace, input.marker);

  const result = await executeEditBuild(env, {
    ...input,
    request,
    run_build: true,
    strict_codex: false,
    codex_full_access: input.codex_full_access ?? true,
    download_dir: downloadDir,
  });

  if (!result.success) {
    return result;
  }

  if (!result.hex_local_path || !fs.existsSync(result.hex_local_path)) {
    return {
      ...result,
      success: false,
      error: result.error || 'Build succeeded but no local hex file was produced.',
    };
  }

  const stats = fs.statSync(result.hex_local_path);
  return {
    ...result,
    verification: {
      passed: true,
      local_hex_path: result.hex_local_path,
      local_hex_size: stats.size,
      request,
    },
  };
}

async function getStatus(env) {
  return requestJson(env, 'GET', '/api/cps/auth/status');
}

module.exports = {
  MANAGEMENT_API_UNAVAILABLE_MESSAGE,
  buildVerificationRequest,
  executeVerifyBuild,
  getManagementConfig,
  getStatus,
  executeAsk,
  executeEditBuild,
};
