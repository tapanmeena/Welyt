import {
  AUTH_ERROR_CODES,
  accountListQuerySchema,
  accountParamsSchema,
  accountsAsOfQuerySchema,
  snapshotParamsSchema,
  type AccountDto,
} from '@welyt/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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

  app.get('/currencies', async () => accounts.listCurrencies());

  app.get('/accounts', async (request) => {
    const query = parseInput(accountListQuerySchema, request.query);
    return accounts.listAccounts(ownerId(request), query).map(toAccountDto);
  });

  app.post('/accounts', async (request, reply) => {
    const account = accounts.createAccount(ownerId(request), request.body);
    return reply.code(201).send(toAccountDto(account));
  });

  app.get('/accounts/valuation', async (request) => {
    const { asOf } = parseInput(accountsAsOfQuerySchema, request.query);
    return valuation.valueAccounts(ownerId(request), asOf);
  });

  app.patch('/accounts/:accountId', async (request) => {
    const { accountId } = parseInput(accountParamsSchema, request.params);
    return toAccountDto(accounts.updateAccount(ownerId(request), accountId, request.body));
  });

  app.post('/accounts/:accountId/archive', async (request) => {
    const { accountId } = parseInput(accountParamsSchema, request.params);
    return toAccountDto(accounts.archiveAccount(ownerId(request), accountId));
  });

  app.get('/accounts/:accountId/snapshots', async (request) => {
    const { accountId } = parseInput(accountParamsSchema, request.params);
    return accounts.listObservations(ownerId(request), accountId);
  });

  app.get('/accounts/:accountId/snapshots/latest', async (request) => {
    const { accountId } = parseInput(accountParamsSchema, request.params);
    const { asOf } = parseInput(accountsAsOfQuerySchema, request.query);
    return { snapshot: accounts.getLatestObservation(ownerId(request), accountId, asOf) };
  });

  app.post('/accounts/:accountId/snapshots', async (request, reply) => {
    const { accountId } = parseInput(accountParamsSchema, request.params);
    const snapshot = accounts.recordObservation(ownerId(request), accountId, request.body);
    return reply.code(201).send(snapshot);
  });

  app.post('/accounts/:accountId/snapshots/:snapshotId/corrections', async (request, reply) => {
    const { accountId, snapshotId } = parseInput(snapshotParamsSchema, request.params);
    const snapshot = accounts.correctObservation(
      ownerId(request),
      accountId,
      snapshotId,
      request.body,
    );
    return reply.code(201).send(snapshot);
  });
}
