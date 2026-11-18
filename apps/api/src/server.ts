import { buildApp } from './app.ts';
import { loadApiEnv } from './config/env.ts';
import { OPENAPI_DOCS_PREFIX } from './plugins/openapi.ts';

const env = loadApiEnv();

async function start(): Promise<void> {
  const app = await buildApp({ logger: true, env });

  try {
    await app.listen({ host: env.host, port: env.port });
    if (env.apiDocsEnabled) {
      const displayHost = env.host === '0.0.0.0' || env.host === '::' ? 'localhost' : env.host;
      app.log.info(
        { docsUrl: `http://${displayHost}:${env.port}${OPENAPI_DOCS_PREFIX}` },
        'Interactive API docs available',
      );
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'Shutting down API');
      void app.close().catch((err: unknown) => {
        app.log.error(err, 'Failed to shut down API');
        process.exitCode = 1;
      });
    });
  }
}

void start();
