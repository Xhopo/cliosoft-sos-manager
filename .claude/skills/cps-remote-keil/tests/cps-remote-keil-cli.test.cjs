const test = require('node:test');
const assert = require('node:assert/strict');

const libPath = require.resolve('../lib/remote-keil-client.js');
const scriptPath = require.resolve('../scripts/cps-remote-keil.js');

function loadCliWithStubs(stubs) {
  const originalLibModule = require.cache[libPath];
  const originalScriptModule = require.cache[scriptPath];

  require.cache[libPath] = {
    id: libPath,
    filename: libPath,
    loaded: true,
    exports: {
      executeAsk: async () => ({ success: true }),
      executeEditBuild: async () => ({ success: true }),
      executeVerifyBuild: async () => ({ success: true }),
      getStatus: async () => ({ ok: true }),
      ...stubs,
    },
  };
  delete require.cache[scriptPath];

  const captured = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk, encoding, callback) => {
    captured.push(String(chunk));
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  };

  const restore = () => {
    process.stdout.write = originalWrite;

    if (originalLibModule) {
      require.cache[libPath] = originalLibModule;
    } else {
      delete require.cache[libPath];
    }

    if (originalScriptModule) {
      require.cache[scriptPath] = originalScriptModule;
    } else {
      delete require.cache[scriptPath];
    }
  };

  return {
    captured,
    main: require(scriptPath).main,
    restore,
  };
}

test('ask accepts four-digit CPS workspaces without CLI whitelist rejection', async () => {
  let askInput = null;
  const { main, restore } = loadCliWithStubs({
    executeAsk: async (_env, input) => {
      askInput = input;
      return { success: true, workspace: input.workspace };
    },
  });

  try {
    await main(['ask', '--question', 'boot entry?', '--workspace', '4041', '--json'], {});
    assert.equal(askInput.workspace, '4041');
  } finally {
    restore();
  }
});

test('edit_build still rejects auto workspace', async () => {
  const { main, restore } = loadCliWithStubs();

  try {
    await assert.rejects(
      () => main(['edit_build', '--request', 'rebuild', '--workspace', 'auto', '--json'], {}),
      /edit_build mode requires a specific workspace/
    );
  } finally {
    restore();
  }
});
