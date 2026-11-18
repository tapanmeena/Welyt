import { randomUUID } from 'node:crypto';
import {
  INCOME_ERROR_CODES,
  monthlyPlanSaveSchema,
  monthlyPlanTotals,
  shiftPlanMonth,
  type AutoCopyRuleDto,
  type MonthlyPlanDto,
} from '@welyt/shared';
import { and, desc, eq, lt, lte } from 'drizzle-orm';
import type { AppDatabase } from '../../db/client.ts';
import { monthlyPlanAutoCopyRules, monthlyPlans, planAllocations } from '../../db/schema.ts';
import { AppError, fieldValidationError, parseInput } from '../../lib/errors.ts';
import {
  formatHundredths,
  indiaBusinessDate,
  parseAmountHundredths,
} from '../../lib/financial-values.ts';

type PlanReader = Pick<AppDatabase, 'select'>;
type PlanWriter = Pick<AppDatabase, 'select' | 'insert'>;
type PlanRecord = typeof monthlyPlans.$inferSelect;
type AllocationAmounts = Pick<
  typeof planAllocations.$inferInsert,
  'name' | 'group' | 'amountHundredths'
>;

function findPlan(db: PlanReader, userId: string, month: string, revision?: number) {
  return db
    .select()
    .from(monthlyPlans)
    .where(
      and(
        eq(monthlyPlans.userId, userId),
        eq(monthlyPlans.month, month),
        revision === undefined ? undefined : eq(monthlyPlans.revision, revision),
      ),
    )
    .orderBy(desc(monthlyPlans.revision))
    .get();
}

function readAllocations(db: PlanReader, monthlyPlanId: string) {
  return db
    .select()
    .from(planAllocations)
    .where(eq(planAllocations.monthlyPlanId, monthlyPlanId))
    .orderBy(planAllocations.position)
    .all();
}

function toPlanDto(db: PlanReader, row: PlanRecord): MonthlyPlanDto {
  const allocations = readAllocations(db, row.id);
  return {
    id: row.id,
    month: row.month,
    revision: row.revision,
    currencyCode: row.currencyCode,
    forecastIncome: formatHundredths(row.forecastHundredths),
    allocations: allocations.map(({ id, name, group, amountHundredths }) => ({
      id,
      name,
      group,
      amount: formatHundredths(amountHundredths),
    })),
    createdAt: row.createdAt,
    createdVia: row.createdVia,
    copiedFromPlanId: row.copiedFromPlanId,
    totals: monthlyPlanTotals(row.forecastHundredths, allocations),
  };
}

function insertPlan(
  db: PlanWriter,
  fields: Omit<typeof monthlyPlans.$inferInsert, 'id'>,
  allocations: readonly AllocationAmounts[],
): PlanRecord {
  const row = db
    .insert(monthlyPlans)
    .values({ ...fields, id: randomUUID() })
    .returning()
    .get();
  for (const [position, { name, group, amountHundredths }] of allocations.entries()) {
    db.insert(planAllocations)
      .values({
        id: randomUUID(),
        monthlyPlanId: row.id,
        name,
        group,
        amountHundredths,
        position,
      })
      .run();
  }
  return row;
}

function missingPlan() {
  return new AppError(404, INCOME_ERROR_CODES.MONTHLY_PLAN_NOT_FOUND, 'Monthly plan not found');
}

export class MonthlyPlanService {
  private readonly db: AppDatabase;
  private readonly now: () => Date;

