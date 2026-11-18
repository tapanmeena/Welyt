import assert from 'node:assert/strict';
import { it, type TestContext } from 'node:test';
import { createDatabase } from '../db/client.ts';
import { currencies, users } from '../db/schema.ts';
import { AccountsService } from '../modules/accounts/accounts.service.ts';

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
  const { db, service } = setup(t);
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

  db.insert(currencies)
    .values({ code: 'JPY', name: 'Japanese Yen', minorUnits: 0, createdAt: nowIso })
    .run();
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
