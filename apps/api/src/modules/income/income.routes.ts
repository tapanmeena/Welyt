import {
  AUTH_ERROR_CODES,
  autoCopyRuleInputSchema,
  incomeHistoryQuerySchema,
  incomeListQuerySchema,
  incomeReceiptParamsSchema,
  monthlyPlanParamsSchema,
  monthlyPlanQuerySchema,
} from '@welyt/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDatabase } from '../../db/client.ts';
import { AppError, parseInput } from '../../lib/errors.ts';
import { IncomeService } from './income.service.ts';
import { MonthlyPlanService } from './monthly-plan.service.ts';

function ownerId(request: FastifyRequest): string {
  if (!request.auth) {
    throw new AppError(401, AUTH_ERROR_CODES.UNAUTHORIZED, 'Authentication required');
  }
  return request.auth.userId;
}

export async function registerIncomeRoutes(
  app: FastifyInstance,
  { db }: { db: AppDatabase },
): Promise<void> {
  const income = new IncomeService(db);
  const plans = new MonthlyPlanService(db);

  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });
  app.addHook('preHandler', app.authGuards.authenticate);
  app.addHook('preHandler', app.authGuards.requireVerifiedEmail);

  app.get('/income', async (request) => {
    const { includeInactive } = parseInput(incomeListQuerySchema, request.query);
    return income.listReceipts(ownerId(request), includeInactive);
  });

  app.get('/income/history', async (request) => {
    const { fiscalYear } = parseInput(incomeHistoryQuerySchema, request.query);
    return income.getHistory(ownerId(request), fiscalYear);
  });

  app.get('/income/plans/:month', async (request) => {
    const { month } = parseInput(monthlyPlanParamsSchema, request.params);
    const { revision } = parseInput(monthlyPlanQuerySchema, request.query);
    return { plan: plans.get(ownerId(request), month, revision) };
  });

  app.put('/income/plans/:month', async (request) => {
    const { month } = parseInput(monthlyPlanParamsSchema, request.params);
    return { plan: plans.save(ownerId(request), month, request.body) };
  });

  app.get('/income/plan-rules/auto-copy', async (request) => {
    return plans.getAutoCopyRule(ownerId(request));
  });

  app.put('/income/plan-rules/auto-copy', async (request) => {
    const { enabled } = parseInput(autoCopyRuleInputSchema, request.body);
    return plans.setAutoCopyRule(ownerId(request), enabled);
  });

  app.post('/income', async (request, reply) => {
    return reply.code(201).send(income.createReceipt(ownerId(request), request.body));
  });

  app.post('/income/:receiptId/corrections', async (request, reply) => {
    const { receiptId } = parseInput(incomeReceiptParamsSchema, request.params);
    return reply.code(201).send(income.correctReceipt(ownerId(request), receiptId, request.body));
  });

  app.post('/income/:receiptId/archive', async (request) => {
    const { receiptId } = parseInput(incomeReceiptParamsSchema, request.params);
    return income.archiveReceipt(ownerId(request), receiptId);
  });
}
