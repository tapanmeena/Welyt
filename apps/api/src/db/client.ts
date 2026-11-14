import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export interface DatabaseConnection {
  db: AppDatabase;
  sqlite: SqliteDatabase;
  close: () => void;
}

export interface CreateDatabaseOptions {
  runMigrations?: boolean;
  migrationsFolder?: string;
}

const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function createDatabase(
  databaseUrl: string,
  options: CreateDatabaseOptions = {},
): DatabaseConnection {
  const isInMemory = databaseUrl === ':memory:';

  if (!isInMemory) {
    const resolvedPath = path.resolve(databaseUrl);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const sqlite = new Database(databaseUrl);

  if (!isInMemory) {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });

  if (options.runMigrations ?? true) {
    const migrationsFolder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
    migrate(db, { migrationsFolder });
  }

  return {
    db,
    sqlite,
    close: () => {
      sqlite.close();
    },
  };
}
