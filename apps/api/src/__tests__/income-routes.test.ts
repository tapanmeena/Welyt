import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it, type TestContext } from 'node:test';
import {
  AUTH_ERROR_CODES,
  INCOME_ERROR_CODES,
  apiErrorResponseSchema,
  incomeHistoryDtoSchema,
  incomeReceiptDtoSchema,
  indiaBusinessDate,
  indiaFiscalWindow,
  type ApiErrorCode,
  type IncomeReceiptInput,
} from '@welyt/shared';
import { eq } from 'drizzle-orm';
import { buildApp } from '../app.ts';
import { loadApiEnv } from '../config/env.ts';
import { createDatabase, type AppDatabase } from '../db/client.ts';
import { fxRates, users } from '../db/schema.ts';
import { FRANKFURTER_SOURCE } from '../modules/fx/frankfurter.provider.ts';
import { createTestAuthHarness } from './test-auth.ts';

const receipt: IncomeReceiptInput = {
  receivedDate: '2024-03-31',
  type: 'Salary',
  source: 'Test employer',
  currencyCode: 'INR',
  amount: '100.05',
};

function expectError(
  response: { statusCode: number; body: string; json(): unknown },
  statusCode: number,
  code: ApiErrorCode,
) {
  assert.equal(response.statusCode, statusCode, response.body);
  const { error } = apiErrorResponseSchema.parse(response.json());
  assert.equal(error.code, code);
  return error;
}

