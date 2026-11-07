/**
 * Household budget: every month is kept separately, with its own income and
 * its own expenses, and a history entry per month.
 */
jest.unmock('@/lib/db/db-client');
import { runMigrations } from '@/lib/db/migrations';
import * as q from '@/lib/db/queries';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => db.close());

const expense = (amount: number, date: string) =>
  q.createHouseholdExpense({ amount, date, category_id: null, notes: null } as any);

/** Close the current month the way useHousehold does when it has ended. */
async function closeMonth(start: string, end: string, nextStart: string) {
  const config = (await q.getHouseholdConfig())!;
  await q.rollOverHouseholdPeriod({
    period: 'monthly',
    start_date: start,
    end_date: end,
    income_amount: config.income_amount,
    next_start_date: nextStart,
  });
}

describe('household months', () => {
  it('keeps each month separately, with its own income and expenses', async () => {
    // June: income 1000, two expenses.
    await q.upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: '2026-06-01' });
    await expense(300, '2026-06-05');
    await expense(150, '2026-06-20');
    await closeMonth('2026-06-01', '2026-06-30', '2026-07-01');

    // July starts with June's income as an unconfirmed suggestion…
    let config = (await q.getHouseholdConfig())!;
    expect(config.income_amount).toBe(1000);
    expect(config.income_confirmed).toBe(false);

    // …and the user sets July's own income.
    await q.upsertHouseholdConfig({ income_amount: 1500, period: 'monthly', period_start_date: '2026-07-01' });
    config = (await q.getHouseholdConfig())!;
    expect(config.income_confirmed).toBe(true);
    await expense(900, '2026-07-10');
    await closeMonth('2026-07-01', '2026-07-31', '2026-08-01');

    const [july, june] = await q.listHouseholdHistory();
    expect(june).toMatchObject({
      start_date: '2026-06-01', end_date: '2026-06-30',
      income_amount: 1000, spent_amount: 450, remaining_amount: 550, expense_count: 2,
    });
    expect(july).toMatchObject({
      start_date: '2026-07-01', end_date: '2026-07-31',
      income_amount: 1500, spent_amount: 900, remaining_amount: 600, expense_count: 1,
    });

    // Every month still has its own entries; August starts empty.
    expect(await q.getHouseholdExpenses('2026-06-01', '2026-06-30')).toHaveLength(2);
    expect(await q.getHouseholdExpenses('2026-07-01', '2026-07-31')).toHaveLength(1);
    expect(await q.getHouseholdExpenses('2026-08-01', '2026-08-31')).toHaveLength(0);
  });

  it('keeps carried-over income when the user chooses to keep it', async () => {
    await q.upsertHouseholdConfig({ income_amount: 800, period: 'monthly', period_start_date: '2026-06-01' });
    await closeMonth('2026-06-01', '2026-06-30', '2026-07-01');
    await q.confirmHouseholdIncome();
    const config = (await q.getHouseholdConfig())!;
    expect(config).toMatchObject({ income_amount: 800, income_confirmed: true, period_start_date: '2026-07-01' });
  });

  it('counts an expense backdated into a closed month in that month', async () => {
    await q.upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: '2026-06-01' });
    await expense(100, '2026-06-03');
    await closeMonth('2026-06-01', '2026-06-30', '2026-07-01');

    await expense(50, '2026-06-28'); // logged late, dated in June
    const [june] = await q.listHouseholdHistory();
    expect(june).toMatchObject({ spent_amount: 150, remaining_amount: 850, expense_count: 2 });
  });

  it('changes one past month\'s income without touching other months or the current one', async () => {
    await q.upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: '2026-06-01' });
    await expense(400, '2026-06-10');
    await closeMonth('2026-06-01', '2026-06-30', '2026-07-01');
    await closeMonth('2026-07-01', '2026-07-31', '2026-08-01');

    const [july, june] = await q.listHouseholdHistory();
    await q.updateHouseholdHistoryIncome(june.id, 1200);

    expect(await q.getHouseholdHistoryEntry(june.id)).toMatchObject({ income_amount: 1200, remaining_amount: 800 });
    expect(await q.getHouseholdHistoryEntry(july.id)).toMatchObject({ income_amount: 1000 });
    expect((await q.getHouseholdConfig())!.income_amount).toBe(1000);
    await expect(q.updateHouseholdHistoryIncome(june.id, 0)).rejects.toThrow();
  });

  it('refuses a start date that would overlap a month already in history', async () => {
    await q.upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: '2026-06-01' });
    await closeMonth('2026-06-01', '2026-06-30', '2026-07-01');

    const error = await q
      .upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: '2026-06-15' })
      .catch(e => e);
    expect(error).toBeInstanceOf(q.HouseholdPeriodOverlapError);
    expect(error.lastArchivedEnd).toBe('2026-06-30');
    expect((await q.getHouseholdConfig())!.period_start_date).toBe('2026-07-01');

    // The day after the last archived month is fine.
    await q.upsertHouseholdConfig({ income_amount: 1100, period: 'monthly', period_start_date: '2026-07-01' });
    expect((await q.getHouseholdConfig())!.income_amount).toBe(1100);
  });

  it('deleting a month from history deletes its expenses but keeps other months and account income', async () => {
    const accountId = (await q.getAccounts())[0].id;
    const incomeCategoryId = (await q.getCategories('income'))[0].id;
    await q.upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: '2026-06-01' });
    await expense(100, '2026-06-02');
    const { income } = await q.createHouseholdTransfer({
      amount: 200, accountId, accountName: 'Cash', incomeCategoryId, date: '2026-06-25',
    });
    await closeMonth('2026-06-01', '2026-06-30', '2026-07-01');
    await expense(70, '2026-07-04');
    await closeMonth('2026-07-01', '2026-07-31', '2026-08-01');

    const [july, june] = await q.listHouseholdHistory();
    await q.deleteHouseholdHistoryEntry(june.id);

    expect(await q.getHouseholdHistoryEntry(june.id)).toBeNull();
    expect(await q.getHouseholdExpenses('2026-06-01', '2026-06-30')).toHaveLength(0);
    expect(await q.getHouseholdHistoryEntry(july.id)).toMatchObject({ expense_count: 1, spent_amount: 70 });
    // The transfer's income really reached the account: it stays.
    expect(db.raw.prepare('select id from transactions where id = ?').get(income.id)).toBeTruthy();
  });

  it('shows the stored totals for months closed before this update (their expenses were deleted)', async () => {
    db.raw.prepare(
      `insert into household_periods_history
         (period, start_date, end_date, income_amount, spent_amount, remaining_amount, expense_count, entries_kept)
       values ('monthly', '2026-01-01', '2026-01-31', 900, 400, 500, 3, 0)`,
    ).run();
    const [legacy] = await q.listHouseholdHistory();
    expect(legacy).toMatchObject({ income_amount: 900, spent_amount: 400, remaining_amount: 500, expense_count: 3, entries_kept: false });

    await q.updateHouseholdHistoryIncome(legacy.id, 1000);
    expect(await q.getHouseholdHistoryEntry(legacy.id)).toMatchObject({ income_amount: 1000, remaining_amount: 600 });
  });
});

describe('migration v12', () => {
  it('upgrades an existing database: old months keep stored totals, current income stays confirmed', async () => {
    // Recreate a v11 database with household data in it.
    db.raw.exec(`
      ALTER TABLE household_periods_history DROP COLUMN entries_kept;
      ALTER TABLE household_config DROP COLUMN income_confirmed;
      DROP INDEX IF EXISTS idx_household_expenses_date_amount;
      INSERT INTO household_config (income_amount, period, period_start_date, anchor_day)
        VALUES (1000, 'monthly', '2026-07-01', 1);
      INSERT INTO household_periods_history
        (period, start_date, end_date, income_amount, spent_amount, remaining_amount, expense_count)
        VALUES ('monthly', '2026-06-01', '2026-06-30', 1000, 250, 750, 2);
    `);
    db.raw.pragma('user_version = 11');

    await runMigrations(db.expo);

    expect(db.raw.pragma('user_version', { simple: true })).toBe(12);
    const [june] = await q.listHouseholdHistory();
    expect(june).toMatchObject({ entries_kept: false, spent_amount: 250, expense_count: 2 });
    expect((await q.getHouseholdConfig())!.income_confirmed).toBe(true);
  });
});
