import { z } from 'zod';
import {
  BALANCE_INPUT_PATTERN,
  currencyCodeSchema,
  financialDateSchema,
  moneyStringSchema,
  valuationFxIssueSchema,
  valuationFxRateSchema,
} from './accounts.ts';

const receiptAmountSchema = z
  .string()
  .regex(BALANCE_INPUT_PATTERN, 'Enter a decimal amount with up to two fractional digits');

export const incomeReceiptInputSchema = z.strictObject({
  receivedDate: financialDateSchema,
  type: z.string().trim().min(1, 'Income type is required'),
  source: z.string().trim().min(1, 'Income source is required'),
  currencyCode: currencyCodeSchema,
  amount: receiptAmountSchema,
  gross: receiptAmountSchema.nullable().optional(),
  tds: receiptAmountSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const incomeReceiptParamsSchema = z.strictObject({ receiptId: z.uuid() });
export const incomeListQuerySchema = z.strictObject({
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
});

export const incomeHistoryQuerySchema = z.strictObject({
  fiscalYear: z
    .string()
    .length(4, 'Use the four-digit financial year start')
    .regex(/^\d{4}$/, 'Use the four-digit financial year start')
    .optional(),
});

export const incomeReceiptDtoSchema = z.object({
  id: z.uuid(),
  receivedDate: financialDateSchema,
  type: z.string(),
  source: z.string(),
  currencyCode: currencyCodeSchema,
  amount: moneyStringSchema,
  gross: moneyStringSchema.nullable(),
  tds: moneyStringSchema.nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  retiredAt: z.iso.datetime().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  replacesReceiptId: z.uuid().nullable(),
});

export const incomeReceiptValuationDtoSchema = incomeReceiptDtoSchema.extend({
  inrAmount: moneyStringSchema.nullable(),
  fxRate: valuationFxRateSchema.nullable(),
  issue: valuationFxIssueSchema.nullable(),
});

const incomeTotalsSchema = z.object({
  complete: z.boolean(),
  knownSubtotalInr: moneyStringSchema,
  totalInr: moneyStringSchema.nullable(),
});

export const incomeMonthDtoSchema = incomeTotalsSchema.extend({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  receipts: z.array(incomeReceiptValuationDtoSchema),
});

export const incomeHistoryDtoSchema = incomeTotalsSchema.extend({
  fiscalYear: z.object({ startsOn: financialDateSchema, endsBefore: financialDateSchema }),
  reportingCurrencyCode: z.literal('INR'),
  months: z.array(incomeMonthDtoSchema),
});

export type IncomeReceiptInput = z.input<typeof incomeReceiptInputSchema>;
export type IncomeReceiptDto = z.infer<typeof incomeReceiptDtoSchema>;
export type IncomeReceiptValuationDto = z.infer<typeof incomeReceiptValuationDtoSchema>;
export type IncomeHistoryDto = z.infer<typeof incomeHistoryDtoSchema>;
