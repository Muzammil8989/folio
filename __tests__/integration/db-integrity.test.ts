jest.unmock('@/lib/db/db-client');
import { getDb } from '@/lib/db/db-client';
import { clearDatabase, DATABASE_VERSION } from '@/lib/db/migrations';
import * as q from '@/lib/db/queries';
import { transactions } from '@/lib/db/schema';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });
afterEach(() => db.close());

const columns = (table: string) =>
  (db.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);
const count = (table: string) => (db.raw.prepare(`select count(*) c from ${table}`).get() as { c: number }).c;

describe('database integrity', () => {
  it('enables foreign key enforcement on init', () => {
    expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('migrates to the latest version with link columns', () => {
    expect(db.raw.pragma('user_version', { simple: true })).toBe(DATABASE_VERSION);
    expect(columns('transactions')).toEqual(expect.arrayContaining(['transfer_group', 'savings_goal_id']));
    expect(columns('loans')).toContain('origin_transaction_id');
    expect(columns('household_expenses')).toContain('linked_transaction_id');
    expect(columns('household_periods_history')).toContain('entries_kept');
    expect(columns('household_config')).toContain('income_confirmed');
  });

  it('cascades budget deletion when its category is deleted', async () => {
    const cat = await q.createCategory({ name: 'Temp', type: 'expense' } as any);
    await q.createBudget({ category_id: cat.id, amount: 100, period: 'monthly' } as any);
    await q.deleteCategory(cat.id);
    expect(count('budgets')).toBe(0);
  });

  it('rejects transactions that reference a missing category', async () => {
    const [acct] = await q.getAccounts();
    await expect(
      q.createTransaction({ amount: 1, type: 'expense', category_id: 99999, account_id: acct.id, date: '2026-01-01' } as any)
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('a sync drizzle transaction rolls back every statement on error', () => {
    const d = getDb();
    expect(() =>
      d.transaction((t) => {
        t.insert(transactions).values({ amount: 5, type: 'income', category_id: 1, account_id: 1, date: '2026-01-01' } as any).run();
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(count('transactions')).toBe(0);
  });

  it('clearDatabase resets data with foreign keys on', async () => {
    const [acct] = await q.getAccounts();
    const [cat] = await q.getCategories('income');
    await q.createTransaction({ amount: 5, type: 'income', category_id: cat.id, account_id: acct.id, date: '2026-01-01' } as any);
    await clearDatabase(db.expo);
    expect(count('transactions')).toBe(0);
    expect((await q.getCategories()).length).toBeGreaterThan(0);
  });
});
