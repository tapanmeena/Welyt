import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDatabase, type AppDatabase, type CreateDatabaseOptions } from '../db/client.ts';
import {
  accountObservations,
  accounts,
  currencies,
  fxRates,
  incomeReceipts,
  users,
} from '../db/schema.ts';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
const observedOn = '2026-04-01';
const createdAt = '2026-04-02T08:00:00.000Z';

function openTestDatabase(t: TestContext, options?: CreateDatabaseOptions) {
  const connection = createDatabase(':memory:', options);
  t.after(connection.close);
  return connection;
}

function addUser(db: AppDatabase, id = 'owner') {
  return db
    .insert(users)
    .values({
      id,
      email: `${id}@example.test`,
      name: id,
      passwordHash: 'fixture-password-hash',
      createdAt,
      updatedAt: createdAt,
    })
    .returning()
    .get();
}

function addAccount(db: AppDatabase, id: string, currencyCode?: string) {
  return db
    .insert(accounts)
    .values({
      id,
      userId: 'owner',
      name: 'Everyday account',
      kind: 'bank',
      currencyCode,
      createdAt,
      updatedAt: createdAt,
    })
    .returning()
    .get();
}

it('migrates a fresh database with the launch currency catalog and keeps INR as the default', (t) => {
  const { db, sqlite } = openTestDatabase(t);
  assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1);
  assert.deepEqual(
    db
      .select({ code: currencies.code, minorUnits: currencies.minorUnits })
      .from(currencies)
      .orderBy(currencies.code)
      .all(),
    [
      { code: 'AED', minorUnits: 2 },
      { code: 'AUD', minorUnits: 2 },
      { code: 'CAD', minorUnits: 2 },
      { code: 'CHF', minorUnits: 2 },
      { code: 'EUR', minorUnits: 2 },
      { code: 'GBP', minorUnits: 2 },
      { code: 'INR', minorUnits: 2 },
      { code: 'JPY', minorUnits: 0 },
      { code: 'SGD', minorUnits: 2 },
      { code: 'USD', minorUnits: 2 },
    ],
  );
  assert.deepEqual(db.select().from(fxRates).all(), []);

  addUser(db);
  assert.equal(addAccount(db, 'everyday').currencyCode, 'INR');
});

function copyMigrationPrefix(t: TestContext, count: number): string {
  const folder = mkdtempSync(join(tmpdir(), 'welyt-migration-prefix-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const journal: { entries: { tag: string }[] } = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  );
  const entries = journal.entries.slice(0, count);
  assert.equal(entries.length, count);
  for (const { tag } of entries) {
    const file = `${tag}.sql`;
    copyFileSync(join(migrationsFolder, file), join(folder, file));
  }
  mkdirSync(join(folder, 'meta'));
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }));
  return folder;
}

it('upgrades an auth-only database without replacing existing user data', (t) => {
  const { db, sqlite } = openTestDatabase(t, { migrationsFolder: copyMigrationPrefix(t, 1) });
  const existingUser = addUser(db);
  migrate(db, { migrationsFolder });

  assert.deepEqual(db.select().from(users).all(), [existingUser]);
  assert.equal(addAccount(db, 'first-financial-account').userId, existingUser.id);
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
});

it('adds income receipts without rewriting existing users, accounts, snapshots, or rates', (t) => {
  const { db, sqlite } = openTestDatabase(t, { migrationsFolder: copyMigrationPrefix(t, 3) });
  const owner = addUser(db);
  const account = addAccount(db, 'kept-account');
  const snapshot = db
    .insert(accountObservations)
    .values({
      id: 'kept-snapshot',
      accountId: account.id,
      observedOn,
      balanceHundredths: 100,
      source: 'manual',
      createdAt,
    })
    .returning()
    .get();
  const rate = db
    .insert(fxRates)
    .values({
      id: 'kept-rate',
      baseCurrencyCode: 'USD',
      quoteCurrencyCode: 'INR',
      rateOn: observedOn,
      rateE8: 8_100_000_000,
      source: 'frankfurter',
      fetchedAt: createdAt,
      createdAt,
    })
    .returning()
    .get();

  migrate(db, { migrationsFolder });

  assert.deepEqual(db.select().from(incomeReceipts).all(), []);
  assert.deepEqual(db.select().from(users).all(), [owner]);
  assert.deepEqual(db.select().from(accounts).all(), [account]);
  assert.deepEqual(db.select().from(accountObservations).all(), [snapshot]);
  assert.deepEqual(db.select().from(fxRates).all(), [rate]);
  assert.deepEqual(sqlite.pragma('foreign_key_check'), []);
});

it('enforces exact positive amounts and rejects cross-owner or branching receipt corrections in SQLite', (t) => {
  const { db, sqlite } = openTestDatabase(t);
  addUser(db);
  addUser(db, 'second-owner');
  const record = sqlite.prepare(
    `INSERT INTO income_receipts
      (id, user_id, received_date, type, source, currency_code, amount_hundredths,
       gross_hundredths, tds_hundredths, created_at, replaces_receipt_id)
     VALUES (@id, @userId, @receivedDate, 'Salary', 'Fixture', 'INR', @amount, @gross, @tds,
             @createdAt, @replacesReceiptId)`,
  );
  const original = {
    id: 'original',
    userId: 'owner',
    receivedDate: observedOn,
    amount: 10_000,
    gross: 12_000,
    tds: 1_000,
    createdAt,
    replacesReceiptId: null,
  };
  record.run(original);
  for (const invalid of [{ amount: 0 }, { amount: 1.5 }, { gross: 9_999 }, { tds: 2_001 }]) {
    assert.throws(() => record.run({ ...original, ...invalid, id: 'invalid' }), {
      code: 'SQLITE_CONSTRAINT_CHECK',
    });
  }
  const revised = { ...original, id: 'replacement', replacesReceiptId: original.id };
  assert.throws(() => record.run({ ...revised, userId: 'second-owner' }), {
    code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  });
  sqlite
    .prepare('UPDATE income_receipts SET retired_at = ? WHERE id = ?')
    .run(createdAt, original.id);
  record.run(revised);
  assert.throws(() => record.run({ ...revised, id: 'second-replacement' }), {
    code: 'SQLITE_CONSTRAINT_UNIQUE',
  });
  assert.equal(db.select().from(incomeReceipts).all().length, 2);
});

