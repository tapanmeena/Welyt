import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import {
  AUTH_ERROR_CODES,
  INCOME_ERROR_CODES,
  autoCopyRuleDtoSchema,
  type ApiErrorCode,
  type MonthlyPlanSaveInput,
  apiErrorResponseSchema,
  authSessionResponseSchema,
  monthlyPlanResponseSchema,
} from '@welyt/shared';
import { buildApp } from '../app.ts';
import { loadApiEnv } from '../config/env.ts';
import { createDatabase, type AppDatabase } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { MemoryMailer } from '../lib/mailer.ts';
import { MonthlyPlanService } from '../modules/income/monthly-plan.service.ts';

const ruleUrl = '/income/plan-rules/auto-copy';
const planInput: MonthlyPlanSaveInput = {
  expectedRevision: 0,
  forecastIncome: '100000',
  allocations: [
    { name: 'Rent', group: 'fixed', amount: '70000' },
    { name: 'Travel', group: 'flexible', amount: '30000' },
    { name: 'Saving target', group: 'saving', amount: '10000' },
  ],
};

function expectError(
  response: { statusCode: number; body: string; json(): unknown },
  statusCode: number,
  code: ApiErrorCode,
) {
  assert.equal(response.statusCode, statusCode, response.body);
  assert.equal(apiErrorResponseSchema.parse(response.json()).error.code, code);
}

async function setup(t: TestContext) {
  const mailer = new MemoryMailer();
  const app = await buildApp({
    env: loadApiEnv({ NODE_ENV: 'test' }),
    mailer,
    logger: false,
    enableRateLimit: false,
  });
  t.after(() => app.close());

  async function register(email: string, verify = true) {
    const registration = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, name: 'Plan fixture', password: 'Password123' },
    });
    assert.equal(registration.statusCode, 201, registration.body);
    const { tokens } = authSessionResponseSchema.parse(registration.json());
    const headers = { authorization: `Bearer ${tokens.accessToken}` };
    if (verify) {
      const code = mailer.verifications.find((message) => message.to === email)?.code;
      assert.ok(code);
      const verification = await app.inject({
        method: 'POST',
        url: '/auth/verify-email',
        headers,
        payload: { code },
      });
      assert.equal(verification.statusCode, 200, verification.body);
    }
    return headers;
  }
  return { app, register };
}

it('keeps verified-user plans and rules private, even when a copy names another user’s version', async (t) => {
  const { app, register } = await setup(t);
  const unverified = await register('unverified@example.test', false);
  const owner = await register('owner@example.test');
  const other = await register('other@example.test');
  const planUrl = '/income/plans/2026-11';
  const requests = [
    { method: 'GET', url: planUrl },
    { method: 'PUT', url: planUrl, payload: planInput },
    { method: 'GET', url: ruleUrl },
    { method: 'PUT', url: ruleUrl, payload: { enabled: true } },
  ] as const;
  for (const request of requests) {
    expectError(await app.inject(request), 401, AUTH_ERROR_CODES.UNAUTHORIZED);
    expectError(
      await app.inject({ ...request, headers: unverified }),
      403,
      AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
    );
  }
  const saved = await app.inject({ ...requests[1], headers: owner });
  assert.equal(saved.statusCode, 200, saved.body);
  const source = monthlyPlanResponseSchema.parse(saved.json()).plan;
  assert.ok(source);
  const otherPlan = await app.inject({ ...requests[0], headers: other });
  assert.equal(otherPlan.statusCode, 200, otherPlan.body);
  assert.equal(otherPlan.headers['cache-control'], 'no-store');
  assert.deepEqual(otherPlan.json(), { plan: null });
  expectError(
    await app.inject({
      method: 'PUT',
      url: '/income/plans/2026-12',
      headers: other,
      payload: { ...planInput, copiedFromPlanId: source.id },
    }),
    404,
    INCOME_ERROR_CODES.MONTHLY_PLAN_NOT_FOUND,
  );

  const ownerRule = await app.inject({ ...requests[3], headers: owner });
  assert.equal(ownerRule.statusCode, 200, ownerRule.body);
  assert.equal(autoCopyRuleDtoSchema.parse(ownerRule.json()).enabled, true);
  const otherRule = await app.inject({ ...requests[2], headers: other });
  assert.equal(otherRule.statusCode, 200, otherRule.body);
  assert.deepEqual(otherRule.json(), { enabled: false, firstTargetMonth: null });
});

