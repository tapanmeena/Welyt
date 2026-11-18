import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { createDatabase } from '../db/client.ts';
import { users } from '../db/schema.ts';
import { AccountsValuationService } from '../modules/accounts/accounts-valuation.service.ts';
import { AccountsService, type CreateAccountInput } from '../modules/accounts/accounts.service.ts';
import { FxService } from '../modules/fx/fx.service.ts';

const nowIso = '2026-04-04T08:00:00.000Z';
const bankAccount = { name: 'Everyday account', kind: 'bank' } as const;
const balanceEntry = { observedOn: '2026-04-01', balance: '10.05' };

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
  return { db, service: new AccountsService(db, now) };
}

it('creates and updates account metadata without letting a payload change its currency or owner', (t) => {
  const { service } = setup(t);
  assert.throws(() => service.createAccount('owner', { ...bankAccount, name: '  ' }), {
    code: 'VALIDATION_ERROR',
  });
  assert.throws(() => service.createAccount('owner', { ...bankAccount, currencyCode: 'ZZZ' }), {
    code: 'VALIDATION_ERROR',
  });
  const wrongOwner = { ...bankAccount, userId: 'other-owner' };
  assert.throws(() => service.createAccount('owner', wrongOwner), { code: 'VALIDATION_ERROR' });

  const account = service.createAccount('owner', { ...bankAccount, notes: 'Original note' });
  assert.equal(account.userId, 'owner');
  assert.equal(account.currencyCode, 'INR');
  assert.equal(account.inNetWorth, true);
  const updated = service.updateAccount('owner', account.id, {
    name: '  Travel cash  ',
    inNetWorth: false,
    notes: null,
  });
  assert.equal(updated.name, 'Travel cash');
  assert.equal(updated.inNetWorth, false);
  assert.equal(updated.notes, null);
  const currencyChange = { name: 'Not applied', currencyCode: 'USD' };
  assert.throws(() => service.updateAccount('owner', account.id, currencyChange), {
    code: 'VALIDATION_ERROR',
  });
  assert.deepEqual(service.listAccounts('owner'), [updated]);
});

it('scopes every account and observation operation to the owning user', (t) => {
  const { service } = setup(t);
  const owned = service.createAccount('owner', bankAccount);
  const other = service.createAccount('other-owner', bankAccount);
  const observation = service.recordObservation('owner', owned.id, balanceEntry);

  assert.deepEqual(service.listAccounts('other-owner', { includeArchived: true }), [other]);
  for (const operation of [
    () => service.updateAccount('other-owner', owned.id, { name: 'Not applied' }),
    () => service.archiveAccount('other-owner', owned.id),
    () => service.recordObservation('other-owner', owned.id, balanceEntry),
    () => service.correctObservation('other-owner', owned.id, observation.id, balanceEntry),
    () => service.listObservations('other-owner', owned.id),
    () => service.getLatestObservation('other-owner', owned.id),
  ]) {
    assert.throws(operation, { code: 'ACCOUNT_NOT_FOUND', message: 'Account not found' });
  }
  assert.throws(
    () => service.correctObservation('other-owner', other.id, observation.id, balanceEntry),
    { code: 'OBSERVATION_NOT_FOUND' },
  );
  assert.deepEqual(service.listObservations('owner', owned.id), [observation]);
  assert.deepEqual(service.listAccounts('owner'), [owned]);
});

it('changes business dates at India midnight and uses the observation date rather than creation order', (t) => {
  let instant = new Date('2026-03-31T18:29:59.999Z');
  const { service } = setup(t, () => instant);
  const account = service.createAccount('owner', bankAccount);
  assert.throws(() => service.recordObservation('owner', account.id, balanceEntry), {
    code: 'VALIDATION_ERROR',
    fieldErrors: { observedOn: ['Date cannot be in the future in India'] },
  });
  assert.throws(
    () =>
      service.recordObservation('owner', account.id, { ...balanceEntry, observedOn: '2026-02-29' }),
    { code: 'VALIDATION_ERROR' },
  );

  instant = new Date('2026-03-31T18:30:00.000Z');
  const april = service.recordObservation('owner', account.id, balanceEntry);
  assert.equal(april.observedOn, '2026-04-01');
  assert.equal(april.createdAt, '2026-03-31T18:30:00.000Z');
  instant = new Date('2026-03-31T18:31:00.000Z');
  const march = service.recordObservation('owner', account.id, {
    observedOn: '2026-03-31',
    balance: '9.99',
  });
  assert.deepEqual(service.getLatestObservation('owner', account.id), april);
  assert.deepEqual(service.getLatestObservation('owner', account.id, '2026-03-31'), march);
  assert.deepEqual(service.listObservations('owner', account.id), [april, march]);
});

