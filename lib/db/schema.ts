import { relations, sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

/**
 * ACCOUNTS TABLE
 * Stores user bank accounts, wallets, or credit cards
 */
export const accounts = sqliteTable(
  'accounts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Account name (e.g., "Chase Bank", "Cash Wallet")
    name: text('name').notNull(),
    // Account type
    type: text('type', { enum: ['checking', 'savings', 'credit', 'cash', 'other'] }).notNull().default('checking'),
    // Initial/Current balance
    balance: real('balance').notNull().default(0),
    // Optional: currency code
    currency: text('currency').notNull().default('USD'),
    // Icon identifier
    icon: text('icon'),
    // Color code
    color: text('color'),
    // Audit timestamps
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    unique('unique_account_name').on(table.name),
  ]
);

/**
 * CATEGORIES TABLE
 * Stores user-defined transaction categories
 * Supports dynamic category creation and organization
 */
export const categories = sqliteTable(
  'categories',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Category name (e.g., "Food", "Transport", "Salary")
    name: text('name').notNull().unique(),
    // Category type: income or expense
    type: text('type', { enum: ['income', 'expense'] }).notNull(),
    // Payment method (e.g., "Cash", "Card", "Bank Transfer", "Wallet")
    payment_method: text('payment_method'),
    // Icon identifier for visual distinction
    icon: text('icon'),
    // Color code for visual distinction (hex format)
    color: text('color'),
    // Audit timestamps
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // Index on type for quick filtering by income/expense
    index('idx_categories_type').on(table.type),
    // Ensure unique names per type (e.g., can't have duplicate "Food" expense categories)
    unique('unique_category_name_type').on(table.name, table.type),
  ]
);

/**
 * TRANSACTIONS TABLE
 * Core table storing all financial transactions
 * References categories for comprehensive tracking
 */
export const transactions = sqliteTable(
  'transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Foreign key to categories table
    category_id: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    // Transaction amount (positive value, type determines if income or expense)
    amount: real('amount').notNull(),
    // Transaction type: income or expense (derived from category, but stored for performance)
    type: text('type', { enum: ['income', 'expense'] }).notNull(),
    // Transaction date in ISO format (YYYY-MM-DD or ISO 8601)
    date: text('date').notNull(),
    // Optional: descriptive notes for the transaction
    notes: text('notes'),
    // Optional: receipt/attachment path or identifier
    receipt: text('receipt'),
    // Foreign key to accounts table
    account_id: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    // Foreign key to recurring_expenses (nullable - for tracking which recurring expense generated this)
    recurring_id: integer('recurring_id').references(() => recurringExpenses.id, {
      onDelete: 'set null',
    }),
    // Both halves of an account-to-account transfer share this key
    transfer_group: text('transfer_group'),
    // Set on deposits into / withdrawals from a savings goal
    savings_goal_id: integer('savings_goal_id').references(() => savingsGoals.id, { onDelete: 'set null' }),
    // Audit timestamps
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // Critical index for date-based queries (common operations: monthly, weekly views)
    index('idx_transactions_date').on(table.date),
    // Index for category filtering
    index('idx_transactions_category_id').on(table.category_id),
    // Composite index for date + type (useful for income/expense summaries by date)
    index('idx_transactions_date_type').on(table.date, table.type),
    // Index for recurring transaction tracking
    index('idx_transactions_recurring_id').on(table.recurring_id),
    // Index for account filtering
    index('idx_transactions_account_id').on(table.account_id),
    // v10: transfer pairs and savings-goal movements
    index('idx_transactions_transfer_group').on(table.transfer_group),
    index('idx_transactions_savings_goal_id').on(table.savings_goal_id),
    // v11 covering indexes: budget spend by category, totals by date, balances by account
    index('idx_transactions_category_type_date_amount').on(table.category_id, table.type, table.date, table.amount),
    index('idx_transactions_type_date_amount').on(table.type, table.date, table.amount),
    index('idx_transactions_account_type_amount').on(table.account_id, table.type, table.amount),
    // Ensure amount is positive (logic should validate, but database ensures)
    check('check_amount_positive', sql`amount > 0`),
  ]
);

