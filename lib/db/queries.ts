import {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  gte,
  isNull,
  like,
  lte,
  ne,
  notInArray,
  sql,
  sum
} from 'drizzle-orm';
import { logger } from '../logger';
import { parseLocalDate, toISODateString, todayString } from '../utils/date';
import { getDb } from './db-client';
import {
  accounts,
  budgets,
  categories,
  householdConfig,
  householdExpenses,
  householdPeriodsHistory,
  loanPayments,
  loans,
  recurringExpenses,
  savingsGoals,
  transactions,
} from './schema';

import type {
  HouseholdExpense,
  HouseholdPeriodHistory,
  NewAccount,
  NewBudget,
  NewCategory,
  NewHouseholdConfig,
  NewHouseholdExpense,
  NewLoan,
  NewLoanPayment,
  NewRecurringExpense,
  NewSavingsGoal,
  NewTransaction
} from './schema';

export type {
  Account, Budget, Category, HouseholdConfig, HouseholdExpense, HouseholdPeriodHistory, Loan, LoanPayment, NewAccount, NewBudget, NewCategory, NewHouseholdConfig, NewHouseholdExpense, NewHouseholdPeriodHistory, NewLoan, NewLoanPayment, NewRecurringExpense, NewSavingsGoal, NewTransaction, RecurringExpense, SavingsGoal, Transaction
} from './schema';

/**
 * TRANSACTION QUERIES
 */

/**
 * System categories for money moving between people (lending, borrowing,
 * repaying). These change balances but are not income or spending, so every
 * income/spending total, chart, budget and export summary leaves them out.
 */
export const TRANSFER_CATEGORY_NAMES = [
  'Loan Given', 'Loan Received',        // money lent / borrowed / repaid
  'Transfer Out', 'Transfer In',        // between your own accounts
  'To Savings', 'From Savings',         // into / out of a savings goal
] as const;

export function isTransferCategory(name: string | null | undefined): boolean {
  return !!name && (TRANSFER_CATEGORY_NAMES as readonly string[]).includes(name);
}

/** SQL condition: the transaction is real income/spending, not a transfer. */
const notTransfer = () =>
  sql`${transactions.category_id} NOT IN (SELECT id FROM categories WHERE name IN ('Loan Given', 'Loan Received', 'Transfer Out', 'Transfer In', 'To Savings', 'From Savings'))`;

/**
 * Get current balance across all accounts:
 * SUM(opening balances) + totalIncome - totalExpense.
 * Matches the per-account figures from getAccountsWithBalance().
 */
export async function getCurrentBalance(): Promise<number> {
  const db = getDb();
  const [opening] = await db.select({ total: sum(accounts.balance) }).from(accounts);
  const result = await db
    .select({
      type: transactions.type,
      total: sum(transactions.amount),
    })
    .from(transactions)
    .groupBy(transactions.type);

  let income = 0;
  let expense = 0;
  for (const row of result) {
    if (row.type === 'income') income = Number(row.total) || 0;
    else expense = Number(row.total) || 0;
  }
  return (Number(opening?.total) || 0) + income - expense;
}

/**
 * Create a new transaction
 */
export async function createTransaction(
  transaction: NewTransaction
): Promise<typeof transactions.$inferSelect> {
  const db = getDb();
  const result = await db
    .insert(transactions)
    .values({
      ...transaction,
      date: transaction.date || todayString(),
    })
    .returning();
  return result[0];
}

/**
 * Get all transactions with optional filters and relations
 */
export async function getTransactions(options?: {
  startDate?: string;
  endDate?: string;
  categoryId?: number;
  type?: 'income' | 'expense';
  searchQuery?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();

  return db.query.transactions.findMany({
    where: (t, { eq, and, gte, lte, or, like }) => {
      const conditions = [];

      if (options?.startDate) conditions.push(gte(t.date, options.startDate));
      if (options?.endDate) conditions.push(lte(t.date, options.endDate));
      if (options?.categoryId) conditions.push(eq(t.category_id, options.categoryId));
      if (options?.type) conditions.push(eq(t.type, options.type));

      if (options?.searchQuery) {
        const query = `%${options.searchQuery}%`;
        conditions.push(or(
          like(t.notes, query),
        ));
      }

      return and(...conditions);
    },
    with: {
      category: true,
      account: true,
    },
    orderBy: (t, { desc }) => [desc(t.date), desc(t.id)],
    limit: options?.limit,
    offset: options?.offset,
  });
}

/**
 * Get transactions by date range (useful for monthly/weekly views)
 */
export async function getTransactionsByDateRange(
  startDate: string,
  endDate: string
) {
  const db = getDb();
  const conditions = [between(transactions.date, startDate, endDate)];

  return db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.date));
}

/**
 * Get total income and expenses for a period
 */
export async function getSummaryByDateRange(
  startDate: string,
  endDate: string
) {
  const db = getDb();
  const conditions = [between(transactions.date, startDate, endDate), notTransfer()];

  return db
    .select({
      type: transactions.type,
      total: sum(transactions.amount),
      count: count(),
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.type);
}

/**
 * Get transaction by ID with related data
 */
export async function getTransactionById(id: number) {
  const db = getDb();
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.id, id))
    .then((results) => results[0] || null);
}

/**
 * Update transaction
 */