it('stores exact signed balances, preserves explicit zero, and validates native currency precision', (t) => {
  const { service } = setup(t);
  const account = service.createAccount('owner', bankAccount);
  for (const balance of ['1.001', '1e2', '90071992547409.92']) {
    assert.throws(
      () => service.recordObservation('owner', account.id, { ...balanceEntry, balance }),
      {
        code: 'VALIDATION_ERROR',
      },
    );
  }
  assert.equal(service.getLatestObservation('owner', account.id), null);

  const minimum = service.recordObservation('owner', account.id, {
    ...balanceEntry,
    balance: '-90071992547409.91',
  });
  assert.equal(minimum.balance, '-90071992547409.91');
  const zero = service.recordObservation('owner', account.id, {
    observedOn: '2026-04-02',
    balance: '-0',
  });
  assert.equal(zero.balance, '0.00');
  assert.deepEqual(service.getLatestObservation('owner', account.id), zero);

  const foreign = service.createAccount('owner', { ...bankAccount, currencyCode: 'JPY' });
  assert.throws(
    () => service.recordObservation('owner', foreign.id, { ...balanceEntry, balance: '100.01' }),
    { code: 'VALIDATION_ERROR' },
  );
  const native = service.recordObservation('owner', foreign.id, {
    ...balanceEntry,
    balance: '100.00',
  });
  assert.equal(native.currencyCode, 'JPY');
  assert.equal(native.balance, '100.00');
});

it('rolls back corrections into occupied dates and retains both same-date and wrong-date revisions', (t) => {
  const { service } = setup(t);
  const account = service.createAccount('owner', bankAccount);
  const first = service.recordObservation('owner', account.id, balanceEntry);
  const later = service.recordObservation('owner', account.id, {
    observedOn: '2026-04-03',
    balance: '20',
  });
  assert.throws(() => service.recordObservation('owner', account.id, balanceEntry), {
    code: 'OBSERVATION_DATE_OCCUPIED',
  });
  assert.throws(
    () =>
      Reflect.apply(service.correctObservation, service, [
        'owner',
        account.id,
        undefined,
        { observedOn: '2026-04-02', balance: '11' },
      ]),
    { code: 'VALIDATION_ERROR' },
  );
  assert.throws(
    () =>
      service.correctObservation('owner', account.id, first.id, {
        observedOn: later.observedOn,
        balance: '11',
      }),
    { code: 'OBSERVATION_DATE_OCCUPIED' },
  );
  assert.deepEqual(service.getLatestObservation('owner', account.id, first.observedOn), first);
  assert.deepEqual(service.listObservations('owner', account.id), [later, first]);

  const revised = service.correctObservation('owner', account.id, first.id, {
    ...balanceEntry,
    balance: '10.25',
  });
  assert.equal(revised.replacesObservationId, first.id);
  assert.deepEqual(service.getLatestObservation('owner', account.id, first.observedOn), revised);
  assert.throws(() => service.correctObservation('owner', account.id, first.id, balanceEntry), {
    code: 'OBSERVATION_NOT_CURRENT',
  });

  const moved = service.correctObservation('owner', account.id, revised.id, {
    observedOn: '2026-04-02',
    balance: '10.25',
  });
  assert.equal(moved.replacesObservationId, revised.id);
  assert.equal(service.getLatestObservation('owner', account.id, first.observedOn), null);
  assert.deepEqual(service.getLatestObservation('owner', account.id, moved.observedOn), moved);
  const history = service.listObservations('owner', account.id);
  assert.deepEqual(
    history.filter((row) => row.retiredAt === null),
    [later, moved],
  );
  assert.deepEqual(
    history.find((row) => row.id === first.id),
    { ...first, retiredAt: nowIso },
  );
  assert.deepEqual(
    history.find((row) => row.id === revised.id),
    { ...revised, retiredAt: nowIso },
  );
});

