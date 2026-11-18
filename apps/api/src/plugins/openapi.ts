import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { apiErrorResponseSchema } from '@welyt/shared';
import type { FastifyInstance, FastifySchema } from 'fastify';
import { z } from 'zod';

export type OpenApiAuthMode = 'none' | 'optional' | 'bearer' | 'verified';

export interface OpenApiInputSpec {
  schema: z.ZodType;
  description?: string;
  example?: Record<string, unknown>;
}

export interface OpenApiResponseSpec {
  schema: z.ZodType;
  description: string;
  example?: unknown;
}

export interface OpenApiRouteDoc {
  tags: readonly string[];
  summary: string;
  description?: string;
  auth?: OpenApiAuthMode;
  params?: z.ZodType | OpenApiInputSpec;
  querystring?: z.ZodType | OpenApiInputSpec;
  body?: z.ZodType | OpenApiInputSpec;
  responses: Record<number, z.ZodType | OpenApiResponseSpec>;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    openapi?: OpenApiRouteDoc;
  }
}

function isInputSpec(value: z.ZodType | OpenApiInputSpec): value is OpenApiInputSpec {
  return typeof value === 'object' && value !== null && 'schema' in value && !('_zod' in value);
}

function isResponseSpec(value: z.ZodType | OpenApiResponseSpec): value is OpenApiResponseSpec {
  return typeof value === 'object' && value !== null && 'schema' in value && !('_zod' in value);
}

function toOpenApiJsonSchema(schema: z.ZodType, io: 'input' | 'output'): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as Record<string, unknown>;
  delete generated.$schema;
  return generated;
}

function buildBodyJsonSchema(input: z.ZodType | OpenApiInputSpec): Record<string, unknown> {
  const spec = isInputSpec(input) ? input : { schema: input };
  const jsonSchema = toOpenApiJsonSchema(spec.schema, 'input');
  if (spec.description) {
    jsonSchema.description = spec.description;
  }
  if (spec.example !== undefined) {
    jsonSchema.examples = [spec.example];
  }
  return jsonSchema;
}

function buildParamsJsonSchema(input: z.ZodType | OpenApiInputSpec): Record<string, unknown> {
  const spec = isInputSpec(input) ? input : { schema: input };
  const jsonSchema = toOpenApiJsonSchema(spec.schema, 'input');
  if (spec.example && typeof jsonSchema.properties === 'object' && jsonSchema.properties !== null) {
    const properties = jsonSchema.properties as Record<string, Record<string, unknown>>;
    for (const [key, exampleValue] of Object.entries(spec.example)) {
      const prop = properties[key];
      if (prop && exampleValue !== undefined) {
        prop.examples = [exampleValue];
      }
    }
  }
  return jsonSchema;
}

function buildErrorJsonSchema(description: string): Record<string, unknown> {
  const jsonSchema = toOpenApiJsonSchema(apiErrorResponseSchema, 'output');
  jsonSchema.description = description;
  return jsonSchema;
}

function buildRouteSchema(
  baseSchema: FastifySchema | undefined,
  doc: OpenApiRouteDoc,
): FastifySchema {
  const authMode = doc.auth ?? 'none';
  const responses: Record<number, Record<string, unknown>> = {};

  for (const [statusText, responseDef] of Object.entries(doc.responses)) {
    const statusCode = Number(statusText);
    const spec = isResponseSpec(responseDef)
      ? responseDef
      : {
          schema: responseDef,
          description: statusCode === 201 ? 'Created' : 'Successful response',
        };
    const jsonSchema = toOpenApiJsonSchema(spec.schema, 'output');
    jsonSchema.description = spec.description;
    if (spec.example !== undefined) {
      jsonSchema.examples = [spec.example];
    }
    responses[statusCode] = jsonSchema;
  }

  const hasInputs = Boolean(doc.body || doc.params || doc.querystring);
  if (hasInputs && !responses[400]) {
    responses[400] = buildErrorJsonSchema('Request validation error');
  }

  if ((authMode === 'bearer' || authMode === 'verified') && !responses[401]) {
    responses[401] = buildErrorJsonSchema('Missing, invalid, or expired bearer token');
  }

  if (authMode === 'verified' && !responses[403]) {
    responses[403] = buildErrorJsonSchema(
      'Email verification required before accessing this endpoint',
    );
  }

  if (!responses[429]) {
    responses[429] = buildErrorJsonSchema('Rate limit exceeded');
  }

  const security: ReadonlyArray<Record<string, readonly string[]>> =
    authMode === 'bearer' || authMode === 'verified'
      ? [{ bearerAuth: [] }]
      : authMode === 'optional'
        ? [{}, { bearerAuth: [] }]
        : [];

  let description = doc.description;
  if (authMode === 'verified') {
    const verifiedNote =
      'Requires a bearer access token for an account with a verified email address.';
    description = description ? `${description}\n\n${verifiedNote}` : verifiedNote;
  }

  return {
    ...baseSchema,
    tags: doc.tags,
    summary: doc.summary,
    ...(description ? { description } : {}),
    security,
    ...(doc.params ? { params: buildParamsJsonSchema(doc.params) } : {}),
    ...(doc.querystring ? { querystring: buildParamsJsonSchema(doc.querystring) } : {}),
    ...(doc.body ? { body: buildBodyJsonSchema(doc.body) } : {}),
    response: responses,
  };
}

const API_DESCRIPTION = [
  'Interactive OpenAPI documentation for testing Welyt API endpoints directly in the browser.',
  '',
  '### Quick-start workflow',
  '1. Register via **POST `/auth/register`** or sign in via **POST `/auth/login`**.',
  '2. Copy `tokens.accessToken` from the response, click **Authorize**, and paste the token (without the `Bearer ` prefix).',
  '3. To call **Accounts & Cash** or **Income & Monthly Plans** routes, verify your email first via **POST `/auth/verify-email`** (when SMTP is not configured in local development, the 6-digit OTP is printed to the API console), then authorize with the newly returned `accessToken`.',
].join('\n');

export const OPENAPI_DOCS_PREFIX = '/docs';

export async function registerOpenApiDocs(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Welyt API',
        version: '0.1.0',
        description: API_DESCRIPTION,
      },
      servers: [
        {
          url: '/',
          description: 'Current API server',
        },
      ],
      tags: [
        { name: 'System', description: 'Service health and operational checks' },
        {
          name: 'Authentication',
          description:
            'Registration, sessions, email verification, password recovery, and profile settings',
        },
        {
          name: 'Accounts & Cash',
          description:
            'Currency catalog, cash/bank accounts, balance snapshots, and INR valuations',
        },
        {
          name: 'Income & Monthly Plans',
          description:
            'Income receipts, fiscal-year history, monthly allocation plans, and auto-copy rules',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description:
              'Paste `tokens.accessToken` from `/auth/login`, `/auth/register`, or `/auth/verify-email`.',
          },
        },
      },
    },
    transform: ({ schema, url, route }) => {
      const openapiDoc = route.config?.openapi;
      if (!openapiDoc) {
        return { schema, url };
      }
      return {
        schema: buildRouteSchema(schema, openapiDoc),
        url,
      };
    },
  });

  await app.register(swaggerUi, {
    routePrefix: OPENAPI_DOCS_PREFIX,
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
      filter: true,
      persistAuthorization: true,
      tryItOutEnabled: true,
    },
  });
}