/**
 * RECURRING_EXPENSES TABLE
 * Manages recurring/scheduled transactions (bills, subscriptions, regular income)
 * Supports various frequencies: daily, weekly, monthly, yearly
 */
export const recurringExpenses = sqliteTable(
  'recurring_expenses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Foreign key to categories table
    category_id: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    // Recurring amount
    amount: real('amount').notNull(),
    // Frequency of recurrence: daily, weekly, monthly, yearly
    frequency: text('frequency', {
      enum: ['daily', 'weekly', 'monthly', 'yearly'],
    }).notNull(),
    // Start date for the recurring expense (ISO format)
    start_date: text('start_date').notNull(),
    // Optional: end date for the recurring expense (if null, it continues indefinitely)
    end_date: text('end_date'),
    // Optional: descriptive notes
    notes: text('notes'),
    // Is this recurring expense active
    is_active: integer('is_active').default(1), // 0 = false, 1 = true
    // Foreign key to accounts table
    account_id: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    // Last processed date (to prevent duplicate generations)
    last_processed: text('last_processed'),
    // Audit timestamps
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // Index for frequency-based queries
    index('idx_recurring_frequency').on(table.frequency),
    // Index for active recurring expenses
    index('idx_recurring_is_active').on(table.is_active),
    // Index for date-based processing (get active recurring expenses)
    index('idx_recurring_start_date').on(table.start_date),
    // Composite index for finding active recurring expenses by date
    index('idx_recurring_active_dates').on(table.is_active, table.start_date),
    // Index for account filtering
    index('idx_recurring_account_id').on(table.account_id),
    // Index for category lookups (category delete checks)
    index('idx_recurring_category_id').on(table.category_id),
    // Ensure amount is positive
    check('check_recurring_amount_positive', sql`amount > 0`),
  ]
);

/**
 * BUDGETS TABLE
 * Tracks spending budgets and limits
 * Supports category-specific or overall budgets with configurable periods
 */
export const budgets = sqliteTable(
  'budgets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    // Optional: Foreign key to categories (if null, budget applies to all expenses)
    category_id: integer('category_id').references(() => categories.id, {
      onDelete: 'cascade',
    }),
    // Budget amount limit
    amount: real('amount').notNull(),
    // Period for the budget: daily, weekly, monthly, yearly
    period: text('period', {
      enum: ['daily', 'weekly', 'monthly', 'yearly'],
    }).notNull(),
    // Optional: start date for the budget
    start_date: text('start_date'),
    // Optional: end date for the budget (if null, continues indefinitely)
    end_date: text('end_date'),
    // Optional: descriptive notes
    notes: text('notes'),
    // Is this budget active
    is_active: integer('is_active').default(1), // 0 = false, 1 = true
    // Alert threshold percentage (e.g., 80 to alert at 80% of budget)
    alert_threshold: integer('alert_threshold').default(80),
    // Audit timestamps
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    // Index for category-specific budget queries
    index('idx_budgets_category_id').on(table.category_id),
    // Index for period-based queries
    index('idx_budgets_period').on(table.period),
    // Index for active budget filtering
    index('idx_budgets_is_active').on(table.is_active),
    // Composite index for finding active budgets by period
    index('idx_budgets_active_period').on(table.is_active, table.period),
    // Ensure amount is positive
    check('check_budget_amount_positive', sql`amount > 0`),
    // Ensure alert threshold is between 0 and 100
    check(
      'check_alert_threshold',
      sql`alert_threshold >= 0 AND alert_threshold <= 100`
    ),
  ]
);

/**
 * SAVINGS_GOALS TABLE
 * Tracks user-defined financial saving targets
 */
