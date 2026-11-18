import { queryOptions } from '@tanstack/react-query';
import {
  accountDtoSchema,
  accountsValuationDtoSchema,
  balanceSnapshotDtoSchema,
  currencyDtoSchema,
  type BalanceObservationInput,
  type CreateAccountInput,
  type UpdateAccountInput,
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
    throw new Error('Unexpected response from the Accounts API. Refresh before trying again.');
  }
  return parsed.data;
}

function accountPath(accountId: string): string {
  return `/accounts/${encodeURIComponent(accountId)}`;
}

export const accountsApi = {
  listCurrencies: () => request(currencyDtoSchema.array(), '/currencies'),
  listAccounts: () => request(accountDtoSchema.array(), '/accounts?includeArchived=true'),
  valueAccounts: () => request(accountsValuationDtoSchema, '/accounts/valuation'),
  listSnapshots: (accountId: string) =>
    request(balanceSnapshotDtoSchema.array(), `${accountPath(accountId)}/snapshots`),
  createAccount: (body: CreateAccountInput) =>
    request(accountDtoSchema, '/accounts', { method: 'POST', body }),
  updateAccount: (accountId: string, body: UpdateAccountInput) =>
    request(accountDtoSchema, accountPath(accountId), { method: 'PATCH', body }),
  archiveAccount: (accountId: string) =>
    request(accountDtoSchema, `${accountPath(accountId)}/archive`, { method: 'POST' }),
  recordSnapshot: (accountId: string, body: BalanceObservationInput) =>
    request(balanceSnapshotDtoSchema, `${accountPath(accountId)}/snapshots`, {
      method: 'POST',
      body,
    }),
  correctSnapshot: (accountId: string, snapshotId: string, body: BalanceObservationInput) =>
    request(
      balanceSnapshotDtoSchema,
      `${accountPath(accountId)}/snapshots/${encodeURIComponent(snapshotId)}/corrections`,
      { method: 'POST', body },
    ),
};

export const accountsQueries = {
  list: (userId: string) =>
    queryOptions({
      queryKey: ['accounts', userId, 'list'],
      queryFn: accountsApi.listAccounts,
    }),
  valuation: (userId: string) =>
    queryOptions({
      queryKey: ['accounts', userId, 'valuation'],
      queryFn: accountsApi.valueAccounts,
    }),
  currencies: (userId: string) =>
    queryOptions({
      queryKey: ['accounts', userId, 'currencies'],
      queryFn: accountsApi.listCurrencies,
    }),
  snapshots: (userId: string, accountId: string) =>
    queryOptions({
      queryKey: ['accounts', userId, 'snapshots', accountId],
      queryFn: () => accountsApi.listSnapshots(accountId),
    }),
};
