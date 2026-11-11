import * as DocumentPicker from 'expo-document-picker';
import { UserService } from '@/features/user/services/user-service';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { getRawDb } from '@/lib/db/db-client';
import type * as SQLite from 'expo-sqlite';
import { todayString } from '@/lib/utils/date';
import { logger } from '@/lib/logger';
import { NotificationService } from '@/features/notifications/services/notification-service';
import { Platform } from 'react-native';

const AUTO_BACKUP_KEY = 'folio_auto_backup_enabled';
const LAST_BACKUP_KEY = 'folio_last_backup_time'; // last SUCCESSFUL backup (manual or auto)
const LAST_AUTO_ATTEMPT_KEY = 'folio_last_auto_attempt'; // last auto-backup attempt (success or fail) — prevents retry loops
const BACKUP_DIR_KEY = 'folio_backup_dir_uri';
const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
// v2 adds loans, loan payments and household tables; v3 adds calculator
// history and the portfolio. Older files still restore.
const BACKUP_VERSION = 3;

type Row = Record<string, unknown>;

/**
 * Every user-data table, parents before children (insert order).
 * Deletes run in reverse. `required` keys must be present in any backup;
 * the rest default to [] so older backups restore.
 */
const BACKUP_TABLES = [
  { key: 'categories', table: 'categories', required: true },
  { key: 'accounts', table: 'accounts', required: true },
  { key: 'recurringExpenses', table: 'recurring_expenses', required: false },
  { key: 'budgets', table: 'budgets', required: false },
  { key: 'transactions', table: 'transactions', required: true },
  { key: 'savingsGoals', table: 'savings_goals', required: false },
  { key: 'householdConfig', table: 'household_config', required: false },
  { key: 'householdExpenses', table: 'household_expenses', required: false },
  { key: 'householdPeriodsHistory', table: 'household_periods_history', required: false },
  { key: 'loans', table: 'loans', required: false },
  { key: 'loanPayments', table: 'loan_payments', required: false },
  { key: 'calculatorHistory', table: 'calculator_history', required: false },
  { key: 'investmentHoldings', table: 'investment_holdings', required: false },
  { key: 'investmentTrades', table: 'investment_trades', required: false },
  { key: 'investmentPrices', table: 'investment_prices', required: false },
] as const;

type BackupKey = (typeof BACKUP_TABLES)[number]['key'];

export interface BackupProfile {
  name?: string;
  currency?: string;
  theme?: 'light' | 'dark' | 'system';
}

export interface BackupData {
  version: number;
  exportedAt: string;
  data: Partial<Record<BackupKey, Row[]>>;
  /** Name, currency and theme, so amounts restore in the right currency. */
  profile?: BackupProfile;
}

/** Keep only well-formed profile fields from a backup file. */
export function sanitizeBackupProfile(p: unknown): BackupProfile | undefined {
  if (!p || typeof p !== 'object') return undefined;
  const src = p as Record<string, unknown>;
  const out: BackupProfile = {};
  if (typeof src.name === 'string' && src.name.trim().length <= 50) out.name = src.name.trim();
  if (typeof src.currency === 'string' && /^[A-Z]{3}$/.test(src.currency)) out.currency = src.currency;
  if (src.theme === 'light' || src.theme === 'dark' || src.theme === 'system') out.theme = src.theme;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Check a parsed backup before touching the database. Returns the data with
 * every table key present (missing optional tables become []).
 */
export function validateBackup(backup: unknown): Record<BackupKey, Row[]> {
  const b = backup as BackupData | null;
  if (!b || typeof b !== 'object' || !b.version || !b.data || typeof b.data !== 'object') {
    throw new Error('Invalid backup format — missing required fields');
  }
  if (b.version > BACKUP_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Please update the app first.');
  }
  const out = {} as Record<BackupKey, Row[]>;
  for (const { key, required } of BACKUP_TABLES) {
    const rows = b.data[key];
    if (rows === undefined || rows === null) {
      if (required) throw new Error(`Invalid backup format — missing "${key}"`);
      out[key] = [];
    } else if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object')) {
      throw new Error(`Invalid backup format — "${key}" is not a list of records`);
    } else {
      out[key] = rows;
    }
  }
  // Money rows must be usable as money: a text amount would turn sums into
  // string concatenation, and a bad date would drop out of every period.
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  out.transactions.forEach((t, i) => {
    const amount = t.amount;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Invalid backup — transaction #${i + 1} has an invalid amount`);
    }
    if (typeof t.date !== 'string' || !DATE.test(t.date)) {
      throw new Error(`Invalid backup — transaction #${i + 1} has an invalid date`);
    }
    if (t.type !== 'income' && t.type !== 'expense') {
      throw new Error(`Invalid backup — transaction #${i + 1} has an invalid type`);
    }
  });
  return out;
}

