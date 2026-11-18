import {
  AUTH_ERROR_CODES,
  apiErrorResponseSchema,
  autoCopyRuleDtoSchema,
  autoCopyRuleInputSchema,
  incomeHistoryDtoSchema,
  incomeHistoryQuerySchema,
  incomeListQuerySchema,
  incomeReceiptDtoSchema,
  incomeReceiptInputSchema,
  incomeReceiptParamsSchema,
  monthlyPlanParamsSchema,
  monthlyPlanQuerySchema,
  monthlyPlanResponseSchema,
  monthlyPlanSaveSchema,
} from '@welyt/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
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

  app.get(
    '/income',
    {
      config: {
        openapi: {
          tags: ['Income & Monthly Plans'],
          summary: 'List income receipts',
          auth: 'verified',
          querystring: incomeListQuerySchema,
          responses: {
            200: {
              schema: z.array(incomeReceiptDtoSchema),
              description: 'Income receipts ordered newest first',
            },
          },
        },
      },
    },
    async (request) => {
      const { includeInactive } = parseInput(incomeListQuerySchema, request.query);
      return income.listReceipts(ownerId(request), includeInactive);
    },
  );

  app.get(
    '/income/history',
    {
      config: {
        openapi: {
          tags: ['Income & Monthly Plans'],
          summary: 'Get fiscal-year income history in INR',
          description:
            'Groups active income receipts by month within the India financial year (April–March) and values each receipt in INR.',
          auth: 'verified',
          querystring: incomeHistoryQuerySchema,
          responses: {
            200: {
              schema: incomeHistoryDtoSchema,
              description: 'Monthly income breakdown and INR totals for the fiscal year',
            },
          },
        },
      },
    },
    async (request) => {
      const { fiscalYear } = parseInput(incomeHistoryQuerySchema, request.query);
      return income.getHistory(ownerId(request), fiscalYear);
    },
  );

  app.get(
    '/income/plans/:month',
    {
      config: {
        openapi: {
          tags: ['Income & Monthly Plans'],
          summary: 'Get monthly income plan',
          auth: 'verified',
          params: {
            schema: monthlyPlanParamsSchema,
            example: { month: '2026-04' },
          },
          querystring: monthlyPlanQuerySchema,
          responses: {
            200: {
              schema: monthlyPlanResponseSchema,
              description: 'Latest (or requested revision) plan for the month, or null',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'Requested plan revision not found',
            },
          },
        },
      },
    },
    async (request) => {
      const { month } = parseInput(monthlyPlanParamsSchema, request.params);
      const { revision } = parseInput(monthlyPlanQuerySchema, request.query);
      return { plan: plans.get(ownerId(request), month, revision) };
    },
  );

  app.put(
    '/income/plans/:month',
    {
      config: {
        openapi: {
          tags: ['Income & Monthly Plans'],
          summary: 'Save monthly income plan revision',
          description:
            'Saves a new immutable plan revision for `month` using optimistic concurrency (`expectedRevision`: `0` when creating the first plan for a month).',
          auth: 'verified',
          params: {
            schema: monthlyPlanParamsSchema,
            example: { month: '2026-04' },
          },
          body: {
            schema: monthlyPlanSaveSchema,
            example: {
              expectedRevision: 0,
              forecastIncome: '185000.00',
              allocations: [
                { name: 'Rent', group: 'fixed', amount: '45000.00' },
                { name: 'Groceries & Dining', group: 'flexible', amount: '25000.00' },
                { name: 'Index Fund SIP', group: 'saving', amount: '50000.00' },
              ],
            },
          },
          responses: {
            200: {
              schema: monthlyPlanResponseSchema,
              description: 'Saved monthly plan revision with computed group totals',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'Referenced source plan (`copiedFromPlanId`) not found',
            },
            409: {
              schema: apiErrorResponseSchema,
              description: 'Plan revision conflict (`expectedRevision` does not match latest)',
            },
          },
        },
      },
    },
    async (request) => {
      const { month } = parseInput(monthlyPlanParamsSchema, request.params);
      return { plan: plans.save(ownerId(request), month, request.body) };
    },
  );

  app.get(
    '/income/plan-rules/auto-copy',
    {
      config: {
        openapi: {
          tags: ['Income & Monthly Plans'],
          summary: 'Get monthly plan auto-copy rule',
          auth: 'verified',
          responses: {
            200: {
              schema: autoCopyRuleDtoSchema,
              description: 'Current monthly plan auto-copy setting',
            },
          },
        },
      },
    },
    async (request) => {
      return plans.getAutoCopyRule(ownerId(request));
    },
  );

  app.put(
    '/income/plan-rules/auto-copy',
    {
      config: {
        openapi: {
          tags: ['Income & Monthly Plans'],
          summary: 'Set monthly plan auto-copy rule',
          auth: 'verified',
          body: {
            schema: autoCopyRuleInputSchema,
            example: { enabled: true },
          },
          responses: {
            200: {
              schema: autoCopyRuleDtoSchema,
              description: 'Updated monthly plan auto-copy setting',
            },
          },
        },
      },
    },
    async (request) => {
      const { enabled } = parseInput(autoCopyRuleInputSchema, request.body);
      return plans.setAutoCopyRule(ownerId(request), enabled);
    },
  );

  app.post(
    '/income',
    {
      config: {
        openapi: {
          tags: ['Income & Monthly Plans'],
          summary: 'Record an income receipt',
          auth: 'verified',
          body: {
            schema: incomeReceiptInputSchema,
            example: {
              receivedDate: '2026-04-01',
              type: 'Salary',
              source: 'Acme Corp',
              currencyCode: 'INR',
              amount: '185000.00',
              gross: '210000.00',
              tds: '25000.00',
              notes: 'April payroll',
            },
          },
          responses: {
            201: {
              schema: incomeReceiptDtoSchema,
              description: 'Recorded income receipt',
            },
          },
        },
      },
    },
    async (request, reply) => {
      return reply.code(201).send(income.createReceipt(ownerId(request), request.body));
    },
  );

  app.post(
    '/income/:receiptId/corrections',
    {
      config: {
        openapi: {
          tags: ['Income & Monthly Plans'],
          summary: 'Correct an existing income receipt',
          description:
            'Retires the target active receipt and records a replacement receipt preserving audit lineage.',
          auth: 'verified',
          params: incomeReceiptParamsSchema,
          body: {
            schema: incomeReceiptInputSchema,
            example: {
              receivedDate: '2026-04-01',
              type: 'Salary',
              source: 'Acme Corp',
              currencyCode: 'INR',
              amount: '186500.00',
              gross: '210000.00',
              tds: '23500.00',
              notes: 'Corrected TDS deduction',
            },
          },
          responses: {
            201: {
              schema: incomeReceiptDtoSchema,
              description: 'Replacement income receipt',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'Income receipt not found',
            },
            409: {
              schema: apiErrorResponseSchema,
              description: 'Income receipt has already been corrected or archived',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { receiptId } = parseInput(incomeReceiptParamsSchema, request.params);
      return reply.code(201).send(income.correctReceipt(ownerId(request), receiptId, request.body));
    },
  );

  app.post(
    '/income/:receiptId/archive',
    {
      config: {
        openapi: {
          tags: ['Income & Monthly Plans'],
          summary: 'Archive an income receipt',
          auth: 'verified',
          params: incomeReceiptParamsSchema,
          responses: {
            200: {
              schema: incomeReceiptDtoSchema,
              description: 'Archived income receipt',
            },
            404: {
              schema: apiErrorResponseSchema,
              description: 'Income receipt not found',
            },
            409: {
              schema: apiErrorResponseSchema,
              description: 'Income receipt has already been corrected or archived',
            },
          },
        },
      },
    },
    async (request) => {
      const { receiptId } = parseInput(incomeReceiptParamsSchema, request.params);
      return income.archiveReceipt(ownerId(request), receiptId);
    },
  );
}
