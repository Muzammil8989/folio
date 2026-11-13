jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(async () => ({ uri: 'file:///tmp/print-1.pdf' })) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => ({
    cacheDirectory: 'file:///cache/',
    EncodingType: { Base64: 'base64' },
    writeAsStringAsync: jest.fn(async () => {}),
    deleteAsync: jest.fn(async () => {}),
    moveAsync: jest.fn(async () => {}),
}));

import {
    buildHouseholdWorkbook,
    exportHouseholdExcel,
    periodSheetName,
    uniqueSheetName,
} from '@/features/household/services/household-excel';
import { buildHouseholdHtml, exportHouseholdPdf } from '@/features/household/services/household-pdf';
import {
    buildHouseholdReport,
    buildMonthReport,
    householdFileStem,
    type HouseholdMonthReport,
} from '@/features/household/services/household-report';
import type { HouseholdExpenseWithCategory } from '@/lib/db/queries';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';

let nextId = 1;
const expense = (amount: number, date: string, categoryName: string | null = 'Groceries', notes: string | null = null): HouseholdExpenseWithCategory => ({
    id: nextId++,
    amount,
    date,
    notes,
    created_at: '',
    category_id: categoryName ? 1 : null,
    linked_transaction_id: null,
    categoryName,
    categoryIcon: null,
    categoryColor: null,
});

const october = () => buildMonthReport({
    period: 'monthly', start: '2026-10-01', end: '2026-10-31', income: 1000, isCurrent: false,
    expenses: [expense(300, '2026-10-20', 'Rent'), expense(120.5, '2026-10-05'), expense(80, '2026-10-06')],
});
const november = () => buildMonthReport({
    period: 'monthly', start: '2026-11-01', end: '2026-11-30', income: 1000, isCurrent: true,
    expenses: [expense(1100, '2026-11-02', 'Rent'), expense(50, '2026-11-03', null, 'transfer-out:Wallet')],
});
const report = (months: HouseholdMonthReport[]) =>
    buildHouseholdReport(months, { scopeLabel: 'All periods', currency: 'USD', ownerName: 'Ada', now: new Date(2026, 10, 9) });

