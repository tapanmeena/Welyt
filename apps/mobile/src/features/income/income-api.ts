import { queryOptions } from '@tanstack/react-query';
import {
  incomeHistoryDtoSchema,
  incomeReceiptDtoSchema,
  type IncomeReceiptInput,
} from '@welyt/shared';
import type { z } from 'zod';
import { apiRequest, type ApiRequestOptions } from '@/lib/api-client';

async function request<T>(
  schema: z.ZodType<T>,
  path: string,
  options?: ApiRequestOptions,
): Promise<T> {
  const parsed = schema.safeParse(await apiRequest<unknown>(path, options));
  if (!parsed.success) {
    throw new Error('Unexpected response from the Income API. Refresh before trying again.');
  }
  return parsed.data;
}

export const incomeApi = {
  history: (fiscalYear: string) =>
    request(incomeHistoryDtoSchema, `/income/history?fiscalYear=${encodeURIComponent(fiscalYear)}`),
  create: (body: IncomeReceiptInput) =>
    request(incomeReceiptDtoSchema, '/income', { method: 'POST', body }),
  correct: (id: string, body: IncomeReceiptInput) =>
    request(incomeReceiptDtoSchema, `/income/${encodeURIComponent(id)}/corrections`, {
      method: 'POST',
      body,
    }),
};

export const incomeHistoryKey = (userId: string) => ['income', userId, 'history'] as const;

export function incomeHistoryQuery(userId: string, fiscalYear: string) {
  return queryOptions({
    queryKey: [...incomeHistoryKey(userId), fiscalYear],
    queryFn: () => incomeApi.history(fiscalYear),
  });
}
