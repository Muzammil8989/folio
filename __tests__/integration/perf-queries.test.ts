jest.unmock('@/lib/db/db-client');
import { loadBudgetsWithSpend } from '@/features/budgets/services/budget-spend';
import { fetchTransactionPage, fetchTransactionTotals } from '@/features/transactions/hooks/use-transactions';
import { DatabaseMigrationError, DATABASE_VERSION, runMigrations, type Migration } from '@/lib/db/migrations';
import * as q from '@/lib/db/queries';
import { getPeriodDateRange, toISODateString } from '@/lib/utils/date';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';

let db: TestDb;
let accountId: number;
let food: { id: number };
let shopping: { id: number };
let salary: { id: number };

beforeEach(async () => {
  db = await createTestDb();
  accountId = (await q.getAccounts())[0].id;
  const expense = await q.getCategories('expense');
  food = expense.find(c => c.name === 'Food & Dining')!;
  shopping = expense.find(c => c.name === 'Shopping')!;
  salary = (await q.getCategories('income'))[0];
});
afterEach(() => db.close());

const add = (type: 'income' | 'expense', amount: number, date: string, categoryId: number, account = accountId) =>
  q.createTransaction({ amount, type, date, account_id: account, category_id: categoryId } as any);

const indexNames = () =>
  (db.raw.prepare(`select name from sqlite_master where type = 'index'`).all() as { name: string }[]).map(r => r.name);

/** Run `fn`, capturing the SQL of every statement it prepares. */
async function captureSql(fn: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  const original = db.raw.prepare.bind(db.raw);
  const spy = jest.spyOn(db.raw, 'prepare').mockImplementation(((sql: string) => {
    seen.push(sql);
    return original(sql);
  }) as typeof db.raw.prepare);
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return seen;
}

/** EXPLAIN QUERY PLAN details for `sql`, binding placeholder values. */
function plan(sql: string): string {
  const params = (sql.match(/\?/g) ?? []).map(() => '2026-01-01');
  return (db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[])
    .map(r => r.detail)
    .join('\n');
}

describe('migration v11', () => {
  it('creates every new index', () => {
    expect(db.raw.pragma('user_version', { simple: true })).toBe(DATABASE_VERSION);
    expect(indexNames()).toEqual(expect.arrayContaining([
      'idx_transactions_category_type_date_amount',
      'idx_transactions_type_date_amount',
      'idx_transactions_account_type_amount',
      'idx_loans_origin_transaction_id',
      'idx_loans_transaction_id',
      'idx_loan_payments_transaction_id',
      'idx_household_expenses_linked_transaction_id',
      'idx_recurring_category_id',
    ]));
  });
});

describe('runMigrations never wipes data', () => {
  const current: Migration[] = Array.from({ length: DATABASE_VERSION }, (_, i) => ({
    version: i + 1,
    description: `v${i + 1}`,
    up: async () => {},
  }));

  it('rolls a failed migration back and keeps existing rows', async () => {
    await add('expense', 42, '2026-04-02', food.id);
    const broken: Migration = {
      version: DATABASE_VERSION + 1,
      description: 'half-done change',
      up: async (txn) => {
        await txn.execAsync('CREATE TABLE half_done (id INTEGER);');
        await txn.execAsync('DELETE FROM transactions;');
        throw new Error('boom');
      },
    };

    const error = await runMigrations(db.expo, [...current, broken]).catch(e => e);
    expect(error).toBeInstanceOf(DatabaseMigrationError);
    expect(error.reason).toBe('failed');
    expect(error.message).toContain('boom');

    expect(db.raw.pragma('user_version', { simple: true })).toBe(DATABASE_VERSION);
    expect(indexNames()).not.toContain('half_done');
    expect(db.raw.prepare(`select name from sqlite_master where name = 'half_done'`).get()).toBeUndefined();
    expect((db.raw.prepare('select count(*) c from transactions').get() as { c: number }).c).toBe(1);
  });

  it('refuses to open a database from a newer app instead of dropping it', async () => {
    await add('expense', 42, '2026-04-02', food.id);
    db.raw.pragma(`user_version = ${DATABASE_VERSION + 5}`);

    const error = await runMigrations(db.expo).catch(e => e);
    expect(error).toBeInstanceOf(DatabaseMigrationError);
    expect(error.reason).toBe('downgrade');
    expect((db.raw.prepare('select count(*) c from transactions').get() as { c: number }).c).toBe(1);
    expect(db.raw.pragma('user_version', { simple: true })).toBe(DATABASE_VERSION + 5);
  });
});

