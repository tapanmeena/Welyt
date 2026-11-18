import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { createDatabase } from '../db/client.ts';
import { fxRates, users } from '../db/schema.ts';
import {
  FRANKFURTER_SOURCE,
  FrankfurterProvider,
  LAUNCH_FX_CURRENCIES,
} from '../modules/fx/frankfurter.provider.ts';
import { FxBackfillError, backfillFrankfurterRates } from '../modules/fx/fx.backfill.ts';
import { startDailyFxRefresh } from '../modules/fx/fx.job.ts';
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
    { baseCurrencyCode: 'USD', status: 'inserted', rateOn: quoteDate },
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
    { baseCurrencyCode: 'USD', status: 'unchanged', rateOn: quoteDate },
  ]);
  assert.deepEqual(db.select().from(fxRates).all(), [original]);

  instant = new Date('2026-04-15T09:00:00.000Z');
  respondWith([quote(quoteDate, '84')]);
  assert.deepEqual(await service.refreshDailyRates(quoteDate, ['USD']), [
    { baseCurrencyCode: 'USD', status: 'revised', rateOn: quoteDate },
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
    { baseCurrencyCode: 'USD', status: 'inserted', rateOn: quoteDate },
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

it('imports one Frankfurter batch with exact reciprocals and the dates actually published', async (t) => {
  const { db } = setup(t);
  const urls: string[] = [];
  let upstream = new Response(
    'date,base,quote,rate\n2026-04-14,INR,USD,0.03\n2026-04-15,INR,JPY,4\n',
  );
  const provider = new FrankfurterProvider(async (url) => {
    urls.push(String(url));
    return upstream;
  });
  const fx = new FxService(db, provider, () => new Date(nowIso));
  const codes = ['USD', 'JPY', 'AED'];
  assert.deepEqual(await fx.refreshLatestRates(codes), [
    { baseCurrencyCode: 'USD', status: 'inserted', rateOn: '2026-04-14' },
    { baseCurrencyCode: 'JPY', status: 'inserted', rateOn: '2026-04-15' },
    { baseCurrencyCode: 'AED', status: 'missing' },
  ]);
  assert.deepEqual(urls, [
    'https://api.frankfurter.dev/v2/rates.csv?base=INR&quotes=USD%2CJPY%2CAED',
  ]);
  const usd = fx.lookupRate('owner', 'USD', '2026-04-15');
  assert.equal(usd.status, 'carried_forward');
  assert.equal(usd.status === 'carried_forward' && usd.rate.rateE8, 3_333_333_333);
  assert.equal(usd.status === 'carried_forward' && usd.rate.source, FRANKFURTER_SOURCE);
  const jpy = fx.lookupRate('owner', 'JPY', '2026-04-15');
  assert.equal(jpy.status === 'same_day' && jpy.rate.rateE8, 25_000_000);
  const stored = db.select().from(fxRates).all();

  upstream = new Response('date,base,quote,rate\n2026-04-14,INR,USD,0.04\n2026-04-16,INR,JPY,4\n');
  await assert.rejects(fx.refreshLatestRates(codes), { code: 'VALIDATION_ERROR' });
  assert.deepEqual(db.select().from(fxRates).all(), stored);

  upstream = new Response(null, { status: 503 });
  await assert.rejects(fx.refreshLatestRates(codes), /Frankfurter returned HTTP 503/);
  assert.deepEqual(db.select().from(fxRates).all(), stored);
});

it('previews and backfills the first available date without overwriting existing rates', async (t) => {
  const { db } = setup(t);
  const provider = new FrankfurterProvider(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('base'), 'INR');
    assert.equal(url.searchParams.get('quotes'), LAUNCH_FX_CURRENCIES.join(','));
    assert.equal(url.searchParams.get('from'), '2020-04-01');
    assert.equal(url.searchParams.get('to'), '2020-04-03');
    return new Response('date,base,quote,rate\n2020-04-03,INR,USD,0.02\n2020-04-02,INR,USD,0.03\n');
  });
  const now = () => new Date(nowIso);
  const fx = new FxService(db, provider, now);
  const manual = fx.setManualRate('owner', {
    baseCurrencyCode: 'USD',
    rateOn: '2020-04-02',
    rate: '92',
  });
  const saved = db
    .insert(fxRates)
    .values({
      id: 'existing-daily-rate',
      source: FRANKFURTER_SOURCE,
      baseCurrencyCode: 'USD',
      quoteCurrencyCode: 'INR',
      rateOn: '2020-04-03',
      rateE8: 8_100_000_000,
      fetchedAt: nowIso,
      createdAt: nowIso,
    })
    .returning()
    .get();
  const range = { from: '2020-04-01', to: '2020-04-03' };

  const preview = await backfillFrankfurterRates(db, provider, { ...range, dryRun: true }, now);
  assert.equal(preview.daysChecked, 3);
  assert.deepEqual(
    preview.currencies.find(({ currencyCode }) => currencyCode === 'USD'),
    {
      currencyCode: 'USD',
      firstRateOn: '2020-04-02',
      lastRateOn: '2020-04-03',
      available: 2,
      existing: 1,
      newRates: 1,
    },
  );
  assert.deepEqual(db.select().from(fxRates).all(), [manual, saved]);

  assert.deepEqual(await backfillFrankfurterRates(db, provider, range, now), preview);
  const imported = db.select().from(fxRates).all();
  assert.equal(imported.length, 3);
  assert.deepEqual(
    imported.find(({ id }) => id === manual.id),
    manual,
  );
  assert.deepEqual(
    imported.find(({ id }) => id === saved.id),
    saved,
  );
  const historical = imported.find((row) => row.userId === null && row.rateOn === '2020-04-02');
  assert.equal(historical?.rateE8, 3_333_333_333);
  assert.equal(historical.fetchedAt, nowIso);
  const lookup = fx.lookupRate('owner', 'USD', '2020-04-02');
  assert.equal(lookup.status === 'same_day' && lookup.rate.id, manual.id);

  const rerun = await backfillFrankfurterRates(db, provider, range, now);
  assert.ok(rerun.currencies.every(({ newRates }) => newRates === 0));
  assert.deepEqual(db.select().from(fxRates).all(), imported);
});

