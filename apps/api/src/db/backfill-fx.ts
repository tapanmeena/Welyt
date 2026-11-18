import path from 'node:path';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { loadApiEnv } from '../config/env.ts';
import { FrankfurterProvider } from '../modules/fx/frankfurter.provider.ts';
import {
  FxBackfillError,
  backfillFrankfurterRates,
  type FxBackfillSummary,
} from '../modules/fx/fx.backfill.ts';
import * as schema from './schema.ts';

function printCoverage(summary: FxBackfillSummary, dryRun: boolean): void {
  console.info(`Calendar days checked: ${summary.daysChecked}`);
  console.table(
    summary.currencies.map(
      ({ currencyCode, firstRateOn, lastRateOn, available, existing, newRates }) => ({
        currencyCode,
        firstRateOn,
        lastRateOn,
        available,
        existing,
        [dryRun ? 'wouldInsert' : 'inserted']: newRates,
        notReturned: summary.daysChecked - available,
      }),
    ),
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const { from, to, 'dry-run': dryRun } = values;
  if (!from || !to) {
    throw new Error(
      'Usage: pnpm run api:fx:backfill --from YYYY-MM-DD --to YYYY-MM-DD [--dry-run]',
    );
  }

  const { databaseUrl } = loadApiEnv();
  if (databaseUrl === ':memory:') {
    throw new Error('Historical FX backfill requires an existing SQLite database file');
  }
  const filename = path.resolve(databaseUrl);
  const sqlite = new Database(filename, { fileMustExist: true, readonly: dryRun });
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    const db = drizzle(sqlite, { schema });
    console.info(
      `${dryRun ? 'Previewing' : 'Backfilling'} FX from ${from} through ${to} in ${filename}`,
    );
    const summary = await backfillFrankfurterRates(db, new FrankfurterProvider(), {
      from,
      to,
      dryRun,
    });
    printCoverage(summary, dryRun);
  } catch (error) {
    if (error instanceof FxBackfillError) printCoverage(error.summary, dryRun);
    throw error;
  } finally {
    sqlite.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