describe('keyset pagination', () => {
  it('returns ordered pages without duplicates or gaps', async () => {
    // 130 rows over 40 days: several rows share a day, so pages end mid-day.
    for (let i = 0; i < 130; i++) {
      const day = String(1 + (i % 28)).padStart(2, '0');
      await add('expense', i + 1, `2026-0${1 + (i % 3)}-${day}`, food.id);
    }

    const seen: { id: number; date: string | null }[] = [];
    const pages: number[] = [];
    let cursor: { date: string; id: number } | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const page = await fetchTransactionPage(undefined, cursor, 50);
      pages.push(page.rows.length);
      seen.push(...page.rows);
      const last = page.rows[page.rows.length - 1];
      if (!page.hasMore) break;
      cursor = { date: last.date!, id: last.id };
    }

    const all = await fetchTransactionPage(undefined, null, 10_000);
    expect(seen.map(t => t.id)).toEqual(all.rows.map(t => t.id));
    expect(new Set(seen.map(t => t.id)).size).toBe(130);
    expect(pages[0]).toBeGreaterThanOrEqual(50);
    // A day is never split across pages.
    const firstPage = seen.slice(0, pages[0]);
    const nextFirst = seen[pages[0]];
    expect(firstPage.some(t => t.date === nextFirst.date)).toBe(false);
  });

  it('totals the whole filtered set, leaving transfers out of income and spending', async () => {
    await add('expense', 10, '2026-04-02', food.id);
    await add('income', 100, '2026-04-03', salary.id);
    await q.createAccountTransfer({ fromAccountId: accountId, toAccountId: (await q.getAccounts())[1].id, amount: 50, date: '2026-04-04' });

    const totals = await fetchTransactionTotals({ startDate: '2026-04-01', endDate: '2026-04-30' });
    expect(totals).toEqual({ income: 100, expense: 10, count: 4 });
  });
});

describe('grouped budget spend', () => {
  it('matches the per-budget query for every budget', async () => {
    const today = toISODateString(new Date());
    const month = getPeriodDateRange('monthly');
    await add('expense', 12.5, today, food.id);
    await add('expense', 7.25, month.startDate, food.id);
    await add('expense', 30, today, shopping.id);
    await add('expense', 99, '2001-01-01', shopping.id); // outside every period
    await add('income', 500, today, salary.id);
    const savings = await q.createSavingsGoal({ name: 'Trip', target_amount: 1000 } as any);
    await q.moveSavings({ goalId: savings.id, accountId, amount: 40, date: today, direction: 'deposit' });

    for (const period of ['daily', 'weekly', 'monthly', 'yearly'] as const) {
      await q.createBudget({ category_id: food.id, amount: 100, period } as any);
      await q.createBudget({ category_id: null, amount: 200, period } as any);
    }
    await q.createBudget({ category_id: shopping.id, amount: 50, period: 'monthly' } as any);

    const budgets = await loadBudgetsWithSpend();
    expect(budgets).toHaveLength(9);
    for (const b of budgets) {
      const { startDate, endDate } = getPeriodDateRange(b.period);
      const [expected] = await q.getBudgetSpend(b.category_id, startDate, endDate);
      expect(b.spent).toBeCloseTo(Number(expected.total) || 0, 9);
    }
    expect(budgets.find(b => b.category_id === shopping.id)!.spent).toBe(30);
  });
});

describe('getMonthOverMonthTotals', () => {
  it('splits this month (to date) and last month, excluding transfers and future entries', async () => {
    const now = new Date(2026, 3, 15); // 15 Apr 2026
    await add('income', 1000, '2026-04-01', salary.id);
    await add('expense', 200, '2026-04-15', food.id);
    await add('expense', 999, '2026-04-20', food.id);   // future: not yet
    await add('income', 800, '2026-03-05', salary.id);
    await add('expense', 300, '2026-03-31', food.id);
    await add('expense', 50, '2026-02-28', food.id);    // two months back
    await q.createAccountTransfer({ fromAccountId: accountId, toAccountId: (await q.getAccounts())[1].id, amount: 70, date: '2026-04-10' });

    const totals = await q.getMonthOverMonthTotals(now);
    expect(totals.thisMonth).toEqual({ income: 1000, expense: 200 });
    expect(totals.lastMonth).toEqual({ income: 800, expense: 300 });
    // Raw all-time totals include everything (transfer halves too).
    expect(totals.allIncome).toBe(1000 + 800 + 70);
    expect(totals.allExpense).toBe(200 + 999 + 300 + 50 + 70);
  });

  it('handles January (last month is December of the previous year)', async () => {
    await add('expense', 20, '2025-12-31', food.id);
    await add('expense', 5, '2026-01-02', food.id);
    const totals = await q.getMonthOverMonthTotals(new Date(2026, 0, 10));
    expect(totals.lastMonth.expense).toBe(20);
    expect(totals.thisMonth.expense).toBe(5);
  });
});

