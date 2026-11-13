jest.unmock('@/lib/db/db-client');
import { dueOccurrences, occurrenceDate, processRecurringTransactions } from '@/features/recurring/services/recurring-processor';
import * as q from '@/lib/db/queries';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';

describe('recurring schedule math', () => {
  it('clamps monthly schedules to month end without drifting', () => {
    const dates = [0, 1, 2, 3].map(n => occurrenceDate('2026-01-31', 'monthly', n));
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('handles leap-day yearly schedules', () => {
    expect(occurrenceDate('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
    expect(occurrenceDate('2024-02-29', 'yearly', 4)).toBe('2028-02-29');
  });

  it('steps weekly and daily across month boundaries', () => {
    expect(occurrenceDate('2026-03-28', 'weekly', 1)).toBe('2026-04-04');
    expect(occurrenceDate('2026-12-31', 'daily', 1)).toBe('2027-01-01');
  });

  it('lists every missed occurrence after last_processed, up to today', () => {
    const due = dueOccurrences(
      { start_date: '2026-01-15', frequency: 'monthly', last_processed: '2026-01-15', end_date: null },
      '2026-04-20'
    );
    expect(due).toEqual(['2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('stops at end_date', () => {
    const due = dueOccurrences(
      { start_date: '2026-01-01', frequency: 'monthly', last_processed: null, end_date: '2026-02-15' },
      '2026-06-01'
    );
    expect(due).toEqual(['2026-01-01', '2026-02-01']);
  });

  it('returns nothing when not yet due', () => {
    expect(dueOccurrences({ start_date: '2026-05-01', frequency: 'monthly', last_processed: null, end_date: null }, '2026-04-30')).toEqual([]);
  });
});

describe('processRecurringTransactions (real SQLite)', () => {
  let db: TestDb;
  let accountId: number;
  let expenseCat: number;

  beforeEach(async () => {
    db = await createTestDb();
    accountId = (await q.getAccounts())[0].id;
    expenseCat = (await q.getCategories('expense'))[0].id;
  });
  afterEach(() => db.close());

  const txDates = () =>
    (db.raw.prepare('select date from transactions order by date').all() as { date: string }[]).map(r => r.date);
  const recurringRow = (id: number) =>
    db.raw.prepare('select last_processed, is_active from recurring_expenses where id = ?').get(id) as { last_processed: string | null; is_active: number };

  const newRecurring = (extra: object = {}) =>
    q.createRecurringExpense({
      category_id: expenseCat,
      account_id: accountId,
      amount: 15,
      frequency: 'monthly',
      start_date: '2026-01-31',
      is_active: 1,
      ...extra,
    } as any);

  it('catches up on all missed occurrences and is idempotent', async () => {
    const r = await newRecurring();
    const first = await processRecurringTransactions('2026-04-01');
    expect(first).toMatchObject({ success: true, created: 3 });
    expect(txDates()).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(recurringRow(r.id).last_processed).toBe('2026-03-31');

    const second = await processRecurringTransactions('2026-04-01');
    expect(second.created).toBe(0);
    expect(txDates()).toHaveLength(3);
  });

  it('reports each booked expense, for budget alerts', async () => {
    await newRecurring();
    const result = await processRecurringTransactions('2026-03-01');
    expect(result.bookedExpenses).toEqual([
      { categoryId: expenseCat, amount: 15, date: '2026-01-31' },
      { categoryId: expenseCat, amount: 15, date: '2026-02-28' },
    ]);
  });

  it('links generated transactions to the recurring entry', async () => {
    const r = await newRecurring({ start_date: '2026-03-01' });
    await processRecurringTransactions('2026-03-01');
    expect(db.raw.prepare('select recurring_id from transactions').get()).toEqual({ recurring_id: r.id });
  });

  it('deactivates the entry once its end date has passed', async () => {
    const r = await newRecurring({ start_date: '2026-01-10', end_date: '2026-02-20' });
    await processRecurringTransactions('2026-05-01');
    expect(txDates()).toEqual(['2026-01-10', '2026-02-10']);
    expect(recurringRow(r.id).is_active).toBe(0);
  });

  it('"Make Recurring" from the add modal does not duplicate the first transaction', async () => {
    await q.createTransactionWithRecurring(
      { category_id: expenseCat, account_id: accountId, amount: 9.99, type: 'expense', date: '2026-03-05' } as any,
      'monthly'
    );
    await processRecurringTransactions('2026-03-20');
    expect(txDates()).toEqual(['2026-03-05']);
    await processRecurringTransactions('2026-04-05');
    expect(txDates()).toEqual(['2026-03-05', '2026-04-05']);
  });

  it('adopts a legacy first transaction instead of duplicating it', async () => {
    // Before this fix, "Make Recurring" saved the transaction and a recurring
    // entry with no last_processed.
    await q.createTransaction({ category_id: expenseCat, account_id: accountId, amount: 15, type: 'expense', date: '2026-03-05' } as any);
    const r = await newRecurring({ start_date: '2026-03-05' });
    await processRecurringTransactions('2026-03-06');
    expect(txDates()).toEqual(['2026-03-05']);
    expect(recurringRow(r.id).last_processed).toBe('2026-03-05');
    expect(db.raw.prepare('select recurring_id from transactions').get()).toEqual({ recurring_id: r.id });
  });
});

describe('recurring: concurrency and resume', () => {
  let db: TestDb;
  let accountId: number;
  let expenseCat: number;
  beforeEach(async () => {
    db = await createTestDb();
    accountId = (await q.getAccounts())[0].id;
    expenseCat = (await q.getCategories('expense'))[0].id;
  });
  afterEach(() => db.close());

  const countTx = () => (db.raw.prepare('select count(*) as n from transactions').get() as { n: number }).n;

  it('overlapping runs (launch + resume) create each occurrence once', async () => {
    await q.createRecurringExpense({ category_id: expenseCat, account_id: accountId, amount: 10, frequency: 'monthly', start_date: '2026-01-31', is_active: 1 } as any);
    await Promise.all([processRecurringTransactions('2026-04-01'), processRecurringTransactions('2026-04-01')]);
    expect(countTx()).toBe(3); // Jan 31, Feb 28, Mar 31
  });

  it('resuming a paused item skips the paused months instead of back-filling them', async () => {
    const { resumeRecurring } = require('@/features/recurring/services/recurring-processor');
    const rec = await q.createRecurringExpense({ category_id: expenseCat, account_id: accountId, amount: 10, frequency: 'monthly', start_date: '2026-01-10', is_active: 1 } as any);
    const id = (rec as any)?.id ?? (rec as any)[0]?.id;
    await processRecurringTransactions('2026-01-15');          // Jan 10 charged
    await q.updateRecurringExpense(id, { is_active: 0 });       // paused
    await resumeRecurring(id, '2026-06-15');                    // resumed mid-June
    await processRecurringTransactions('2026-06-15');
    expect(countTx()).toBe(1);                                  // no Feb–Jun back-fill
    await processRecurringTransactions('2026-07-10');
    expect(countTx()).toBe(2);                                  // billing restarts on schedule
  });

  it('resuming still charges an occurrence that falls due today', async () => {
    const { resumeRecurring } = require('@/features/recurring/services/recurring-processor');
    const rec = await q.createRecurringExpense({ category_id: expenseCat, account_id: accountId, amount: 10, frequency: 'monthly', start_date: '2026-01-10', is_active: 0, last_processed: '2026-01-10' } as any);
    const id = (rec as any)?.id ?? (rec as any)[0]?.id;
    await resumeRecurring(id, '2026-05-10');
    await processRecurringTransactions('2026-05-10');
    expect(countTx()).toBe(1); // only May 10
  });
});
