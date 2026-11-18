import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it, type TestContext } from 'node:test';
import {
  AUTH_ERROR_CODES,
  INCOME_ERROR_CODES,
  apiErrorResponseSchema,
  authSessionResponseSchema,
  incomeReceiptDtoSchema,
  indiaBusinessDate,
  type ApiErrorCode,
  type IncomeReceiptInput,
} from '@welyt/shared';
import { buildApp } from '../app.ts';
import { loadApiEnv } from '../config/env.ts';
import { MemoryMailer } from '../lib/mailer.ts';

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
      payload: { email, name: 'Income fixture', password: 'Password123' },
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

  return { app, register, create, list };
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
  for (const request of requests.slice(2)) {
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