it('enforces one current balance per date and retains a same-account correction', (t) => {
  const { db, sqlite } = openTestDatabase(t);
  addUser(db);
  addAccount(db, 'checking');
  addAccount(db, 'other');
  const record = sqlite.prepare(
    `INSERT INTO account_observations
      (id, account_id, observed_on, balance_hundredths, source, replaces_observation_id, created_at)
     VALUES (?, ?, ?, ?, 'manual', ?, ?)`,
  );

  record.run('original', 'checking', observedOn, -250, null, createdAt);
  assert.throws(() => record.run('duplicate', 'checking', observedOn, 0, null, createdAt), {
    code: 'SQLITE_CONSTRAINT_UNIQUE',
  });
  assert.throws(() => record.run('wrong-account', 'other', observedOn, 0, 'original', createdAt), {
    code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  });

  sqlite.transaction(() => {
    sqlite
      .prepare('UPDATE account_observations SET retired_at = ? WHERE id = ?')
      .run(createdAt, 'original');
    record.run('replacement', 'checking', observedOn, 0, 'original', createdAt);
  })();
  assert.throws(
    () => record.run('second-replacement', 'checking', '2026-04-02', 500, 'original', createdAt),
    { code: 'SQLITE_CONSTRAINT_UNIQUE' },
  );
  assert.throws(
    () => sqlite.prepare('DELETE FROM accounts WHERE id = ?').run('checking'),
    /FOREIGN KEY constraint failed/,
  );
  assert.deepEqual(
    db
      .select({
        id: accountObservations.id,
        balance: accountObservations.balanceHundredths,
        retiredAt: accountObservations.retiredAt,
        replaces: accountObservations.replacesObservationId,
      })
      .from(accountObservations)
      .orderBy(accountObservations.id)
      .all(),
    [
      { id: 'original', balance: -250, retiredAt: createdAt, replaces: null },
      { id: 'replacement', balance: 0, retiredAt: null, replaces: 'original' },
    ],
  );
});

it('rejects invalid calendar dates, fractional storage values, and unsafe balances in SQLite', (t) => {
  const { db, sqlite } = openTestDatabase(t);
  addUser(db);
  addAccount(db, 'wallet');
  const record = sqlite.prepare(
    `INSERT INTO account_observations
      (id, account_id, observed_on, balance_hundredths, source, created_at)
     VALUES ('balance', 'wallet', ?, ?, 'manual', ?)`,
  );

  for (const [date, balance] of [
    ['2026-02-29', 10],
    [observedOn, 1.5],
    [observedOn, BigInt(Number.MAX_SAFE_INTEGER) + 1n],
  ]) {
    assert.throws(() => record.run(date, balance, createdAt), {
      code: 'SQLITE_CONSTRAINT_CHECK',
    });
  }
  record.run('2024-02-29', Number.MIN_SAFE_INTEGER, createdAt);
  assert.equal(
    db.select().from(accountObservations).get()?.balanceHundredths,
    Number.MIN_SAFE_INTEGER,
  );
});

it('enforces daily FX direction and separates shared rates from user-scoped overrides', (t) => {
  const { db, sqlite } = openTestDatabase(t);
  addUser(db);
  addUser(db, 'second-owner');
  assert.equal(addAccount(db, 'usd-checking', 'USD').currencyCode, 'USD');
  const record = sqlite.prepare(
    `INSERT INTO fx_rates
      (id, base_currency_code, quote_currency_code, rate_on, rate_e8, source, fetched_at, user_id, created_at)
     VALUES (@id, @base, @quote, @rateOn, @rate, @source, @fetchedAt, @userId, @createdAt)`,
  );
  const provider = {
    id: 'provider',
    base: 'USD',
    quote: 'INR',
    rateOn: observedOn,
    rate: 8_345_670_000,
    source: 'fixture-feed',
    fetchedAt: createdAt,
    userId: null,
    createdAt,
  };
  const manual = {
    ...provider,
    id: 'manual-owner',
    source: 'manual',
    fetchedAt: null,
    userId: 'owner',
  };

  record.run(provider);
  record.run(manual);
  record.run({ ...manual, id: 'manual-second-owner', userId: 'second-owner' });
  for (const duplicate of [provider, manual]) {
    assert.throws(() => record.run({ ...duplicate, id: 'duplicate' }), {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
    });
  }
  for (const invalid of [
    { ...provider, base: 'INR' },
    { ...provider, base: 'INR', quote: 'USD' },
    { ...provider, rate: 0 },
    { ...provider, userId: 'owner' },
    { ...manual, userId: null },
  ]) {
    assert.throws(() => record.run({ ...invalid, id: 'invalid' }), {
      code: 'SQLITE_CONSTRAINT_CHECK',
    });
  }
  sqlite.transaction(() => {
    sqlite.prepare('UPDATE fx_rates SET retired_at = ? WHERE id = ?').run(createdAt, provider.id);
    record.run({ ...provider, id: 'provider-revised', rate: 8_350_000_000 });
  })();
  assert.equal(db.select().from(fxRates).all().length, 4);
});
