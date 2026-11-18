import { z } from 'zod';
import { formatHundredths, moneyStringSchema, parseDecimalHundredths } from './accounts.ts';

export const PLAN_ALLOCATION_GROUPS = ['fixed', 'flexible', 'saving'] as const;
export const PLAN_CREATION_METHODS = ['manual', 'manual_copy', 'auto_copy'] as const;
export const planMonthSchema = z
  .string()
  .length(7)
  .regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/, 'Use a calendar month in YYYY-MM format');
export const monthlyPlanParamsSchema = z.strictObject({ month: planMonthSchema });
export const monthlyPlanQuerySchema = z.strictObject({
  revision: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.int().positive())
    .optional(),
});

function inrAmount(minimumHundredths: bigint, message: string) {
  return z.string().refine((value) => {
    const parsed = parseDecimalHundredths(value);
    return (
      parsed !== null &&
      value.trim() === value &&
      parsed.hundredths >= minimumHundredths &&
      parsed.hundredths <= BigInt(Number.MAX_SAFE_INTEGER)
    );
  }, message);
}

const allocationGroupSchema = z.enum(PLAN_ALLOCATION_GROUPS);
const allocationInputSchema = z.strictObject({
  name: z.string().trim().min(1, 'Enter an allocation name'),
  group: allocationGroupSchema,
  amount: inrAmount(1n, 'Enter a positive amount with up to two decimal places'),
});
export const monthlyPlanSaveSchema = z.strictObject({
  expectedRevision: z.int().nonnegative(),
  forecastIncome: inrAmount(0n, 'Enter a nonnegative forecast with up to two decimal places'),
  allocations: z.array(allocationInputSchema),
  copiedFromPlanId: z.uuid().optional(),
});
export const monthlyPlanTotalsSchema = z.object({
  byGroup: z.object({
    fixed: moneyStringSchema,
    flexible: moneyStringSchema,
    saving: moneyStringSchema,
  }),
  allocated: moneyStringSchema,
  remaining: moneyStringSchema,
});
export const monthlyPlanDtoSchema = z.object({
  id: z.uuid(),
  month: planMonthSchema,
  revision: z.int().positive(),
  currencyCode: z.literal('INR'),
  forecastIncome: moneyStringSchema,
  allocations: z.array(allocationInputSchema.extend({ id: z.uuid(), amount: moneyStringSchema })),
  createdAt: z.iso.datetime(),
  createdVia: z.enum(PLAN_CREATION_METHODS),
  copiedFromPlanId: z.uuid().nullable(),
  totals: monthlyPlanTotalsSchema,
});
export const monthlyPlanResponseSchema = z.object({ plan: monthlyPlanDtoSchema.nullable() });
export const autoCopyRuleInputSchema = z.strictObject({ enabled: z.boolean() });
export const autoCopyRuleDtoSchema = z.object({
  enabled: z.boolean(),
  firstTargetMonth: planMonthSchema.nullable(),
});

export type PlanAllocationGroup = z.infer<typeof allocationGroupSchema>;
export type MonthlyPlanSaveInput = z.input<typeof monthlyPlanSaveSchema>;
export type MonthlyPlanDto = z.infer<typeof monthlyPlanDtoSchema>;
export type MonthlyPlanTotals = z.infer<typeof monthlyPlanTotalsSchema>;
export type AutoCopyRuleDto = z.infer<typeof autoCopyRuleDtoSchema>;

export function shiftPlanMonth(month: string, offset: -1 | 1): string | null {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + offset;
  const year = Math.floor(index / 12);
  if (year < 1 || year > 9999) return null;
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function monthlyPlanTotals(
  forecastHundredths: number | bigint,
  allocations: readonly { group: PlanAllocationGroup; amountHundredths: number | bigint }[],
): MonthlyPlanTotals {
  const sums = { fixed: 0n, flexible: 0n, saving: 0n };
  for (const { group, amountHundredths } of allocations) sums[group] += BigInt(amountHundredths);
  const allocated = sums.fixed + sums.flexible + sums.saving;
  return {
    byGroup: {
      fixed: formatHundredths(sums.fixed),
      flexible: formatHundredths(sums.flexible),
      saving: formatHundredths(sums.saving),
    },
    allocated: formatHundredths(allocated),
    remaining: formatHundredths(BigInt(forecastHundredths) - allocated),
  };
}