async function setup(t: TestContext) {
  const database = createDatabase(':memory:');
  const auth = createTestAuthHarness();
  const app = await buildApp({
    env: loadApiEnv({ NODE_ENV: 'test' }),
    database,
    authVerifier: auth.authVerifier,
    logger: false,
    enableRateLimit: false,
  });
  t.after(async () => {
    try {
      await app.close();
    } finally {
      database.close();
    }
  });

  async function register(email: string, verify = true) {
    const headers = auth.authHeader({
      email,
      name: 'Income fixture',
      emailVerified: verify,
    });
    // Ensure local user row is provisioned before tests inspect db.select().from(users)
    const me = await app.inject({ url: '/auth/me', headers });
    assert.equal(me.statusCode, 200, me.body);
    return headers;
  }

  async function create(headers: { authorization: string }, payload = receipt) {
    const response = await app.inject({ method: 'POST', url: '/income', headers, payload });
    assert.equal(response.statusCode, 201, response.body);
    assert.equal(Object.hasOwn(response.json(), 'userId'), false);
    return incomeReceiptDtoSchema.parse(response.json());
  }

  async function list(headers: { authorization: string }, includeInactive = false) {
    const response = await app.inject({
      url: includeInactive ? '/income?includeInactive=true' : '/income',
      headers,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'no-store');
    return incomeReceiptDtoSchema.array().parse(response.json());
  }

  async function history(headers: { authorization: string }, fiscalYear?: string) {
    const response = await app.inject({
      url:
        fiscalYear === undefined ? '/income/history' : `/income/history?fiscalYear=${fiscalYear}`,
      headers,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'no-store');
    return incomeHistoryDtoSchema.parse(response.json());
  }

  return { app, db: database.db, register, create, list, history };
}

it('requires a verified email on every income route and isolates receipt access by owner', async (t) => {
  const { app, register, create, list } = await setup(t);
  const unverified = await register('unverified@example.test', false);
  const owner = await register('owner@example.test');
  const other = await register('other@example.test');
  const owned = await create(owner);
  const ownReceipt = await create(other, { ...receipt, source: 'Second employer' });
  const requests = [
    { method: 'GET', url: '/income' },
    { method: 'GET', url: '/income/history' },
    { method: 'POST', url: '/income', payload: receipt },
    { method: 'POST', url: `/income/${owned.id}/corrections`, payload: receipt },
    { method: 'POST', url: `/income/${owned.id}/archive` },
  ] as const;

  for (const request of requests) {
    expectError(await app.inject(request), 401, AUTH_ERROR_CODES.UNAUTHORIZED);
    expectError(
      await app.inject({ ...request, headers: unverified }),
      403,
      AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED,
    );
  }
  for (const request of requests.slice(3)) {
    expectError(
      await app.inject({ ...request, headers: other }),
      404,
      INCOME_ERROR_CODES.INCOME_RECEIPT_NOT_FOUND,
    );
  }
  expectError(
    await app.inject({ method: 'POST', url: `/income/${randomUUID()}/archive`, headers: owner }),
    404,
    INCOME_ERROR_CODES.INCOME_RECEIPT_NOT_FOUND,
  );
  assert.deepEqual(await list(other, true), [ownReceipt]);
  assert.deepEqual(await list(owner, true), [owned]);
});

it('keeps native receipt amounts exact and validates dates, currency precision, and withholding', async (t) => {
  const { app, register, create, list } = await setup(t);
  const headers = await register('owner@example.test');
  const tomorrow = indiaBusinessDate(new Date(Date.now() + 86_400_000));
  for (const [invalid, field] of [
    [{ receivedDate: '2024-02-30' }, 'receivedDate'],
    [{ receivedDate: tomorrow }, 'receivedDate'],
    [{ currencyCode: 'ZZZ' }, 'currencyCode'],
    [{ currencyCode: 'JPY', amount: '100.05' }, 'amount'],
    [{ amount: '0' }, 'amount'],
    [{ amount: '90071992547409.92' }, 'amount'],
    [{ gross: '99.00' }, 'gross'],
    [{ tds: '-1' }, 'tds'],
    [{ gross: '110', tds: '10' }, 'tds'],
  ] as const) {
    const response = await app.inject({
      method: 'POST',
      url: '/income',
      headers,
      payload: { ...receipt, ...invalid },
    });
    const error = expectError(response, 400, AUTH_ERROR_CODES.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.[field]?.length, response.body);
  }
  expectError(
    await app.inject({
      method: 'POST',
      url: '/income',
      headers,
      payload: { ...receipt, userId: 'another-user', accountId: randomUUID() },
    }),
    400,
    AUTH_ERROR_CODES.VALIDATION_ERROR,
  );
  assert.deepEqual(await list(headers), []);

  const dollars = await create(headers, {
    ...receipt,
    currencyCode: 'USD',
    amount: '90071992547409.91',
  });
  assert.equal(dollars.currencyCode, 'USD');
  assert.equal(dollars.amount, '90071992547409.91');
  assert.equal(dollars.gross, null);
  assert.equal(dollars.tds, null);

  const yen = await create(headers, {
    ...receipt,
    currencyCode: 'JPY',
    amount: '100',
    tds: '0',
  });
  assert.equal(yen.amount, '100.00');
  assert.equal(yen.gross, null);
  assert.equal(yen.tds, '0.00');

  const payroll = await create(headers, { ...receipt, gross: '120', tds: '12.3' });
  assert.equal(payroll.amount, '100.05');
  assert.equal(payroll.gross, '120.00');
  assert.equal(payroll.tds, '12.30');
});

it('preserves both same-day receipts and revision history without changing account snapshots', async (t) => {
  const { app, register, create, list } = await setup(t);
  const headers = await register('owner@example.test');
  const account = await app.inject({
    method: 'POST',
    url: '/accounts',
    headers,
    payload: { name: 'Snapshot account', kind: 'bank' },
  });
  assert.equal(account.statusCode, 201, account.body);
  const snapshots = `/accounts/${account.json<{ id: string }>().id}/snapshots`;
  const snapshot = await app.inject({
    method: 'POST',
    url: snapshots,
    headers,
    payload: { observedOn: receipt.receivedDate, balance: '300' },
  });
  assert.equal(snapshot.statusCode, 201, snapshot.body);

  const original = await create(headers);
  const duplicateLooking = await create(headers);
  assert.notEqual(original.id, duplicateLooking.id);
  const correctOriginal = `/income/${original.id}/corrections`;
  expectError(
    await app.inject({
      method: 'POST',
      url: correctOriginal,
      headers,
      payload: { ...receipt, amount: '0' },
    }),
    400,
    AUTH_ERROR_CODES.VALIDATION_ERROR,
  );
  assert.deepEqual(new Set(await list(headers)), new Set([original, duplicateLooking]));

  const correctionResponse = await app.inject({
    method: 'POST',
    url: correctOriginal,
    headers,
    payload: { ...receipt, receivedDate: '2024-04-01', amount: '98.5' },
  });
  assert.equal(correctionResponse.statusCode, 201, correctionResponse.body);
  const corrected = incomeReceiptDtoSchema.parse(correctionResponse.json());
  assert.equal(corrected.replacesReceiptId, original.id);
  assert.equal(corrected.receivedDate, '2024-04-01');
  assert.equal(corrected.amount, '98.50');
  assert.deepEqual(await list(headers), [corrected, duplicateLooking]);
  expectError(
    await app.inject({ method: 'POST', url: correctOriginal, headers, payload: receipt }),
    409,
    INCOME_ERROR_CODES.INCOME_RECEIPT_NOT_CURRENT,
  );

  const archive = () =>
    app.inject({ method: 'POST', url: `/income/${corrected.id}/archive`, headers });
  const archivedResponse = await archive();
  assert.equal(archivedResponse.statusCode, 200, archivedResponse.body);
  const archived = incomeReceiptDtoSchema.parse(archivedResponse.json());
  assert.ok(archived.archivedAt);
  assert.deepEqual((await archive()).json(), archived);
  expectError(
    await app.inject({
      method: 'POST',
      url: `/income/${archived.id}/corrections`,
      headers,
      payload: receipt,
    }),
    409,
    INCOME_ERROR_CODES.INCOME_RECEIPT_ARCHIVED,
  );
  assert.deepEqual(await list(headers), [duplicateLooking]);
  const history = await list(headers, true);
  assert.equal(history.length, 3);
  assert.deepEqual(history[0], archived);
  const retired = history.find(({ id }) => id === original.id);
  assert.deepEqual(retired, { ...original, retiredAt: corrected.createdAt });
  const after = await app.inject({ url: snapshots, headers });
  assert.equal(after.statusCode, 200, after.body);
  assert.deepEqual(after.json(), [snapshot.json()]);
});

function seedRate(
  db: AppDatabase,
  currencyCode: string,
  rateOn: string,
  rateE8: number,
  userId: string | null = null,
) {
  const createdAt = '2025-04-02T08:00:00.000Z';
  return db
    .insert(fxRates)
    .values({
      id: randomUUID(),
      baseCurrencyCode: currencyCode,
      quoteCurrencyCode: 'INR',
      rateOn,
      rateE8,
      source: userId === null ? FRANKFURTER_SOURCE : 'manual',
      userId,
      fetchedAt: userId === null ? createdAt : null,
      createdAt,
    })
    .returning()
    .get();
}

it('groups April–March receipts and uses their own dated FX and scoped manual overrides', async (t) => {
  const { app, db, register, create, history } = await setup(t);
  const ownerEmail = 'owner@example.test';
  const owner = await register(ownerEmail);
  const other = await register('other@example.test');
  const user = db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail)).get();
  assert.ok(user);
  seedRate(db, 'USD', '2024-04-01', 8_000_000_000);
  const override = seedRate(db, 'USD', '2024-04-01', 8_125_000_000, user.id);
  seedRate(db, 'USD', '2024-04-03', 9_000_000_000);
  seedRate(db, 'JPY', '2025-03-31', 100_500_000);

  await create(owner, { ...receipt, amount: '99' }); // Just before this FY.
  const inr = await create(owner, { ...receipt, receivedDate: '2024-04-01', amount: '100' });
  const usd = await create(owner, {
    ...receipt,
    receivedDate: '2024-04-02',
    currencyCode: 'USD',
    amount: '2',
  });
  const yen = await create(owner, {
    ...receipt,
    receivedDate: '2025-03-31',
    currencyCode: 'JPY',
    amount: '1',
  });
  await create(owner, { ...receipt, receivedDate: '2025-04-01', amount: '99' });
  const otherUsd = await create(other, {
    ...receipt,
    receivedDate: '2024-04-02',
    currencyCode: 'USD',
    amount: '2',
  });

  const report = await history(owner, '2024');
  assert.deepEqual(report.fiscalYear, { startsOn: '2024-04-01', endsBefore: '2025-04-01' });
  assert.deepEqual(
    report.months.map(({ month, totalInr }) => [month, totalInr]),
    [
      ['2025-03', '1.01'],
      ['2024-04', '262.50'],
    ],
  );
  assert.equal(report.totalInr, '263.51');
  assert.equal(report.complete, true);
  const rows = report.months.flatMap(({ receipts }) => receipts);
  assert.deepEqual(
    rows.map(({ id }) => id),
    [yen.id, usd.id, inr.id],
  );
  assert.deepEqual(rows[1], {
    ...usd,
    inrAmount: '162.50',
    fxRate: {
      id: override.id,
      rateOn: '2024-04-01',
      rate: '81.25000000',
      source: 'manual',
      fetchedAt: null,
      ageDays: 1,
    },
    issue: null,
  });
  assert.equal(rows[2]?.fxRate, null);
  const otherReport = await history(other, '2024');
  assert.equal(otherReport.totalInr, '160.00');
  assert.deepEqual(
    otherReport.months.flatMap(({ receipts }) => receipts.map(({ id }) => id)),
    [otherUsd.id],
  );

  const today = indiaBusinessDate(new Date());
  assert.deepEqual((await history(other)).fiscalYear, indiaFiscalWindow(today));
  for (const year of ['2024%0A', String(Number(today.slice(0, 4)) + 1)]) {
    expectError(
      await app.inject({ url: `/income/history?fiscalYear=${year}`, headers: owner }),
      400,
      AUTH_ERROR_CODES.VALIDATION_ERROR,
    );
  }
});