it('continues past an unavailable window and never invents dated rates', async (t) => {
  const { db } = setup(t);
  const windows: [string | null, string | null][] = [];
  const provider = new FrankfurterProvider(async (input) => {
    const { searchParams } = new URL(String(input));
    windows.push([searchParams.get('from'), searchParams.get('to')]);
    return new Response(
      searchParams.get('from') === '2020-04-01'
        ? 'date,base,quote,rate\n'
        : 'date,base,quote,rate\n2020-05-04,INR,AED,0.25\n',
    );
  });
  const summary = await backfillFrankfurterRates(
    db,
    provider,
    {
      from: '2020-04-01',
      to: '2020-05-04',
    },
    () => new Date(nowIso),
  );
  assert.deepEqual(windows, [
    ['2020-04-01', '2020-05-01'],
    ['2020-05-02', '2020-05-04'],
  ]);
  assert.equal(summary.daysChecked, 34);
  const aed = summary.currencies.find(({ currencyCode }) => currencyCode === 'AED');
  assert.equal(aed?.firstRateOn, '2020-05-04');
  assert.equal(aed.newRates, 1);
  const stored = db.select().from(fxRates).all();
  assert.deepEqual(
    stored.map(({ baseCurrencyCode, rateOn, rateE8 }) => ({ baseCurrencyCode, rateOn, rateE8 })),
    [{ baseCurrencyCode: 'AED', rateOn: '2020-05-04', rateE8: 400_000_000 }],
  );
});

it('keeps completed chunks and reports progress when a later historical window fails', async (t) => {
  const { db } = setup(t);
  let laterResponse = new Response(null, { status: 503 });
  const provider = new FrankfurterProvider(async (input) => {
    const { searchParams } = new URL(String(input));
    return searchParams.get('from') === '2020-04-01'
      ? new Response('date,base,quote,rate\n2020-04-01,INR,USD,0.02\n')
      : laterResponse;
  });
  const run = () =>
    backfillFrankfurterRates(
      db,
      provider,
      {
        from: '2020-04-01',
        to: '2020-05-04',
      },
      () => new Date(nowIso),
    );

  await assert.rejects(run, (error) => {
    assert.ok(error instanceof FxBackfillError);
    assert.match(error.message, /2020-05-02 through 2020-05-04: Frankfurter returned HTTP 503/);
    assert.equal(error.summary.daysChecked, 31);
    assert.equal(
      error.summary.currencies.find(({ currencyCode }) => currencyCode === 'USD')?.newRates,
      1,
    );
    return true;
  });
  const completed = db.select().from(fxRates).all();
  assert.equal(completed.length, 1);

  for (const invalidRow of [
    '2020-05-02,INR,EUR,0.02', // Same pair and date as the first row.
    '2020-05-01,INR,JPY,4', // Outside this chunk.
    '2020-05-02,INR,MXN,0.25', // Not requested.
    '2020-05-02,INR,JPY,0', // Invalid reciprocal.
  ]) {
    laterResponse = new Response(`date,base,quote,rate\n2020-05-02,INR,EUR,0.01\n${invalidRow}\n`);
    await assert.rejects(run, /Historical FX backfill failed for 2020-05-02 through 2020-05-04/);
    assert.deepEqual(db.select().from(fxRates).all(), completed);
  }
});

it('rejects invalid date bounds before requesting historical rates', async (t) => {
  const { db } = setup(t);
  const provider = new FrankfurterProvider(async () => {
    assert.fail('Invalid date ranges must not reach Frankfurter');
  });
  const now = () => new Date(nowIso);
  for (const range of [
    { from: '2020-02-30', to: '2020-04-01' },
    { from: '2020-04-02', to: '2020-04-01' },
    { from: '2020-04-01', to: '2026-04-16' },
  ]) {
    await assert.rejects(backfillFrankfurterRates(db, provider, range, now), {
      code: 'VALIDATION_ERROR',
    });
  }
});

it('retries the next evening after a failed startup refresh and stops with the app', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date('2026-04-15T16:29:00Z') });
  const runs: string[] = [];
  let warnings = 0;
  const stop = startDailyFxRefresh(
    async () => {
      runs.push(new Date().toISOString());
      if (runs.length === 1) {
        throw new Error('Temporary provider failure');
      }
      return [{ baseCurrencyCode: 'USD', rateOn: '2026-04-15', status: 'inserted' }];
    },
    {
      info() {},
      warn() {
        warnings += 1;
      },
    },
  );
  t.after(stop);
  await Promise.resolve();
  assert.equal(warnings, 1);
  t.mock.timers.tick(59_999);
  assert.deepEqual(runs, ['2026-04-15T16:29:00.000Z']);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.deepEqual(runs, ['2026-04-15T16:29:00.000Z', '2026-04-15T16:30:00.000Z']);
  await stop();
  t.mock.timers.tick(2 * 86_400_000);
  assert.equal(runs.length, 2);
});