export async function updateTransaction(
  id: number,
  updates: Partial<NewTransaction>
) {
  const db = getDb();
  const result = await db
    .update(transactions)
    .set({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .where(eq(transactions.id, id))
    .returning();
  return result[0];
}

/**
 * Delete a transaction and keep linked records consistent, atomically:
 * - a loan's origin transaction (money lent/borrowed) deletes the loan + payments
 * - a loan's repayment transfer only un-marks the loan as transferred
 * - a household transfer's income deletes the paired household expense
 *
 * NOTE: the expo-sqlite Drizzle driver is synchronous. Transactions must use a
 * sync callback with .run()/.all(); an async callback commits before its
 * awaited statements run and never rolls back.
 */
export async function deleteTransaction(id: number) {
  const db = getDb();
  const tx = await getTransactionById(id);
  const legacyHouseholdExpenseId =
    tx && tx.type === 'income' && tx.notes === HOUSEHOLD_TRANSFER_NOTE
      ? await findLegacyHouseholdTransferExpenseId(tx.date, tx.amount)
      : null;

  db.transaction((t) => {
    // A savings deposit/withdrawal: undo its effect on the goal.
    if (tx?.savings_goal_id) {
      const [goal] = t.select().from(savingsGoals).where(eq(savingsGoals.id, tx.savings_goal_id)).all();
      if (goal) {
        const deltaCents = (tx.type === 'expense' ? -1 : 1) * toCents(tx.amount);
        const savedCents = Math.max(0, toCents(goal.saved_amount) + deltaCents);
        t.update(savingsGoals)
          .set({ saved_amount: savedCents / 100, is_completed: savedCents >= toCents(goal.target_amount) ? 1 : 0, updated_at: new Date().toISOString() })
          .where(eq(savingsGoals.id, goal.id))
          .run();
      }
    }
    // An account transfer is two rows: remove its other half too.
    if (tx?.transfer_group) {
      t.delete(transactions).where(and(eq(transactions.transfer_group, tx.transfer_group), ne(transactions.id, id))).run();
    }

    const originLoans = t.select({ id: loans.id }).from(loans).where(eq(loans.origin_transaction_id, id)).all();
    for (const loan of originLoans) {
      t.delete(loanPayments).where(eq(loanPayments.loan_id, loan.id)).run();
      t.delete(loans).where(eq(loans.id, loan.id)).run();
    }
    t.update(loans).set({ transaction_id: null }).where(eq(loans.transaction_id, id)).run();
    t.delete(loanPayments).where(eq(loanPayments.transaction_id, id)).run();

    t.delete(householdExpenses).where(eq(householdExpenses.linked_transaction_id, id)).run();
    if (legacyHouseholdExpenseId !== null) {
      t.delete(householdExpenses).where(eq(householdExpenses.id, legacyHouseholdExpenseId)).run();
    }

    t.delete(transactions).where(eq(transactions.id, id)).run();
  });
}

/**
 * CATEGORY QUERIES
 */

/**
 * Get all categories
 */
export async function getCategories(type?: 'income' | 'expense', options: { includeSystem?: boolean } = {}) {
  const db = getDb();
  // System categories (loans, transfers, savings) are bookkeeping, not something
  // to tag a purchase with, rename or delete — keep them out of pickers.
  const visible = options.includeSystem ? undefined : notInArray(categories.name, [...TRANSFER_CATEGORY_NAMES]);
  return db
    .select()
    .from(categories)
    .where(and(type ? eq(categories.type, type) : undefined, visible))
    .orderBy(asc(categories.name));
}

/**
 * Get category by ID
 */
export async function getCategoryById(id: number) {
  const db = getDb();
  return db
    .select()
    .from(categories)
    .where(eq(categories.id, id))
    .then((results) => results[0] || null);
}

/**
 * Create category
 */
export async function createCategory(
  category: NewCategory
): Promise<typeof categories.$inferSelect> {
  const db = getDb();
  const result = await db
    .insert(categories)
    .values(category)
    .returning();
  return result[0];
}

/**
 * Update category
 */
export async function updateCategory(
  id: number,
  updates: Partial<NewCategory>
) {
  const db = getDb();
  const result = await db
    .update(categories)
    .set({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .where(eq(categories.id, id))
    .returning();
  return result[0];
}

/**
 * Delete category (only if no associated transactions)
 */
export async function deleteCategory(id: number) {
  const db = getDb();
  const associatedTransactions = await db
    .select({ count: count() })
    .from(transactions)
    .where(eq(transactions.category_id, id));

  if ((associatedTransactions[0]?.count ?? 0) > 0) {
    throw new Error(
      'Cannot delete category with associated transactions'
    );
  }

  // Recurring bills reference categories with ON DELETE RESTRICT; say so
  // plainly instead of surfacing "FOREIGN KEY constraint failed".
  const [recurring] = await db
    .select({ count: count() })
    .from(recurringExpenses)
    .where(eq(recurringExpenses.category_id, id));
  if ((recurring?.count ?? 0) > 0) {
    throw new Error('This category is used by a recurring bill. Delete or change that bill first.');
  }

  await db.delete(categories).where(eq(categories.id, id));
}

/**
 * RECURRING EXPENSE QUERIES
 */

/**
 * Get all active recurring expenses
 */
export async function getActiveRecurringExpenses() {
  const db = getDb();
  return db
    .select()
    .from(recurringExpenses)
    .where(eq(recurringExpenses.is_active, 1))
    .orderBy(asc(recurringExpenses.start_date));
}

/**
 * Get all recurring expenses with category and account info
 */
export async function getRecurringExpensesWithDetails() {
  const db = getDb();
  return db
    .select({
      id: recurringExpenses.id,
      amount: recurringExpenses.amount,
      frequency: recurringExpenses.frequency,
      start_date: recurringExpenses.start_date,
      end_date: recurringExpenses.end_date,
      notes: recurringExpenses.notes,
      is_active: recurringExpenses.is_active,
      category_id: recurringExpenses.category_id,
      account_id: recurringExpenses.account_id,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      categoryType: categories.type,
      accountName: accounts.name,
    })
    .from(recurringExpenses)
    .leftJoin(categories, eq(recurringExpenses.category_id, categories.id))
    .leftJoin(accounts, eq(recurringExpenses.account_id, accounts.id))
    .orderBy(desc(recurringExpenses.is_active), asc(recurringExpenses.start_date));
}

/**
 * Get recurring expense by ID
 */
export async function getRecurringExpenseById(id: number) {
  const db = getDb();
  return db
    .select()
    .from(recurringExpenses)
    .where(eq(recurringExpenses.id, id))
    .then((results) => results[0] || null);
}

/**
 * Check if an active recurring expense already exists for a given category
 */
export async function getActiveRecurringByCategory(categoryId: number) {
  const db = getDb();
  return db
    .select()
    .from(recurringExpenses)
    .where(and(eq(recurringExpenses.category_id, categoryId), eq(recurringExpenses.is_active, 1)))
    .limit(1);
}

/**
 * Create recurring expense
 */
export async function createRecurringExpense(
  expense: NewRecurringExpense
): Promise<typeof recurringExpenses.$inferSelect> {
  const db = getDb();
  const result = await db
    .insert(recurringExpenses)
    .values(expense)
    .returning();
  return result[0];
}

/**
 * Save a transaction and make it recurring in one step: the first occurrence
 * is this transaction, so the recurring entry starts as already processed for
 * that date (otherwise the processor would create a duplicate).
 */
export async function createTransactionWithRecurring(
  transaction: NewTransaction & { date: string },
  frequency: NewRecurringExpense['frequency']
) {
  const db = getDb();
  return db.transaction((t) => {
    const [recurring] = t
      .insert(recurringExpenses)
      .values({
        category_id: transaction.category_id,
        account_id: transaction.account_id,
        amount: transaction.amount,
        frequency,
        start_date: transaction.date,
        last_processed: transaction.date,
        notes: transaction.notes ?? null,
        is_active: 1,
      })
      .returning()
      .all();
    const [created] = t
      .insert(transactions)
      .values({ ...transaction, recurring_id: recurring.id })
      .returning()
      .all();
    return { transaction: created, recurring };
  });
}

/**
 * Update recurring expense
 */
export async function updateRecurringExpense(
  id: number,
  updates: Partial<NewRecurringExpense>
) {
  const db = getDb();
  const result = await db
    .update(recurringExpenses)
    .set({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .where(eq(recurringExpenses.id, id))
    .returning();
  return result[0];
}

/**
 * Deactivate recurring expense
 */
export async function deactivateRecurringExpense(id: number) {
  return updateRecurringExpense(id, { is_active: 0 });
}

/**
 * Delete recurring expense
 */
export async function deleteRecurringExpense(id: number) {
  const db = getDb();
  await db.delete(recurringExpenses).where(eq(recurringExpenses.id, id));
}

/**
 * BUDGET QUERIES
 */

/**
 * Get all active budgets with joined category details
 */
export async function getBudgetsWithDetails() {
  const db = getDb();
  return db
    .select({
      id: budgets.id,
      amount: budgets.amount,
      period: budgets.period,
      category_id: budgets.category_id,
      is_active: budgets.is_active,
      alert_threshold: budgets.alert_threshold,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
    })
    .from(budgets)
    .leftJoin(categories, eq(budgets.category_id, categories.id))
    .where(eq(budgets.is_active, 1))
    .orderBy(asc(budgets.id));
}

/**
 * Get all active budgets
 */
export async function getActiveBudgets() {
  const db = getDb();
  return db
    .select()
    .from(budgets)
    .where(eq(budgets.is_active, 1))
    .orderBy(asc(budgets.period));
}

/**
 * Get budget by ID
 */
export async function getBudgetById(id: number) {
  const db = getDb();
  return db
    .select()
    .from(budgets)
    .where(eq(budgets.id, id))
    .then((results) => results[0] || null);
}

/**
 * Get budgets by period
 */
export async function getBudgetsByPeriod(
  period: 'daily' | 'weekly' | 'monthly' | 'yearly'
) {
  const db = getDb();
  return db
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.period, period),
        eq(budgets.is_active, 1)
      )
    );
}

/**
 * Create budget
 */
export async function createBudget(
  budget: NewBudget
): Promise<typeof budgets.$inferSelect> {
  const db = getDb();
  const result = await db
    .insert(budgets)
    .values(budget)
    .returning();
  return result[0];
}

/**
 * Update budget
 */
export async function updateBudget(
  id: number,
  updates: Partial<NewBudget>
) {
  const db = getDb();
  const result = await db
    .update(budgets)
    .set({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .where(eq(budgets.id, id))
    .returning();
  return result[0];
}

/**
 * Deactivate budget
 */
export async function deactivateBudget(id: number) {
  return updateBudget(id, { is_active: 0 });
}

/**
 * Delete budget
 */
export async function deleteBudget(id: number) {
  const db = getDb();
  await db.delete(budgets).where(eq(budgets.id, id));
}

/**
 * Get budget spend for a category in a period
 */
export async function getBudgetSpend(
  categoryId: number | null,
  startDate: string,
  endDate: string
) {
  const db = getDb();
  const conditions = [between(transactions.date, startDate, endDate), notTransfer()];

  if (categoryId !== null) {
    conditions.push(eq(transactions.category_id, categoryId));
  }

  return db
    .select({ total: sum(transactions.amount) })
    .from(transactions)
    .where(
      and(
        ...conditions,
        eq(transactions.type, 'expense')
      )
    );
}

/**
 * Expense spend per category for a period in one grouped query (excluding
 * transfers, like getBudgetSpend). `total` is the all-category sum, used by
 * budgets without a category. Lets callers check every budget that shares a
 * period without one query per budget.
 */
export async function getSpendByCategory(
  startDate: string,
  endDate: string
): Promise<{ byCategory: Map<number, number>; total: number }> {
  const db = getDb();
  const rows = await db
    .select({ category_id: transactions.category_id, total: sum(transactions.amount) })
    .from(transactions)
    .where(and(eq(transactions.type, 'expense'), between(transactions.date, startDate, endDate), notTransfer()))
    .groupBy(transactions.category_id);
  const byCategory = new Map<number, number>();
  let total = 0;
  for (const r of rows) {
    const value = Number(r.total) || 0;
    byCategory.set(r.category_id, value);
    total += value;
  }
  return { byCategory, total };
}

/**
 * ACCOUNT QUERIES
 */

/**
 * Get all accounts
 */
export async function getAccounts() {
  const db = getDb();
  return db.select().from(accounts).orderBy(asc(accounts.name));
}

/**
 * Get all accounts with balance computed from transactions
 * real_balance = initial_balance + SUM(income) - SUM(expense)
 */
export async function getAccountsWithBalance() {
  const db = getDb();
  const accountList = await db.select().from(accounts).orderBy(asc(accounts.name));

  // One pass over transactions (covered by idx_transactions_account_type_amount)
  // instead of one scan per type.
  const sums = await db
    .select({
      account_id: transactions.account_id,
      income: sql<number>`sum(case when ${transactions.type} = 'income' then ${transactions.amount} end)`,
      expense: sql<number>`sum(case when ${transactions.type} = 'expense' then ${transactions.amount} end)`,
    })
    .from(transactions)
    .groupBy(transactions.account_id);

  const incomeMap = new Map(sums.map(r => [r.account_id, Number(r.income) || 0]));
  const expenseMap = new Map(sums.map(r => [r.account_id, Number(r.expense) || 0]));

  return accountList.map(account => ({
    ...account,
    /** The stored opening balance. Edit forms must use this, not `balance`. */
    initial_balance: account.balance,
    balance: account.balance + (incomeMap.get(account.id) || 0) - (expenseMap.get(account.id) || 0),
  }));
}

export type AccountWithBalance = Awaited<ReturnType<typeof getAccountsWithBalance>>[number];

/**
 * Accounts are always in the profile currency (there is no per-account
 * choice), so when the profile currency changes, every account follows.
 * Otherwise balances in different "currencies" would be added together.
 */
export async function setAccountsCurrency(code: string) {
  const db = getDb();
  await db.update(accounts).set({ currency: code, updated_at: new Date().toISOString() });
}

/**
 * Get account by ID
 */
export async function getAccountById(id: number) {
  const db = getDb();
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.id, id))
    .then((results) => results[0] || null);
}

/**
 * Create account
 */
export async function createAccount(
  account: NewAccount
): Promise<typeof accounts.$inferSelect> {
  const db = getDb();
  const result = await db
    .insert(accounts)
    .values(account)
    .returning();
  return result[0];
}

/**
 * Update account
 */
export async function updateAccount(
  id: number,
  updates: Partial<NewAccount>
) {
  const db = getDb();
  const result = await db
    .update(accounts)
    .set({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .where(eq(accounts.id, id))
    .returning();
  return result[0];
}

/**
 * Delete account (only if no associated transactions)
 */
export async function deleteAccount(id: number) {
  const db = getDb();

  const associatedTransactions = await db
    .select({ count: count() })
    .from(transactions)
    .where(eq(transactions.account_id, id));

  if ((associatedTransactions[0]?.count ?? 0) > 0) {
    throw new Error(
      'Cannot delete account with associated transactions'
    );
  }

  await db.delete(accounts).where(eq(accounts.id, id));
  defaultAccountEnsured = false;
}

let defaultAccountEnsured = false;

/**
 * Create a default account if none exists. Checked once per app session
 * (it used to run a query on every accounts refresh).
 */
export async function ensureDefaultAccount(currency: string = 'USD') {
  if (defaultAccountEnsured) return;
  try {
    const existingAccounts = await getAccounts();
    defaultAccountEnsured = true;
    if (existingAccounts.length === 0) {
      await createAccount({
        name: 'Main Account',
        type: 'checking',
        balance: 0,
        currency,
        icon: 'wallet',
        color: '#246BFD',
      });
    }
  } catch (error) {
    logger.error('Failed to ensure default account', error);
  }
}

/**
 * REPORT / INSIGHTS QUERIES
 */

export interface CategoryExpense {
  categoryId: number;
  categoryName: string;
  categoryIcon: string | null;
  categoryColor: string | null;
  total: number;
}

/** Expenses grouped by category for a date range */
export async function getExpenseByCategory(
  startDate: string,
  endDate: string
): Promise<CategoryExpense[]> {
  const db = getDb();
  const rows = await db
    .select({
      categoryId: categories.id,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
      total: sum(transactions.amount),
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.category_id, categories.id))
    .where(
      and(
        eq(transactions.type, 'expense'),
        between(transactions.date, startDate, endDate),
        notTransfer()
      )
    )
    .groupBy(categories.id)
    .orderBy(desc(sum(transactions.amount)));

  return rows
    .filter(r => r.categoryId !== null && Number(r.total) > 0)
    .map(r => ({
      categoryId: r.categoryId!,
      categoryName: r.categoryName ?? 'Unknown',
      categoryIcon: r.categoryIcon,
      categoryColor: r.categoryColor,
      total: Number(r.total) || 0,
    }));
}

export interface MonthlyTotals {
  month: string; // "Jan", "Feb" etc.
  year: number;
  income: number;
  expense: number;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Income vs expense for exactly the last `months` calendar months, ending with
 * the current month (oldest first). Months with no transactions are 0, and
 * future-dated transactions are ignored. Filtering and grouping run in SQL.
 */
export async function getMonthlyTotals(months = 6, now: Date = new Date()): Promise<MonthlyTotals[]> {
  const db = getDb();
  const first = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const monthKey = sql<string>`substr(${transactions.date}, 1, 7)`;

  const rows = await db
    .select({ key: monthKey, type: transactions.type, total: sum(transactions.amount) })
    .from(transactions)
    .where(and(between(transactions.date, toISODateString(first), toISODateString(last)), notTransfer()))
    .groupBy(monthKey, transactions.type);

  const result: (MonthlyTotals & { key: string })[] = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(first.getFullYear(), first.getMonth() + i, 1);
    const key = toISODateString(d).slice(0, 7);
    result.push({ key, month: SHORT_MONTHS[d.getMonth()], year: d.getFullYear(), income: 0, expense: 0 });
  }
  const byKey = new Map(result.map(r => [r.key, r]));
  for (const row of rows) {
    const entry = byKey.get(row.key);
    if (!entry) continue;
    if (row.type === 'income') entry.income = Number(row.total) || 0;
    else entry.expense = Number(row.total) || 0;
  }
  return result.map(({ key: _key, ...rest }) => rest);
}

export interface MonthOverMonthTotals {
  thisMonth: { income: number; expense: number };
  lastMonth: { income: number; expense: number };
  /** Every transaction ever, transfers included (the balance fallback). */
  allIncome: number;
  allExpense: number;
}

/**
 * Income and spending for the current month so far and the whole previous
 * month (transfers and future-dated entries excluded), plus all-time raw
 * totals. Grouped in SQL so the home screen doesn't load every transaction.
 */
export async function getMonthOverMonthTotals(now: Date = new Date()): Promise<MonthOverMonthTotals> {
  const db = getDb();
  const today = toISODateString(now);
  const thisKey = today.slice(0, 7);
  const lastKey = toISODateString(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  const monthKey = sql<string>`substr(${transactions.date}, 1, 7)`;

  const [rows, allRows] = await Promise.all([
    db
      .select({ key: monthKey, type: transactions.type, total: sum(transactions.amount) })
      .from(transactions)
      .where(and(between(transactions.date, `${lastKey}-01`, today), notTransfer()))
      .groupBy(monthKey, transactions.type),
    db
      .select({ type: transactions.type, total: sum(transactions.amount) })
      .from(transactions)
      .groupBy(transactions.type),
  ]);

  const result: MonthOverMonthTotals = {
    thisMonth: { income: 0, expense: 0 },
    lastMonth: { income: 0, expense: 0 },
    allIncome: 0,
    allExpense: 0,
  };
  for (const row of rows) {
    const bucket = row.key === thisKey ? result.thisMonth : row.key === lastKey ? result.lastMonth : null;
    if (!bucket) continue;
    if (row.type === 'income') bucket.income = Number(row.total) || 0;
    else bucket.expense = Number(row.total) || 0;
  }
  for (const row of allRows) {
    if (row.type === 'income') result.allIncome = Number(row.total) || 0;
    else result.allExpense = Number(row.total) || 0;
  }
  return result;
}

/**
 * Income/spending (transfers excluded) and the row count (transfers included)
 * for a date range, inclusive. Same figures as summing getTransactions().
 */
export async function getPeriodTotals(startDate: string, endDate: string) {
  const db = getDb();
  const [row] = await db
    .select({
      income: sql<number>`sum(case when ${transactions.type} = 'income' and ${notTransfer()} then ${transactions.amount} end)`,
      expense: sql<number>`sum(case when ${transactions.type} = 'expense' and ${notTransfer()} then ${transactions.amount} end)`,
      count: count(),
    })
    .from(transactions)
    .where(between(transactions.date, startDate, endDate));
  return { income: Number(row?.income) || 0, expense: Number(row?.expense) || 0, count: Number(row?.count) || 0 };
}

export interface DailySpend {
  day: number; // 1-31
  amount: number;
}

/**
 * Daily expense totals for a month, one entry per day from `startDate` to
 * `endDate` (or today, if earlier), with 0 for days without spending so the
 * chart's points line up with calendar days.
 */
export async function getDailySpending(
  startDate: string,
  endDate: string,
  now: Date = new Date()
): Promise<DailySpend[]> {
  const db = getDb();
  const rows = await db
    .select({ date: transactions.date, total: sum(transactions.amount) })
    .from(transactions)
    .where(and(eq(transactions.type, 'expense'), between(transactions.date, startDate, endDate), notTransfer()))
    .groupBy(transactions.date);
  const byDate = new Map(rows.map(r => [r.date, Number(r.total) || 0]));

  const today = toISODateString(now);
  const stop = endDate < today ? endDate : today;
  const result: DailySpend[] = [];
  for (let d = parseLocalDate(startDate); toISODateString(d) <= stop; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const key = toISODateString(d);
    result.push({ day: d.getDate(), amount: byDate.get(key) ?? 0 });
  }
  return result;
}

/**
 * SAVINGS GOAL QUERIES
 */

/** Get all savings goals ordered by creation date */
export async function getSavingsGoals() {
  const db = getDb();
  return db.select().from(savingsGoals).orderBy(asc(savingsGoals.id));
}

/** Create a new savings goal */
export async function createSavingsGoal(
  goal: NewSavingsGoal
): Promise<typeof savingsGoals.$inferSelect> {
  const db = getDb();
  const result = await db.insert(savingsGoals).values(goal).returning();
  return result[0];
}

/** Update a savings goal */
export async function updateSavingsGoal(
  id: number,
  updates: Partial<NewSavingsGoal>
) {
  const db = getDb();
  const result = await db
    .update(savingsGoals)
    .set({ ...updates, updated_at: new Date().toISOString() })
    .where(eq(savingsGoals.id, id))
    .returning();
  return result[0];
}

/**
 * Delete a savings goal. Its deposits and withdrawals are removed too, so the
 * money it held goes back to the accounts it came from.
 */
export async function deleteSavingsGoal(id: number) {
  const db = getDb();
  db.transaction((t) => {
    t.delete(transactions).where(eq(transactions.savings_goal_id, id)).run();
    t.delete(savingsGoals).where(eq(savingsGoals.id, id)).run();
  });
}

/** Look up (creating if needed) a system category by name and type. */
async function ensureSystemCategory(name: (typeof TRANSFER_CATEGORY_NAMES)[number], type: 'income' | 'expense', icon: string) {
  const db = getDb();
  const find = () => db.select({ id: categories.id }).from(categories).where(eq(categories.name, name)).limit(1);
  let [row] = await find();
  if (!row) {
    await db.insert(categories).values({ name, type, icon, color: '#8C7A5B' }).onConflictDoNothing();
    [row] = await find();
  }
  return row.id;
}

/**
 * Move money between two of your own accounts. Recorded as a pair of rows
 * (out of one, into the other) sharing a transfer_group, so balances move but
 * nothing counts as income or spending. Deleting either row removes both.
 */
export async function createAccountTransfer(input: {
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  date: string;
  notes?: string | null;
}): Promise<string> {
  if (input.fromAccountId === input.toAccountId) throw new Error('Choose two different accounts');
  if (!(input.amount > 0)) throw new Error('Enter an amount above zero');
  const outId = await ensureSystemCategory('Transfer Out', 'expense', 'swap-horizontal-outline');
  const inId = await ensureSystemCategory('Transfer In', 'income', 'swap-horizontal-outline');
  const group = `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const db = getDb();
  db.transaction((t) => {
    const base = { amount: input.amount, date: input.date, notes: input.notes ?? null, transfer_group: group };
    t.insert(transactions).values({ ...base, type: 'expense', category_id: outId, account_id: input.fromAccountId }).run();
    t.insert(transactions).values({ ...base, type: 'income', category_id: inId, account_id: input.toAccountId }).run();
  });
  return group;
}

/**
 * Put money into a savings goal from an account (or take it back out). The
 * account balance moves and the goal's saved amount follows, in one DB
 * transaction; neither counts as income or spending.
 */
export async function moveSavings(input: {
  goalId: number;
  accountId: number;
  amount: number;
  date: string;
  direction: 'deposit' | 'withdraw';
}): Promise<{ saved_amount: number; is_completed: number }> {
  if (!(input.amount > 0)) throw new Error('Enter an amount above zero');
  const deposit = input.direction === 'deposit';
  const categoryId = deposit
    ? await ensureSystemCategory('To Savings', 'expense', 'arrow-down-circle-outline')
    : await ensureSystemCategory('From Savings', 'income', 'arrow-up-circle-outline');
  const db = getDb();
  return db.transaction((t) => {
    const [goal] = t.select().from(savingsGoals).where(eq(savingsGoals.id, input.goalId)).all();
    if (!goal) throw new Error('Goal not found');
    const savedCents = toCents(goal.saved_amount);
    const amountCents = toCents(input.amount);
    if (deposit && amountCents > toCents(goal.target_amount) - savedCents) {
      throw new Error(`Only ${((toCents(goal.target_amount) - savedCents) / 100).toFixed(2)} left to reach this goal`);
    }
    if (!deposit && amountCents > savedCents) {
      throw new Error(`Only ${(savedCents / 100).toFixed(2)} saved in this goal`);
    }
    t.insert(transactions).values({
      amount: input.amount,
      type: deposit ? 'expense' : 'income',
      category_id: categoryId,
      account_id: input.accountId,
      date: input.date,
      notes: `${deposit ? 'Saved to' : 'Withdrawn from'} ${goal.name}`,
      savings_goal_id: goal.id,
    }).run();
    const nextCents = savedCents + (deposit ? amountCents : -amountCents);
    const result = { saved_amount: nextCents / 100, is_completed: nextCents >= toCents(goal.target_amount) ? 1 : 0 };
    t.update(savingsGoals).set({ ...result, updated_at: new Date().toISOString() }).where(eq(savingsGoals.id, goal.id)).run();
    return result;
  });
}

// ─── HOUSEHOLD BUDGET QUERIES ────────────────────────────────────────────────

/** Get the single household config row, or null if not set up yet */
export async function getHouseholdConfig() {
  const db = getDb();
  const rows = await db.select().from(householdConfig).limit(1);
  return rows[0] ?? null;
}

/**
 * Thrown when the current household month would start inside a month that is
 * already in history: its expenses would then be counted in both.
 */
export class HouseholdPeriodOverlapError extends Error {
  constructor(public readonly lastArchivedEnd: string) {
    super(`The household period must start after ${lastArchivedEnd}, the end of the last month in history.`);
    this.name = 'HouseholdPeriodOverlapError';
  }
}

/** End date of the most recent month in household history, or null if there is none. */
export async function getLastHouseholdHistoryEnd(): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ end: sql<string | null>`max(${householdPeriodsHistory.end_date})` })
    .from(householdPeriodsHistory);
  return row?.end ?? null;
}

/** Create config on first setup, update it on subsequent edits.
 *  The income set here is the current month's only: past months keep their own
 *  income in history. Saving it confirms the month's income.
 *  anchor_day is derived from the chosen start date's day-of-month so monthly/yearly
 *  cycles can recover the intended day after a short month clamps it (31 → Feb 28 → Mar 31). */
export async function upsertHouseholdConfig(
  data: Omit<NewHouseholdConfig, 'id' | 'created_at' | 'updated_at' | 'anchor_day' | 'income_confirmed'>,
) {
  const db = getDb();
  const lastArchivedEnd = await getLastHouseholdHistoryEnd();
  if (lastArchivedEnd && data.period_start_date <= lastArchivedEnd) {
    throw new HouseholdPeriodOverlapError(lastArchivedEnd);
  }
  const existing = await getHouseholdConfig();
  const now = new Date().toISOString();
  const anchor_day = parseInt(data.period_start_date.slice(8, 10), 10) || 1;
  if (existing) {
    const result = await db
      .update(householdConfig)
      .set({ ...data, anchor_day, income_confirmed: true, updated_at: now })
      .where(eq(householdConfig.id, existing.id))
      .returning();
    return result[0];
  }
  const result = await db
    .insert(householdConfig)
    .values({ ...data, anchor_day, income_confirmed: true, created_at: now, updated_at: now })
    .returning();
  return result[0];
}

/** Keep the income carried over from last month as this month's income. */
export async function confirmHouseholdIncome() {
  const db = getDb();
  await db
    .update(householdConfig)
    .set({ income_confirmed: true, updated_at: new Date().toISOString() });
}

/** Update the period start date when user resets/starts a new period */
export async function resetHouseholdPeriod(newStartDate: string) {
  const db = getDb();
  const existing = await getHouseholdConfig();
  if (!existing) return;
  await db
    .update(householdConfig)
    .set({ period_start_date: newStartDate, updated_at: new Date().toISOString() })
    .where(eq(householdConfig.id, existing.id));
}

export interface HouseholdExpenseWithCategory {
  id: number;
  amount: number;
  date: string;
  notes: string | null;
  created_at: string;
  category_id: number | null;
  linked_transaction_id: number | null;
  categoryName: string | null;
  categoryIcon: string | null;
  categoryColor: string | null;
}

/** Get household expenses within the given date range, newest first */
export async function getHouseholdExpenses(startDate: string, endDate: string): Promise<HouseholdExpenseWithCategory[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: householdExpenses.id,
      amount: householdExpenses.amount,
      date: householdExpenses.date,
      notes: householdExpenses.notes,
      created_at: householdExpenses.created_at,
      category_id: householdExpenses.category_id,
      linked_transaction_id: householdExpenses.linked_transaction_id,
      categoryName: categories.name,
      categoryIcon: categories.icon,
      categoryColor: categories.color,
    })
    .from(householdExpenses)
    .leftJoin(categories, eq(householdExpenses.category_id, categories.id))
    .where(and(gte(householdExpenses.date, startDate), lte(householdExpenses.date, endDate)))
    .orderBy(desc(householdExpenses.date), desc(householdExpenses.id));
  return rows;
}

/** Add a new household expense */
export async function createHouseholdExpense(data: Omit<NewHouseholdExpense, 'id' | 'created_at'>) {
  const db = getDb();
  const result = await db
    .insert(householdExpenses)
    .values({ ...data, created_at: new Date().toISOString() })
    .returning();
  return result[0];
}

/** Edit an existing household expense */
export async function updateHouseholdExpense(id: number, data: Partial<Omit<NewHouseholdExpense, 'id' | 'created_at'>>) {
  const db = getDb();
  const result = await db
    .update(householdExpenses)
    .set(data)
    .where(eq(householdExpenses.id, id))
    .returning();
  return result[0];
}

/** Remove a household expense */
export async function deleteHouseholdExpense(id: number) {
  const db = getDb();
  await db.delete(householdExpenses).where(eq(householdExpenses.id, id));
}

export const HOUSEHOLD_TRANSFER_NOTE = 'Household budget transfer';
const HOUSEHOLD_TRANSFER_PREFIX = 'transfer-out:';

/** Amounts are stored as REAL; compare to the cent rather than exactly. */
const sameCents = (col: typeof transactions.amount | typeof householdExpenses.amount, amount: number) =>
  sql`round(${col} * 100) = ${Math.round(amount * 100)}`;

/**
 * Move money out of the household budget into an account, atomically:
 * one income transaction + one household expense linked to it by id.
 */
export async function createHouseholdTransfer(data: {
  amount: number;
  accountId: number;
  accountName: string;
  incomeCategoryId: number;
  date: string;
}) {
  const db = getDb();
  return db.transaction((t) => {
    const [income] = t
      .insert(transactions)
      .values({
        amount: data.amount,
        type: 'income',
        category_id: data.incomeCategoryId,
        account_id: data.accountId,
        date: data.date,
        notes: HOUSEHOLD_TRANSFER_NOTE,
      })
      .returning()
      .all();
    const [expense] = t
      .insert(householdExpenses)
      .values({
        amount: data.amount,
        category_id: null,
        date: data.date,
        notes: `${HOUSEHOLD_TRANSFER_PREFIX}${data.accountName}`,
        linked_transaction_id: income.id,
        created_at: new Date().toISOString(),
      })
      .returning()
      .all();
    return { income, expense };
  });
}

/** Pre-link transfers (before DB v9) have no id link: find exactly one match. */
async function findLegacyHouseholdTransferExpenseId(date: string, amount: number): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: householdExpenses.id })
    .from(householdExpenses)
    .where(and(
      isNull(householdExpenses.linked_transaction_id),
      eq(householdExpenses.date, date),
      sameCents(householdExpenses.amount, amount),
      like(householdExpenses.notes, `${HOUSEHOLD_TRANSFER_PREFIX}%`),
    ))
    .orderBy(asc(householdExpenses.id))
    .limit(1);
  return row?.id ?? null;
}

async function findLegacyHouseholdTransferTransactionId(date: string, amount: number): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(
      eq(transactions.date, date),
      sameCents(transactions.amount, amount),
      eq(transactions.type, 'income'),
      eq(transactions.notes, HOUSEHOLD_TRANSFER_NOTE),
      sql`${transactions.id} not in (select linked_transaction_id from household_expenses where linked_transaction_id is not null)`,
    ))
    .orderBy(asc(transactions.id))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Delete a household expense. If it is a transfer-out, its paired income
 * transaction is deleted too, in the same DB transaction.
 */
export async function deleteHouseholdExpenseWithLink(
  expense: Pick<HouseholdExpense, 'id' | 'date' | 'amount' | 'notes' | 'linked_transaction_id'>
) {
  const db = getDb();
  let txId = expense.linked_transaction_id ?? null;
  if (txId === null && expense.notes?.startsWith(HOUSEHOLD_TRANSFER_PREFIX)) {
    txId = await findLegacyHouseholdTransferTransactionId(expense.date, expense.amount);
  }
  db.transaction((t) => {
    t.delete(householdExpenses).where(eq(householdExpenses.id, expense.id)).run();
    if (txId !== null) t.delete(transactions).where(eq(transactions.id, txId)).run();
  });
}

/** Delete ALL expenses in a given date range — called after a transfer to reset the period */
export async function clearHouseholdExpensesByRange(startDate: string, endDate: string) {
  const db = getDb();
  await db
    .delete(householdExpenses)
    .where(and(gte(householdExpenses.date, startDate), lte(householdExpenses.date, endDate)));
}

/**
 * Close one elapsed household month atomically: archive it to history with
 * its own income and totals, and move the config to `next_start_date`.
 *
 * The month's expenses are kept (they belong to that month and are listed in
 * its history entry). The next month starts with this month's income as a
 * suggestion that the user is asked to confirm or change.
 */
export async function rollOverHouseholdPeriod(cycle: {
  period: 'monthly' | 'weekly' | 'yearly';
  start_date: string;
  end_date: string;
  income_amount: number;
  next_start_date: string;
}) {
  const db = getDb();
  const inRange = and(gte(householdExpenses.date, cycle.start_date), lte(householdExpenses.date, cycle.end_date));
  db.transaction((t) => {
    const [totals] = t
      .select({ spent: sum(householdExpenses.amount), count: count() })
      .from(householdExpenses)
      .where(inRange)
      .all();
    const spent = Number(totals?.spent) || 0;
    const summary = {
      period: cycle.period,
      income_amount: cycle.income_amount,
      spent_amount: spent,
      remaining_amount: cycle.income_amount - spent,
      expense_count: Number(totals?.count) || 0,
      entries_kept: true,
    };
    const [existing] = t
      .select({ id: householdPeriodsHistory.id })
      .from(householdPeriodsHistory)
      .where(and(eq(householdPeriodsHistory.start_date, cycle.start_date), eq(householdPeriodsHistory.end_date, cycle.end_date)))
      .limit(1)
      .all();
    if (existing) {
      t.update(householdPeriodsHistory).set(summary).where(eq(householdPeriodsHistory.id, existing.id)).run();
    } else {
      t.insert(householdPeriodsHistory)
        .values({ ...summary, start_date: cycle.start_date, end_date: cycle.end_date, created_at: new Date().toISOString() })
        .run();
    }
    t.update(householdConfig)
      .set({ period_start_date: cycle.next_start_date, income_confirmed: false, updated_at: new Date().toISOString() })
      .run();
  });
}

/** Archive a household period summary into history (idempotent on start+end). */
export async function archiveHouseholdPeriod(entry: {
  period: 'monthly' | 'weekly' | 'yearly';
  start_date: string;
  end_date: string;
  income_amount: number;
  spent_amount: number;
  remaining_amount: number;
  expense_count: number;
}) {
  const db = getDb();
  const existing = await db
    .select({ id: householdPeriodsHistory.id })
    .from(householdPeriodsHistory)
    .where(
      and(
        eq(householdPeriodsHistory.start_date, entry.start_date),
        eq(householdPeriodsHistory.end_date, entry.end_date),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db
      .update(householdPeriodsHistory)
      .set({
        income_amount: entry.income_amount,
        spent_amount: entry.spent_amount,
        remaining_amount: entry.remaining_amount,
        expense_count: entry.expense_count,
        period: entry.period,
      })
      .where(eq(householdPeriodsHistory.id, existing[0].id));
    return;
  }
  await db.insert(householdPeriodsHistory).values({
    period: entry.period,
    start_date: entry.start_date,
    end_date: entry.end_date,
    income_amount: entry.income_amount,
    spent_amount: entry.spent_amount,
    remaining_amount: entry.remaining_amount,
    expense_count: entry.expense_count,
    created_at: new Date().toISOString(),
  });
}

/** One past household month. Totals are live when its expenses were kept. */
export type HouseholdHistoryEntry = HouseholdPeriodHistory;

function householdHistoryQuery() {
  const db = getDb();
  const h = householdPeriodsHistory;
  const inMonth = sql`${householdExpenses.date} >= ${h.start_date} and ${householdExpenses.date} <= ${h.end_date}`;
  return db
    .select({
      row: h,
      liveSpent: sql<number>`coalesce((select sum(${householdExpenses.amount}) from ${householdExpenses} where ${inMonth}), 0)`,
      liveCount: sql<number>`(select count(*) from ${householdExpenses} where ${inMonth})`,
    })
    .from(h);
}

function toHistoryEntry({ row, liveSpent, liveCount }: {
  row: HouseholdPeriodHistory;
  liveSpent: number;
  liveCount: number;
}): HouseholdHistoryEntry {
  // Months closed before DB v12 lost their expenses: keep their stored totals.
  if (!row.entries_kept) return row;
  const spent = Number(liveSpent) || 0;
  return {
    ...row,
    spent_amount: spent,
    remaining_amount: row.income_amount - spent,
    expense_count: Number(liveCount) || 0,
  };
}

/** List archived household months, newest first. */
export async function listHouseholdHistory(): Promise<HouseholdHistoryEntry[]> {
  const rows = await householdHistoryQuery().orderBy(
    desc(householdPeriodsHistory.start_date),
    desc(householdPeriodsHistory.id),
  );
  return rows.map(toHistoryEntry);
}

/** One archived household month, or null. */
export async function getHouseholdHistoryEntry(id: number): Promise<HouseholdHistoryEntry | null> {
  const [row] = await householdHistoryQuery().where(eq(householdPeriodsHistory.id, id)).limit(1);
  return row ? toHistoryEntry(row) : null;
}

/** Change one past month's income. Other months, and the current one, are untouched. */
export async function updateHouseholdHistoryIncome(id: number, incomeAmount: number) {
  if (!(incomeAmount > 0)) throw new Error('Income must be greater than zero');
  const db = getDb();
  await db
    .update(householdPeriodsHistory)
    .set({
      income_amount: incomeAmount,
      // Only used for months whose expenses are gone (stored totals).
      remaining_amount: sql`${incomeAmount} - ${householdPeriodsHistory.spent_amount}`,
    })
    .where(eq(householdPeriodsHistory.id, id));
}

/**
 * Remove a month from household history, together with its expenses (they
 * belong to that month only). Account transactions linked to its transfers
 * are kept: that money really reached the account.
 */
export async function deleteHouseholdHistoryEntry(id: number) {
  const db = getDb();
  db.transaction((t) => {
    const [entry] = t
      .select()
      .from(householdPeriodsHistory)
      .where(eq(householdPeriodsHistory.id, id))
      .limit(1)
      .all();
    if (!entry) return;
    if (entry.entries_kept) {
      t.delete(householdExpenses)
        .where(and(gte(householdExpenses.date, entry.start_date), lte(householdExpenses.date, entry.end_date)))
        .run();
    }
    t.delete(householdPeriodsHistory).where(eq(householdPeriodsHistory.id, id)).run();
  });
}

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// LOAN QUERIES
// ─────────────────────────────────────────────────────────────────────────────

export interface LoanWithDetails {
  id: number;
  type: 'given' | 'taken';
  person_name: string;
  amount: number;
  account_id: number;
  transaction_id: number | null;
  origin_transaction_id: number | null;
  date: string;
  due_date: string | null;
  notes: string | null;
  is_settled: number;
  created_at: string;
  updated_at: string;
  accountName: string;
  accountIcon: string | null;
  accountColor: string | null;
  payments: Array<{ id: number; amount: number; date: string; notes: string | null; created_at: string }>;
  settled_amount: number;
  remaining_amount: number;
}

/**
 * Ensure "Loan Given" (expense) and "Loan Received" (income) system categories exist.
 * Returns their IDs for use when creating loan transactions.
 */
export async function ensureSystemLoanCategories(): Promise<{ expenseCategoryId: number; incomeCategoryId: number }> {
  const db = getDb();

  const existing = await db
    .select({ id: categories.id, name: categories.name, type: categories.type })
    .from(categories)
    .where(and(like(categories.name, 'Loan %')));

  let expenseCategoryId: number | null = null;
  let incomeCategoryId: number | null = null;

  for (const cat of existing) {
    if (cat.name === 'Loan Given' && cat.type === 'expense') expenseCategoryId = cat.id;
    if (cat.name === 'Loan Received' && cat.type === 'income') incomeCategoryId = cat.id;
  }

  if (!expenseCategoryId) {
    await db
      .insert(categories)
      .values({ name: 'Loan Given', type: 'expense', icon: 'cash-outline', color: '#F59E0B' })
      .onConflictDoNothing();
    const result = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, 'Loan Given'))
      .limit(1);
    expenseCategoryId = result[0].id;
  }

  if (!incomeCategoryId) {
    await db
      .insert(categories)
      .values({ name: 'Loan Received', type: 'income', icon: 'cash-outline', color: '#10B981' })
      .onConflictDoNothing();
    const result = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, 'Loan Received'))
      .limit(1);
    incomeCategoryId = result[0].id;
  }

  return { expenseCategoryId, incomeCategoryId };
}

/** Fetch all loans with account info and payments, optionally filtered by type / settled status */
export async function getLoans(filters?: { type?: 'given' | 'taken'; isSettled?: boolean }): Promise<LoanWithDetails[]> {
  const db = getDb();

  const conditions = [];
  if (filters?.type) conditions.push(eq(loans.type, filters.type));
  if (filters?.isSettled !== undefined) conditions.push(eq(loans.is_settled, filters.isSettled ? 1 : 0));

  const rows = await db.query.loans.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    with: {
      account: true,
      payments: { orderBy: (p, { asc: a }) => [a(p.date)] },
    },
    orderBy: (l, { desc: d }) => [d(l.date), d(l.id)],
  });

  return rows.map((loan) => {
    const settled_amount = loan.payments.reduce((sum, p) => sum + toCents(p.amount), 0) / 100;
    return {
      id: loan.id,
      type: loan.type,
      person_name: loan.person_name,
      amount: loan.amount,
      account_id: loan.account_id,
      transaction_id: loan.transaction_id ?? null,
      origin_transaction_id: loan.origin_transaction_id ?? null,
      date: loan.date,
      due_date: loan.due_date ?? null,
      notes: loan.notes ?? null,
      is_settled: loan.is_settled,
      created_at: loan.created_at,
      updated_at: loan.updated_at,
      accountName: loan.account?.name ?? '',
      accountIcon: loan.account?.icon ?? null,
      accountColor: loan.account?.color ?? null,
      payments: loan.payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        date: p.date,
        notes: p.notes ?? null,
        created_at: p.created_at,
      })),
      settled_amount,
      remaining_amount: Math.max(0, toCents(loan.amount) - toCents(settled_amount)) / 100,
    };
  });
}

/** Money is compared in whole cents to avoid float drift (0.7 + 0.4 !== 1.1). */
export const toCents = (amount: number) => Math.round(amount * 100);

/**
 * Create a loan and book the money leaving (given) or entering (taken) the
 * account, atomically. The later "Transfer to Account" books the repayment,
 * so a fully repaid loan nets to zero on the balance.
 */
export async function createLoan(
  data: Omit<NewLoan, 'id' | 'transaction_id' | 'origin_transaction_id' | 'created_at' | 'updated_at'>,
  categoryIds: { expenseCategoryId: number; incomeCategoryId: number }
): Promise<LoanWithDetails> {
  const db = getDb();
  const now = new Date().toISOString();

  const loan = db.transaction((t) => {
    const [origin] = t
      .insert(transactions)
      .values({
        category_id: data.type === 'given' ? categoryIds.expenseCategoryId : categoryIds.incomeCategoryId,
        account_id: data.account_id,
        amount: data.amount,
        type: data.type === 'given' ? 'expense' : 'income',
        date: data.date,
        notes: data.type === 'given' ? `Loan given to ${data.person_name}` : `Loan taken from ${data.person_name}`,
      })
      .returning()
      .all();
    const [created] = t
      .insert(loans)
      .values({
        ...data,
        transaction_id: null,
        origin_transaction_id: origin.id,
        created_at: now,
        updated_at: now,
      })
      .returning()
      .all();
    return created;
  });
  const account = await db
    .select({ name: accounts.name, icon: accounts.icon, color: accounts.color })
    .from(accounts)
    .where(eq(accounts.id, loan.account_id));

  return {
    ...loan,
    accountName: account[0]?.name ?? '',
    accountIcon: account[0]?.icon ?? null,
    accountColor: account[0]?.color ?? null,
    payments: [],
    settled_amount: 0,
    remaining_amount: loan.amount,
  };
}

/** Update loan fields (person_name, due_date, notes, is_settled) */
export async function updateLoan(id: number, updates: Partial<Pick<NewLoan, 'person_name' | 'due_date' | 'notes' | 'is_settled'>>) {
  const db = getDb();
  const result = await db
    .update(loans)
    .set({ ...updates, updated_at: new Date().toISOString() })
    .where(eq(loans.id, id))
    .returning();
  return result[0];
}

/** Delete a loan, its payments, and its origin + transfer transactions, atomically. */
export async function deleteLoan(id: number): Promise<void> {
  const db = getDb();
  db.transaction((t) => {
    const [loan] = t
      .select({ transaction_id: loans.transaction_id, origin_transaction_id: loans.origin_transaction_id })
      .from(loans)
      .where(eq(loans.id, id))
      .limit(1)
      .all();
    if (!loan) return;
    t.delete(loanPayments).where(eq(loanPayments.loan_id, id)).run();
    t.delete(loans).where(eq(loans.id, id)).run();
    for (const txId of [loan.transaction_id, loan.origin_transaction_id]) {
      if (txId) t.delete(transactions).where(eq(transactions.id, txId)).run();
    }
  });
}

/**
 * Record a repayment amount against a loan (progress tracking only — no transaction created).
 * Balance only changes when the user explicitly taps "Transfer to Account".
 * Auto-settles the loan when fully paid.
 */
export async function createLoanPayment(
  data: Omit<NewLoanPayment, 'id' | 'transaction_id' | 'created_at'>,
  loan: Pick<LoanWithDetails, 'id' | 'type' | 'person_name' | 'account_id' | 'amount' | 'settled_amount'>,
  _categoryIds: { expenseCategoryId: number; incomeCategoryId: number }
): Promise<void> {
  const db = getDb();

  db.transaction((t) => {
    // Re-read inside the transaction: the caller's loan snapshot may be stale
    // (double tap, list not yet refreshed), which used to allow overpaying and
    // leave a fully-paid loan stuck as unsettled.
    const [current] = t.select({ amount: loans.amount }).from(loans).where(eq(loans.id, loan.id)).all();
    if (!current) throw new Error('Loan not found');
    const [paidRow] = t.select({ total: sum(loanPayments.amount) }).from(loanPayments).where(eq(loanPayments.loan_id, loan.id)).all();
    const paidCents = toCents(Number(paidRow?.total) || 0);
    const owedCents = toCents(current.amount) - paidCents;
    if (toCents(data.amount) > owedCents) {
      throw new Error(`Payment is more than the ${(Math.max(owedCents, 0) / 100).toFixed(2)} still owed`);
    }

    t.insert(loanPayments)
      .values({ ...data, transaction_id: null, created_at: new Date().toISOString() })
      .run();

    if (paidCents + toCents(data.amount) >= toCents(current.amount)) {
      t.update(loans)
        .set({ is_settled: 1, updated_at: new Date().toISOString() })
        .where(eq(loans.id, loan.id))
        .run();
    }
  });
}

/**
 * Transfer a settled loan to the account: creates one transaction that shows in Activity
 * and affects the account balance. For given loans → income; for taken loans → expense.
 * Sets loan.transaction_id so the button becomes "Transferred" afterward.
 */
export async function transferLoanToAccount(
  loanId: number,
  categoryIds: { expenseCategoryId: number; incomeCategoryId: number }
): Promise<void> {
  const db = getDb();

  const [loan] = await db
    .select()
    .from(loans)
    .where(eq(loans.id, loanId))
    .limit(1);
  if (!loan) throw new Error('Loan not found');

  const txType = loan.type === 'given' ? 'income' : 'expense';
  const catId = loan.type === 'given'
    ? categoryIds.incomeCategoryId
    : categoryIds.expenseCategoryId;

  if (loan.transaction_id) throw new Error('Loan already transferred');
  const [paidRow] = await db.select({ total: sum(loanPayments.amount) }).from(loanPayments).where(eq(loanPayments.loan_id, loanId));
  if (toCents(Number(paidRow?.total) || 0) < toCents(loan.amount)) {
    throw new Error('Loan is not fully repaid yet');
  }

  db.transaction((t) => {
    const txResult = t
      .insert(transactions)
      .values({
        category_id: catId,
        account_id: loan.account_id,
        amount: loan.amount,
        type: txType,
        date: todayString(),
        notes: loan.type === 'given'
          ? `Loan repaid by ${loan.person_name}`
          : `Loan repaid to ${loan.person_name}`,
      })
      .returning()
      .all();

    t.update(loans)
      .set({
        transaction_id: txResult[0].id,
        is_settled: 1,
        updated_at: new Date().toISOString(),
      })
      .where(eq(loans.id, loanId))
      .run();
  });
}

/** Monthly equivalent of all active recurring expenses */
export async function getRecurringMonthlyTotal(): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({
      amount: recurringExpenses.amount,
      frequency: recurringExpenses.frequency,
    })
    .from(recurringExpenses)
    .leftJoin(categories, eq(recurringExpenses.category_id, categories.id))
    .where(
      and(
        eq(recurringExpenses.is_active, 1),
        eq(categories.type, 'expense')
      )
    );

  const MULTIPLIERS: Record<string, number> = {
    daily: 30,
    weekly: 4.33,
    monthly: 1,
    yearly: 1 / 12,
  };

  return rows.reduce((sum, r) => {
    const mult = MULTIPLIERS[r.frequency] ?? 1;
    return sum + r.amount * mult;
  }, 0);
}
