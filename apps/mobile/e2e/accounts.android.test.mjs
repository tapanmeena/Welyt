import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { authSessionResponseSchema, indiaBusinessDate } from '@welyt/shared';
import { buildApp } from '../../api/src/app.ts';
import { loadApiEnv } from '../../api/src/config/env.ts';
import { createDatabase } from '../../api/src/db/client.ts';
import { fxRates } from '../../api/src/db/schema.ts';
import { MemoryMailer } from '../../api/src/lib/mailer.ts';
import { FRANKFURTER_SOURCE } from '../../api/src/modules/fx/frankfurter.provider.ts';
import { connectAndroid } from './android-device.mjs';

const mobileDir = fileURLToPath(new URL('../', import.meta.url));
const metroCli = path.join(
  path.dirname(createRequire(import.meta.url).resolve('expo/package.json')),
  'bin',
  'cli',
);
const fixtureName = 'Welyt Android Fixture';

async function fixtureApi(cleanup) {
  const database = createDatabase(':memory:');
  cleanup.push(database.close);
  const mailer = new MemoryMailer();
  const app = await buildApp({
    database,
    env: loadApiEnv({ NODE_ENV: 'test' }),
    logger: false,
    mailer,
  });
  cleanup.push(() => app.close());

  const credentials = {
    email: 'android.regression@example.test',
    password: `WelytTest${randomBytes(8).toString('hex')}1`,
  };
  const registration = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { ...credentials, name: fixtureName },
  });
  assert.equal(registration.statusCode, 201, 'Fixture registration failed');
  const { tokens } = authSessionResponseSchema.parse(registration.json());
  const code = mailer.verifications[0]?.code;
  assert.ok(code, 'Fixture verification code was not delivered');
  const verification = await app.inject({
    method: 'POST',
    url: '/auth/verify-email',
    headers: { authorization: `Bearer ${tokens.accessToken}` },
    payload: { code },
  });
  assert.equal(verification.statusCode, 200, 'Fixture email verification failed');

  const now = new Date();
  const rateOn = indiaBusinessDate(new Date(now.getTime() - 86_400_000));
  database.db
    .insert(fxRates)
    .values({
      id: randomUUID(),
      baseCurrencyCode: 'USD',
      quoteCurrencyCode: 'INR',
      rateOn,
      rateE8: 8_125_000_000,
      source: FRANKFURTER_SOURCE,
      fetchedAt: now.toISOString(),
      createdAt: now.toISOString(),
    })
    .run();

  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  return { credentials, rateOn, port: Number(new URL(origin).port) };
}

