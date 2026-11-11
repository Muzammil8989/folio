jest.unmock('@/lib/db/db-client');
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@/features/notifications/services/notification-service', () => ({
    NotificationService: { sendBackupComplete: jest.fn() },
}));
import { BackupService } from '@/features/backup/services/backup-service';
import { summarizeHolding } from '@/features/investments/utils';
import { clearDatabase, DATABASE_VERSION, runMigrations } from '@/lib/db/migrations';
import * as q from '@/lib/db/queries';
import { parseAmount } from '@/lib/utils/currency';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });
afterEach(() => db.close());

const count = (table: string) => (db.raw.prepare(`select count(*) c from ${table}`).get() as { c: number }).c;
const base = { symbol: 'engro ', asset_type: 'stock' as const, market: 'PSX', notes: null, color: null };
const buy = (date: string, quantity: number, price: number, fees = 0): q.TradeInput =>
    ({ type: 'buy', date, quantity, price, fees, amount: null, notes: null });

describe('portfolio queries', () => {
    it('creates a holding with its first trade and price, and tidies its fields', async () => {
        const h = await q.createHolding({ ...base, name: '  Engro Corp ' }, buy('2026-01-05', 100, 250, 50), { price: 270, date: '2026-01-10' });
        expect(h).toMatchObject({ name: 'Engro Corp', symbol: 'ENGRO', current_price: 270, price_updated_at: '2026-01-10' });
        const data = (await q.getHoldingData(h.id))!;
        expect(data.trades).toHaveLength(1);
        expect(data.prices).toEqual([expect.objectContaining({ date: '2026-01-10', price: 270 })]);
        const s = summarizeHolding(data.holdings[0], data.trades);
        expect(s.marketValue).toBe(27000);
        expect(s.unrealized).toBe(27000 - 25050);
    });

    it('stores dividends with only an amount and buys without one', async () => {
        const h = await q.createHolding({ ...base, name: 'Lucky' });
        await q.createTrade(h.id, { type: 'dividend', date: '2026-02-01', quantity: 5, price: 3, fees: 2, amount: 40, notes: '' });
        await q.createTrade(h.id, { ...buy('2026-01-01', 10, 5), amount: 99 });
        const { trades } = (await q.getHoldingData(h.id))!;
        expect(trades[0]).toMatchObject({ type: 'buy', amount: null });
        expect(trades[1]).toMatchObject({ type: 'dividend', quantity: null, price: null, fees: 0, amount: 40, notes: null });
    });

    it('rejects invalid trades at the database level', async () => {
        const h = await q.createHolding({ ...base, name: 'X' });
        await expect(q.createTrade(h.id, buy('2026-01-01', 0, 10))).rejects.toThrow();
        await expect(q.createTrade(h.id, buy('2026-01-01', 1, -1))).rejects.toThrow();
        await expect(q.createTrade(h.id, { type: 'dividend', date: '2026-01-01', quantity: null, price: null, fees: 0, amount: 0, notes: null })).rejects.toThrow();
        await expect(q.createTrade(9999, buy('2026-01-01', 1, 1))).rejects.toThrow(/FOREIGN KEY/);
    });

    it('updates and deletes trades', async () => {
        const h = await q.createHolding({ ...base, name: 'X' }, buy('2026-01-01', 10, 10));
        const [t] = (await q.getHoldingData(h.id))!.trades;
        await q.updateTrade(t.id, buy('2026-01-02', 20, 11));
        expect((await q.getHoldingData(h.id))!.trades[0]).toMatchObject({ date: '2026-01-02', quantity: 20, price: 11 });
        await q.deleteTrade(t.id);
        expect((await q.getHoldingData(h.id))!.trades).toEqual([]);
    });

    it('keeps one typed price per day and only moves the current price forward', async () => {
        const h = await q.createHolding({ ...base, name: 'X' });
        await q.setHoldingPrice(h.id, 100, '2026-03-01');
        await q.setHoldingPrice(h.id, 105, '2026-03-01');
        await q.setHoldingPrice(h.id, 90, '2026-02-01'); // back-dated
        const data = (await q.getHoldingData(h.id))!;
        expect(data.prices.map(p => [p.date, p.price])).toEqual([['2026-02-01', 90], ['2026-03-01', 105]]);
        expect(data.holdings[0]).toMatchObject({ current_price: 105, price_updated_at: '2026-03-01' });
    });

    it('updates many prices in one go', async () => {
        const a = await q.createHolding({ ...base, name: 'A' });
        const b = await q.createHolding({ ...base, name: 'B' });
        await q.setHoldingPrices([{ holdingId: a.id, price: 1 }, { holdingId: b.id, price: 2 }], '2026-04-01');
        const { holdings } = await q.getPortfolioData();
        expect(holdings.map(h => h.current_price)).toEqual([1, 2]);
    });

    it('archives, edits and deletes a holding with everything under it', async () => {
        const h = await q.createHolding({ ...base, name: 'X' }, buy('2026-01-01', 1, 1), { price: 2, date: '2026-01-02' });
        await q.updateHolding(h.id, { is_archived: 1, name: 'Renamed', symbol: '' });
        expect((await q.getHoldingData(h.id))!.holdings[0]).toMatchObject({ is_archived: 1, name: 'Renamed', symbol: null });
        await q.deleteHolding(h.id);
        expect(await q.getHoldingData(h.id)).toBeNull();
        expect(count('investment_trades')).toBe(0);
        expect(count('investment_prices')).toBe(0);
    });

    it('never touches accounts or transactions', async () => {
        const before = await q.getCurrentBalance();
        const txCount = count('transactions');
        const h = await q.createHolding({ ...base, name: 'X' }, buy('2026-01-01', 10, 100));
        await q.createTrade(h.id, { type: 'dividend', date: '2026-02-01', quantity: null, price: null, fees: 0, amount: 50, notes: null });
        expect(await q.getCurrentBalance()).toBe(before);
        expect(count('transactions')).toBe(txCount);
    });
});