it('archives an account without altering its history and prevents more balance writes', (t) => {
  let instant = new Date(nowIso);
  const { service } = setup(t, () => instant);
  const account = service.createAccount('owner', bankAccount);
  const observation = service.recordObservation('owner', account.id, balanceEntry);
  const archived = service.archiveAccount('owner', account.id);
  assert.equal(archived.archivedAt, nowIso);
  instant = new Date('2026-04-05T08:00:00.000Z');
  assert.deepEqual(service.archiveAccount('owner', account.id), archived);
  assert.deepEqual(service.listAccounts('owner'), []);
  assert.deepEqual(service.listAccounts('owner', { includeArchived: true }), [archived]);
  assert.deepEqual(service.listObservations('owner', account.id), [observation]);
  assert.deepEqual(service.getLatestObservation('owner', account.id), observation);
  for (const operation of [
    () => service.updateAccount('owner', account.id, { name: 'Not applied' }),
    () =>
      service.recordObservation('owner', account.id, { ...balanceEntry, observedOn: '2026-04-02' }),
    () => service.correctObservation('owner', account.id, observation.id, balanceEntry),
  ]) {
    assert.throws(operation, { code: 'ACCOUNT_ARCHIVED' });
  }
});

function setupValuation(t: TestContext, now: () => Date = () => new Date(nowIso)) {
  const { db, service } = setup(t, now);
  const source = 'valuation-fixture';
  let quotes: {
    baseCurrencyCode: string;
    quoteCurrencyCode: string;
    rateOn: string;
    rate: string;
  }[] = [];
  const fx = new FxService(
    db,
    {
      source,
      async fetchDailyRates() {
        return quotes;
      },
    },
    now,
  );

  return {
    service,
    fx,
    report: new AccountsValuationService(db, source, now),
    async publishRate(baseCurrencyCode: string, rateOn: string, rate: string) {
      quotes = [{ baseCurrencyCode, quoteCurrencyCode: 'INR', rateOn, rate }];
      await fx.refreshDailyRates(rateOn, [baseCurrencyCode]);
    },
    addBalance(
      input: CreateAccountInput,
      balance: string,
      observedOn = balanceEntry.observedOn,
      userId = 'owner',
    ) {
      const account = service.createAccount(userId, input);
      const snapshot = service.recordObservation(userId, account.id, { observedOn, balance });
      return { account, snapshot };
    },
  };
}

it('values an unchanged snapshot using rates on the report date and shows when a rate is carried forward', async (t) => {
  const { service, report, publishRate, addBalance } = setupValuation(t);
  const { account, snapshot } = addBalance(
    { ...bankAccount, currencyCode: 'USD' },
    '2',
    '2026-03-31',
  );
  await publishRate('USD', '2026-04-01', '80');
  const first = report.valueAccounts('owner', '2026-04-01');
  assert.equal(first.totalInr, '160.00');
  assert.equal(first.complete, true);

  const laterSnapshot = service.recordObservation('owner', account.id, {
    observedOn: '2026-04-04',
    balance: '3.50',
  });
  await publishRate('USD', '2026-04-02', '82');
  const second = report.valueAccounts('owner', '2026-04-02');
  assert.equal(second.totalInr, '164.00');
  assert.equal(second.reportingCurrencyCode, 'INR');
  const [line] = second.accounts;
  assert.ok(line?.fxRate);
  assert.equal(line.accountId, account.id);
  assert.equal(line.currencyCode, 'USD');
  assert.deepEqual(line.snapshot, {
    id: snapshot.id,
    observedOn: '2026-03-31',
    balance: '2.00',
  });
  assert.deepEqual(line.snapshot, first.accounts[0]?.snapshot);
  assert.deepEqual(line.fxRate, {
    id: line.fxRate.id,
    rateOn: '2026-04-02',
    source: 'valuation-fixture',
    fetchedAt: nowIso,
    rate: '82.00000000',
    ageDays: 0,
  });
  assert.notEqual(line.fxRate.id, first.accounts[0]?.fxRate?.id);
  assert.equal(report.valueAccounts('owner', '2026-04-01').totalInr, '160.00');

  const carried = report.valueAccounts('owner', '2026-04-03');
  assert.equal(carried.totalInr, '164.00');
  assert.deepEqual(carried.accounts[0]?.fxRate, { ...line.fxRate, ageDays: 1 });
  assert.deepEqual(service.listObservations('owner', account.id), [laterSnapshot, snapshot]);
});