it('returns known subtotals for missing or stale FX and never counts archived or replaced receipts', async (t) => {
  const { app, db, register, create, history } = await setup(t);
  const headers = await register('owner@example.test');
  seedRate(db, 'GBP', '2024-04-01', 10_000_000_000);
  const original = await create(headers, { ...receipt, amount: '10' });
  const correctionResponse = await app.inject({
    method: 'POST',
    url: `/income/${original.id}/corrections`,
    headers,
    payload: { ...receipt, receivedDate: '2024-05-01', amount: '10' },
  });
  assert.equal(correctionResponse.statusCode, 201, correctionResponse.body);
  const corrected = incomeReceiptDtoSchema.parse(correctionResponse.json());
  await create(headers, { ...receipt, receivedDate: '2024-04-01', amount: '100' });
  const stale = await create(headers, {
    ...receipt,
    receivedDate: '2024-04-09',
    currencyCode: 'GBP',
    amount: '2',
  });
  const missing = await create(headers, {
    ...receipt,
    receivedDate: '2024-04-02',
    currencyCode: 'EUR',
    amount: '3',
  });
  const archived = await create(headers, { ...receipt, receivedDate: '2024-04-01', amount: '99' });
  const archive = await app.inject({
    method: 'POST',
    url: `/income/${archived.id}/archive`,
    headers,
  });
  assert.equal(archive.statusCode, 200, archive.body);

  assert.deepEqual((await history(headers, '2023')).months, []);
  const report = await history(headers, '2024');
  assert.equal(report.complete, false);
  assert.equal(report.totalInr, null);
  assert.equal(report.knownSubtotalInr, '110.00');
  const [may, april] = report.months;
  assert.deepEqual(
    may?.receipts.map(({ id }) => id),
    [corrected.id],
  );
  assert.equal(may?.totalInr, '10.00');
  assert.equal(april?.complete, false);
  assert.equal(april?.totalInr, null);
  assert.equal(april?.knownSubtotalInr, '100.00');
  assert.equal(april?.receipts.length, 3);
  assert.deepEqual(
    april?.receipts.find(({ id }) => id === stale.id),
    {
      ...stale,
      inrAmount: null,
      fxRate: null,
      issue: { reason: 'stale_fx_rate', rateOn: '2024-04-01', ageDays: 8 },
    },
  );
  assert.deepEqual(
    april?.receipts.find(({ id }) => id === missing.id),
    {
      ...missing,
      inrAmount: null,
      fxRate: null,
      issue: { reason: 'missing_fx_rate' },
    },
  );
});
