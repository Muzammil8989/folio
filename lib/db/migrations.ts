import * as SQLite from 'expo-sqlite';
import { logger } from '../logger';

/**
 * DATABASE MIGRATION SYSTEM
 * Handles schema versioning and migrations for offline-first SQLite database
 * Supports incremental schema evolution while maintaining data integrity
 */

export const DATABASE_VERSION = 14; // Increment this when adding new migrations

/**
 * Thrown when the schema can't be brought to DATABASE_VERSION. The database
 * is left exactly as it was (each migration runs in its own transaction, and
 * nothing is ever dropped automatically), so the user's data stays on disk
 * for a fixed app version or a backup to recover.
 */
export class DatabaseMigrationError extends Error {
  constructor(
    message: string,
    /** 'downgrade': the file was written by a newer app. 'failed': a migration threw. */
    readonly reason: 'downgrade' | 'failed',
    readonly fromVersion: number,
    readonly targetVersion: number,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'DatabaseMigrationError';
  }
}

/**
 * Migration interface for type safety
 */
export interface Migration {
  version: number;
  up: (db: SQLite.SQLiteDatabase) => Promise<void>;
  description: string;
}

/**
 * ALL MIGRATIONS
 * Define migrations in sequential order
 * Each migration should be idempotent where possible
 */
