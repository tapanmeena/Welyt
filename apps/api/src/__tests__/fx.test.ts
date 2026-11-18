import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { createDatabase } from '../db/client.ts';
import { currencies, fxRates, users } from '../db/schema.ts';
import { FxService, type FxRateRequest } from '../modules/fx/fx.service.ts';

const nowIso = '2026-04-15T08:00:00.000Z';
const quoteDate = '2026-04-01';
const nextDate = '2026-04-02';

function quote(rateOn: string, rate: string, baseCurrencyCode = 'USD') {
  return { rateOn, rate, baseCurrencyCode, quoteCurrencyCode: 'INR' };
}

function setup(t: TestContext, now: () => Date = () => new Date(nowIso)) {
  const { db, close } = createDatabase(':memory:');
  t.after(close);
  db.insert(currencies)
    .values([
      { code: 'USD', name: 'US Dollar', minorUnits: 2, createdAt: nowIso },
      { code: 'EUR', name: 'Euro', minorUnits: 2, createdAt: nowIso },
    ])
    .run();
  db.insert(users)
    .values(
      ['owner', 'other-owner'].map((id) => ({
        id,
        name: id,
        email: `${id}@example.test`,
        passwordHash: 'fixture-password-hash',
        createdAt: nowIso,
        updatedAt: nowIso,
      })),
    )
    .run();

  const requests: FxRateRequest[] = [];
  let response: unknown = [];
  const service = new FxService(
    db,
    {
      source: 'fixture-feed',
      async fetchDailyRates(request) {
        requests.push(request);
        if (response instanceof Error) {
          throw response;
        }
        return response;
      },
    },
    now,
  );

  return {
    db,
    service,
    requests,
    respondWith(value: unknown) {
      response = value;
    },
  };
}

it('rounds provider rates exactly, deduplicates equivalent fetches, and keeps revised quotes', async (t) => {
  let instant = new Date(nowIso);
  const { db, service, requests, respondWith } = setup(t, () => instant);
  respondWith([quote(quoteDate, '83.123456785')]);
  assert.deepEqual(await service.refreshDailyRates(quoteDate, ['USD']), [
    { baseCurrencyCode: 'USD', status: 'inserted' },
  ]);
  assert.deepEqual(requests, [
    { rateOn: quoteDate, baseCurrencyCodes: ['USD'], quoteCurrencyCode: 'INR' },
  ]);
  const original = db.select().from(fxRates).get();
  assert.ok(original);
  assert.equal(original.rateE8, 8_312_345_679);
  assert.equal(original.rateOn, quoteDate);
  assert.equal(original.fetchedAt, nowIso);
  assert.equal(original.userId, null);

  respondWith([quote(quoteDate, '83.12345679')]);
  assert.deepEqual(await service.refreshDailyRates(quoteDate, ['USD']), [
    { baseCurrencyCode: 'USD', status: 'unchanged' },
  ]);
  assert.deepEqual(db.select().from(fxRates).all(), [original]);

  instant = new Date('2026-04-15T09:00:00.000Z');
  respondWith([quote(quoteDate, '84')]);
  assert.deepEqual(await service.refreshDailyRates(quoteDate, ['USD']), [
    { baseCurrencyCode: 'USD', status: 'revised' },
  ]);
  const history = db.select().from(fxRates).all();
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.find((row) => row.id === original.id),
    {
      ...original,
      retiredAt: instant.toISOString(),
    },
  );
  const current = history.find((row) => row.retiredAt === null);
  assert.equal(current?.rateE8, 8_400_000_000);
  assert.deepEqual(service.lookupRate('owner', 'USD', quoteDate), {
    status: 'same_day',
    ageDays: 0,
    rate: current,
  });
});

it('reports missing pairs and leaves non-publication dates empty', async (t) => {
  const { db, service, respondWith } = setup(t);
  respondWith([quote(quoteDate, '83')]);
  assert.deepEqual(await service.refreshDailyRates(quoteDate, ['USD', 'EUR']), [
    { baseCurrencyCode: 'USD', status: 'inserted' },
    { baseCurrencyCode: 'EUR', status: 'missing' },
  ]);
  const published = db.select().from(fxRates).all();

  respondWith([]);
  assert.deepEqual(await service.refreshDailyRates(nextDate, ['USD', 'EUR']), [
    { baseCurrencyCode: 'USD', status: 'missing' },
    { baseCurrencyCode: 'EUR', status: 'missing' },
  ]);
  assert.deepEqual(db.select().from(fxRates).all(), published);
  assert.deepEqual(service.lookupRate('owner', 'EUR', nextDate), { status: 'missing' });
});

