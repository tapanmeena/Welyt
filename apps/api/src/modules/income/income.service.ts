import { randomUUID } from 'node:crypto';
import { INCOME_ERROR_CODES, incomeReceiptInputSchema, type IncomeReceiptDto } from '@welyt/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AppDatabase } from '../../db/client.ts';
import { currencies, incomeReceipts, type IncomeReceiptRecord } from '../../db/schema.ts';
import { AppError, fieldValidationError, parseInput } from '../../lib/errors.ts';
import {
  assertNotFuture,
  formatHundredths,
  indiaBusinessDate,
  parseAmountHundredths,
} from '../../lib/financial-values.ts';

function mapReceipt(row: IncomeReceiptRecord): IncomeReceiptDto {
  return {
    id: row.id,
    receivedDate: row.receivedDate,
    type: row.type,
    source: row.source,
    currencyCode: row.currencyCode,
    amount: formatHundredths(row.amountHundredths),
    gross: row.grossHundredths === null ? null : formatHundredths(row.grossHundredths),
    tds: row.tdsHundredths === null ? null : formatHundredths(row.tdsHundredths),
    notes: row.notes,
    createdAt: row.createdAt,
    retiredAt: row.retiredAt,
    archivedAt: row.archivedAt,
    replacesReceiptId: row.replacesReceiptId,
  };
}

function ownedReceipt(userId: string, receiptId: string) {
  return and(eq(incomeReceipts.userId, userId), eq(incomeReceipts.id, receiptId));
}

function requireCurrentVersion(db: Pick<AppDatabase, 'select'>, userId: string, receiptId: string) {
  const record = db.select().from(incomeReceipts).where(ownedReceipt(userId, receiptId)).get();
  if (!record) {
    throw new AppError(
      404,
      INCOME_ERROR_CODES.INCOME_RECEIPT_NOT_FOUND,
      'Income receipt not found',
    );
  }
  if (record.retiredAt !== null) {
    throw new AppError(
      409,
      INCOME_ERROR_CODES.INCOME_RECEIPT_NOT_CURRENT,
      'Income receipt has already been corrected',
    );
  }
  return record;
}

function readReceiptInput(db: Pick<AppDatabase, 'select'>, input: unknown, instant: Date) {
  const { amount, gross, tds, ...receipt } = parseInput(incomeReceiptInputSchema, input);
  assertNotFuture(receipt.receivedDate, indiaBusinessDate(instant), 'receivedDate');
  const currency = db
    .select({ minorUnits: currencies.minorUnits })
    .from(currencies)
    .where(eq(currencies.code, receipt.currencyCode))
    .get();
  if (!currency) {
    throw fieldValidationError('currencyCode', 'Unsupported receipt currency');
  }
  const { minorUnits } = currency;
  const amountHundredths = parseAmountHundredths(amount, minorUnits, 'amount');
  if (amountHundredths <= 0) {
    throw fieldValidationError('amount', 'The received amount must be positive');
  }

  const grossHundredths = gross == null ? null : parseAmountHundredths(gross, minorUnits, 'gross');
  if (grossHundredths !== null && grossHundredths < amountHundredths) {
    throw fieldValidationError('gross', 'Gross cannot be below the received amount');
  }
  const tdsHundredths = tds == null ? null : parseAmountHundredths(tds, minorUnits, 'tds');
  if (tdsHundredths !== null) {
    if (tdsHundredths < 0) {
      throw fieldValidationError('tds', 'TDS cannot be negative');
    }
    if (grossHundredths !== null && tdsHundredths > grossHundredths - amountHundredths) {
      throw fieldValidationError(
        'tds',
        'TDS cannot exceed the difference between gross and received',
      );
    }
  }
  return { ...receipt, amountHundredths, grossHundredths, tdsHundredths };
}

export class IncomeService {
  private readonly db: AppDatabase;
  private readonly now: () => Date;

  constructor(db: AppDatabase, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  listReceipts(userId: string, includeInactive: boolean): IncomeReceiptDto[] {
    return this.db
      .select()
      .from(incomeReceipts)
      .where(
        and(
          eq(incomeReceipts.userId, userId),
          includeInactive
            ? undefined
            : and(isNull(incomeReceipts.retiredAt), isNull(incomeReceipts.archivedAt)),
        ),
      )
      .orderBy(desc(incomeReceipts.receivedDate), desc(incomeReceipts.id))
      .all()
      .map(mapReceipt);
  }

  createReceipt(userId: string, input: unknown): IncomeReceiptDto {
    return this.writeReceipt(userId, input);
  }

  correctReceipt(userId: string, receiptId: string, input: unknown): IncomeReceiptDto {
    return this.writeReceipt(userId, input, receiptId);
  }

  archiveReceipt(userId: string, receiptId: string): IncomeReceiptDto {
    return this.db.transaction(
      (tx) => {
        const record = requireCurrentVersion(tx, userId, receiptId);
        if (record.archivedAt !== null) return mapReceipt(record);
        const row = tx
          .update(incomeReceipts)
          .set({ archivedAt: this.now().toISOString() })
          .where(ownedReceipt(userId, receiptId))
          .returning()
          .get();
        return mapReceipt(row);
      },
      { behavior: 'immediate' },
    );
  }

  private writeReceipt(
    userId: string,
    input: unknown,
    replacesReceiptId?: string,
  ): IncomeReceiptDto {
    return this.db.transaction(
      (tx) => {
        if (replacesReceiptId !== undefined) {
          const original = requireCurrentVersion(tx, userId, replacesReceiptId);
          if (original.archivedAt !== null) {
            throw new AppError(
              409,
              INCOME_ERROR_CODES.INCOME_RECEIPT_ARCHIVED,
              'Archived income receipts cannot be corrected',
            );
          }
        }
        const instant = this.now();
        const fields = readReceiptInput(tx, input, instant);
        const createdAt = instant.toISOString();
        if (replacesReceiptId !== undefined) {
          tx.update(incomeReceipts)
            .set({ retiredAt: createdAt })
            .where(ownedReceipt(userId, replacesReceiptId))
            .run();
        }
        const row = tx
          .insert(incomeReceipts)
          .values({ ...fields, id: randomUUID(), userId, createdAt, replacesReceiptId })
          .returning()
          .get();
        return mapReceipt(row);
      },
      { behavior: 'immediate' },
    );
  }
}