describe('getAccountsWithBalance (single grouped scan)', () => {
  it('adds income and subtracts expenses per account', async () => {
    const [a, b] = await q.getAccounts();
    await q.updateAccount(a.id, { balance: 100 });
    await add('income', 50, '2026-04-01', salary.id, a.id);
    await add('expense', 30.5, '2026-04-02', food.id, a.id);
    await add('expense', 10, '2026-04-02', food.id, b.id);

    const balances = new Map((await q.getAccountsWithBalance()).map(acc => [acc.id, acc]));
    expect(balances.get(a.id)!.balance).toBeCloseTo(119.5, 9);
    expect(balances.get(a.id)!.initial_balance).toBe(100);
    expect(balances.get(b.id)!.balance).toBe(-10);
  });
});

describe('rollOverHouseholdPeriod', () => {
  it("archives SQL totals and advances the config in one go, keeping the month's expenses", async () => {
    await q.upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: '2026-06-18' } as any);
    await q.createHouseholdExpense({ amount: 300, date: '2026-06-25' } as any);
    await q.createHouseholdExpense({ amount: 200, date: '2026-07-10' } as any);
    await q.createHouseholdExpense({ amount: 75, date: '2026-07-19' } as any); // next cycle

    await q.rollOverHouseholdPeriod({
      period: 'monthly', start_date: '2026-06-18', end_date: '2026-07-17', income_amount: 1000, next_start_date: '2026-07-18',
    });

    const [entry] = await q.listHouseholdHistory();
    expect(entry).toMatchObject({
      start_date: '2026-06-18', end_date: '2026-07-17', income_amount: 1000,
      spent_amount: 500, remaining_amount: 500, expense_count: 2, entries_kept: true,
    });
    // The closed month keeps its own expenses; the new month starts empty.
    expect((await q.getHouseholdExpenses('2026-06-18', '2026-07-17'))).toHaveLength(2);
    expect((await q.getHouseholdExpenses('2026-07-18', '2026-08-17'))).toHaveLength(1);
    const config = (await q.getHouseholdConfig())!;
    expect(config.period_start_date).toBe('2026-07-18');
    expect(config.income_confirmed).toBe(false);
  });
});

describe('query plans with ~20k rows', () => {
  beforeEach(() => {
    const insert = db.raw.prepare(
      'insert into transactions (category_id, account_id, amount, type, date) values (?, ?, ?, ?, ?)'
    );
    const accounts = (db.raw.prepare('select id from accounts').all() as { id: number }[]).map(r => r.id);
    const cats = (db.raw.prepare('select id, type from categories').all() as { id: number; type: string }[]);
    db.raw.transaction(() => {
      for (let i = 0; i < 20_000; i++) {
        const cat = cats[i % cats.length];
        const d = new Date(2022, 0, 1 + (i % 1500));
        insert.run(cat.id, accounts[i % accounts.length], (i % 500) + 1, cat.type, toISODateString(d));
      }
    })();
    db.raw.exec('ANALYZE');
  });

  it('budget spend by category uses a covering index', async () => {
    const sqls = await captureSql(() => q.getSpendByCategory('2026-01-01', '2026-01-31'));
    const main = sqls.find(s => /group by/i.test(s))!;
    const detail = plan(main);
    expect(detail).toMatch(/USING (COVERING )?INDEX idx_transactions_(category_type_date_amount|type_date_amount)/);
    expect(detail).not.toMatch(/SCAN transactions(?! USING)/);
  });

  it('account balances use the account/type/amount covering index', async () => {
    const sqls = await captureSql(() => q.getAccountsWithBalance());
    const main = sqls.find(s => /group by/i.test(s))!;
    expect(plan(main)).toMatch(/USING COVERING INDEX idx_transactions_account_type_amount/);
  });

  it('pages stay fast: the first page is index-ordered, not sorted in memory', async () => {
    const sqls = await captureSql(() => fetchTransactionPage(undefined, null, 50));
    expect(plan(sqls[0])).not.toMatch(/USE TEMP B-TREE FOR ORDER BY/);
  });
});
