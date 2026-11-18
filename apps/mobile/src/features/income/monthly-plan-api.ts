import { queryOptions } from '@tanstack/react-query';
import {
  autoCopyRuleDtoSchema,
  monthlyPlanResponseSchema,
  type MonthlyPlanSaveInput,
} from '@welyt/shared';
import { apiRequest } from '@/lib/api-client';

function pathForMonth(month: string) {
  return `/income/plans/${encodeURIComponent(month)}`;
}

export const monthlyPlanApi = {
  async get(month: string, revision?: number) {
    const query = revision === undefined ? '' : `?revision=${revision}`;
    return monthlyPlanResponseSchema.parse(await apiRequest(`${pathForMonth(month)}${query}`)).plan;
  },
  async save(month: string, body: MonthlyPlanSaveInput) {
    const result = monthlyPlanResponseSchema.parse(
      await apiRequest(pathForMonth(month), {
        method: 'PUT',
        body,
      }),
    );
    if (!result.plan) throw new Error('The saved plan could not be read.');
    return result.plan;
  },
  async getAutoCopyRule() {
    return autoCopyRuleDtoSchema.parse(await apiRequest('/income/plan-rules/auto-copy'));
  },
  async setAutoCopyRule(enabled: boolean) {
    return autoCopyRuleDtoSchema.parse(
      await apiRequest('/income/plan-rules/auto-copy', {
        method: 'PUT',
        body: { enabled },
      }),
    );
  },
};

export const monthlyPlanKey = (userId: string, month: string) =>
  ['income', userId, 'plan', month] as const;

export function monthlyPlanQuery(userId: string, month: string, revision?: number) {
  return queryOptions({
    queryKey: [...monthlyPlanKey(userId, month), revision ?? 'current'],
    queryFn: () => monthlyPlanApi.get(month, revision),
  });
}

export function autoCopyRuleQuery(userId: string) {
  return queryOptions({
    queryKey: ['income', userId, 'plan-rules', 'auto-copy'],
    queryFn: monthlyPlanApi.getAutoCopyRule,
  });
}