describe('buildMonthReport', () => {
    it('totals the period, lists expenses oldest first and splits spending by category', () => {
        const m = october();
        expect(m).toMatchObject({ spent: 500.5, remaining: 499.5, percentUsed: 50, detailsKept: true, label: 'Oct 1 – Oct 31, 2026' });
        expect(m.expenses.map(e => e.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-20']);
        expect(m.byCategory.map(c => [c.name, c.total])).toEqual([['Rent', 300], ['Groceries', 200.5]]);
    });

    it('labels transfers out by where the money went', () => {
        const transfer = november().expenses.find(e => e.amount === 50)!;
        expect(transfer).toMatchObject({ category: 'Transfer to account', notes: 'Wallet' });
    });

    it('keeps the stored totals for periods whose expenses were not kept', () => {
        const m = buildMonthReport({
            period: 'monthly', start: '2025-01-01', end: '2025-01-31', income: 800, isCurrent: false,
            expenses: [], detailsKept: false, storedSpent: 650,
        });
        expect(m).toMatchObject({ spent: 650, remaining: 150, detailsKept: false, expenses: [] });
    });
});

describe('buildHouseholdReport', () => {
    it('orders periods oldest first and adds grand totals', () => {
        const r = report([november(), october()]);
        expect(r.months.map(m => m.start)).toEqual(['2026-10-01', '2026-11-01']);
        expect(r.totals).toEqual({ income: 2000, spent: 1650.5, remaining: 349.5, expenseCount: 5 });
    });

    it('names files after one period, or the span of all of them', () => {
        expect(householdFileStem(report([october()]))).toBe('Folio-household-2026-10-01-to-2026-10-31');
        expect(householdFileStem(report([october(), november()]))).toBe('Folio-household-all-2026-10-01-to-2026-11-30');
    });
});

describe('buildHouseholdHtml', () => {
    it('puts every period on its own page after an overview', () => {
        const html = buildHouseholdHtml(report([october(), november()]));
        expect(html.match(/class="month[" ]/g)).toHaveLength(2);
        expect(html).toContain('<h2>Overview');
        expect(html).toContain('page-break-before: always');
        expect(html).toContain('Over budget');
        expect(html).toContain('Prepared for Ada');
    });

    it('has no overview for a single period', () => {
        const html = buildHouseholdHtml(report([october()]));
        expect(html).not.toContain('<h2>Overview');
        expect(html).toContain('class="month first"');
    });

    it('escapes what the user typed', () => {
        const m = buildMonthReport({
            period: 'monthly', start: '2026-10-01', end: '2026-10-31', income: 100, isCurrent: false,
            expenses: [expense(10, '2026-10-02', '<b>Food</b>', '"quoted" & <i>note</i>')],
        });
        const html = buildHouseholdHtml(report([m]));
        expect(html).not.toContain('<b>Food</b>');
        expect(html).toContain('&lt;b&gt;Food&lt;/b&gt;');
        expect(html).toContain('&quot;quoted&quot; &amp; &lt;i&gt;note&lt;/i&gt;');
    });
});

describe('Excel sheet names', () => {
    it('names calendar months and years plainly, other cycles by their span', () => {
        expect(periodSheetName({ period: 'monthly', start: '2026-11-01', end: '2026-11-30' })).toBe('Nov 2026');
        expect(periodSheetName({ period: 'monthly', start: '2026-06-18', end: '2026-07-17' })).toBe('Jun 18–Jul 17 26');
        expect(periodSheetName({ period: 'yearly', start: '2026-01-01', end: '2026-12-31' })).toBe('2026');
        expect(periodSheetName({ period: 'weekly', start: '2026-11-02', end: '2026-11-08' })).toBe('Nov 2–Nov 8 26');
    });

    it('keeps names valid and unique', () => {
        const taken = new Set<string>();
        expect(uniqueSheetName('Nov 2026', taken)).toBe('Nov 2026');
        expect(uniqueSheetName('nov 2026', taken)).toBe('nov 2026 (2)');
        const long = uniqueSheetName('a/b?c*d[e]f:g'.repeat(5), taken);
        expect(long.length).toBeLessThanOrEqual(31);
        expect(long).not.toMatch(/[\\/?*[\]:]/);
    });
});

describe('buildHouseholdWorkbook', () => {
    it('has an Overview tab and one tab per period, with numeric money and live totals', () => {
        const wb = buildHouseholdWorkbook(report([october(), november()]));
        expect(wb.SheetNames).toEqual(['Overview', 'Oct 2026', 'Nov 2026']);

        const overview = wb.Sheets.Overview;
        expect(overview.E2).toMatchObject({ t: 'n', v: 1000 });
        expect(overview.E5.f).toBe('SUM(E2:E3)');
        expect(overview.F5.v).toBe(1650.5);

        const oct = wb.Sheets['Oct 2026'];
        expect(oct.B7).toMatchObject({ t: 'n', v: 500.5, f: 'SUM(D13:D15)' });
        expect(oct.B8.f).toBe('B6-B7');
        expect(oct.A13).toMatchObject({ t: 'n', z: 'yyyy-mm-dd' });
        expect(oct.D16).toMatchObject({ v: 500.5, f: 'SUM(D13:D15)' });
        expect(oct['!autofilter']).toEqual({ ref: 'A12:D15' });
    });

    it('notes periods whose expenses were not kept', () => {
        const old = buildMonthReport({
            period: 'monthly', start: '2025-01-01', end: '2025-01-31', income: 800, isCurrent: false,
            expenses: [], detailsKept: false, storedSpent: 650,
        });
        const ws = buildHouseholdWorkbook(report([old])).Sheets['Jan 2025'];
        expect(ws.B7).toMatchObject({ v: 650 });
        expect(ws.B7.f).toBeUndefined();
        expect(ws.A13.v).toMatch(/weren't kept/);
    });

    it('round-trips through the xlsx writer', () => {
        const wb = buildHouseholdWorkbook(report([october(), november()]));
        const back = XLSX.read(XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }), { type: 'base64' });
        expect(back.SheetNames).toEqual(['Overview', 'Oct 2026', 'Nov 2026']);
    });
});

describe('sharing', () => {
    it('shares the PDF and the workbook under household file names', async () => {
        const r = report([october(), november()]);
        await expect(exportHouseholdPdf(r)).resolves.toBe('file:///cache/Folio-household-all-2026-10-01-to-2026-11-30.pdf');
        await expect(exportHouseholdExcel(r)).resolves.toBe('file:///cache/Folio-household-all-2026-10-01-to-2026-11-30.xlsx');
        expect(Sharing.shareAsync).toHaveBeenCalledTimes(2);
    });
});
