import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { it, type TestContext } from 'node:test';
import {
  ACCOUNTS_ERROR_CODES,
  AUTH_ERROR_CODES,
  accountDtoSchema,
  accountsValuationDtoSchema,
  apiErrorResponseSchema,
  authSessionResponseSchema,
  authVerifyEmailResponseSchema,
  balanceSnapshotDtoSchema,
  currencyDtoSchema,
  latestBalanceSnapshotResponseSchema,
  type ApiErrorCode,
} from '@welyt/shared';
import { buildApp } from '../app.ts';
import { loadApiEnv } from '../config/env.ts';
import { createDatabase } from '../db/client.ts';
import { fxRates } from '../db/schema.ts';
import { MemoryMailer } from '../lib/mailer.ts';
import { FRANKFURTER_SOURCE } from '../modules/fx/frankfurter.provider.ts';

const bankAccount = { name: 'Everyday account', kind: 'bank' } as const;
const observedOn = '2024-04-01';
const observation = { observedOn, balance: '10.05' };

function expectError(
  response: { statusCode: number; body: string; json(): unknown },
  statusCode: number,
  code: ApiErrorCode,
): void {
  assert.equal(response.statusCode, statusCode, response.body);
  assert.equal(apiErrorResponseSchema.parse(response.json()).error.code, code);
}

async function setup(t: TestContext) {
  const database = createDatabase(':memory:');
  const mailer = new MemoryMailer();
  const app = await buildApp({
    env: loadApiEnv({ NODE_ENV: 'test' }),
    database,
    mailer,
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

  return {
    app,
    db: database.db,
    async register(email: string, verify = true) {
      const registration = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { email, name: 'Accounts fixture', password: 'Password123' },
      });
      assert.equal(registration.statusCode, 201, registration.body);
      const { tokens } = authSessionResponseSchema.parse(registration.json());
      const headers = { authorization: `Bearer ${tokens.accessToken}` };
      if (!verify) return headers;

      const code = mailer.verifications.find((message) => message.to === email)?.code;
      assert.ok(code);
      const verification = await app.inject({
        method: 'POST',
        url: '/auth/verify-email',
        headers,
        payload: { code },
      });
      assert.equal(verification.statusCode, 200, verification.body);
      const verified = authVerifyEmailResponseSchema.parse(verification.json());
      assert.ok(verified.accessToken);
      return { authorization: `Bearer ${verified.accessToken}` };
    },
  };
}

it('requires a verified email on every Accounts & Cash endpoint', async (t) => {
  const { app, register } = await setup(t);
  const headers = await register('unverified@example.test', false);
  const base = `/accounts/${randomUUID()}`;
  const requests = [
    { method: 'GET', url: '/currencies' },
    { method: 'GET', url: '/accounts' },
    { method: 'POST', url: '/accounts', payload: bankAccount },
    { method: 'GET', url: '/accounts/valuation' },
    { method: 'PATCH', url: base, payload: { name: 'Updated' } },
    { method: 'POST', url: `${base}/archive` },
    { method: 'GET', url: `${base}/snapshots` },
    { method: 'GET', url: `${base}/snapshots/latest` },
    { method: 'POST', url: `${base}/snapshots`, payload: observation },
    { method: 'POST', url: `${base}/snapshots/${randomUUID()}/corrections`, payload: observation },
  ] as const;

  for (const request of requests) {
    expectError(await app.inject(request), 401, AUTH_ERROR_CODES.UNAUTHORIZED);
    const unverified = await app.inject({ ...request, headers });
    expectError(unverified, 403, AUTH_ERROR_CODES.EMAIL_NOT_VERIFIED);
    assert.equal(unverified.headers['cache-control'], 'no-store');
  }
});

