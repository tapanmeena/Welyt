import { buildApp } from './app.ts';
import { loadApiEnv } from './config/env.ts';

const env = loadApiEnv();

async function start(): Promise<void> {
  const app = await buildApp({ logger: true, env });

  try {
    await app.listen({ host: env.host, port: env.port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