it('rejects invalid batches and preserves previously stored quotes when refresh fails', async (t) => {
  const { db, service, requests, respondWith } = setup(t);
  respondWith([quote(quoteDate, '83')]);
  await service.refreshDailyRates(quoteDate, ['USD']);
  const before = db.select().from(fxRates).all();

  for (const invalid of [
    { ...quote(quoteDate, '85', 'EUR'), quoteCurrencyCode: 'USD' },
    quote(nextDate, '85', 'EUR'),
    quote(quoteDate, '0.000000004', 'EUR'),
    quote(quoteDate, '90071992.54740992', 'EUR'),
    quote(quoteDate, '86'), // Duplicate USD quote in the batch.
  ]) {
    respondWith([quote(quoteDate, '84'), invalid]);
    await assert.rejects(service.refreshDailyRates(quoteDate, ['USD', 'EUR']), {
      code: 'VALIDATION_ERROR',
    });
    assert.deepEqual(db.select().from(fxRates).all(), before);
  }

  respondWith([quote(quoteDate, '85', 'EUR')]);
  await assert.rejects(service.refreshDailyRates(quoteDate, ['USD']), { code: 'VALIDATION_ERROR' });
  respondWith(new Error('Fixture feed unavailable'));
  await assert.rejects(service.refreshDailyRates(quoteDate, ['USD']), /Fixture feed unavailable/);
  assert.deepEqual(db.select().from(fxRates).all(), before);

  const requestCount = requests.length;
  await assert.rejects(service.refreshDailyRates('2026-04-16', ['USD']), {
    code: 'VALIDATION_ERROR',
  });
  assert.equal(requests.length, requestCount);
});

it('applies only the requesting user override on a tie, without hiding newer shared rates', async (t) => {
  const { db, service, respondWith } = setup(t);
  respondWith([quote(quoteDate, '83')]);
  await service.refreshDailyRates(quoteDate, ['USD']);
  const shared = db.select().from(fxRates).get();

  const input = { baseCurrencyCode: 'USD', rateOn: quoteDate, rate: '84' };
  const manual = service.setManualRate('owner', input);
  assert.equal(manual.userId, 'owner');
  assert.equal(manual.fetchedAt, null);
  assert.deepEqual(service.setManualRate('owner', input), manual);
  const corrected = service.setManualRate('owner', { ...input, rate: '84.50' });
  assert.notEqual(corrected.id, manual.id);
  assert.deepEqual(service.lookupRate('owner', 'USD', quoteDate), {
    status: 'same_day',
    ageDays: 0,
    rate: corrected,
  });
  assert.deepEqual(service.lookupRate('other-owner', 'USD', quoteDate), {
    status: 'same_day',
    ageDays: 0,
    rate: shared,
  });
  const spoofed = { ...input, userId: 'owner' };
  assert.throws(() => service.setManualRate('other-owner', spoofed), { code: 'VALIDATION_ERROR' });
  const other = service.setManualRate('other-owner', { ...input, rate: '85' });
  assert.deepEqual(service.lookupRate('other-owner', 'USD', quoteDate), {
    status: 'same_day',
    ageDays: 0,
    rate: other,
  });

  respondWith([quote(nextDate, '86')]);
  await service.refreshDailyRates(nextDate, ['USD']);
  const newer = service.lookupRate('owner', 'USD', nextDate);
  assert.ok(newer.status === 'same_day');
  assert.equal(newer.rate.rateE8, 8_600_000_000);
  assert.equal(newer.rate.source, 'fixture-feed');
  assert.deepEqual(service.lookupRate('owner', 'USD', quoteDate), {
    status: 'same_day',
    ageDays: 0,
    rate: corrected,
  });
});

it('carries forward through seven calendar days without look-ahead or other providers', async (t) => {
  const { db, service, requests, respondWith } = setup(t);
  respondWith([quote(quoteDate, '83')]);
  await service.refreshDailyRates(quoteDate, ['USD']);
  const shared = db.select().from(fxRates).get();

  const otherProvider = new FxService(
    db,
    {
      source: 'other-fixture-feed',
      async fetchDailyRates() {
        return [quote('2026-04-09', '90')];
      },
    },
    () => new Date(nowIso),
  );
  await otherProvider.refreshDailyRates('2026-04-09', ['USD']);

  assert.deepEqual(service.lookupRate('owner', 'USD', '2026-03-31'), { status: 'missing' });
  assert.deepEqual(service.lookupRate('owner', 'USD', '2026-04-08'), {
    status: 'carried_forward',
    rate: shared,
    ageDays: 7,
  });
  assert.deepEqual(service.lookupRate('owner', 'USD', '2026-04-09'), {
    status: 'stale',
    rateOn: quoteDate,
    ageDays: 8,
  });
  assert.deepEqual(service.lookupRate('owner', 'INR'), { status: 'not_required' });
  assert.equal(requests.length, 1);
});
