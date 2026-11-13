jest.unmock('@/lib/db/db-client');
import { loadInsights } from '@/features/reports/hooks/use-insights';
import { buildReportData } from '@/features/export/services/report-data';
import { buildWorkbook } from '@/features/export/services/excel-export';
import * as q from '@/lib/db/queries';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';

let db: TestDb;
let cash: number;
let bank: number;
let food: number;
let rent: number;
let salary: number;

beforeEach(async () => {
    db = await createTestDb();
    cash = (await q.getAccounts())[0].id;
    bank = (await q.createAccount({ name: 'Bank', type: 'checking', balance: 1000, currency: 'USD' } as any)).id;
    const expenses = await q.getCategories('expense');
    food = expenses[0].id;
    rent = expenses[1].id;
    salary = (await q.getCategories('income'))[0].id;
});
afterEach(() => db.close());

const add = (type: 'income' | 'expense', amount: number, date: string, account_id: number, category_id: number, notes?: string) =>
    q.createTransaction({ amount, type, date, account_id, category_id, notes } as any);

describe('report filters', () => {
    beforeEach(async () => {
        await add('income', 3000, '2026-04-01', bank, salary);
        await add('expense', 40, '2026-04-04', cash, food, 'Groceries'); // Saturday
        await add('expense', 60, '2026-04-11', cash, food);              // Saturday
        await add('expense', 900, '2026-04-06', bank, rent, 'April rent');  // Monday
        await q.createAccountTransfer({ fromAccountId: bank, toAccountId: cash, amount: 200, date: '2026-04-07' });
    });

    it('narrows totals by account and by category, leaving transfers out', async () => {
        const totals = async (f?: q.ReportFilters) => {
            const rows = await q.getSummaryByDateRange('2026-04-01', '2026-04-30', f);
            return Object.fromEntries(rows.map(r => [r.type, Number(r.total)]));
        };
        expect(await totals()).toEqual({ income: 3000, expense: 1000 });
        expect(await totals({ accountId: cash })).toEqual({ expense: 100 });
        expect(await totals({ categoryId: rent })).toEqual({ expense: 900 });
        expect(await totals({ accountId: cash, categoryId: rent })).toEqual({});
    });

    it('groups income and spending by category', async () => {
        expect((await q.getCategoryTotals('expense', '2026-04-01', '2026-04-30')).map(c => [c.categoryId, c.total]))
            .toEqual([[rent, 900], [food, 100]]);
        expect((await q.getCategoryTotals('income', '2026-04-01', '2026-04-30')).map(c => c.total)).toEqual([3000]);
        expect(await q.getExpenseByCategory('2026-04-01', '2026-04-30', { accountId: cash })).toHaveLength(1);
    });

    it('filters monthly and daily figures', async () => {
        const months = await q.getMonthlyTotals(1, new Date(2026, 3, 20), { categoryId: food });
        expect(months[0]).toMatchObject({ income: 0, expense: 100 });
        const days = await q.getDailySpending('2026-04-01', '2026-04-30', new Date(2026, 3, 30), { accountId: cash });
        expect(days.filter(d => d.amount > 0).map(d => [d.day, d.amount])).toEqual([[4, 40], [11, 60]]);
    });

    it('averages spending per weekday over the days in range', async () => {
        const week = await q.getSpendByWeekday('2026-04-01', '2026-04-30', undefined, new Date(2026, 3, 30));
        const sat = week.find(w => w.weekday === 6)!;
        expect(sat).toMatchObject({ total: 100, days: 4, average: 25 });
        expect(week.find(w => w.weekday === 1)).toMatchObject({ total: 900 });
        expect(week.reduce((s, w) => s + w.days, 0)).toBe(30);
    });

    it('lists the largest expenses with their category and account', async () => {
        const top = await q.getTopExpenses('2026-04-01', '2026-04-30', undefined, 2);
        expect(top.map(t => [t.amount, t.notes, t.accountName, t.categoryId])).toEqual([
            [900, 'April rent', 'Bank', rent],
            [60, null, (await q.getAccounts()).find(a => a.id === cash)!.name, food],
        ]);
    });

    it('loads every Insights figure together, compared with the month before', async () => {
        await add('expense', 500, '2026-03-05', bank, rent);
        const data = await loadInsights(
            { period: 'custom', custom: { start: '2026-04-01', end: '2026-04-30' }, accountId: null, categoryId: null },
            new Date(2026, 4, 15),
        );
        expect(data).toMatchObject({ income: 3000, expense: 1000, prevExpense: 500 });
        expect(data.prev).toEqual({ start: '2026-03-02', end: '2026-03-31' });
        expect(data.daily).toHaveLength(30);
        expect(data.monthly[data.monthly.length - 1]).toMatchObject({ month: 'Apr', expense: 1000 });
        expect(data.top[0].amount).toBe(900);
    });
});

describe('net worth', () => {
    it('adds accounts, savings and money lent, less money owed', async () => {
        const opening = await q.getCurrentBalance();
        await add('income', 500, '2026-04-01', cash, salary);
        const goal = await q.createSavingsGoal({ name: 'Trip', target_amount: 1000, saved_amount: 0 } as any);
        await q.moveSavings({ goalId: goal.id, accountId: cash, amount: 200, direction: 'deposit', date: '2026-04-02' });
        const cats = await q.ensureSystemLoanCategories();
        await q.createLoan({ type: 'given', person_name: 'Ali', amount: 50, account_id: cash, date: '2026-04-03', due_date: null, notes: null, is_settled: 0 }, cats);
        await q.createLoan({ type: 'taken', person_name: 'Sara', amount: 80, account_id: bank, date: '2026-04-03', due_date: null, notes: null, is_settled: 0 }, cats);

        const parts = await q.getNetWorthParts();
        expect(parts.savings).toBe(200);
        expect(parts.lent).toBe(50);
        expect(parts.borrowed).toBe(80);
        // Moving money into savings or lending it out doesn't change net worth.
        const balance = await q.getCurrentBalance();
        expect(parts.accounts).toBe(balance);
        expect(parts.accounts + parts.savings + parts.lent - parts.borrowed).toBe(opening + 500);
    });
});

describe('portfolio in the export', () => {
    it('adds a Portfolio sheet with totals, and leaves it out when unticked', async () => {
        const h = await q.createHolding(
            { name: 'Engro', symbol: 'ENGRO', asset_type: 'stock', market: null, notes: null, color: null },
            { type: 'buy', date: '2026-01-05', quantity: 10, price: 100, fees: 0, amount: null, notes: null },
            { price: 130, date: '2026-02-01' },
        );
        await q.createTrade(h.id, { type: 'dividend', date: '2026-03-01', quantity: null, price: null, fees: 0, amount: 25, notes: null });
        const data = await buildReportData({ start: '2026-04-01', end: '2026-04-30', periodLabel: 'April', currency: 'USD' });
        expect(data.holdings).toEqual([expect.objectContaining({ name: 'Engro', value: 1300, invested: 1000, totalReturn: 325, totalReturnPct: 32.5 })]);
        const wb = buildWorkbook(data);
        expect(wb.SheetNames).toContain('Portfolio');
        expect(wb.Sheets.Portfolio.H2.v).toBe(1300);

        const without = await buildReportData({
            start: '2026-04-01', end: '2026-04-30', periodLabel: 'April', currency: 'USD',
            sections: { transactions: true, categories: true, budgets: true, investments: false },
        });
        expect(without.holdings).toEqual([]);
    });
});