async function freePort() {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function startMetro(apiPort, cleanup) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const testId = randomBytes(8).toString('hex');
  // Keep the API on the USB reverse tunnel rather than triggering the Android emulator fallback.
  const apiUrl = `http://[::ffff:127.0.0.1]:${apiPort}`;
  const metro = spawn(
    process.execPath,
    [metroCli, 'start', '--dev-client', '--localhost', '--port', String(port)],
    {
      cwd: mobileDir,
      env: {
        ...process.env,
        CI: '1',
        EXPO_OFFLINE: '1',
        EXPO_NO_DOTENV: '1',
        EXPO_NO_TELEMETRY: '1',
        EXPO_PUBLIC_API_URL: apiUrl,
        EXPO_PUBLIC_WELYT_ANDROID_TEST_ID: testId,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let logs = '';
  for (const stream of [metro.stdout, metro.stderr]) {
    stream.on('data', (data) => {
      logs = `${logs}${data}`.slice(-3000);
    });
  }
  let stopped = false;
  const finished = new Promise((resolve) => {
    metro.once('error', (error) => {
      stopped = true;
      logs += error.message;
      resolve();
    });
    metro.once('exit', () => {
      stopped = true;
      resolve();
    });
  });
  cleanup.push(async () => {
    if (stopped) return;
    metro.kill('SIGTERM');
    await Promise.race([finished, delay(2500, undefined, { ref: false })]);
    if (!stopped) metro.kill('SIGKILL');
    await finished;
  });

  const deadline = Date.now() + 40_000;
  let ready = false;
  while (!stopped && Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/status`, { signal: AbortSignal.timeout(1500) });
      ready = response.ok && (await response.text()) === 'packager-status:running';
    } catch (error) {
      if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
    }
    if (ready) break;
    await delay(400);
  }
  assert.ok(ready && !stopped, `Metro did not start for the device test.\n${logs}`);

  const manifestResponse = await fetch(origin, {
    headers: { 'expo-platform': 'android', accept: 'application/expo+json' },
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(manifestResponse.ok, `Android manifest returned HTTP ${manifestResponse.status}`);
  const manifest = await manifestResponse.json();
  const launch = new URL(manifest.launchAsset.url);
  assert.equal(
    launch.searchParams.get('dev'),
    'true',
    'Expected a development-only Android bundle.',
  );
  const bundle = new URL(origin);
  bundle.pathname = launch.pathname;
  bundle.search = launch.search;
  bundle.searchParams.set('lazy', 'false');
  bundle.searchParams.delete('transform.bytecode');
  const response = await fetch(bundle, { signal: AbortSignal.timeout(90_000) });
  assert.ok(response.ok, `Android test bundle returned HTTP ${response.status}.\n${logs}`);
  const source = await response.text();
  assert.ok(
    source.includes(testId) && source.includes(apiUrl),
    'Metro bundle is missing the isolated Android test configuration.',
  );
  return { origin, port, logTail: () => logs };
}

async function recordBalance(device, name, currency, balance) {
  await device.tap('Add account');
  await device.enter('Account name', name);
  if (currency !== 'INR') await device.tap(new RegExp(`^${currency}($| )`), { scroll: true });
  await device.tap('Create account', { scroll: true });
  await device.tap(`${name}, ${currency}`, { scroll: true });
  await device.expect('No balance recorded');
  await device.tap('Record balance');
  await device.enter(`Balance (${currency})`, balance);
  await device.tap('Save balance', { scroll: true });
  await device.expect('Balance recorded.');
  await device.tap('Back to Accounts');
}

async function step(t, label, action) {
  let passed = false;
  await t.test(label, async () => {
    await action();
    passed = true;
  });
  return passed;
}

test('Financial modules on a USB Android device', { timeout: 600_000 }, async (t) => {
  const cleanup = [];
  t.after(async () => {
    const errors = [];
    for (const dispose of cleanup.reverse()) {
      try {
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Android test cleanup failed');
  });

  const { expo } = JSON.parse(await readFile(path.join(mobileDir, 'app.json'), 'utf8'));
  const device = await connectAndroid(expo.android.package, `exp+${expo.slug.toLowerCase()}`);
  const api = await fixtureApi(cleanup);
  const metro = await startMetro(api.port, cleanup);
  for (const port of [api.port, metro.port]) {
    await device.reverse(port);
    cleanup.push(() => device.removeReverse(port));
  }
  cleanup.push(() => device.leaveApp());
  await device.coldRestart(metro.origin);

  if (
    !(await step(t, 'signs in as a verified user and shows an empty cash summary', async () => {
      await device.expectWithin(55_000, 'Welcome back');
      await device.enter('Email address', api.credentials.email);
      await device.enter('Password', api.credentials.password);
      await device.tap('Sign in', { scroll: true });
      await device.expect('No accounts included in INR reporting', 'Accounts', 'Plan', 'More');
    }))
  ) {
    t.diagnostic(`Isolated Metro output:\n${metro.logTail()}`);
    return;
  }

  if (
    !(await step(
      t,
      'keeps navigation on main screens and returns from focused screens',
      async () => {
        await device.tap('More');
        await device.expect(fixtureName);
        await device.tap('Change password', { scroll: true });
        await device.expect('Current password');
        await device.expectHidden('Accounts');
        await device.tap('Back to More');
        await device.expect('Security & sessions');
        await device.tap('Plan');
        await device.expect('Monthly Plan', 'No plan saved for this month.');
        await device.tap('Create plan');
        await device.expect('Expected net income (INR)');
        await device.expectHidden('More');
        await device.shell('input', 'keyevent', 'KEYCODE_BACK');
        await device.expect('Create plan', 'More');
        await device.tap('Home');
      },
    ))
  )
    return;

  if (
    !(await step(
      t,
      'reports a dated INR total and marks missing FX as an incomplete cash subtotal',
      async () => {
        await device.tap('Accounts');
        await recordBalance(device, 'Rupee cash', 'INR', '100.00');
        await recordBalance(device, 'Dollar travel', 'USD', '2.00');
        await device.tap('Home');
        await device.expect(
          'Cash total',
          'INR 262.50',
          `USD to INR: ${api.rateOn} (Frankfurter, 1 day old)`,
        );

        await device.tap('Accounts');
        await recordBalance(device, 'Euro reserve', 'EUR', '10.00');
        await device.tap('Home');
        await device.expect(
          'Known cash subtotal',
          'INR 262.50',
          'Incomplete: 2 of 3 included accounts could be valued.',
          /No EUR to INR rate available\./,
        );
      },
    ))
  )
    return;

  if (
    !(await step(
      t,
      'preserves a corrected signed balance and restores the session after a cold launch',
      async () => {
        await device.tap('Accounts');
        await device.tap('Dollar travel, USD', { scroll: true });
        await device.expectHidden('More');
        await device.tap(/^Correct balance for /, { scroll: true });
        await device.tap('Add minus sign', { scroll: true });
        await device.tap('Save correction', { scroll: true });
        await device.expect('Superseded', 'USD 2.00', 'USD -2.00');
        await device.shell('input', 'keyevent', 'KEYCODE_BACK');
        await device.tap('Home');
        await device.expect('Known cash subtotal', 'INR -62.50');
        await device.coldRestart(metro.origin);
        await device.expectWithin(55_000, 'More', 'Known cash subtotal', 'INR -62.50');
      },
    ))
  )
    return;

  if (
    !(await step(
      t,
      'records and corrects income, browses fiscal history, and leaves cash unchanged',
      async () => {
        await device.tap('Plan');
        await device.tap('Income History');
        await device.expect('No income receipts in this financial year.');
        await device.tap('Record income');
        await device.enter('Income type', 'Freelance');
        await device.enter('Income source', 'Pixel payer');
        await device.tap(/^USD($| )/, { scroll: true });
        await device.enter('Amount received', '2.00');
        await device.tap('Save receipt', { scroll: true });
        await device.expect('Receipt recorded.', 'Financial year total', 'INR 162.50');
        await device.tap('Previous year');
        await device.expect('No income receipts in this financial year.');
        await device.tap('Home');
        await device.expect('Known cash subtotal', 'INR -62.50');
        await device.tap('Plan');
        await device.expect('Income History', 'No income receipts in this financial year.');
        await device.tap('Next year');
        await device.expect('Financial year total', 'INR 162.50');
        await device.tap('Correct receipt', { scroll: true });
        await device.tap('Notes (optional)', { scroll: true, editor: true });
        await device.enter('Notes (optional)', 'Correction fixture');
        await device.tap('Save correction', { scroll: true });
        await device.expect('Receipt corrected.', 'Financial year total', 'INR 162.50');
        await device.tap('Home');
        await device.expect('Known cash subtotal', 'INR -62.50');
      },
    ))
  )
    return;

  await step(
    t,
    'saves a shortfall, copies a blank month, and keeps actual receipts and cash unchanged',
    async () => {
      await device.tap('Plan');
      await device.tap('Monthly Plan', { scroll: true });
      await device.expect('No plan saved for this month.');
      await device.tap('Create plan');
      await device.enter('Expected net income (INR)', '100000');
      await device.tap('Add allocation', { scroll: true });
      await device.enter('Allocation 1 name', 'Fixed costs');
      await device.enter('Allocation 1 amount (INR)', '110000');
      await device.tap('Save plan', { scroll: true });
      await device.expect('Plan saved.', /Shortfall: INR 10,000\.00/);
      await device.expectHidden('Plan saved.', 8_000);
      await device.expect(/Shortfall: INR 10,000\.00/);
      await device.tap('Next month');
      await device.expect('No plan saved for this month.');
      await device.tap('Create plan');
      await device.tap('Copy Previous Month');
      await device.expect(/Draft copied from \d{4}-\d{2}\. Nothing is saved yet\./);
      await device.tap('Save plan', { scroll: true });
      await device.expect('Plan saved.', 'Copied from the previous month');
      await device.tap('Enable auto-copy', { scroll: true });
      await device.expect('Disable auto-copy');
      await device.tap('Income History');
      await device.expect('Financial year total', 'INR 162.50');
      await device.tap('Home');
      await device.expect('Known cash subtotal', 'INR -62.50');
      await device.tap('More');
      await device.tap('Sign out', { scroll: true });
      await device.expect('Welcome back');
    },
  );
});