export const savingsGoals = sqliteTable(
  'savings_goals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    target_amount: real('target_amount').notNull(),
    saved_amount: real('saved_amount').notNull().default(0),
    icon: text('icon'),
    color: text('color'),
    deadline: text('deadline'),
    is_completed: integer('is_completed').notNull().default(0),
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  }
);

/**
 * HOUSEHOLD_CONFIG TABLE
 * Single-row config for the standalone household budget system.
 * Stores the one monthly/weekly/yearly income the user sets for home expenses.
 */
export const householdConfig = sqliteTable('household_config', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  income_amount: real('income_amount').notNull(),
  period: text('period', { enum: ['monthly', 'weekly', 'yearly'] }).notNull().default('monthly'),
  period_start_date: text('period_start_date').notNull(),
  // Original day-of-month the cycle anchors to (1–31). Lets monthly/yearly cycles
  // recover the intended day after a short month clamps it (e.g. 31 → Feb 28 → Mar 31).
  anchor_day: integer('anchor_day').notNull().default(1),
  // False when a new month has just started and its income is still last
  // month's amount carried over; the user is asked to confirm or change it.
  income_confirmed: integer('income_confirmed', { mode: 'boolean' }).notNull().default(true),
  created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * HOUSEHOLD_EXPENSES TABLE
 * Expense entries for the household budget system.
 * Independent of main accounts — only links to categories.
 */
export const householdExpenses = sqliteTable(
  'household_expenses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    category_id: integer('category_id').references(() => categories.id, { onDelete: 'set null' }),
    amount: real('amount').notNull(),
    date: text('date').notNull(),
    notes: text('notes'),
    linked_transaction_id: integer('linked_transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_household_expenses_date').on(table.date),
    index('idx_household_expenses_date_amount').on(table.date, table.amount),
    index('idx_household_expenses_category_id').on(table.category_id),
    index('idx_household_expenses_linked_transaction_id').on(table.linked_transaction_id),
    check('check_household_expense_amount_positive', sql`amount > 0`),
  ]
);

/**
 * HOUSEHOLD_PERIODS_HISTORY TABLE
 * Archived household budget periods. A row is inserted whenever a cycle ends
 * (auto-rolled forward) so the user can review past months/weeks/years.
 */
export const householdPeriodsHistory = sqliteTable(
  'household_periods_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    period: text('period', { enum: ['monthly', 'weekly', 'yearly'] }).notNull(),
    start_date: text('start_date').notNull(),
    end_date: text('end_date').notNull(),
    income_amount: real('income_amount').notNull(),
    spent_amount: real('spent_amount').notNull().default(0),
    remaining_amount: real('remaining_amount').notNull().default(0),
    expense_count: integer('expense_count').notNull().default(0),
    // 1 for months closed after DB v12: their expenses are kept, so totals are
    // computed live. 0 for older months, whose expenses were deleted at close.
    entries_kept: integer('entries_kept', { mode: 'boolean' }).notNull().default(false),
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_household_periods_history_start').on(table.start_date),
    unique('unique_household_period_range').on(table.start_date, table.end_date),
  ]
);

/**
 * LOANS TABLE
 * Tracks money lent to others (given) or borrowed from others (taken).
 * Creating a loan auto-generates a linked transaction that adjusts account balance.
 */
export const loans = sqliteTable(
  'loans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type', { enum: ['given', 'taken'] }).notNull(),
    person_name: text('person_name').notNull(),
    amount: real('amount').notNull(),
    account_id: integer('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    transaction_id: integer('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    origin_transaction_id: integer('origin_transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    date: text('date').notNull(),
    due_date: text('due_date'),
    notes: text('notes'),
    is_settled: integer('is_settled').notNull().default(0),
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_loans_type').on(table.type),
    index('idx_loans_is_settled').on(table.is_settled),
    index('idx_loans_account_id').on(table.account_id),
    index('idx_loans_origin_transaction_id').on(table.origin_transaction_id),
    index('idx_loans_transaction_id').on(table.transaction_id),
    check('check_loan_amount_positive', sql`amount > 0`),
  ]
);

