import { getCurrencySymbol } from '@/lib/utils/currency';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { reportFileStem, type ReportData } from './report-data';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Cell = XLSX.CellObject;

/** Excel serial for a YYYY-MM-DD date — computed in UTC so no timezone can shift the day. */
export function excelDateSerial(ymd: string): number {
    const [y, m, d] = ymd.split('-').map(Number);
    return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/**
 * Turn report data into a workbook. Money stays numeric (with a currency
 * number format) and dates are real date cells, so people can sort, filter
 * and sum in Excel / Sheets / Numbers.
 */
export function buildWorkbook(data: ReportData): XLSX.WorkBook {
    const sym = getCurrencySymbol(data.currency).replace(/"/g, '');
    const money = `"${sym}"#,##0.00;-"${sym}"#,##0.00`;
    const pct = '0.0%';
    const date = 'yyyy-mm-dd';

    const m = (v: number): Cell => ({ t: 'n', v, z: money });
    const d = (ymd: string): Cell => ({ t: 'n', v: excelDateSerial(ymd), z: date });
    const p = (fraction: number): Cell => ({ t: 'n', v: fraction, z: pct });
    const s = (v: string): Cell => ({ t: 's', v });
    // Header/label cell. (SheetJS CE does not write cell styles, so no bold.)
    const h = (v: string): Cell => ({ t: 's', v });

    const wb = XLSX.utils.book_new();
    wb.Props = { Title: `${data.title} — ${data.periodLabel}`, Author: data.ownerName || 'Folio', CreatedDate: new Date(data.generatedAt) };

    // ── Summary ────────────────────────────────────────────────
    const summary: Cell[][] = [
        [h(data.title)],
        [s('Period'), s(data.periodLabel)],
        [s('From'), d(data.start)],
        [s('To'), d(data.end)],
        [s('Currency'), s(data.currency)],
        [],
        [h('Figure'), h('Value')],
        [s('Income'), m(data.summary.income)],
        [s('Spending'), m(data.summary.expense)],
        [s('Net'), m(data.summary.net)],
        [s('Savings rate'), data.summary.savingsRate == null ? s('—') : p(data.summary.savingsRate / 100)],
        [s('Transactions'), { t: 'n', v: data.summary.transactionCount }],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summary);
    wsSummary['!cols'] = [{ wch: 16 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // ── Transactions ───────────────────────────────────────────
    if (data.transactions.length) {
        const header = ['Date', 'Type', 'Category', 'Account', 'Amount', 'Signed amount', 'Notes'].map(h);
        const rows: Cell[][] = data.transactions.map(t => [
            d(t.date),
            s(t.isTransfer ? 'Transfer' : t.type === 'income' ? 'Income' : 'Expense'),
            s(t.category),
            s(t.account),
            m(t.amount),
            m(t.type === 'income' ? t.amount : -t.amount),
            s(t.notes),
        ]);
        const first = 2;
        const last = rows.length + 1;
        // Live formulas (with cached values) so totals update if rows are edited.
        const totals: Cell[][] = [
            [],
            [h('Total income'), s(''), s(''), s(''), { t: 'n', v: data.summary.income, z: money, f: `SUMIF(B${first}:B${last},"Income",E${first}:E${last})` }],
            [h('Total spending'), s(''), s(''), s(''), { t: 'n', v: data.summary.expense, z: money, f: `SUMIF(B${first}:B${last},"Expense",E${first}:E${last})` }],
            [h('Net'), s(''), s(''), s(''), s(''), { t: 'n', v: data.summary.net, z: money, f: `SUMIF(B${first}:B${last},"Income",E${first}:E${last})-SUMIF(B${first}:B${last},"Expense",E${first}:E${last})` }],
        ];
        const ws = XLSX.utils.aoa_to_sheet([header, ...rows, ...totals]);
        ws['!cols'] = [{ wch: 12 }, { wch: 9 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 36 }];
        ws['!autofilter'] = { ref: `A1:G${last}` };
        XLSX.utils.book_append_sheet(wb, ws, 'Transactions');
    }

    // ── By category ────────────────────────────────────────────
    if (data.categories.length) {
        const ws = XLSX.utils.aoa_to_sheet([
            ['Category', 'Spent', 'Share'].map(h),
            ...data.categories.map(c => [s(c.name), m(c.total), p(c.percent / 100)]),
        ]);
        ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 9 }];
        XLSX.utils.book_append_sheet(wb, ws, 'By category');
    }

    // ── Monthly ────────────────────────────────────────────────
    if (data.monthly.length) {
        const ws = XLSX.utils.aoa_to_sheet([
            ['Month', 'Income', 'Spending', 'Net'].map(h),
            ...data.monthly.map(r => [s(`${r.month} ${r.year}`), m(r.income), m(r.expense), m(r.income - r.expense)]),
        ]);
        ws['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Monthly');
    }

    // ── Budgets ────────────────────────────────────────────────
    if (data.budgets.length) {
        const ws = XLSX.utils.aoa_to_sheet([
            ['Category', 'Resets', 'Limit', 'Spent', 'Remaining', 'Used'].map(h),
            ...data.budgets.map(b => [s(b.category), s(b.period), m(b.limit), m(b.spent), m(b.remaining), p(b.percentUsed / 100)]),
        ]);
        ws['!cols'] = [{ wch: 20 }, { wch: 9 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 8 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Budgets');
    }

    // ── Portfolio ──────────────────────────────────────────────
    if (data.holdings.length) {
        const n = (v: number): Cell => ({ t: 'n', v });
        const rows: Cell[][] = data.holdings.map(x => [
            s(x.name),
            s(x.symbol),
            s(x.type),
            n(x.quantity),
            m(x.avgCost),
            x.price == null ? s('—') : m(x.price),
            m(x.invested),
            m(x.value),
            m(x.unrealized),
            m(x.realized),
            m(x.dividends),
            m(x.totalReturn),
            x.totalReturnPct == null ? s('—') : p(x.totalReturnPct / 100),
        ]);
        const last = rows.length + 1;
        const sumCol = (col: string, v: number): Cell => ({ t: 'n', v, z: money, f: `SUM(${col}2:${col}${last})` });
        const total = (key: 'invested' | 'value' | 'unrealized' | 'realized' | 'dividends' | 'totalReturn') =>
            data.holdings.reduce((acc, x) => acc + x[key], 0);
        const ws = XLSX.utils.aoa_to_sheet([
            ['Holding', 'Symbol', 'Type', 'Quantity', 'Average cost', 'Price', 'Invested', 'Value', 'Unrealised', 'Realised', 'Dividends', 'Total return', 'Return'].map(h),
            ...rows,
            [],
            [h('Total'), s(''), s(''), s(''), s(''), s(''),
                sumCol('G', total('invested')), sumCol('H', total('value')), sumCol('I', total('unrealized')),
                sumCol('J', total('realized')), sumCol('K', total('dividends')), sumCol('L', total('totalReturn'))],
        ]);
        ws['!cols'] = [{ wch: 22 }, { wch: 9 }, { wch: 12 }, { wch: 11 }, { wch: 13 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 8 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Portfolio');
    }

    return wb;
}

/** Build the .xlsx, save it to the cache directory, and open the share sheet. Returns the file URI. */
export async function exportExcel(data: ReportData): Promise<string> {
    // Yield one macrotask so the caller's spinner can paint before the
    // synchronous workbook build blocks the JS thread.
    await new Promise(resolve => setTimeout(resolve, 0));
    const wb = buildWorkbook(data);
    // No zip compression: noticeably faster on device, and the file is small anyway.
    const base64: string = XLSX.write(wb, { type: 'base64', bookType: 'xlsx', compression: false });
    const uri = `${FileSystem.cacheDirectory}${reportFileStem(data)}.xlsx`;
    await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
            mimeType: XLSX_MIME,
            UTI: 'org.openxmlformats.spreadsheetml.sheet',
            dialogTitle: 'Share Excel report',
        });
    }
    return uri;
}