it('saves a shortfall, preserves revisions, and copies a blank month without changing receipts or cash', async (t) => {
  const { app, register } = await setup(t);
  const headers = await register('owner@example.test');
  const november = '/income/plans/2026-11';
  const december = '/income/plans/2026-12';
  const receipt = await app.inject({
    method: 'POST',
    url: '/income',
    headers,
    payload: {
      receivedDate: '2024-04-01',
      type: 'Salary',
      source: 'Employer',
      currencyCode: 'INR',
      amount: '25',
    },
  });
  assert.equal(receipt.statusCode, 201, receipt.body);
  const account = await app.inject({
    method: 'POST',
    url: '/accounts',
    headers,
    payload: { name: 'Cash', kind: 'cash' },
  });
  assert.equal(account.statusCode, 201, account.body);
  const snapshot = await app.inject({
    method: 'POST',
    url: `/accounts/${account.json<{ id: string }>().id}/snapshots`,
    headers,
    payload: { observedOn: '2024-04-01', balance: '51.25' },
  });
  assert.equal(snapshot.statusCode, 201, snapshot.body);

  const saved = await app.inject({ method: 'PUT', url: november, headers, payload: planInput });
  assert.equal(saved.statusCode, 200, saved.body);
  const original = monthlyPlanResponseSchema.parse(saved.json()).plan;
  assert.ok(original);
  assert.equal(original.revision, 1);
  assert.equal(original.forecastIncome, '100000.00');
  assert.deepEqual(original.totals, {
    byGroup: { fixed: '70000.00', flexible: '30000.00', saving: '10000.00' },
    allocated: '110000.00',
    remaining: '-10000.00',
  });
  const result = await app.inject({
    method: 'PUT',
    url: november,
    headers,
    payload: { ...planInput, expectedRevision: 1, forecastIncome: '120000' },
  });
  assert.equal(result.statusCode, 200, result.body);
  const revised = monthlyPlanResponseSchema.parse(result.json()).plan;
  assert.ok(revised);
  assert.equal(revised.revision, 2);
  assert.equal(revised.totals.remaining, '10000.00');
  expectError(
    await app.inject({ method: 'PUT', url: november, headers, payload: planInput }),
    409,
    INCOME_ERROR_CODES.MONTHLY_PLAN_REVISION_CONFLICT,
  );
  const historic = await app.inject({ url: `${november}?revision=1`, headers });
  assert.equal(historic.statusCode, 200, historic.body);
  assert.deepEqual(historic.json(), { plan: original });

  const copy = {
    ...planInput,
    forecastIncome: revised.forecastIncome,
    copiedFromPlanId: revised.id,
  };
  expectError(
    await app.inject({
      method: 'PUT',
      url: '/income/plans/2027-01',
      headers,
      payload: copy,
    }),
    400,
    AUTH_ERROR_CODES.VALIDATION_ERROR,
  );
  expectError(
    await app.inject({
      method: 'PUT',
      url: december,
      headers,
      payload: { ...copy, forecastIncome: '0.001' },
    }),
    400,
    AUTH_ERROR_CODES.VALIDATION_ERROR,
  );
  const blank = await app.inject({ url: december, headers });
  assert.deepEqual(blank.json(), { plan: null });
  const copied = await app.inject({ method: 'PUT', url: december, headers, payload: copy });
  assert.equal(copied.statusCode, 200, copied.body);
  const target = monthlyPlanResponseSchema.parse(copied.json()).plan;
  assert.equal(target?.createdVia, 'manual_copy');
  assert.equal(target.copiedFromPlanId, revised.id);
  assert.equal(target.forecastIncome, revised.forecastIncome);
  assert.equal(target.totals.allocated, revised.totals.allocated);
  const after = await app.inject({ url: '/income', headers });
  assert.deepEqual(after.json(), [receipt.json()]);
  const cash = await app.inject({ url: '/accounts/valuation', headers });
  assert.equal(cash.json<{ totalInr: string }>().totalInr, '51.25');
});

