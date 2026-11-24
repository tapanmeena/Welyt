import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildApp } from '../app.ts';
import { loadApiEnv } from '../config/env.ts';

describe('Public system pages', () => {
  const env = loadApiEnv({ NODE_ENV: 'test' });
  const browserAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

  it('serves a landing page with links to status and, when enabled, API docs', async (t) => {
    for (const enableDocs of [false, true]) {
      const app = await buildApp({ env, enableDocs, logger: false });
      t.after(() => app.close());

      const response = await app.inject({ url: '/' });

      assert.equal(response.statusCode, 200);
      assert.match(response.headers['content-type'] ?? '', /^text\/html/);
      assert.match(response.body, /<title>Welyt \| Your money, in focus<\/title>/);
      assert.match(response.body, /href="\/health"/);
      assert.equal(response.body.includes('href="/docs"'), enableDocs);
    }
  });

  it('shows a fresh Service Pulse for browser requests without overclaiming health', async (t) => {
    const app = await buildApp({ env, logger: false });
    t.after(() => app.close());

    const started = Date.now();
    const response = await app.inject({
      url: '/health',
      headers: { accept: browserAccept, origin: 'https://welyt.example' },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'] ?? '', /^text\/html/);
    assert.equal(response.headers['cache-control'], 'no-store');
    const vary = String(response.headers.vary).toLowerCase().split(/,\s*/);
    assert.ok(vary.includes('accept'));
    assert.ok(vary.includes('origin'));
    assert.match(response.body, /<title>Welyt \| Service Pulse<\/title>/);
    assert.match(response.body, /HTTP liveness only/);
    assert.match(response.body, /href="\/health\?format=json"/);

    const timestamp = Date.parse(response.body.match(/<time datetime="([^"]+)"/)?.[1] ?? '');
    assert.ok(timestamp >= started && timestamp <= Date.now(), 'Expected a fresh check time');
  });

  it('preserves the health JSON for probes and allows browsers to request it', async (t) => {
    const app = await buildApp({ env, logger: false });
    t.after(() => app.close());

    for (const accept of [
      undefined,
      '*/*',
      'application/json',
      'text/html;q=0.2, application/json',
      'text/html;q=0, */*;q=1',
    ]) {
      const response = await app.inject({ url: '/health', headers: accept ? { accept } : {} });
      assert.equal(response.statusCode, 200);
      assert.match(response.headers['content-type'] ?? '', /^application\/json/);
      assert.deepEqual(response.json(), { status: 'ok' });
    }

    const response = await app.inject({
      url: '/health?format=json',
      headers: { accept: browserAccept },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
  });
});

async function buildProxyTestApp(trustProxy = '') {
  const app = await buildApp({
    env: loadApiEnv({ NODE_ENV: 'test', TRUST_PROXY: trustProxy }),
    logger: false,
  });

  app.get(
    '/rate-limit-test',
    { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } },
    (request) => ({ ip: request.ip }),
  );
  return app;
}

describe('Reverse proxy configuration', () => {
  it('rate limits real clients separately and ignores spoofed hops before the client', async (t) => {
    const app = await buildProxyTestApp('172.30.250.3');
    t.after(() => app.close());

    const first = await app.inject({
      url: '/rate-limit-test',
      remoteAddress: '172.30.250.3',
      headers: { 'x-forwarded-for': '203.0.113.99, 198.51.100.10' },
    });
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.json(), { ip: '198.51.100.10' });

    const second = await app.inject({
      url: '/rate-limit-test',
      remoteAddress: '172.30.250.3',
      headers: { 'x-forwarded-for': '198.51.100.11' },
    });
    assert.equal(second.statusCode, 200);
    assert.deepEqual(second.json(), { ip: '198.51.100.11' });

    const repeat = await app.inject({
      url: '/rate-limit-test',
      remoteAddress: '172.30.250.3',
      headers: { 'x-forwarded-for': '203.0.113.100, 198.51.100.10' },
    });
    assert.equal(repeat.statusCode, 429);
  });

  it('ignores forwarding headers by default and from peers outside the trusted CIDR', async (t) => {
    for (const trustProxy of ['', '172.30.249.0/29']) {
      const app = await buildProxyTestApp(trustProxy);
      t.after(() => app.close());

      const first = await app.inject({
        url: '/rate-limit-test',
        remoteAddress: '172.30.250.4',
        headers: { 'x-forwarded-for': '198.51.100.10' },
      });
      assert.equal(first.statusCode, 200);
      assert.deepEqual(first.json(), { ip: '172.30.250.4' });

      const second = await app.inject({
        url: '/rate-limit-test',
        remoteAddress: '172.30.250.4',
        headers: { 'x-forwarded-for': '198.51.100.11' },
      });
      assert.equal(second.statusCode, 429);
    }
  });

  it('rejects invalid addresses and blanket boolean proxy settings', () => {
    for (const trustProxy of ['true', '*', '172.30.250.3,invalid', '172.30.250.0/99']) {
      assert.throws(() => loadApiEnv({ TRUST_PROXY: trustProxy }), /TRUST_PROXY/);
    }
  });
});

describe('Interactive OpenAPI / Swagger UI documentation', () => {
  it('enables docs by default only in development unless overridden by API_DOCS_ENABLED', () => {
    assert.equal(loadApiEnv({ NODE_ENV: 'development' }).apiDocsEnabled, true);
    assert.equal(
      loadApiEnv({ NODE_ENV: 'development', API_DOCS_ENABLED: 'false' }).apiDocsEnabled,
      false,
    );
    assert.equal(loadApiEnv({ NODE_ENV: 'test' }).apiDocsEnabled, false);
    assert.equal(loadApiEnv({ NODE_ENV: 'production' }).apiDocsEnabled, false);
    assert.equal(
      loadApiEnv({
        NODE_ENV: 'production',
        API_DOCS_ENABLED: 'true',
      }).apiDocsEnabled,
      true,
    );
  });

  it('does not expose /docs or /docs/json when disabled', async (t) => {
    const app = await buildApp({
      env: loadApiEnv({ NODE_ENV: 'test' }),
      logger: false,
      enableRateLimit: false,
    });
    t.after(() => app.close());

    const uiResponse = await app.inject({ url: '/docs' });
    assert.equal(uiResponse.statusCode, 404);

    const specResponse = await app.inject({ url: '/docs/json' });
    assert.equal(specResponse.statusCode, 404);
  });

  it('serves Swagger UI and a complete OpenAPI 3.0 spec covering all API routes', async (t) => {
    const app = await buildApp({
      env: loadApiEnv({ NODE_ENV: 'test', API_DOCS_ENABLED: 'true' }),
      logger: false,
      enableRateLimit: false,
    });
    t.after(() => app.close());

    const uiResponse = await app.inject({ url: '/docs' });
    assert.equal(uiResponse.statusCode, 200);
    assert.match(uiResponse.headers['content-type'] ?? '', /text\/html/);
    assert.match(uiResponse.body, /swagger-ui/i);

    const specResponse = await app.inject({ url: '/docs/json' });
    assert.equal(specResponse.statusCode, 200);
    const spec = specResponse.json<{
      openapi: string;
      components?: { securitySchemes?: Record<string, { type: string; scheme: string }> };
      paths: Record<string, Record<string, Record<string, unknown>>>;
    }>();

    assert.equal(spec.openapi, '3.0.3');
    assert.deepEqual(spec.components?.securitySchemes?.bearerAuth?.type, 'http');
    assert.deepEqual(spec.components?.securitySchemes?.bearerAuth?.scheme, 'bearer');

    const expectedOperations: Array<[string, string]> = [
      ['get', '/health'],
      ['get', '/auth/me'],
      ['patch', '/auth/me'],
      ['get', '/currencies'],
      ['get', '/accounts'],
      ['post', '/accounts'],
      ['get', '/accounts/valuation'],
      ['patch', '/accounts/{accountId}'],
      ['post', '/accounts/{accountId}/archive'],
      ['get', '/accounts/{accountId}/snapshots'],
      ['get', '/accounts/{accountId}/snapshots/latest'],
      ['post', '/accounts/{accountId}/snapshots'],
      ['post', '/accounts/{accountId}/snapshots/{snapshotId}/corrections'],
      ['get', '/income'],
      ['get', '/income/history'],
      ['post', '/income'],
      ['post', '/income/{receiptId}/corrections'],
      ['post', '/income/{receiptId}/archive'],
      ['get', '/income/plans/{month}'],
      ['put', '/income/plans/{month}'],
      ['get', '/income/plan-rules/auto-copy'],
      ['put', '/income/plan-rules/auto-copy'],
    ];

    for (const [method, path] of expectedOperations) {
      const operation = spec.paths[path]?.[method];
      assert.ok(operation, `Expected ${method.toUpperCase()} ${path} in OpenAPI spec`);
      assert.ok(operation.summary, `Expected summary on ${method.toUpperCase()} ${path}`);
      assert.ok(
        Array.isArray(operation.tags) && operation.tags.length > 0,
        `Expected tags on ${method.toUpperCase()} ${path}`,
      );
    }

    assert.deepEqual(spec.paths['/auth/me']?.get?.security, [{ bearerAuth: [] }]);
    assert.deepEqual(spec.paths['/accounts']?.post?.security, [{ bearerAuth: [] }]);
    assert.equal(spec.paths['/accounts/{accountId}/archive']?.post?.requestBody, undefined);
  });
});