it('creates and archives accounts and exposes corrections without overwriting snapshot history', async (t) => {
  const { app, register } = await setup(t);
  const headers = await register('owner@example.test');
  const catalog = await app.inject({ url: '/currencies', headers });
  assert.equal(catalog.statusCode, 200);
  assert.ok(
    currencyDtoSchema
      .array()
      .parse(catalog.json())
      .some((currency) => currency.code === 'USD'),
  );

  const created = await app.inject({
    method: 'POST',
    url: '/accounts',
    headers,
    payload: bankAccount,
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(Object.hasOwn(created.json(), 'userId'), false);
  const account = accountDtoSchema.parse(created.json());
  assert.equal(account.currencyCode, 'INR');
  const base = `/accounts/${account.id}`;
  const snapshots = `${base}/snapshots`;
  const patched = await app.inject({
    method: 'PATCH',
    url: base,
    headers,
    payload: { name: '  Daily cash  ' },
  });
  assert.equal(patched.statusCode, 200, patched.body);
  assert.equal(accountDtoSchema.parse(patched.json()).name, 'Daily cash');
  expectError(
    await app.inject({ method: 'PATCH', url: base, headers, payload: { currencyCode: 'USD' } }),
    400,
    AUTH_ERROR_CODES.VALIDATION_ERROR,
  );
  expectError(
    await app.inject({
      method: 'POST',
      url: snapshots,
      headers,
      payload: { ...observation, balance: 10.05 },
    }),
    400,
    AUTH_ERROR_CODES.VALIDATION_ERROR,
  );

  const recorded = await app.inject({
    method: 'POST',
    url: snapshots,
    headers,
    payload: observation,
  });
  assert.equal(recorded.statusCode, 201, recorded.body);
  assert.equal(Object.hasOwn(recorded.json(), 'balanceHundredths'), false);
  const original = balanceSnapshotDtoSchema.parse(recorded.json());
  assert.equal(original.balance, '10.05');
  const correctionUrl = `${snapshots}/${original.id}/corrections`;
  expectError(
    await app.inject({ method: 'POST', url: snapshots, headers, payload: observation }),
    409,
    ACCOUNTS_ERROR_CODES.OBSERVATION_DATE_OCCUPIED,
  );
  const corrected = await app.inject({
    method: 'POST',
    url: correctionUrl,
    headers,
    payload: { ...observation, balance: '0' },
  });
  assert.equal(corrected.statusCode, 201, corrected.body);
  const replacement = balanceSnapshotDtoSchema.parse(corrected.json());
  assert.equal(replacement.replacesObservationId, original.id);
  assert.equal(replacement.balance, '0.00');
  expectError(
    await app.inject({ method: 'POST', url: correctionUrl, headers, payload: observation }),
    409,
    ACCOUNTS_ERROR_CODES.OBSERVATION_NOT_CURRENT,
  );
  const latest = await app.inject({ url: `${snapshots}/latest?asOf=${observedOn}`, headers });
  assert.deepEqual(latestBalanceSnapshotResponseSchema.parse(latest.json()), {
    snapshot: replacement,
  });
  const earlier = await app.inject({ url: `${snapshots}/latest?asOf=2024-03-31`, headers });
  assert.deepEqual(latestBalanceSnapshotResponseSchema.parse(earlier.json()), { snapshot: null });

  const archived = await app.inject({ method: 'POST', url: `${base}/archive`, headers });
  assert.equal(archived.statusCode, 200, archived.body);
  assert.ok(accountDtoSchema.parse(archived.json()).archivedAt);
  assert.deepEqual(
    (await app.inject({ url: '/accounts?includeArchived=false', headers })).json(),
    [],
  );
  const includingArchived = await app.inject({ url: '/accounts?includeArchived=true', headers });
  assert.deepEqual(accountDtoSchema.array().parse(includingArchived.json()), [archived.json()]);
  expectError(
    await app.inject({ method: 'POST', url: snapshots, headers, payload: observation }),
    409,
    ACCOUNTS_ERROR_CODES.ACCOUNT_ARCHIVED,
  );
  const historyResponse = await app.inject({ url: snapshots, headers });
  const [current, retired] = balanceSnapshotDtoSchema.array().parse(historyResponse.json());
  assert.deepEqual(current, replacement);
  assert.equal(retired?.id, original.id);
  assert.equal(retired?.balance, '10.05');
  assert.ok(retired?.retiredAt);
});

it('keeps other users out of account reads, writes, and snapshot corrections', async (t) => {
  const { app, register } = await setup(t);
  const owner = await register('owner@example.test');
  const other = await register('other@example.test');
  const create = async (headers: { authorization: string }) => {
    const response = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers,
      payload: bankAccount,
    });
    assert.equal(response.statusCode, 201, response.body);
    return accountDtoSchema.parse(response.json());
  };
  const owned = await create(owner);
  const otherAccount = await create(other);
  const base = `/accounts/${owned.id}`;
  const recorded = await app.inject({
    method: 'POST',
    url: `${base}/snapshots`,
    headers: owner,
    payload: observation,
  });
  assert.equal(recorded.statusCode, 201, recorded.body);
  const snapshot = balanceSnapshotDtoSchema.parse(recorded.json());

  const requests = [
    { method: 'PATCH', url: base, payload: { name: 'Not applied' } },
    { method: 'POST', url: `${base}/archive` },
    { method: 'GET', url: `${base}/snapshots` },
    { method: 'GET', url: `${base}/snapshots/latest` },
    { method: 'POST', url: `${base}/snapshots`, payload: observation },
    { method: 'POST', url: `${base}/snapshots/${snapshot.id}/corrections`, payload: observation },
  ] as const;
  for (const request of requests) {
    expectError(
      await app.inject({ ...request, headers: other }),
      404,
      ACCOUNTS_ERROR_CODES.ACCOUNT_NOT_FOUND,
    );
  }
  expectError(
    await app.inject({
      method: 'POST',
      url: `/accounts/${otherAccount.id}/snapshots/${snapshot.id}/corrections`,
      headers: other,
      payload: observation,
    }),
    404,
    ACCOUNTS_ERROR_CODES.OBSERVATION_NOT_FOUND,
  );
  assert.deepEqual((await app.inject({ url: '/accounts', headers: other })).json(), [otherAccount]);
  const otherReport = await app.inject({
    url: `/accounts/valuation?asOf=${observedOn}`,
    headers: other,
  });
  assert.deepEqual(
    accountsValuationDtoSchema.parse(otherReport.json()).accounts.map((line) => line.accountId),
    [otherAccount.id],
  );
  assert.deepEqual((await app.inject({ url: `${base}/snapshots`, headers: owner })).json(), [
    snapshot,
  ]);
});