export const BackupService = {
  /** Forget backup settings (folder, schedule, history) — used by factory reset. */
  async clearSettings(): Promise<void> {
    await Promise.all(
      [AUTO_BACKUP_KEY, LAST_BACKUP_KEY, LAST_AUTO_ATTEMPT_KEY, BACKUP_DIR_KEY].map(k =>
        SecureStore.deleteItemAsync(k).catch(() => {})
      )
    );
  },

  async getAutoBackupEnabled(): Promise<boolean> {
    try {
      const val = await SecureStore.getItemAsync(AUTO_BACKUP_KEY);
      return val === 'true';
    } catch {
      return false;
    }
  },

  async setAutoBackupEnabled(enabled: boolean): Promise<void> {
    await SecureStore.setItemAsync(AUTO_BACKUP_KEY, enabled ? 'true' : 'false');
  },

  async getLastBackupTime(): Promise<Date | null> {
    try {
      const val = await SecureStore.getItemAsync(LAST_BACKUP_KEY);
      if (val) return new Date(val);
    } catch {
      // ignore
    }
    return null;
  },

  async setLastBackupTime(date: Date): Promise<void> {
    await SecureStore.setItemAsync(LAST_BACKUP_KEY, date.toISOString());
  },

  async getBackupDirUri(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(BACKUP_DIR_KEY);
    } catch {
      return null;
    }
  },

  async getLastAutoAttemptTime(): Promise<Date | null> {
    try {
      const val = await SecureStore.getItemAsync(LAST_AUTO_ATTEMPT_KEY);
      if (val) return new Date(val);
    } catch {
      // ignore
    }
    return null;
  },

  async setLastAutoAttemptTime(date: Date): Promise<void> {
    try {
      await SecureStore.setItemAsync(LAST_AUTO_ATTEMPT_KEY, date.toISOString());
    } catch {
      // ignore — best-effort backoff marker
    }
  },

  async shouldTriggerAutoBackup(): Promise<boolean> {
    const enabled = await BackupService.getAutoBackupEnabled();
    if (!enabled) return false;

    // Auto-backup must be SILENT. If no folder has been chosen yet (via a manual
    // "Download Backup"), we skip rather than popping the system folder picker.
    if (Platform.OS === 'android') {
      const dirUri = await BackupService.getBackupDirUri();
      if (!dirUri) return false;
    }

    const now = Date.now();

    // Back off from the last successful backup (manual or auto)…
    const last = await BackupService.getLastBackupTime();
    if (last && now - last.getTime() < BACKUP_INTERVAL_MS) return false;

    // …and from the last auto attempt, so a failing backup can't retry on every
    // app resume (this is what previously caused the repeating folder prompt).
    const lastAttempt = await BackupService.getLastAutoAttemptTime();
    if (lastAttempt && now - lastAttempt.getTime() < BACKUP_INTERVAL_MS) return false;

    return true;
  },

  async exportAllData(): Promise<BackupData> {
    const db = getRawDb();

    const data: BackupData['data'] = {};
    for (const { key, table } of BACKUP_TABLES) {
      data[key] = await db.getAllAsync<Row>(`SELECT * FROM ${table}`);
    }

    let profile: BackupProfile | undefined;
    try {
      const p = await UserService.getProfile();
      profile = { name: p.name, currency: p.currency, theme: p.theme };
    } catch (e) {
      logger.error('Could not read profile for backup', e);
    }

    return {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data,
      profile,
    };
  },

  /**
   * Writes a backup file to the device.
   *
   * @param options.allowPrompt When `true` (manual backups) and no folder has
   *   been chosen yet on Android, the system folder picker is shown. When
   *   `false` (auto-backup) the picker is NEVER shown — if no folder is
   *   configured the call returns `null` and the backup is silently skipped.
   *
   * @returns The saved file info, or `null` if the backup was skipped because
   *   no folder is configured and prompting was not allowed.
   */
  async saveToDevice(
    options: { allowPrompt?: boolean } = {},
  ): Promise<{ fileName: string; location: string } | null> {
    const { allowPrompt = true } = options;

    if (Platform.OS === 'android') {
      const backup = await BackupService.exportAllData();
      const json = JSON.stringify(backup);
      const date = todayString();
      const fileName = `folio-backup-${date}.json`;

      // Writes the JSON into the SAF folder at `dirUri`. SAF persists folder
      // permissions across app restarts, but they can still be lost (folder
      // deleted, SD card removed, OS reclaimed the grant) — in which case
      // createFileAsync/writeAsStringAsync throws. We surface the real native
      // message so failures are diagnosable instead of a generic catch-all.
      const writeInto = async (dirUri: string): Promise<void> => {
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          dirUri,
          fileName,
          'application/json',
        );
        await FileSystem.writeAsStringAsync(fileUri, json, { encoding: 'utf8' as const });
      };

      // Force a fresh folder pick, persist it, and write. Used both for the
      // first-ever backup and to recover when a stored folder has gone stale.
      const promptThenWrite = async (): Promise<void> => {
        const result = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!result.granted) {
          throw new Error('Storage permission denied. Please grant folder access to save backups.');
        }
        await SecureStore.setItemAsync(BACKUP_DIR_KEY, result.directoryUri);
        await writeInto(result.directoryUri);
      };

      const storedDir = await BackupService.getBackupDirUri();

      if (!storedDir) {
        // No folder chosen yet. Auto-backup must stay silent — bail out.
        if (!allowPrompt) return null;
        await promptThenWrite();
      } else {
        try {
          await writeInto(storedDir);
        } catch (error) {
          // The stored folder no longer works. Drop it so we don't keep retrying
          // a dead URI. For a manual backup, immediately re-prompt and try once
          // more; for silent auto-backup, just skip until the user re-picks.
          await SecureStore.deleteItemAsync(BACKUP_DIR_KEY);
          logger.error('Backup write to stored folder failed', error);
          if (!allowPrompt) return null;
          await promptThenWrite();
        }
      }

      await BackupService.setLastBackupTime(new Date());
      return { fileName, location: 'your selected folder' };

    } else {
      // iOS: saves to the app Documents folder, visible in Files app → Folio
      const backup = await BackupService.exportAllData();
      const json = JSON.stringify(backup);
      const date = todayString();
      const fileName = `folio-backup-${date}.json`;

      const filePath = `${FileSystem.documentDirectory}${fileName}`;
      await FileSystem.writeAsStringAsync(filePath, json, { encoding: 'utf8' as const });
      await BackupService.setLastBackupTime(new Date());
      return { fileName, location: 'Files app → Folio' };
    }
  },

  async pickAndRestoreBackup(): Promise<{ restored: number; message: string; profile?: BackupProfile }> {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.[0]) {
      throw new Error('No file selected');
    }

    const fileUri = result.assets[0].uri;
    const raw = await FileSystem.readAsStringAsync(fileUri, {
      encoding: 'utf8' as const,
    });

    let backup: BackupData;
    try {
      backup = JSON.parse(raw);
    } catch {
      throw new Error('Invalid backup file — could not parse JSON');
    }

    return BackupService.restoreData(backup);
  },

  /**
   * Replace all data with the backup's contents. Validates everything first,
   * then deletes + inserts inside one transaction, so a bad file or a failed
   * insert leaves the existing data untouched.
   */
  async restoreData(backup: BackupData): Promise<{ restored: number; message: string; profile?: BackupProfile }> {
    const data = validateBackup(backup);
    const db = getRawDb();

    type BindVal = string | number | null;
    const bind = (v: unknown): BindVal =>
      v === undefined || v === null ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as BindVal);

    // FK checks off while tables are briefly inconsistent. This pragma is a
    // no-op inside a transaction, so it is set outside it. Runs on the app's
    // own connection: a second (exclusive) connection would lock out the
    // screens' queries mid-restore.
    await db.execAsync('PRAGMA foreign_keys = OFF;');
    try {
      await db.withTransactionAsync(async () => {
        const txn = db;
        // Only insert columns the current schema has (backups may be older/newer).
        const columnsOf = async (table: string) =>
          new Set((await txn.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`)).map(c => c.name));

        for (const { table } of [...BACKUP_TABLES].reverse()) {
          await txn.execAsync(`DELETE FROM ${table};`);
        }

        for (const { key, table } of BACKUP_TABLES) {
          const columns = await columnsOf(table);
          // One prepared statement per column set (normally one per table)
          // instead of re-parsing the INSERT for every row. Rows missing a
          // column keep that column's default, as before.
          const statements = new Map<string, SQLite.SQLiteStatement>();
          try {
            for (const row of data[key]) {
              const cols = Object.keys(row).filter(c => columns.has(c));
              if (cols.length === 0) continue;
              const signature = cols.join(',');
              let stmt = statements.get(signature);
              if (!stmt) {
                stmt = await txn.prepareAsync(
                  `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
                );
                statements.set(signature, stmt);
              }
              await stmt.executeAsync(cols.map(c => bind(row[c])));
            }
          } finally {
            for (const stmt of statements.values()) await stmt.finalizeAsync();
          }
        }

        // FKs are off during the load, so verify them before committing: a
        // transaction pointing at a missing account or category would vanish
        // from balances. Throwing here rolls the whole restore back.
        const broken = await txn.getAllAsync<{ table: string }>('PRAGMA foreign_key_check;');
        if (broken.length > 0) {
          throw new Error(`This backup is damaged — ${broken.length} record${broken.length === 1 ? '' : 's'} point to missing data. Nothing was changed.`);
        }
      });
    } catch (error) {
      logger.error('Restore failed, existing data kept', error);
      throw error;
    } finally {
      await db.execAsync('PRAGMA foreign_keys = ON;');
    }

    const total = BACKUP_TABLES.reduce((n, { key }) => n + data[key].length, 0);
    logger.info(`Restore complete: ${total} records restored`);
    return {
      restored: total,
      message: `Restored ${data.transactions.length} transactions, ${data.accounts.length} accounts, ${data.categories.length} categories, and more.`,
      // Applied by the caller through the user context so the UI updates.
      profile: sanitizeBackupProfile((backup as BackupData | null)?.profile),
    };
  },

  async runAutoBackupIfNeeded(): Promise<boolean> {
    if (!(await BackupService.shouldTriggerAutoBackup())) return false;

    // Record the attempt FIRST. Even if the save below fails — or the app is
    // killed mid-write — the 12h backoff is already in place, so we never fall
    // into a retry loop that repeatedly interrupts the user on app resume.
    await BackupService.setLastAutoAttemptTime(new Date());

    try {
      // allowPrompt: false — an automatic backup must never open the folder picker.
      const result = await BackupService.saveToDevice({ allowPrompt: false });
      if (result) {
        // Let the user know a scheduled backup just ran (no-op if notifications
        // are disabled — NotificationService guards on its own preference).
        await NotificationService.sendBackupComplete(result.fileName);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Auto-backup failed', error);
      return false;
    }
  },
};