describe('portfolio storage', () => {
    it('creates the tables when upgrading a v13 database', async () => {
        db.raw.exec('DROP TABLE investment_prices; DROP TABLE investment_trades; DROP TABLE investment_holdings;');
        db.raw.pragma('user_version = 13');
        await runMigrations(db.expo);
        expect(db.raw.pragma('user_version', { simple: true })).toBe(DATABASE_VERSION);
        const h = await q.createHolding({ ...base, name: 'X' }, buy('2026-01-01', 1, 1));
        expect(h.id).toBeGreaterThan(0);
    });

    it('is cleared by a factory reset', async () => {
        await q.createHolding({ ...base, name: 'X' }, buy('2026-01-01', 1, 1), { price: 1, date: '2026-01-01' });
        await clearDatabase(db.expo);
        expect([count('investment_holdings'), count('investment_trades'), count('investment_prices')]).toEqual([0, 0, 0]);
    });

    it('round-trips through a backup', async () => {
        const h = await q.createHolding({ ...base, name: 'X' }, buy('2026-01-01', 3, 7), { price: 9, date: '2026-01-02' });
        await q.createTrade(h.id, { type: 'dividend', date: '2026-02-01', quantity: null, price: null, fees: 0, amount: 4, notes: null });
        const backup = JSON.parse(JSON.stringify(await BackupService.exportAllData()));
        expect(backup.data.investmentHoldings).toHaveLength(1);
        await q.deleteHolding(h.id);
        await BackupService.restoreData(backup);
        const data = (await q.getHoldingData(h.id))!;
        expect(data.trades).toHaveLength(2);
        expect(data.prices).toHaveLength(1);
        expect(db.raw.pragma('foreign_key_check')).toEqual([]);
    });
});

describe('parseAmount precision', () => {
    it('keeps more decimals when asked (share quantities)', () => {
        expect(parseAmount('0.12345678', 8)).toBe(0.12345678);
        expect(parseAmount('0,5', 8)).toBe(0.5);
        expect(parseAmount('1,234.5', 8)).toBe(1234.5);
        expect(parseAmount('0.12345678')).toBe(0.12);
    });
});