it('returns a dated INR total from stored Frankfurter rates and separates incomplete subtotals', async (t) => {
  const { app, db, register } = await setup(t);
  const headers = await register('owner@example.test');
  const addBalance = async (currencyCode: string, balance: string) => {
    const created = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers,
      payload: { ...bankAccount, currencyCode },
    });
    const account = accountDtoSchema.parse(created.json());
    const recorded = await app.inject({
      method: 'POST',
      url: `/accounts/${account.id}/snapshots`,
      headers,
      payload: { observedOn, balance },
    });
    assert.equal(recorded.statusCode, 201, recorded.body);
    return account.id;
  };
  await addBalance('INR', '10.05');
  const foreignId = await addBalance('USD', '2');
  const url = '/accounts/valuation?asOf=2024-04-03';
  const withoutRate = accountsValuationDtoSchema.parse((await app.inject({ url, headers })).json());
  assert.equal(withoutRate.complete, false);
  assert.equal(withoutRate.totalInr, null);
  assert.equal(withoutRate.knownSubtotalInr, '10.05');
  assert.deepEqual(withoutRate.accounts.find((account) => account.accountId === foreignId)?.issue, {
    reason: 'missing_fx_rate',
  });

  const publishedAt = '2024-04-02T18:00:00.000Z';
  const rateId = randomUUID();
  db.insert(fxRates)
    .values({
      id: rateId,
      baseCurrencyCode: 'USD',
      quoteCurrencyCode: 'INR',
      rateOn: '2024-04-02',
      rateE8: 8_125_000_000,
      source: FRANKFURTER_SOURCE,
      fetchedAt: publishedAt,
      createdAt: publishedAt,
    })
    .run();

  const response = await app.inject({ url, headers });
  assert.equal(response.statusCode, 200, response.body);
  const valued = accountsValuationDtoSchema.parse(response.json());
  assert.equal(valued.asOf, '2024-04-03');
  assert.equal(valued.complete, true);
  assert.equal(valued.totalInr, '172.55');
  const foreign = valued.accounts.find((account) => account.accountId === foreignId);
  assert.equal(foreign?.snapshot?.balance, '2.00');
  assert.equal(foreign?.snapshot?.observedOn, observedOn);
  assert.equal(foreign?.inrBalance, '162.50');
  assert.deepEqual(foreign?.fxRate, {
    id: rateId,
    rateOn: '2024-04-02',
    rate: '81.25000000',
    source: FRANKFURTER_SOURCE,
    fetchedAt: publishedAt,
    ageDays: 1,
  });
});