it('rounds each signed conversion to paise before summing without losing precision', (t) => {
  const { fx, report, addBalance } = setupValuation(t);
  const ownRate = fx.setManualRate('owner', {
    baseCurrencyCode: 'USD',
    rateOn: '2026-04-01',
    rate: '1.5',
  });
  fx.setManualRate('other-owner', { baseCurrencyCode: 'USD', rateOn: '2026-04-01', rate: '3' });

  const foreign = { ...bankAccount, currencyCode: 'USD' };
  for (const balance of ['0.01', '0.01', '0.01', '-0.01', '90071992547409.91']) {
    addBalance(foreign, balance);
  }
  addBalance(bankAccount, '90071992547409.91');

  const valuation = report.valueAccounts('owner', '2026-04-01');
  const foreignValues = valuation.accounts.filter((account) => account.currencyCode === 'USD');
  assert.deepEqual(foreignValues.map((account) => account.inrBalance).sort(), [
    '-0.02',
    '0.02',
    '0.02',
    '0.02',
    '135107988821114.87',
  ]);
  assert.ok(foreignValues.every((account) => account.fxRate?.id === ownRate.id));
  assert.equal(valuation.complete, true);
  assert.equal(valuation.knownSubtotalInr, '225179981368524.82');
  assert.equal(valuation.totalInr, '225179981368524.82');
});

it('returns only a known subtotal when data is missing, without counting archived or excluded accounts', async (t) => {
  const { service, report, addBalance, publishRate } = setupValuation(
    t,
    () => new Date('2026-04-15T08:00:00.000Z'),
  );
  const known = addBalance(bankAccount, '12.50').account;
  const zero = addBalance({ ...bankAccount, currencyCode: 'EUR' }, '0.00').account;
  const missing = addBalance({ ...bankAccount, currencyCode: 'EUR' }, '5.20').account;
  const stale = addBalance({ ...bankAccount, currencyCode: 'USD' }, '3.00').account;
  const unknown = addBalance(bankAccount, '25', '2026-04-11').account;
  const archived = addBalance(bankAccount, '1000.00').account;
  service.archiveAccount('owner', archived.id);
  addBalance({ ...bankAccount, inNetWorth: false, currencyCode: 'EUR' }, '1000.00');
  addBalance(bankAccount, '700.00', '2026-04-01', 'other-owner');
  await publishRate('USD', '2026-04-01', '80');

  const valuation = report.valueAccounts('owner', '2026-04-10');
  assert.equal(valuation.complete, false);
  assert.equal(valuation.totalInr, null);
  assert.equal(valuation.knownSubtotalInr, '12.50');
  const lines = new Map(valuation.accounts.map((account) => [account.accountId, account]));
  assert.deepEqual(
    [...lines.keys()].sort(),
    [known.id, zero.id, missing.id, stale.id, unknown.id].sort(),
  );
  assert.equal(lines.get(known.id)?.inrBalance, '12.50');
  assert.equal(lines.get(zero.id)?.inrBalance, '0.00');
  assert.equal(lines.get(zero.id)?.fxRate, null);
  assert.equal(lines.get(zero.id)?.issue, null);
  assert.equal(lines.get(missing.id)?.inrBalance, null);
  assert.equal(lines.get(missing.id)?.snapshot?.balance, '5.20');
  assert.deepEqual(lines.get(missing.id)?.issue, { reason: 'missing_fx_rate' });
  assert.equal(lines.get(stale.id)?.inrBalance, null);
  assert.deepEqual(lines.get(stale.id)?.issue, {
    reason: 'stale_fx_rate',
    rateOn: '2026-04-01',
    ageDays: 9,
  });
  assert.equal(lines.get(unknown.id)?.snapshot, null);
  assert.deepEqual(lines.get(unknown.id)?.issue, { reason: 'missing_snapshot' });
});

it('derives fiscal-year boundaries from the India-local report date', (t) => {
  let instant = new Date('2026-03-31T18:29:59.999Z');
  const { db } = setup(t);
  const report = new AccountsValuationService(db, null, () => instant);

  const march = report.valueAccounts('owner');
  assert.equal(march.asOf, '2026-03-31');
  assert.deepEqual(march.fiscalYear, { startsOn: '2025-04-01', endsBefore: '2026-04-01' });
  assert.equal(march.complete, true);
  assert.equal(march.totalInr, '0.00');
  assert.throws(() => report.valueAccounts('owner', '2026-04-01'), {
    code: 'VALIDATION_ERROR',
    fieldErrors: { asOf: ['Date cannot be in the future in India'] },
  });

  instant = new Date('2026-03-31T18:30:00.000Z');
  const april = report.valueAccounts('owner');
  assert.equal(april.asOf, '2026-04-01');
  assert.deepEqual(april.fiscalYear, { startsOn: '2026-04-01', endsBefore: '2027-04-01' });
});