/**
 * LOAN_PAYMENTS TABLE
 * Tracks partial/full repayments against a loan.
 * Each payment also generates a linked transaction.
 */
export const loanPayments = sqliteTable(
  'loan_payments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    loan_id: integer('loan_id')
      .notNull()
      .references(() => loans.id, { onDelete: 'cascade' }),
    amount: real('amount').notNull(),
    transaction_id: integer('transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
    date: text('date').notNull(),
    notes: text('notes'),
    created_at: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('idx_loan_payments_loan_id').on(table.loan_id),
    index('idx_loan_payments_transaction_id').on(table.transaction_id),
    check('check_loan_payment_amount_positive', sql`amount > 0`),
  ]
);

// --- RELATIONS ---

/**
 * Define relationships for type-safe queries and eager loading
 */
export const categoriesRelations = relations(categories, ({ many }) => ({
  transactions: many(transactions),
  recurringExpenses: many(recurringExpenses),
  budgets: many(budgets),
}));

export const accountsRelations = relations(accounts, ({ many }) => ({
  transactions: many(transactions),
  recurringExpenses: many(recurringExpenses),
  loans: many(loans),
}));

export const transactionsRelations = relations(
  transactions,
  ({ one }) => ({
    category: one(categories, {
      fields: [transactions.category_id],
      references: [categories.id],
    }),
    account: one(accounts, {
      fields: [transactions.account_id],
      references: [accounts.id],
    }),
    recurringExpense: one(recurringExpenses, {
      fields: [transactions.recurring_id],
      references: [recurringExpenses.id],
    }),
  })
);

export const recurringExpensesRelations = relations(
  recurringExpenses,
  ({ one, many }) => ({
    category: one(categories, {
      fields: [recurringExpenses.category_id],
      references: [categories.id],
    }),
    account: one(accounts, {
      fields: [recurringExpenses.account_id],
      references: [accounts.id],
    }),
    transactions: many(transactions),
  })
);

export const budgetsRelations = relations(budgets, ({ one }) => ({
  category: one(categories, {
    fields: [budgets.category_id],
    references: [categories.id],
  }),
}));

export const householdExpensesRelations = relations(householdExpenses, ({ one }) => ({
  category: one(categories, {
    fields: [householdExpenses.category_id],
    references: [categories.id],
  }),
}));

export const loansRelations = relations(loans, ({ one, many }) => ({
  account: one(accounts, {
    fields: [loans.account_id],
    references: [accounts.id],
  }),
  transaction: one(transactions, {
    fields: [loans.transaction_id],
    references: [transactions.id],
  }),
  payments: many(loanPayments),
}));

export const loanPaymentsRelations = relations(loanPayments, ({ one }) => ({
  loan: one(loans, {
    fields: [loanPayments.loan_id],
    references: [loans.id],
  }),
  transaction: one(transactions, {
    fields: [loanPayments.transaction_id],
    references: [transactions.id],
  }),
}));

// --- TYPE EXPORTS ---

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export type RecurringExpense = typeof recurringExpenses.$inferSelect;
export type NewRecurringExpense = typeof recurringExpenses.$inferInsert;

export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type NewSavingsGoal = typeof savingsGoals.$inferInsert;

export type HouseholdConfig = typeof householdConfig.$inferSelect;
export type NewHouseholdConfig = typeof householdConfig.$inferInsert;

export type HouseholdExpense = typeof householdExpenses.$inferSelect;
export type NewHouseholdExpense = typeof householdExpenses.$inferInsert;

export type HouseholdPeriodHistory = typeof householdPeriodsHistory.$inferSelect;
export type NewHouseholdPeriodHistory = typeof householdPeriodsHistory.$inferInsert;

export type Loan = typeof loans.$inferSelect;
export type NewLoan = typeof loans.$inferInsert;

export type LoanPayment = typeof loanPayments.$inferSelect;
export type NewLoanPayment = typeof loanPayments.$inferInsert;
