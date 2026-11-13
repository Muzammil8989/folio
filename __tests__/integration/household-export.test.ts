/**
 * Household export data: each period is loaded separately from the database,
 * with the same totals the History screen shows.
 */
jest.unmock('@/lib/db/db-client');
import { buildHouseholdWorkbook } from '@/features/household/services/household-excel';
import {
  buildHouseholdReport,
  loadAllMonths,
  loadCurrentMonth,
  loadHistoryMonth,
} from '@/features/household/services/household-report';
import * as q from '@/lib/db/queries';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';

let db: TestDb;
let categoryId: number;

beforeEach(async () => {
  db = await createTestDb();
  categoryId = (await q.getCategories('expense'))[0].id;
});
afterEach(() => db.close());

const expense = (amount: number, date: string, category_id: number | null = categoryId, notes: string | null = null) =>
  q.createHouseholdExpense({ amount, date, category_id, notes } as any);

async function setUpTwoMonths() {
  await q.upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: '2026-10-01' });
  await expense(300, '2026-10-05');
  await expense(150, '2026-10-20');
  await q.rollOverHouseholdPeriod({
    period: 'monthly', start_date: '2026-10-01', end_date: '2026-10-31', income_amount: 1000, next_start_date: '2026-11-01',
  });
  await q.upsertHouseholdConfig({ income_amount: 1200, period: 'monthly', period_start_date: '2026-11-01' });
  await expense(700, '2026-11-03');
  await expense(50, '2026-11-04', null, 'transfer-out:Wallet');
}

describe('household export data', () => {
  it('loads the running period with its own income and expenses', async () => {
    await setUpTwoMonths();
    const current = await loadCurrentMonth();
    expect(current).toMatchObject({ start: '2026-11-01', end: '2026-11-30', income: 1200, spent: 750, isCurrent: true });
    expect(current!.expenses.map(e => e.category)).toContain('Transfer to account');
  });

  it('loads a past period from History with the totals History shows', async () => {
    await setUpTwoMonths();
    const [entry] = await q.listHouseholdHistory();
    const month = await loadHistoryMonth(entry.id);
    expect(month).toMatchObject({ start: '2026-10-01', income: 1000, spent: entry.spent_amount, remaining: entry.remaining_amount, isCurrent: false });
    expect(month!.expenses).toHaveLength(entry.expense_count);
    expect(await loadHistoryMonth(9999)).toBeNull();
  });

  it('loads every period, oldest first, each kept separate', async () => {
    await setUpTwoMonths();
    const months = await loadAllMonths();
    expect(months.map(m => [m.start, m.income, m.spent])).toEqual([
      ['2026-10-01', 1000, 450],
      ['2026-11-01', 1200, 750],
    ]);
    const report = buildHouseholdReport(months, { scopeLabel: 'All periods', currency: 'USD' });
    expect(report.totals).toMatchObject({ income: 2200, spent: 1200, remaining: 1000, expenseCount: 4 });
    expect(buildHouseholdWorkbook(report).SheetNames).toEqual(['Overview', 'Oct 2026', 'Nov 2026']);
  });

  it('follows the History filter', async () => {
    await setUpTwoMonths();
    expect(await loadAllMonths('weekly')).toEqual([]);
    expect(await loadAllMonths('monthly')).toHaveLength(2);
  });

  it('has nothing to export before the household budget is set up', async () => {
    expect(await loadCurrentMonth()).toBeNull();
    expect(await loadAllMonths()).toEqual([]);
  });
});
