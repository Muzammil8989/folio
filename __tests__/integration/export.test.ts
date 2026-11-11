jest.unmock('@/lib/db/db-client');

jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(async () => ({ uri: 'file:///tmp/print-123.pdf' })) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
  writeAsStringAsync: jest.fn(async () => {}),
  deleteAsync: jest.fn(async () => {}),
  moveAsync: jest.fn(async () => {}),
}));

import { buildWorkbook, excelDateSerial, exportExcel, XLSX_MIME } from '@/features/export/services/excel-export';
import { buildReportHtml, escapeHtml, exportPdf } from '@/features/export/services/pdf-export';
import { buildReportData, reportFileStem } from '@/features/export/services/report-data';
import * as q from '@/lib/db/queries';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';

let db: TestDb;
let accountId: number;
let incomeCat: number;
let expenseCat: number;

beforeEach(async () => {
  jest.clearAllMocks();
  db = await createTestDb();
  accountId = (await q.getAccounts())[0].id;
  incomeCat = (await q.getCategories('income'))[0].id;
  expenseCat = (await q.getCategories('expense'))[0].id;
});
afterEach(() => db.close());

const add = (type: 'income' | 'expense', amount: number, date: string, notes?: string) =>
  q.createTransaction({ amount, type, date, notes, account_id: accountId, category_id: type === 'income' ? incomeCat : expenseCat } as any);

const NOW = new Date(2026, 3, 20); // 20 Apr 2026

const build = (start: string, end: string, extra: Partial<Parameters<typeof buildReportData>[0]> = {}) =>
  buildReportData({ start, end, periodLabel: 'Test', currency: 'USD', ownerName: 'Ada', now: NOW, ...extra });

describe('buildReportData', () => {
  it('totals only the transactions inside the range', async () => {
    await add('income', 1000, '2026-04-01');
    await add('expense', 250.5, '2026-04-10');
    await add('expense', 99, '2026-03-31'); // outside

    const data = await build('2026-04-01', '2026-04-30');
    expect(data.summary).toEqual({ income: 1000, expense: 250.5, net: 749.5, savingsRate: 75, transactionCount: 2 });
    expect(data.transactions.map(t => t.amount)).toEqual([250.5, 1000]); // newest first
    expect(data.categories).toHaveLength(1);
    expect(data.categories[0].percent).toBe(100);
  });

  it('has no savings rate when nothing came in', async () => {
    await add('expense', 40, '2026-04-02');
    const data = await build('2026-04-01', '2026-04-30');
    expect(data.summary.savingsRate).toBeNull();
  });

  it('covers every month from the range start up to today for a range that runs into the future', async () => {
    await add('income', 10, '2026-01-15');
    const data = await build('2026-01-01', '2026-12-31');
    expect(data.monthly.map(m => m.month)).toEqual(['Jan', 'Feb', 'Mar', 'Apr']);
    expect(data.monthly[0].income).toBe(10);
  });

  it('covers exactly the months of a range in the past', async () => {
    const data = await build('2025-11-01', '2026-01-31');
    expect(data.monthly.map(m => `${m.month} ${m.year}`)).toEqual(['Nov 2025', 'Dec 2025', 'Jan 2026']);
  });

  it('leaves out sections that were switched off', async () => {
    await add('expense', 5, '2026-04-02');
    const data = await build('2026-04-01', '2026-04-30', { sections: { transactions: false, categories: false, budgets: false, investments: false } });
    expect(data.transactions).toEqual([]);
    expect(data.categories).toEqual([]);
    expect(data.budgets).toEqual([]);
    // Totals still describe the whole period.
    expect(data.summary.expense).toBe(5);
  });

  it('includes budgets with their current spend', async () => {
    await q.createBudget({ category_id: expenseCat, amount: 300, period: 'monthly', is_active: 1, alert_threshold: 80 } as any);
    const data = await build('2026-04-01', '2026-04-30');
    expect(data.budgets).toHaveLength(1);
    expect(data.budgets[0]).toMatchObject({ limit: 300, period: 'monthly' });
  });
});