  constructor(db: AppDatabase, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  get(userId: string, month: string, revision?: number): MonthlyPlanDto | null {
    return this.db.transaction((tx) => {
      const current = findPlan(tx, userId, month, revision);
      if (current) return toPlanDto(tx, current);
      if (revision !== undefined) throw missingPlan();
      return null;
    });
  }

  save(userId: string, month: string, raw: unknown): MonthlyPlanDto {
    const input = parseInput(monthlyPlanSaveSchema, raw);
    const { expectedRevision, copiedFromPlanId } = input;
    const forecastHundredths = parseAmountHundredths(input.forecastIncome, 2, 'forecastIncome');
    const allocations = input.allocations.map(({ name, group, amount }, index) => ({
      name,
      group,
      amountHundredths: parseAmountHundredths(amount, 2, `allocations.${index}.amount`),
    }));

    return this.db.transaction(
      (tx) => {
        const current = findPlan(tx, userId, month);
        if ((current?.revision ?? 0) !== expectedRevision) {
          throw new AppError(
            409,
            INCOME_ERROR_CODES.MONTHLY_PLAN_REVISION_CONFLICT,
            'This plan changed. Review the latest revision before saving again.',
          );
        }
        if (copiedFromPlanId !== undefined) {
          if (current)
            throw fieldValidationError(
              'copiedFromPlanId',
              'Copying is only allowed into a blank month',
            );
          const source = tx
            .select()
            .from(monthlyPlans)
            .where(and(eq(monthlyPlans.userId, userId), eq(monthlyPlans.id, copiedFromPlanId)))
            .get();
          if (!source) throw missingPlan();
          if (source.month !== shiftPlanMonth(month, -1)) {
            throw fieldValidationError(
              'copiedFromPlanId',
              'Choose a saved plan from the previous month',
            );
          }
        }
        const row = insertPlan(
          tx,
          {
            userId,
            month,
            revision: expectedRevision + 1,
            forecastHundredths,
            createdAt: this.now().toISOString(),
            createdVia: copiedFromPlanId === undefined ? 'manual' : 'manual_copy',
            copiedFromPlanId: copiedFromPlanId ?? null,
          },
          allocations,
        );
        return toPlanDto(tx, row);
      },
      { behavior: 'immediate' },
    );
  }

  getAutoCopyRule(userId: string): AutoCopyRuleDto {
    const rule = this.db
      .select({
        enabled: monthlyPlanAutoCopyRules.enabled,
        firstTargetMonth: monthlyPlanAutoCopyRules.firstTargetMonth,
      })
      .from(monthlyPlanAutoCopyRules)
      .where(eq(monthlyPlanAutoCopyRules.userId, userId))
      .get();
    return rule ?? { enabled: false, firstTargetMonth: null };
  }

  setAutoCopyRule(userId: string, enabled: boolean): AutoCopyRuleDto {
    return this.db.transaction(
      (tx) => {
        const existing = tx
          .select({
            enabled: monthlyPlanAutoCopyRules.enabled,
            firstTargetMonth: monthlyPlanAutoCopyRules.firstTargetMonth,
          })
          .from(monthlyPlanAutoCopyRules)
          .where(eq(monthlyPlanAutoCopyRules.userId, userId))
          .get();
        if (existing?.enabled === enabled) return existing;
        const now = this.now();
        const firstTargetMonth = enabled
          ? shiftPlanMonth(indiaBusinessDate(now).slice(0, 7), 1)
          : null;
        if (enabled && firstTargetMonth === null) {
          throw fieldValidationError('enabled', 'No supported calendar month follows this month');
        }
        const rule = { enabled, firstTargetMonth, updatedAt: now.toISOString() };
        tx.insert(monthlyPlanAutoCopyRules)
          .values({ userId, ...rule })
          .onConflictDoUpdate({
            target: monthlyPlanAutoCopyRules.userId,
            set: rule,
          })
          .run();
        return { enabled, firstTargetMonth };
      },
      { behavior: 'immediate' },
    );
  }

  runDueAutoCopies(): number {
    const now = this.now();
    const month = indiaBusinessDate(now).slice(0, 7);
    const previous = shiftPlanMonth(month, -1);
    if (previous === null) return 0;
    // Freeze the source at the India-local boundary even when startup is late.
    const cutoff = new Date(`${month}-01T00:00:00+05:30`).toISOString();
    const due = and(
      eq(monthlyPlanAutoCopyRules.enabled, true),
      lte(monthlyPlanAutoCopyRules.firstTargetMonth, month),
    );
    const candidates = this.db
      .select({ userId: monthlyPlanAutoCopyRules.userId })
      .from(monthlyPlanAutoCopyRules)
      .where(due)
      .all();
    let created = 0;
    for (const { userId } of candidates) {
      const wrote = this.db.transaction(
        (tx) => {
          const rule = tx
            .select({ userId: monthlyPlanAutoCopyRules.userId })
            .from(monthlyPlanAutoCopyRules)
            .where(and(eq(monthlyPlanAutoCopyRules.userId, userId), due))
            .get();
          if (!rule || findPlan(tx, userId, month)) return false;
          const source = tx
            .select()
            .from(monthlyPlans)
            .where(
              and(
                eq(monthlyPlans.userId, userId),
                eq(monthlyPlans.month, previous),
                lt(monthlyPlans.createdAt, cutoff),
              ),
            )
            .orderBy(desc(monthlyPlans.revision))
            .get();
          if (!source) return false;
          insertPlan(
            tx,
            {
              userId,
              month,
              revision: 1,
              forecastHundredths: source.forecastHundredths,
              createdAt: now.toISOString(),
              createdVia: 'auto_copy',
              copiedFromPlanId: source.id,
            },
            readAllocations(tx, source.id),
          );
          return true;
        },
        { behavior: 'immediate' },
      );
      if (wrote) created++;
    }
    return created;
  }
}
