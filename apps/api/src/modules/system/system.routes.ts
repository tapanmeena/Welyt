import accepts from '@fastify/accepts';
import { hash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { renderIndex, renderServicePulse } from './system.pages.ts';
import { styles } from './system.styles.ts';

const pageCsp = [
  "default-src 'none'",
  `style-src 'sha256-${hash('sha256', styles, 'base64')}'`,
  'img-src data:',
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

function sendPage(reply: FastifyReply, html: string) {
  return reply
    .type('text/html; charset=utf-8')
    .header('Content-Security-Policy', pageCsp)
    .send(html);
}

export async function registerSystemRoutes(
  app: FastifyInstance,
  { docsEnabled }: { docsEnabled: boolean },
): Promise<void> {
  await app.register(accepts);

  const index = renderIndex(docsEnabled);
  app.get('/', { schema: { hide: true } }, (_request, reply) => sendPage(reply, index));

  app.get<{ Querystring: { format?: string } }>(
    '/health',
    {
      config: {
        openapi: {
          tags: ['System'],
          summary: 'Health check',
          description:
            'Checks HTTP liveness only. Returns JSON by default or an HTML status page when the client prefers it. Use `?format=json` to force JSON.',
          responses: {
            200: {
              schema: z.object({ status: z.literal('ok') }),
              description: 'The API process is responding',
            },
          },
        },
      },
    },
    (request, reply) => {
      const vary = reply.getHeader('Vary');
      reply.header('Vary', vary ? `${vary}, Accept` : 'Accept');
      reply.header('Cache-Control', 'no-store');

      if (
        request.query.format !== 'json' &&
        request.accepts().type(['application/json', 'text/html']) === 'text/html'
      ) {
        return sendPage(reply, renderServicePulse(docsEnabled, new Date()));
      }

      return reply.send({ status: 'ok' });
    },
  );
}
