import { loadApiEnv } from '../config/env.ts';
import { createDatabase } from './client.ts';

const env = loadApiEnv();
const connection = createDatabase(env.databaseUrl, { runMigrations: true });
connection.close();
console.info(`Migrations applied cleanly to ${env.databaseUrl}`);