const migrations: Migration[] = [
  {
    version: 1,
    description: 'Complete schema with all tables and default data',
    up: async (db: SQLite.SQLiteDatabase) => {
      // journal_mode=WAL is set in initializeDatabase, outside any transaction.
      await db.execAsync(`
        -- CATEGORIES TABLE
        CREATE TABLE IF NOT EXISTS categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
          payment_method TEXT,
          icon TEXT,
          color TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        -- Create index for category type queries
        CREATE INDEX IF NOT EXISTS idx_categories_type ON categories(type);

        -- Create unique index for category name + type combination
        CREATE UNIQUE INDEX IF NOT EXISTS unique_category_name_type ON categories(name, type);

        -- ACCOUNTS TABLE
        CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'checking' CHECK(type IN ('checking', 'savings', 'credit', 'cash', 'other')),
          balance REAL NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'USD',
          icon TEXT,
          color TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE UNIQUE INDEX IF NOT EXISTS unique_account_name ON accounts(name);

        -- Add default payment method accounts
        INSERT OR IGNORE INTO accounts (name, type, balance, currency, icon, color)
        VALUES ('Cash', 'cash', 0, 'USD', 'cash-outline', '#10B981');

        INSERT OR IGNORE INTO accounts (name, type, balance, currency, icon, color)
        VALUES ('Bank Account', 'checking', 0, 'USD', 'card-outline', '#246BFD');

        INSERT OR IGNORE INTO accounts (name, type, balance, currency, icon, color)
        VALUES ('Credit Card', 'credit', 0, 'USD', 'card', '#EF4444');

        INSERT OR IGNORE INTO accounts (name, type, balance, currency, icon, color)
        VALUES ('Debit Card', 'checking', 0, 'USD', 'card-outline', '#3B82F6');

        INSERT OR IGNORE INTO accounts (name, type, balance, currency, icon, color)
        VALUES ('Mobile Wallet', 'other', 0, 'USD', 'phone-portrait-outline', '#8B5CF6');

        INSERT OR IGNORE INTO accounts (name, type, balance, currency, icon, color)
        VALUES ('Savings Account', 'savings', 0, 'USD', 'wallet-outline', '#10B981');

        -- TRANSACTIONS TABLE (with account_id)
        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER NOT NULL,
          account_id INTEGER,
          amount REAL NOT NULL CHECK(amount > 0),
          type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
          date TEXT NOT NULL,
          notes TEXT,
          receipt TEXT,
          recurring_id INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (recurring_id) REFERENCES recurring_expenses(id) ON DELETE SET NULL
        );

        -- Create indexes for transactions table
        CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
        CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_date_type ON transactions(date, type);
        CREATE INDEX IF NOT EXISTS idx_transactions_recurring_id ON transactions(recurring_id);

        -- RECURRING_EXPENSES TABLE (with account_id)
        CREATE TABLE IF NOT EXISTS recurring_expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER NOT NULL,
          account_id INTEGER,
          amount REAL NOT NULL CHECK(amount > 0),
          frequency TEXT NOT NULL CHECK(frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
          start_date TEXT NOT NULL,
          end_date TEXT,
          notes TEXT,
          is_active INTEGER DEFAULT 1,
          last_processed TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_recurring_frequency ON recurring_expenses(frequency);
        CREATE INDEX IF NOT EXISTS idx_recurring_is_active ON recurring_expenses(is_active);
        CREATE INDEX IF NOT EXISTS idx_recurring_start_date ON recurring_expenses(start_date);
        CREATE INDEX IF NOT EXISTS idx_recurring_active_dates ON recurring_expenses(is_active, start_date);
        CREATE INDEX IF NOT EXISTS idx_recurring_account_id ON recurring_expenses(account_id);

        -- BUDGETS TABLE
        CREATE TABLE IF NOT EXISTS budgets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER,
          amount REAL NOT NULL CHECK(amount > 0),
          period TEXT NOT NULL CHECK(period IN ('daily', 'weekly', 'monthly', 'yearly')),
          start_date TEXT,
          end_date TEXT,
          notes TEXT,
          is_active INTEGER DEFAULT 1,
          alert_threshold INTEGER DEFAULT 80 CHECK(alert_threshold >= 0 AND alert_threshold <= 100),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_budgets_category_id ON budgets(category_id);
        CREATE INDEX IF NOT EXISTS idx_budgets_period ON budgets(period);
        CREATE INDEX IF NOT EXISTS idx_budgets_is_active ON budgets(is_active);
        CREATE INDEX IF NOT EXISTS idx_budgets_active_period ON budgets(is_active, period);
      `);
    },
  },
  {
    version: 2,
    description: 'Add icon field to categories table',
    up: async (db: SQLite.SQLiteDatabase) => {
      // Check if icon column already exists (Migration 1 now includes it)
      const tableInfo = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(categories)`
      );
      const hasIcon = tableInfo.some(col => col.name === 'icon');

      if (!hasIcon) {
        await db.execAsync(`ALTER TABLE categories ADD COLUMN icon TEXT;`);
      }

      // Set default icons for existing categories based on their names
      await db.execAsync(`
        UPDATE categories SET icon = 'fast-food' WHERE name LIKE '%Food%' OR name LIKE '%Dining%';
        UPDATE categories SET icon = 'car' WHERE name LIKE '%Transport%' OR name LIKE '%Vehicle%';
        UPDATE categories SET icon = 'home' WHERE name LIKE '%Rent%' OR name LIKE '%Housing%';
        UPDATE categories SET icon = 'medical' WHERE name LIKE '%Health%' OR name LIKE '%Medical%';
        UPDATE categories SET icon = 'cart' WHERE name LIKE '%Shop%' OR name LIKE '%Groceries%';
        UPDATE categories SET icon = 'film' WHERE name LIKE '%Entertainment%';
        UPDATE categories SET icon = 'book' WHERE name LIKE '%Education%';
        UPDATE categories SET icon = 'flash' WHERE name LIKE '%Utilities%';
        UPDATE categories SET icon = 'calendar-outline' WHERE name LIKE '%Subscription%';
        UPDATE categories SET icon = 'shield' WHERE name LIKE '%Insurance%';
        UPDATE categories SET icon = 'cash' WHERE name LIKE '%Salary%' OR name LIKE '%Income%';
        UPDATE categories SET icon = 'briefcase' WHERE name LIKE '%Freelance%' OR name LIKE '%Business%';
        UPDATE categories SET icon = 'trending-up' WHERE name LIKE '%Investment%';
        UPDATE categories SET icon = 'gift' WHERE name LIKE '%Bonus%' OR name LIKE '%Gift%';

        UPDATE categories SET icon = 'wallet' WHERE icon IS NULL AND type = 'income';
        UPDATE categories SET icon = 'fast-food' WHERE icon IS NULL AND type = 'expense';
      `);
    },
  },
  {
    version: 3,
    description: 'Fix invalid icon names in categories and accounts',
    up: async (db: SQLite.SQLiteDatabase) => {
      await db.execAsync(`
        -- Fix invalid 'calendar' icon name to 'calendar-outline'
        UPDATE categories SET icon = 'calendar-outline' WHERE icon = 'calendar';

        -- Fix any other potential invalid icon names to valid Ionicons
        UPDATE categories SET icon = 'wallet' WHERE icon IS NULL OR icon = '';
        UPDATE accounts SET icon = 'wallet' WHERE icon IS NULL OR icon = '';
      `);
    },
  },
  {
    version: 4,
    description: 'Add savings_goals table',
    up: async (db: SQLite.SQLiteDatabase) => {
      await db.execAsync(
        'CREATE TABLE IF NOT EXISTS savings_goals (' +
        '  id INTEGER PRIMARY KEY AUTOINCREMENT,' +
        '  name TEXT NOT NULL,' +
        '  target_amount REAL NOT NULL,' +
        '  saved_amount REAL NOT NULL DEFAULT 0,' +
        '  icon TEXT,' +
        '  color TEXT,' +
        '  deadline TEXT,' +
        '  is_completed INTEGER NOT NULL DEFAULT 0,' +
        '  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
        '  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP' +
        ');'
      );
    },
  },
  {
    version: 5,
    description: 'Add household budget tables',
    up: async (db: SQLite.SQLiteDatabase) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS household_config (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          income_amount REAL NOT NULL CHECK(income_amount > 0),
          period TEXT NOT NULL DEFAULT 'monthly' CHECK(period IN ('monthly', 'weekly', 'yearly')),
          period_start_date TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS household_expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          amount REAL NOT NULL CHECK(amount > 0),
          date TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_household_expenses_date ON household_expenses(date);
        CREATE INDEX IF NOT EXISTS idx_household_expenses_category_id ON household_expenses(category_id);
      `);
    },
  },
  {
    version: 6,
    description: 'Add loans and loan_payments tables',
    up: async (db: SQLite.SQLiteDatabase) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS loans (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL CHECK(type IN ('given', 'taken')),
          person_name TEXT NOT NULL,
          amount REAL NOT NULL CHECK(amount > 0),
          account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
          date TEXT NOT NULL,
          due_date TEXT,
          notes TEXT,
          is_settled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_loans_type ON loans(type);
        CREATE INDEX IF NOT EXISTS idx_loans_is_settled ON loans(is_settled);
        CREATE INDEX IF NOT EXISTS idx_loans_account_id ON loans(account_id);

        CREATE TABLE IF NOT EXISTS loan_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
          amount REAL NOT NULL CHECK(amount > 0),
          transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
          date TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_id ON loan_payments(loan_id);
      `);
    },
  },
  {
    version: 7,
    description: 'Add household_periods_history table for archived household cycles',
    up: async (db: SQLite.SQLiteDatabase) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS household_periods_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          period TEXT NOT NULL CHECK(period IN ('monthly', 'weekly', 'yearly')),
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          income_amount REAL NOT NULL,
          spent_amount REAL NOT NULL DEFAULT 0,
          remaining_amount REAL NOT NULL DEFAULT 0,
          expense_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(start_date, end_date)
        );

        CREATE INDEX IF NOT EXISTS idx_household_periods_history_start ON household_periods_history(start_date);
      `);
    },
  },
  {
    version: 8,
    description: 'Add anchor_day to household_config so month-end cycles (e.g. 31st) do not skip or drift',
    up: async (db: SQLite.SQLiteDatabase) => {
      const tableInfo = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(household_config)`
      );
      const hasAnchorDay = tableInfo.some(col => col.name === 'anchor_day');

      if (!hasAnchorDay) {
        await db.execAsync(`ALTER TABLE household_config ADD COLUMN anchor_day INTEGER NOT NULL DEFAULT 1;`);
      }

      // Backfill the anchor from the day component of the existing period_start_date ("YYYY-MM-DD").
      await db.execAsync(`
        UPDATE household_config
        SET anchor_day = CAST(substr(period_start_date, 9, 2) AS INTEGER)
        WHERE length(period_start_date) >= 10;
      `);
    },
  },
  {
    version: 9,
    description: 'Link loans to their origin transaction and household transfers to their income transaction',
    up: async (db: SQLite.SQLiteDatabase) => {
      const loanCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(loans)`);
      if (!loanCols.some(col => col.name === 'origin_transaction_id')) {
        await db.execAsync(
          `ALTER TABLE loans ADD COLUMN origin_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL;`
        );
      }

      const householdCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(household_expenses)`);
      if (!householdCols.some(col => col.name === 'linked_transaction_id')) {
        await db.execAsync(
          `ALTER TABLE household_expenses ADD COLUMN linked_transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL;`
        );
      }
    },
  },
  {
    version: 10,
    description: 'Account-to-account transfers and savings goals funded from an account',
    up: async (db: SQLite.SQLiteDatabase) => {
      const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(transactions)`);
      // Both halves of an account transfer share one group key.
      if (!cols.some(col => col.name === 'transfer_group')) {
        await db.execAsync(`ALTER TABLE transactions ADD COLUMN transfer_group TEXT;`);
      }
      // Deposits into / withdrawals from a savings goal.
      if (!cols.some(col => col.name === 'savings_goal_id')) {
        await db.execAsync(
          `ALTER TABLE transactions ADD COLUMN savings_goal_id INTEGER REFERENCES savings_goals(id) ON DELETE SET NULL;`
        );
      }
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group ON transactions(transfer_group);`);
      await db.execAsync(`CREATE INDEX IF NOT EXISTS idx_transactions_savings_goal_id ON transactions(savings_goal_id);`);
    },
  },
  {
    version: 11,
    description: 'Covering indexes for totals, budgets and balances; indexes on FKs used when deleting',
    up: async (db: SQLite.SQLiteDatabase) => {
      await db.execAsync(`
        -- Budget spend by category and period (covers the SUM, no table lookups)
        CREATE INDEX IF NOT EXISTS idx_transactions_category_type_date_amount ON transactions(category_id, type, date, amount);
        -- Income/expense totals by date range and by month
        CREATE INDEX IF NOT EXISTS idx_transactions_type_date_amount ON transactions(type, date, amount);
        -- Per-account balances
        CREATE INDEX IF NOT EXISTS idx_transactions_account_type_amount ON transactions(account_id, type, amount);
        -- Lookups by linked transaction when a transaction is deleted
        CREATE INDEX IF NOT EXISTS idx_loans_origin_transaction_id ON loans(origin_transaction_id);
        CREATE INDEX IF NOT EXISTS idx_loans_transaction_id ON loans(transaction_id);
        CREATE INDEX IF NOT EXISTS idx_loan_payments_transaction_id ON loan_payments(transaction_id);
        CREATE INDEX IF NOT EXISTS idx_household_expenses_linked_transaction_id ON household_expenses(linked_transaction_id);
        CREATE INDEX IF NOT EXISTS idx_recurring_category_id ON recurring_expenses(category_id);
      `);
    },
  },
  {
    version: 12,
    description: "Household: keep every month's expenses in history and give each month its own income",
    up: async (db: SQLite.SQLiteDatabase) => {
      // Months closed from now on keep their expenses, so their totals are
      // computed live. Months closed earlier had their expenses deleted and
      // keep showing the totals stored when they closed (entries_kept = 0).
      const historyCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(household_periods_history)`);
      if (!historyCols.some(col => col.name === 'entries_kept')) {
        await db.execAsync(
          `ALTER TABLE household_periods_history ADD COLUMN entries_kept INTEGER NOT NULL DEFAULT 0;`
        );
      }

      // Whether the user has set the current month's income. A new month
      // starts with last month's amount as a suggestion, not yet confirmed.
      const configCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(household_config)`);
      if (!configCols.some(col => col.name === 'income_confirmed')) {
        await db.execAsync(
          `ALTER TABLE household_config ADD COLUMN income_confirmed INTEGER NOT NULL DEFAULT 1;`
        );
      }

      // Totals for a month are summed over its date range.
      await db.execAsync(
        `CREATE INDEX IF NOT EXISTS idx_household_expenses_date_amount ON household_expenses(date, amount);`
      );
    },
  },
  {
    version: 13,
    description: 'Calculator: keep a history of finished calculations',
    up: async (db: SQLite.SQLiteDatabase) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS calculator_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          expression TEXT NOT NULL,
          result REAL NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
    },
  },
  {
    version: 14,
    description: 'Portfolio: holdings, trades and manually entered prices',
    up: async (db: SQLite.SQLiteDatabase) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS investment_holdings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          symbol TEXT,
          asset_type TEXT NOT NULL DEFAULT 'stock'
            CHECK(asset_type IN ('stock', 'mutual_fund', 'etf', 'crypto', 'gold', 'bond', 'other')),
          market TEXT,
          current_price REAL CHECK(current_price IS NULL OR current_price >= 0),
          price_updated_at TEXT,
          color TEXT,
          notes TEXT,
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS investment_trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          holding_id INTEGER NOT NULL REFERENCES investment_holdings(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK(type IN ('buy', 'sell', 'dividend')),
          date TEXT NOT NULL,
          quantity REAL,
          price REAL,
          fees REAL NOT NULL DEFAULT 0,
          amount REAL,
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK(fees >= 0 AND ((type IN ('buy', 'sell') AND quantity > 0 AND price >= 0) OR (type = 'dividend' AND amount > 0)))
        );
        CREATE INDEX IF NOT EXISTS idx_investment_trades_holding_date ON investment_trades(holding_id, date);

        CREATE TABLE IF NOT EXISTS investment_prices (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          holding_id INTEGER NOT NULL REFERENCES investment_holdings(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          price REAL NOT NULL CHECK(price >= 0),
          UNIQUE(holding_id, date)
        );
      `);
    },
  },
];

