import { buildApp } from './app.ts';

const host = process.env.HOST ?? '0.0.0.0';
const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

const app = buildApp({ logger: true });

async function start(): Promise<void> {
  try {
    await app.listen({ host, port });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
