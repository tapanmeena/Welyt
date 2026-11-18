import {
  AUTH_ERROR_CODES,
  accountDtoSchema,
  accountListQuerySchema,
  accountParamsSchema,
  accountsAsOfQuerySchema,
  accountsValuationDtoSchema,
  apiErrorResponseSchema,
  balanceObservationSchema,
  balanceSnapshotDtoSchema,
  createAccountSchema,
  currencyDtoSchema,
  latestBalanceSnapshotResponseSchema,
  snapshotParamsSchema,
  updateAccountSchema,
  type AccountDto,
} from '@welyt/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppDatabase } from '../../db/client.ts';
import type { AccountRecord } from '../../db/schema.ts';
import { AppError, parseInput } from '../../lib/errors.ts';
import { FRANKFURTER_SOURCE } from '../fx/frankfurter.provider.ts';
import { AccountsValuationService } from './accounts-valuation.service.ts';
import { AccountsService } from './accounts.service.ts';

function ownerId(request: FastifyRequest): string {
  if (!request.auth) {
    throw new AppError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Authentication required');
  }
  return request.auth.userId;
}

function toAccountDto(account: AccountRecord): AccountDto {
  return {
    id: account.id,
    name: account.name,
    kind: account.kind,
    currencyCode: account.currencyCode,
    inNetWorth: account.inNetWorth,
    purpose: account.purpose,
    notes: account.notes,
    archivedAt: account.archivedAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function registerAccountsRoutes(
  app: FastifyInstance,
  { db }: { db: AppDatabase },
): Promise<void> {
  const accounts = new AccountsService(db);
  const valuation = new AccountsValuationService(db, FRANKFURTER_SOURCE);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });
  app.addHook('preHandler', app.authGuards.authenticate);
  app.addHook('preHandler', app.authGuards.requireVerifiedEmail);

  app.get(
    '/currencies',
    {
      config: {
        openapi: {
          tags: ['Accounts & Cash'],
          summary: 'List supported currencies',
          auth: 'verified',
          responses: {
            200: {
              schema: z.array(currencyDtoSchema),
              description: 'Supported currencies ordered by ISO code',
            },
          },
        },
      },
    },
    async () => accounts.listCurrencies(),
  );

  app.get(
    '/accounts',
    {
      config: {
        openapi: {
          tags: ['Accounts & Cash'],
          summary: 'List cash and bank accounts',
          auth: 'verified',
          querystring: accountListQuerySchema,
          responses: {
            200: {
              schema: z.array(accountDtoSchema),
              description: 'Accounts owned by the authenticated user',
            },
          },
        },
      },
    },
    async (request) => {
      const query = parseInput(accountListQuerySchema, request.query);
      return accounts.listAccounts(ownerId(request), query).map(toAccountDto);
    },
  );

  app.post(
    '/accounts',
    {
      config: {
        openapi: {
          tags: ['Accounts & Cash'],
          summary: 'Create an account',
          auth: 'verified',
          body: {
            schema: createAccountSchema,
            example: {
              name: 'HDFC Savings',
              kind: 'bank',
              currencyCode: 'INR',
              inNetWorth: true,
              purpose: 'Primary operating account',
              notes: null,
            },
          },
          responses: {
            201: {
              schema: accountDtoSchema,
              description: 'Created account',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const account = accounts.createAccount(ownerId(request), request.body);
      return reply.code(201).send(toAccountDto(account));
    },
  );

  app.get(
    '/accounts/valuation',
    {
      config: {
        openapi: {
          tags: ['Accounts & Cash'],
          summary: 'Value active net-worth accounts in INR',
          description:
            'Computes INR balances as of the requested date (defaults to the current India business date) using the latest snapshot on or before `asOf` and stored FX rates.',
          auth: 'verified',
          querystring: accountsAsOfQuerySchema,
          responses: {
            200: {
              schema: accountsValuationDtoSchema,
              description: 'Account valuations and subtotal/completeness summary in INR',
            },
          },
        },
      },
    },
    async (request) => {
      const { asOf } = parseInput(accountsAsOfQuerySchema, request.query);
      return valuation.valueAccounts(ownerId(request), asOf);
    },
  );

  app.patch(
    '/accounts/:accountId',
    {
      config: {
        openapi: {
          tags: ['Accounts & Cash'],
          summary: 'Update account metadata',
          auth: 'verified',
          params: accountParamsSchema,
          body: {
            schema: updateAccountSchema,
            example: {
              name: 'HDFC Primary Savings',
              purpose: 'Emergency & operating cash',
            },
          },
          responses: {
            200: {
              schema: accountDtoSchema,
              description: 'Updated account',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'Account not found',
            },
            409: {
              schema: apiErrorResponseSchema,
              description: 'Archived accounts are read-only',
            },
          },
        },
      },
    },
    async (request) => {
      const { accountId } = parseInput(accountParamsSchema, request.params);
      return toAccountDto(accounts.updateAccount(ownerId(request), accountId, request.body));
    },
  );

  app.post(
    '/accounts/:accountId/archive',
    {
      config: {
        openapi: {
          tags: ['Accounts & Cash'],
          summary: 'Archive an account',
          auth: 'verified',
          params: accountParamsSchema,
          responses: {
            200: {
              schema: accountDtoSchema,
              description: 'Archived account',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'Account not found',
            },
          },
        },
      },
    },
    async (request) => {
      const { accountId } = parseInput(accountParamsSchema, request.params);
      return toAccountDto(accounts.archiveAccount(ownerId(request), accountId));
    },
  );

  app.get(
    '/accounts/:accountId/snapshots',
    {
      config: {
        openapi: {
          tags: ['Accounts & Cash'],
          summary: 'List balance snapshots for an account',
          auth: 'verified',
          params: accountParamsSchema,
          responses: {
            200: {
              schema: z.array(balanceSnapshotDtoSchema),
              description: 'Balance snapshot history (including retired observations)',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'Account not found',
            },
          },
        },
      },
    },
    async (request) => {
      const { accountId } = parseInput(accountParamsSchema, request.params);
      return accounts.listObservations(ownerId(request), accountId);
    },
  );

  app.get(
    '/accounts/:accountId/snapshots/latest',
    {
      config: {
        openapi: {
          tags: ['Accounts & Cash'],
          summary: 'Get latest active balance snapshot as of a date',
          auth: 'verified',
          params: accountParamsSchema,
          querystring: accountsAsOfQuerySchema,
          responses: {
            200: {
              schema: latestBalanceSnapshotResponseSchema,
              description: 'Latest non-retired snapshot on or before `asOf`, or null',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'Account not found',
            },
          },
        },
      },
    },
    async (request) => {
      const { accountId } = parseInput(accountParamsSchema, request.params);
      const { asOf } = parseInput(accountsAsOfQuerySchema, request.query);
      return { snapshot: accounts.getLatestObservation(ownerId(request), accountId, asOf) };
    },
  );

  app.post(
    '/accounts/:accountId/snapshots',
    {
      config: {
        openapi: {
          tags: ['Accounts & Cash'],
          summary: 'Record a balance snapshot',
          auth: 'verified',
          params: accountParamsSchema,
          body: {
            schema: balanceObservationSchema,
            example: {
              observedOn: '2026-04-01',
              balance: '125000.50',
              notes: 'Statement closing balance',
            },
          },
          responses: {
            201: {
              schema: balanceSnapshotDtoSchema,
              description: 'Recorded balance snapshot',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'Account not found',
            },
            409: {
              schema: apiErrorResponseSchema,
              description: 'Account archived or active snapshot already exists on `observedOn`',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { accountId } = parseInput(accountParamsSchema, request.params);
      const snapshot = accounts.recordObservation(ownerId(request), accountId, request.body);
      return reply.code(201).send(snapshot);
    },
  );

  app.post(
    '/accounts/:accountId/snapshots/:snapshotId/corrections',
    {
      config: {
        openapi: {
          tags: ['Accounts & Cash'],
          summary: 'Correct an existing balance snapshot',
          description:
            'Retires the target active snapshot and creates a replacement snapshot preserving audit lineage.',
          auth: 'verified',
          params: snapshotParamsSchema,
          body: {
            schema: balanceObservationSchema,
            example: {
              observedOn: '2026-04-01',
              balance: '125500.00',
              notes: 'Adjusted for cleared transfer',
            },
          },
          responses: {
            201: {
              schema: balanceSnapshotDtoSchema,
              description: 'Replacement balance snapshot',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'Account or snapshot not found',
            },
            409: {
              schema: apiErrorResponseSchema,
              description: 'Account archived, snapshot already corrected, or target date occupied',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { accountId, snapshotId } = parseInput(snapshotParamsSchema, request.params);
      const snapshot = accounts.correctObservation(
        ownerId(request),
        accountId,
        snapshotId,
        request.body,
      );
      return reply.code(201).send(snapshot);
    },
  );
}