/**
 * Get the current database version
 */
export async function getDatabaseVersion(
  db: SQLite.SQLiteDatabase
): Promise<number> {
  try {
    const result = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version'
    );
    return result?.user_version ?? 0;
  } catch (error) {
    logger.error('Error getting database version:', error);
    return 0;
  }
}

/**
 * Set the database version
 */
async function setDatabaseVersion(
  db: SQLite.SQLiteDatabase,
  version: number
): Promise<void> {
  await db.execAsync(`PRAGMA user_version = ${version}`);
}

/**
 * Run all pending migrations
 * This is the main entry point for database initialization
 *
 * Each migration's up() and its user_version bump run in one exclusive
 * transaction: a failure rolls that migration back and throws a
 * DatabaseMigrationError, leaving the database at the last good version.
 * Data is never dropped here. `migrationList` is overridable for tests only.
 */
export async function runMigrations(
  db: SQLite.SQLiteDatabase,
  migrationList: readonly Migration[] = migrations
): Promise<void> {
  const target = migrationList.length ? migrationList[migrationList.length - 1].version : 0;
  let currentVersion = await getDatabaseVersion(db);

  logger.info(
    `Database migration: current version ${currentVersion}, target version ${target}`
  );

  // A newer app wrote this file (the user downgraded). Opening it with an
  // older schema could corrupt it, and dropping it would lose their data.
  if (currentVersion > target) {
    const message =
      `Database version ${currentVersion} is newer than this app supports (${target}). ` +
      'Update the app to open your data; nothing was changed.';
    logger.error(message);
    throw new DatabaseMigrationError(message, 'downgrade', currentVersion, target);
  }

  if (currentVersion === target) {
    logger.info('Database is up to date');
    return;
  }

  for (const migration of migrationList) {
    if (migration.version <= currentVersion) continue;
    logger.info(
      `Running migration ${migration.version}: ${migration.description}`
    );
    try {
      // Same connection, plain transaction: migrations run during SQLiteProvider's
      // onInit, before anything else can query, so exclusivity isn't needed.
      // withExclusiveTransactionAsync opens a second native connection, which
      // could wait forever here and leave the app stuck on the splash screen.
      await db.withTransactionAsync(async () => {
        await migration.up(db);
        await setDatabaseVersion(db, migration.version);
      });
    } catch (error) {
      logger.error(`Error running migration ${migration.version}:`, error);
      const detail = error instanceof Error ? error.message : String(error);
      throw new DatabaseMigrationError(
        `Migration ${migration.version} (${migration.description}) failed and was rolled back; ` +
          `the database is still at version ${currentVersion} and no data was removed. ${detail}`,
        'failed',
        currentVersion,
        target,
        error
      );
    }
    currentVersion = migration.version;
    logger.info(`Migration ${migration.version} completed successfully`);
  }

  logger.info('All migrations completed successfully');
}