describe('Excel workbook', () => {
  it('round-trips with numeric money, real dates and live total formulas', async () => {
    await add('income', 1000, '2026-04-01', 'Salary');
    await add('expense', 250.5, '2026-04-10', 'Rent');
    const data = await build('2026-04-01', '2026-04-30');

    const wb = XLSX.read(XLSX.write(buildWorkbook(data), { type: 'base64', bookType: 'xlsx' }), { type: 'base64', cellFormula: true });
    expect(wb.SheetNames).toEqual(['Summary', 'Transactions', 'By category', 'Monthly']);

    const tx = wb.Sheets.Transactions;
    expect(['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1'].map(a => tx[a].v)).toEqual(
      ['Date', 'Type', 'Category', 'Account', 'Amount', 'Signed amount', 'Notes'],
    );
    // Row 2 is the newest (the expense)
    expect(tx.A2).toMatchObject({ t: 'n', v: excelDateSerial('2026-04-10') });
    expect(tx.E2).toMatchObject({ t: 'n', v: 250.5 });
    expect(tx.F2.v).toBe(-250.5);
    expect(tx.G2.v).toBe('Rent');
    // Totals keep their formulas so edits recalculate
    const totalIncome = tx.E5;
    expect(totalIncome.f).toBe('SUMIF(B2:B3,"Income",E2:E3)');
    expect(totalIncome.v).toBe(1000);

    const summary = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Summary, { header: 1 });
    expect(summary).toContainEqual(['Net', 749.5]);
  });

  it('computes Excel date serials without timezone drift', () => {
    expect(excelDateSerial('1900-03-01')).toBe(61);
    expect(excelDateSerial('2026-04-20')).toBe(46132);
  });

  it('writes the file to the cache and shares it as xlsx', async () => {
    await add('expense', 12, '2026-04-02');
    const data = await build('2026-04-01', '2026-04-30');
    const uri = await exportExcel(data);
    expect(uri).toBe(`file:///cache/${reportFileStem(data)}.xlsx`);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(uri, expect.any(String), { encoding: 'base64' });
    expect(Sharing.shareAsync).toHaveBeenCalledWith(uri, expect.objectContaining({ mimeType: XLSX_MIME }));
  });
});

describe('PDF report', () => {
  it('escapes user text so notes cannot inject markup', async () => {
    await add('expense', 20, '2026-04-03', '<img src=x onerror=alert(1)> & co');
    const html = buildReportHtml(await build('2026-04-01', '2026-04-30'), 'month');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; co');
  });

  it('shows the key figures and a written summary', async () => {
    await add('income', 1000, '2026-04-01');
    await add('expense', 300, '2026-04-05');
    const html = buildReportHtml(await build('2026-04-01', '2026-04-30'), 'month');
    expect(html).toContain('$1,000.00');
    expect(html).toContain('$300.00');
    expect(html).toContain('70%'); // savings rate
    expect(html).toContain('You spent $300.00 this month — 70% less than came in.');
    expect(html).toContain('Prepared for Ada');
  });

  it('renders to a named file and opens the share sheet', async () => {
    await add('expense', 12, '2026-04-02');
    const data = await build('2026-04-01', '2026-04-30');
    const uri = await exportPdf(data, 'month');
    expect(Print.printToFileAsync).toHaveBeenCalledWith({ html: expect.stringContaining('<!doctype html>') });
    expect(FileSystem.moveAsync).toHaveBeenCalledWith({ from: 'file:///tmp/print-123.pdf', to: uri });
    expect(Sharing.shareAsync).toHaveBeenCalledWith(uri, expect.objectContaining({ mimeType: 'application/pdf' }));
  });

  it('escapeHtml covers all five special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});
