import { z } from 'zod';

export const ACCOUNT_KINDS = ['bank', 'cash', 'ewallet', 'brokerage_cash'] as const;
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code');
export const financialDateSchema = z.iso.date();
export const BALANCE_INPUT_PATTERN = /^(-?)(0|[1-9]\d{0,13})(?:\.(\d{1,2}))?$/;

export function parseDecimalHundredths(value: string) {
  const match = BALANCE_INPUT_PATTERN.exec(value);
  const whole = match?.[2];
  if (!whole) return null;
  const fraction = match[3] ?? '';
  const magnitude = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return { fraction, hundredths: match[1] === '-' ? -magnitude : magnitude };
}

export function formatScaledDecimal(
  value: bigint,
  scale: bigint,
  fractionalDigits: number,
): string {
  const magnitude = value < 0n ? -value : value;
  const fraction = String(magnitude % scale).padStart(fractionalDigits, '0');
  return `${value < 0n ? '-' : ''}${magnitude / scale}.${fraction}`;
}

export function formatHundredths(hundredths: number | bigint): string {
  return formatScaledDecimal(BigInt(hundredths), 100n, 2);
}

const indiaDateFormatter = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Kolkata',
  calendar: 'iso8601',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function indiaBusinessDate(instant: Date): string {
  const parts = indiaDateFormatter.formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Unable to format the India business date');
  }
  return `${year.padStart(4, '0')}-${month}-${day}`;
}

export function indiaFiscalWindow(asOf: string): { startsOn: string; endsBefore: string } {
  const date = new Date(`${asOf}T00:00:00Z`);
  const startYear = date.getUTCFullYear() - (date.getUTCMonth() < 3 ? 1 : 0);
  date.setUTCFullYear(startYear, 3, 1);
  const startsOn = date.toISOString().replace(/T.*$/, '');
  date.setUTCFullYear(startYear + 1);
  return { startsOn, endsBefore: date.toISOString().replace(/T.*$/, '') };
}

const accountKindSchema = z.enum(ACCOUNT_KINDS);
export const moneyStringSchema = z.string().regex(/^-?(?:0|[1-9]\d*)\.\d{2}$/);
const accountMetadataSchema = z.strictObject({
  name: z.string().trim().min(1, 'Account name is required'),
  kind: accountKindSchema,
  inNetWorth: z.boolean().optional(),
  purpose: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const createAccountSchema = accountMetadataSchema.extend({
  currencyCode: currencyCodeSchema.default('INR'),
});
export const updateAccountSchema = accountMetadataSchema
  .partial()
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
    message: 'Provide at least one account field to update',
  });
export const balanceObservationSchema = z.strictObject({
  observedOn: financialDateSchema,
  balance: z
    .string()
    .regex(
      BALANCE_INPUT_PATTERN,
      'Enter a signed decimal balance with up to two fractional digits',
    ),
  notes: z.string().nullable().optional(),
});

export const accountListQuerySchema = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
});
export const accountsAsOfQuerySchema = z.strictObject({ asOf: financialDateSchema.optional() });
export const accountParamsSchema = z.strictObject({ accountId: z.uuid() });
export const snapshotParamsSchema = accountParamsSchema.extend({ snapshotId: z.uuid() });

export const currencyDtoSchema = z.object({
  code: currencyCodeSchema,
  name: z.string(),
  minorUnits: z.number().int().min(0).max(2),
});
export const accountDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: accountKindSchema,
  currencyCode: currencyCodeSchema,
  inNetWorth: z.boolean(),
  purpose: z.string().nullable(),
  notes: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const balanceSnapshotDtoSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  observedOn: financialDateSchema,
  balance: moneyStringSchema,
  currencyCode: currencyCodeSchema,
  source: z.literal('manual'),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  retiredAt: z.iso.datetime().nullable(),
  replacesObservationId: z.string().nullable(),
});
export const latestBalanceSnapshotResponseSchema = z.object({
  snapshot: balanceSnapshotDtoSchema.nullable(),
});

export const valuationFxIssueSchema = z.discriminatedUnion('reason', [
  z.object({ reason: z.literal('missing_fx_rate') }),
  z.object({
    reason: z.literal('stale_fx_rate'),
    rateOn: financialDateSchema,
    ageDays: z.number().int().nonnegative(),
  }),
]);
const valuationIssueSchema = z.discriminatedUnion('reason', [
  z.object({ reason: z.literal('missing_snapshot') }),
  ...valuationFxIssueSchema.options,
]);
export const valuationFxRateSchema = z.object({
  id: z.string(),
  rateOn: financialDateSchema,
  rate: z.string().regex(/^\d+\.\d{8}$/),
  source: z.string(),
  fetchedAt: z.iso.datetime().nullable(),
  ageDays: z.number().int().nonnegative(),
});
export const accountValuationDtoSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  currencyCode: currencyCodeSchema,
  snapshot: balanceSnapshotDtoSchema.pick({ id: true, observedOn: true, balance: true }).nullable(),
  inrBalance: moneyStringSchema.nullable(),
  fxRate: valuationFxRateSchema.nullable(),
  issue: valuationIssueSchema.nullable(),
});
export const accountsValuationDtoSchema = z.object({
  asOf: financialDateSchema,
  fiscalYear: z.object({ startsOn: z.string(), endsBefore: z.string() }),
  reportingCurrencyCode: z.literal('INR'),
  accounts: z.array(accountValuationDtoSchema),
  complete: z.boolean(),
  knownSubtotalInr: moneyStringSchema,
  totalInr: moneyStringSchema.nullable(),
});

export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;
export type BalanceObservationInput = z.input<typeof balanceObservationSchema>;
export type CurrencyDto = z.infer<typeof currencyDtoSchema>;
export type AccountDto = z.infer<typeof accountDtoSchema>;
export type BalanceSnapshotDto = z.infer<typeof balanceSnapshotDtoSchema>;
export type AccountValuationDto = z.infer<typeof accountValuationDtoSchema>;
export type AccountsValuationDto = z.infer<typeof accountsValuationDtoSchema>;
export type ValuationFxRateDto = z.infer<typeof valuationFxRateSchema>;
export type ValuationFxIssueDto = z.infer<typeof valuationFxIssueSchema>;