/**
 * Seed default data
 * Called after migrations complete to populate initial categories and accounts
 */
export async function seedDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    logger.info('Seeding database with default categories and accounts...');

    // Check if already seeded
    const categoryCount = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM categories'
    );

    if ((categoryCount?.count ?? 0) > 0) {
      logger.info('Database already seeded, skipping...');
      return;
    }

    // Seed default categories with icons
    const defaultCategories = [
      // Income categories
      { name: 'Salary', type: 'income', color: '#246BFD', icon: 'cash', payment_method: 'Bank Transfer' },
      { name: 'Freelance', type: 'income', color: '#3B82F6', icon: 'briefcase', payment_method: 'Bank Transfer' },
      { name: 'Investment', type: 'income', color: '#60A5FA', icon: 'trending-up', payment_method: 'Bank Transfer' },
      { name: 'Bonus', type: 'income', color: '#93C5FD', icon: 'gift', payment_method: 'Bank Transfer' },
      { name: 'Other Income', type: 'income', color: '#BFDBFE', icon: 'wallet', payment_method: 'Cash' },

      // Expense categories
      { name: 'Food & Dining', type: 'expense', color: '#EF4444', icon: 'fast-food', payment_method: 'Card' },
      { name: 'Transportation', type: 'expense', color: '#1E40AF', icon: 'car', payment_method: 'Card' },
      { name: 'Utilities', type: 'expense', color: '#F59E0B', icon: 'flash', payment_method: 'Bank Transfer' },
      { name: 'Entertainment', type: 'expense', color: '#8B5CF6', icon: 'film', payment_method: 'Card' },
      { name: 'Shopping', type: 'expense', color: '#EC4899', icon: 'cart', payment_method: 'Card' },
      { name: 'Healthcare', type: 'expense', color: '#F87171', icon: 'medical', payment_method: 'Card' },
      { name: 'Education', type: 'expense', color: '#6366F1', icon: 'book', payment_method: 'Bank Transfer' },
      { name: 'Subscriptions', type: 'expense', color: '#0EA5E9', icon: 'calendar-outline', payment_method: 'Card' },
      { name: 'Insurance', type: 'expense', color: '#06B6D4', icon: 'shield', payment_method: 'Bank Transfer' },
      { name: 'Rent/Housing', type: 'expense', color: '#64748B', icon: 'home', payment_method: 'Bank Transfer' },
      { name: 'Other Expenses', type: 'expense', color: '#BDBDBD', icon: 'ellipsis-horizontal', payment_method: 'Cash' },
    ];

    for (const category of defaultCategories) {
      await db.runAsync(
        `INSERT OR IGNORE INTO categories (name, type, color, icon, payment_method, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [category.name, category.type, category.color, category.icon, category.payment_method]
      );
    }

    logger.info('Database seeding completed successfully');
  } catch (error) {
    logger.error('Error seeding database:', error);
    throw error;
  }
}

/**
 * Initialize database (migrations + seeding)
 * Call this on app startup
 */
export async function initializeDatabase(
  db: SQLite.SQLiteDatabase
): Promise<void> {
  try {
    logger.info('Initializing database...');
    // PRAGMA journal_mode = WAL must be a standalone execAsync call on Android,
    // outside any transaction. Mixing it with DDL in a single batch causes a
    // NativeDatabase NullPointerException because the native layer tries to
    // process the PRAGMA result row during a write. WAL persists in the file;
    // setting it on every open is cheap and covers files made elsewhere.
    await db.execAsync('PRAGMA journal_mode = WAL;');
    // Durable across app crashes in WAL mode, with far fewer fsyncs.
    await db.execAsync('PRAGMA synchronous = NORMAL;');
    await db.execAsync('PRAGMA temp_store = MEMORY;');
    await runMigrations(db);
    // SQLite ships with FK enforcement OFF per connection; without this every
    // ON DELETE CASCADE / SET NULL / RESTRICT in the schema is ignored.
    // Enabled after migrations because table rebuilds must run with FKs off.
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await seedDatabase(db);
    // Refresh planner statistics for the new indexes. Cheap: only analyzes
    // tables whose stats are missing or stale.
    await db.execAsync('PRAGMA optimize;');
    logger.info('Database initialization complete');
  } catch (error) {
    logger.error('Database initialization failed:', error);
    throw error;
  }
}

/**
 * Clear all data from database (useful for testing/development)
 * WARNING: This will delete all transactions, accounts, and categories
 */
export async function clearDatabase(db: SQLite.SQLiteDatabase): Promise<void> {
  try {
    logger.info('Clearing database and resetting schema...');
    // Drop tables to full reset schema (in correct dependency order)
    await db.execAsync(`
      DROP TABLE IF EXISTS calculator_history;
      DROP TABLE IF EXISTS investment_prices;
      DROP TABLE IF EXISTS investment_trades;
      DROP TABLE IF EXISTS investment_holdings;
      DROP TABLE IF EXISTS loan_payments;
      DROP TABLE IF EXISTS loans;
      DROP TABLE IF EXISTS household_periods_history;
      DROP TABLE IF EXISTS household_expenses;
      DROP TABLE IF EXISTS household_config;
      DROP TABLE IF EXISTS savings_goals;
      DROP TABLE IF EXISTS transactions_new;
      DROP TABLE IF EXISTS transactions;
      DROP TABLE IF EXISTS recurring_expenses_new;
      DROP TABLE IF EXISTS recurring_expenses;
      DROP TABLE IF EXISTS budgets;
      DROP TABLE IF EXISTS accounts;
      DROP TABLE IF EXISTS categories;
      PRAGMA user_version = 0;
    `);
    logger.info('Database cleared. Re-initializing...');

    // Re-run migrations and seed default data
    await runMigrations(db);
    await seedDatabase(db);
  } catch (error) {
    logger.error('Error clearing database:', error);
    throw error;
  }
}
