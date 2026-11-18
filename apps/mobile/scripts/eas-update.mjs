import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const args = process.argv.slice(2);
const { values } = parseArgs({
  args,
  options: {
    environment: { type: 'string' },
    message: { type: 'string', short: 'm' },
    help: { type: 'boolean', short: 'h' },
  },
  strict: false,
  allowPositionals: true,
});

if (!values.help && !['development', 'preview', 'production'].includes(values.environment)) {
  throw new Error(
    'Pass --environment development, preview, or production to select the app variant.',
  );
}

const env = { ...process.env };
if (typeof values.environment === 'string') {
  env.APP_VARIANT = values.environment;
}

const result = spawnSync('eas', ['update', ...args], { env, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) throw new Error(`EAS Update was terminated by ${result.signal}.`);
process.exitCode = result.status ?? 1;