function addUsers(db: AppDatabase, ids: string[]) {
  for (const id of ids) {
    const createdAt = '2026-01-01T00:00:00.000Z';
    db.insert(users)
      .values({
        id,
        name: id,
        email: `${id}@example.test`,
        passwordHash: 'fixture-hash',
        createdAt,
        updatedAt: createdAt,
      })
      .run();
  }
}

it('catches up only the eligible India-local month once and freezes the source at month start', (t) => {
  const { db, close } = createDatabase(':memory:');
  t.after(close);
  addUsers(db, ['owner', 'already-planned', 'missing-source', 'disabled', 'late-opt-in']);
  let now = new Date('2026-03-15T08:00:00.000Z');
  const plans = new MonthlyPlanService(db, () => now);
  for (const owner of ['owner', 'already-planned', 'missing-source', 'disabled']) {
    assert.deepEqual(plans.setAutoCopyRule(owner, true), {
      enabled: true,
      firstTargetMonth: '2026-04',
    });
  }
  plans.setAutoCopyRule('disabled', false);
  plans.save('disabled', '2026-03', planInput);
  plans.save('already-planned', '2026-03', planInput);
  const manual = plans.save('already-planned', '2026-04', { ...planInput, forecastIncome: '1' });
  plans.save('owner', '2026-03', planInput);
  now = new Date('2026-03-31T18:29:59.999Z');
  const source = plans.save('owner', '2026-03', {
    ...planInput,
    expectedRevision: 1,
    forecastIncome: '125000.01',
  });
  assert.equal(plans.runDueAutoCopies(), 0);
  assert.equal(plans.get('owner', '2026-04'), null);

  now = new Date('2026-04-04T08:00:00.000Z');
  plans.save('owner', '2026-03', { ...planInput, expectedRevision: 2, forecastIncome: '200000' });
  plans.save('late-opt-in', '2026-02', planInput);
  assert.deepEqual(plans.setAutoCopyRule('late-opt-in', true), {
    enabled: true,
    firstTargetMonth: '2026-05',
  });
  assert.equal(plans.runDueAutoCopies(), 1);
  assert.equal(plans.runDueAutoCopies(), 0);
  const copied = plans.get('owner', '2026-04');
  assert.ok(copied);
  assert.equal(copied.revision, 1);
  assert.equal(copied.copiedFromPlanId, source.id);
  assert.equal(copied.createdVia, 'auto_copy');
  assert.equal(copied.forecastIncome, '125000.01');
  assert.deepEqual(
    copied.allocations.map(({ name, group, amount }) => [name, group, amount]),
    source.allocations.map(({ name, group, amount }) => [name, group, amount]),
  );
  assert.deepEqual(plans.get('already-planned', '2026-04'), manual);
  for (const owner of ['missing-source', 'disabled', 'late-opt-in']) {
    assert.equal(plans.get(owner, '2026-04'), null);
  }
  assert.equal(plans.get('late-opt-in', '2026-03'), null);
  assert.throws(() => plans.save('owner', '2026-04', planInput), {
    code: INCOME_ERROR_CODES.MONTHLY_PLAN_REVISION_CONFLICT,
  });
});

it('creates the new calendar year at India midnight and does not backfill ended months', (t) => {
  const { db, close } = createDatabase(':memory:');
  t.after(close);
  addUsers(db, ['owner', 'skipped']);
  let now = new Date('2026-10-01T08:00:00.000Z');
  const plans = new MonthlyPlanService(db, () => now);
  plans.setAutoCopyRule('skipped', true);
  plans.save('skipped', '2026-10', planInput);
  now = new Date('2026-12-31T18:29:59.999Z');
  assert.deepEqual(plans.setAutoCopyRule('owner', true), {
    enabled: true,
    firstTargetMonth: '2027-01',
  });
  const source = plans.save('owner', '2026-12', planInput);
  assert.equal(plans.runDueAutoCopies(), 0);
  now = new Date('2026-12-31T18:30:00.000Z');
  assert.equal(plans.runDueAutoCopies(), 1);
  assert.equal(plans.get('owner', '2027-01')?.copiedFromPlanId, source.id);
  assert.equal(plans.get('skipped', '2026-11'), null);
});
