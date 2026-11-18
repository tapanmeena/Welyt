import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const mobileDir = fileURLToPath(new URL('../', import.meta.url));

function resolveConfig(appVariant) {
  const env = { ...process.env };
  if (appVariant === undefined) delete env.APP_VARIANT;
  else env.APP_VARIANT = appVariant;
  return spawnSync(
    process.execPath,
    ['-e', 'console.log(JSON.stringify(require("expo/config").getConfig(process.cwd()).exp))'],
    { cwd: mobileDir, env, encoding: 'utf8' },
  );
}

async function updateEnvironment(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'welyt-eas-update-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, 'eas'),
    `#!/usr/bin/env node
console.log(JSON.stringify({
  args: process.argv.slice(2),
  appVariant: process.env.APP_VARIANT,
  cwd: process.cwd(),
}));
process.exitCode = Number(process.env.WELYT_TEST_EAS_EXIT_CODE ?? 0);
`,
    { mode: 0o755 },
  );
  return {
    ...process.env,
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    APP_VARIANT: 'development',
  };
}

function runUpdate(args, env) {
  return spawnSync(process.execPath, ['scripts/eas-update.mjs', ...args], {
    cwd: mobileDir,
    env,
    encoding: 'utf8',
  });
}

test('build variants resolve distinct names, native identifiers, and URL schemes', () => {
  for (const [variant, name, applicationId, scheme] of [
    ['development', 'Welyt Dev', 'com.tapanmeena.welyt.dev', 'welyt-dev'],
    ['preview', 'Welyt Preview', 'com.tapanmeena.welyt.preview', 'welyt-preview'],
    ['production', 'Welyt', 'com.tapanmeena.welyt', 'welyt'],
  ]) {
    const result = resolveConfig(variant);
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    assert.equal(config.name, name);
    assert.equal(config.android.package, applicationId);
    assert.equal(config.ios.bundleIdentifier, applicationId);
    assert.equal(config.scheme, scheme);
    const devClient = config.plugins.find((plugin) => plugin[0] === 'expo-dev-client');
    assert.equal(devClient[1].addGeneratedScheme, variant === 'development');
  }
});

test('local configuration defaults to development and rejects unknown variants', () => {
  const local = resolveConfig(undefined);
  assert.equal(local.status, 0, local.stderr);
  assert.equal(JSON.parse(local.stdout).android.package, 'com.tapanmeena.welyt.dev');
  const invalid = resolveConfig('unknown');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid APP_VARIANT/);
});

test('updates select the app variant from the environment and forward EAS arguments', async (t) => {
  const env = await updateEnvironment(t);
  for (const variant of ['preview', 'production']) {
    const args = [
      '--channel',
      variant,
      `--environment=${variant}`,
      '--platform',
      'android',
      '-m',
      'Keep spaces, quotes "and" $HOME literal',
    ];
    const result = runUpdate(args, env);
    assert.equal(result.status, 0, result.stderr);
    const invocation = JSON.parse(result.stdout);
    assert.equal(invocation.appVariant, variant);
    assert.equal(invocation.cwd, mobileDir.slice(0, -1));
    assert.deepEqual(invocation.args, ['update', ...args]);
  }
});

test('updates require an environment, retain help, and propagate EAS failures', async (t) => {
  const env = await updateEnvironment(t);
  const missing = runUpdate(['--channel', 'preview'], env);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Pass --environment/);
  const help = runUpdate(['--help'], env);
  assert.equal(help.status, 0, help.stderr);
  assert.deepEqual(JSON.parse(help.stdout).args, ['update', '--help']);
  const failed = runUpdate(['--environment', 'preview'], {
    ...env,
    WELYT_TEST_EAS_EXIT_CODE: '7',
  });
  assert.equal(failed.status, 7);
});
