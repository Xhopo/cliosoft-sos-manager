const {
  executeAsk,
  executeEditBuild,
  executeVerifyBuild,
  getStatus,
} = require('../lib/remote-keil-client.js');

const BUN_RUNTIME_PREFIX = 'bun --no-env-file --bun';
const NODE_RUNTIME_PREFIX = 'node';

function parseArgs(argv) {
  const positionals = [];
  const flags = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const next = argv[index + 1];
    if (next == null || next.startsWith('--')) {
      flags.set(token, [...(flags.get(token) || []), true]);
      continue;
    }

    flags.set(token, [...(flags.get(token) || []), next]);
    index += 1;
  }

  return { positionals, flags };
}

function getFlag(flags, name, fallback = undefined) {
  const values = flags.get(name);
  if (!values || values.length === 0) {
    return fallback;
  }

  return values[values.length - 1];
}

function getBooleanFlag(flags, name, fallback = false) {
  const values = flags.get(name);
  if (!values || values.length === 0) {
    return fallback;
  }

  return true;
}

function validateWorkspace(workspace) {
  if (!workspace || !String(workspace).trim()) {
    throw new Error('--workspace is required.');
  }
}

function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function usage() {
  return [
    'Usage:',
    `  ${BUN_RUNTIME_PREFIX} scripts/cps-remote-keil.js status [--json]`,
    `  ${BUN_RUNTIME_PREFIX} scripts/cps-remote-keil.js ask --question "..." --workspace <workspace|auto> [--strict-codex] [--json]`,
    `  ${BUN_RUNTIME_PREFIX} scripts/cps-remote-keil.js edit_build --request "..." --workspace <workspace> [--project-file PATH] [--no-build] [--clean] [--force-codex] [--download-dir DIR] [--json]`,
    `  ${BUN_RUNTIME_PREFIX} scripts/cps-remote-keil.js verify --workspace <workspace> [--request "..."] [--marker TEXT] [--download-dir DIR] [--json]`,
    '',
    'Fallback when Bun is unavailable:',
    `  ${NODE_RUNTIME_PREFIX} scripts/cps-remote-keil.js status [--json]`,
    `  ${NODE_RUNTIME_PREFIX} scripts/cps-remote-keil.js ask --question "..." --workspace <workspace|auto> [--strict-codex] [--json]`,
    `  ${NODE_RUNTIME_PREFIX} scripts/cps-remote-keil.js edit_build --request "..." --workspace <workspace> [--project-file PATH] [--no-build] [--clean] [--force-codex] [--download-dir DIR] [--json]`,
    `  ${NODE_RUNTIME_PREFIX} scripts/cps-remote-keil.js verify --workspace <workspace> [--request "..."] [--marker TEXT] [--download-dir DIR] [--json]`,
    '',
    'Commands:',
    '  status       检查 CPS 认证状态',
    '  ask          代码问答，读取远程代码并回答问题',
    '  edit_build   修改代码并构建，自动下载 HEX 文件',
    '  verify       做一次最小安全改动并验证本地 HEX 已下载',
    '',
    'Options:',
    '  --question       [ask] 问题文本',
    '  --request        [edit_build] 修改请求（自然语言）',
    '  --workspace      工作区编号；ask 模式允许 auto',
    '  --strict-codex   [ask] 禁用兜底',
    '  --project-file   [edit_build] 项目文件路径（可选）',
    '  --no-build       [edit_build] 不运行构建',
    '  --clean          [edit_build] 清理构建',
    '  --force-codex    [edit_build] 强制 Codex',
    '  --download-dir   [edit_build] HEX 下载目录（默认当前目录）',
    '  --marker         [verify] 验证注释标记文本（可选）',
    '  --json           输出 JSON 格式',
    '',
    'Environment (provided by MyAgents):',
    '  MYAGENTS_MANAGEMENT_PORT   Management API port',
    '  MYAGENTS_MANAGEMENT_TOKEN  Management API token',
  ].join('\n');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const { positionals, flags } = parseArgs(argv);
  const command = positionals[0];
  const asJson = getBooleanFlag(flags, '--json', false);

  if (!command) {
    throw new Error(usage());
  }

  switch (command) {
    case 'status': {
      printResult(await getStatus(env), asJson);
      return;
    }

    case 'ask': {
      const question = getFlag(flags, '--question');
      const workspace = getFlag(flags, '--workspace');
      const strictCodex = getBooleanFlag(flags, '--strict-codex', false);

      if (!question) {
        throw new Error('--question is required for ask command');
      }

      validateWorkspace(workspace);

      printResult(
        await executeAsk(env, {
          question,
          workspace,
          strict_codex: strictCodex,
        }),
        asJson
      );
      return;
    }

    case 'edit_build': {
      const request = getFlag(flags, '--request');
      const workspace = getFlag(flags, '--workspace');
      const projectFile = getFlag(flags, '--project-file');
      const runBuild = !getBooleanFlag(flags, '--no-build', false);
      const clean = getBooleanFlag(flags, '--clean', false);
      const forceCodex = getBooleanFlag(flags, '--force-codex', false);
      const downloadDir = getFlag(flags, '--download-dir');

      if (!request) {
        throw new Error('--request is required for edit_build command');
      }

      validateWorkspace(workspace);

      if (workspace === 'auto') {
        throw new Error(
          'edit_build mode requires a specific workspace (8610 or 4050), not "auto"'
        );
      }

      printResult(
        await executeEditBuild(env, {
          request,
          workspace,
          project_file: projectFile,
          run_build: runBuild,
          clean,
          force_codex: forceCodex,
          codex_full_access: true,
          download_dir: downloadDir,
        }),
        asJson
      );
      return;
    }

    case 'verify': {
      const workspace = getFlag(flags, '--workspace');
      const request = getFlag(flags, '--request');
      const marker = getFlag(flags, '--marker');
      const downloadDir = getFlag(flags, '--download-dir');

      validateWorkspace(workspace);

      if (workspace === 'auto') {
        throw new Error(
          'verify mode requires a specific workspace (8610 or 4050), not "auto"'
        );
      }

      printResult(
        await executeVerifyBuild(env, {
          workspace,
          request,
          marker,
          codex_full_access: true,
          download_dir: downloadDir,
        }),
        asJson
      );
      return;
    }

    default:
      throw new Error(`Unknown command "${command}".\n\n${usage()}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
};
