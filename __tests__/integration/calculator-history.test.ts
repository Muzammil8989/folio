jest.unmock('@/lib/db/db-client');
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/features/notifications/services/notification-service', () => ({
    NotificationService: { sendBackupComplete: jest.fn() },
}));
import { BackupService, validateBackup } from '@/features/backup/services/backup-service';
import { clearDatabase, DATABASE_VERSION, runMigrations } from '@/lib/db/migrations';
import * as q from '@/lib/db/queries';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });
afterEach(() => db.close());

const count = () => (db.raw.prepare('select count(*) c from calculator_history').get() as { c: number }).c;

describe('calculator history', () => {
    it('saves newest first', async () => {
        await q.addCalcHistory('1+1', 2);
        await q.addCalcHistory('2×3', 6);
        const rows = await q.getCalcHistory();
        expect(rows.map(r => [r.expression, r.result])).toEqual([['2×3', 6], ['1+1', 2]]);
        expect(rows[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it(`keeps only the newest ${q.CALC_HISTORY_LIMIT}`, async () => {
        for (let i = 0; i < q.CALC_HISTORY_LIMIT + 5; i++) await q.addCalcHistory(`${i}+0`, i);
        expect(count()).toBe(q.CALC_HISTORY_LIMIT);
        const rows = await q.getCalcHistory();
        expect(rows[0].result).toBe(q.CALC_HISTORY_LIMIT + 4);
        expect(rows[rows.length - 1].result).toBe(5);
    });

    it('deletes one entry or all of them', async () => {
        const a = await q.addCalcHistory('1+1', 2);
        await q.addCalcHistory('2+2', 4);
        await q.deleteCalcHistoryEntry(a.id);
        expect((await q.getCalcHistory()).map(r => r.result)).toEqual([4]);
        await q.clearCalcHistory();
        expect(count()).toBe(0);
    });

    it('creates the table when upgrading a v12 database', async () => {
        db.raw.exec('DROP TABLE calculator_history');
        db.raw.pragma('user_version = 12');
        await runMigrations(db.expo);
        expect(db.raw.pragma('user_version', { simple: true })).toBe(DATABASE_VERSION);
        await q.addCalcHistory('5×5', 25);
        expect(count()).toBe(1);
    });

    it('is cleared by a factory reset', async () => {
        await q.addCalcHistory('1+1', 2);
        await clearDatabase(db.expo);
        expect(count()).toBe(0);
    });

    it('is included in backups, and older backups still restore', async () => {
        await q.addCalcHistory('7×6', 42);
        const backup = JSON.parse(JSON.stringify(await BackupService.exportAllData()));
        expect(backup.version).toBe(3);
        expect(backup.data.calculatorHistory).toHaveLength(1);

        await q.clearCalcHistory();
        await BackupService.restoreData(backup);
        expect((await q.getCalcHistory())[0]).toMatchObject({ expression: '7×6', result: 42 });

        // A v2 file has no calculator history; restoring it leaves the table empty.
        const v2 = { ...backup, version: 2, data: { ...backup.data } };
        delete (v2.data as Record<string, unknown>).calculatorHistory;
        expect(validateBackup(v2).calculatorHistory).toEqual([]);
        await BackupService.restoreData(v2);
        expect(count()).toBe(0);
    });
});
