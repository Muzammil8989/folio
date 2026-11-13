import { excelDateSerial, moneyFormat, writeAndShareXlsx } from '@/features/export/services/excel-export';
import * as XLSX from 'xlsx';
import { householdFileStem, type HouseholdMonthReport, type HouseholdReport } from './household-report';

type Cell = XLSX.CellObject;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CYCLE: Record<HouseholdMonthReport['period'], string> = { monthly: 'Monthly', weekly: 'Weekly', yearly: 'Yearly' };

const lastDayOf = (y: number, m: number) => new Date(y, m, 0).getDate();

const statusOf = (m: HouseholdMonthReport) =>
    `${m.isCurrent ? 'Current' : 'Closed'}${m.remaining < 0 ? ' · over budget' : ''}`;

/**
 * A short tab name for a period: "Nov 2026" for a calendar month, "2026" for
 * a calendar year, otherwise its span ("Jun 18–Jul 17 26").
 */
export function periodSheetName(m: Pick<HouseholdMonthReport, 'period' | 'start' | 'end'>): string {
    const [sy, sm, sd] = m.start.split('-').map(Number);
    const [ey, em, ed] = m.end.split('-').map(Number);
    if (m.period === 'monthly' && sd === 1 && sy === ey && sm === em && ed === lastDayOf(ey, em)) {
        return `${MONTHS[sm - 1]} ${sy}`;
    }
    if (m.period === 'yearly' && sm === 1 && sd === 1 && em === 12 && ed === 31 && sy === ey) {
        return String(sy);
    }
    return `${MONTHS[sm - 1]} ${sd}–${MONTHS[em - 1]} ${ed} ${String(ey).slice(2)}`;
}

/** Excel tab names: at most 31 characters, none of \ / ? * [ ] :, unique (case-insensitive). */
export function uniqueSheetName(name: string, taken: Set<string>): string {
    const base = name.replace(/[\\/?*[\]:]/g, '-').slice(0, 31).trim() || 'Sheet';
    let candidate = base;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
        const suffix = ` (${n})`;
        candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    }
    taken.add(candidate.toLowerCase());
    return candidate;
}

/**
 * The household report as a workbook: an Overview tab (when there is more
 * than one period) and one tab per period. Money stays numeric with a currency
 * format, dates are real date cells, and totals are live formulas.
 */
export function buildHouseholdWorkbook(report: HouseholdReport): XLSX.WorkBook {
    const money = moneyFormat(report.currency);
    const m = (v: number, f?: string): Cell => ({ t: 'n', v, z: money, ...(f ? { f } : {}) });
    const d = (ymd: string): Cell => ({ t: 'n', v: excelDateSerial(ymd), z: 'yyyy-mm-dd' });
    const p = (fraction: number, f?: string): Cell => ({ t: 'n', v: fraction, z: '0.0%', ...(f ? { f } : {}) });
    const n = (v: number, f?: string): Cell => ({ t: 'n', v, ...(f ? { f } : {}) });
    const s = (v: string): Cell => ({ t: 's', v });

    const wb = XLSX.utils.book_new();
    wb.Props = {
        Title: `${report.title} — ${report.scopeLabel}`,
        Author: report.ownerName || 'Folio',
        CreatedDate: new Date(report.generatedAt),
    };
    const taken = new Set<string>();
    const names = report.months.map(month => uniqueSheetName(periodSheetName(month), taken));

    // ── Overview ───────────────────────────────────────────────
    if (report.months.length > 1) {
        const header = ['Period', 'From', 'To', 'Status', 'Income', 'Spent', 'Left', 'Used', 'Items'].map(s);
        const rows: Cell[][] = report.months.map((month, i) => [
            s(names[i]),
            d(month.start),
            d(month.end),
            s(statusOf(month)),
            m(month.income),
            m(month.spent),
            m(month.remaining, `E${i + 2}-F${i + 2}`),
            p(month.income > 0 ? month.spent / month.income : 0, `IF(E${i + 2}>0,F${i + 2}/E${i + 2},0)`),
            month.detailsKept ? n(month.expenses.length) : s('—'),
        ]);
        const first = 2;
        const last = rows.length + 1;
        const t = report.totals;
        const totalRow = last + 2;
        const ws = XLSX.utils.aoa_to_sheet([
            header,
            ...rows,
            [],
            [
                s('Total'), s(''), s(''), s(''),
                m(t.income, `SUM(E${first}:E${last})`),
                m(t.spent, `SUM(F${first}:F${last})`),
                m(t.remaining, `E${totalRow}-F${totalRow}`),
                p(t.income > 0 ? t.spent / t.income : 0, `IF(E${totalRow}>0,F${totalRow}/E${totalRow},0)`),
                n(t.expenseCount, `SUM(I${first}:I${last})`),
            ],
        ]);
        ws['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 7 }];
        ws['!autofilter'] = { ref: `A1:I${last}` };
        XLSX.utils.book_append_sheet(wb, ws, uniqueSheetName('Overview', taken));
    }

    // ── One tab per period ─────────────────────────────────────
    report.months.forEach((month, i) => {
        const expenseHeaderRow = 12;
        const firstExp = expenseHeaderRow + 1;
        const lastExp = expenseHeaderRow + month.expenses.length;
        const hasRows = month.detailsKept && month.expenses.length > 0;
        const spentCell = hasRows ? m(month.spent, `SUM(D${firstExp}:D${lastExp})`) : m(month.spent);

        const aoa: Cell[][] = [
            [s(`${report.title} — ${month.label}`)],
            [s('Cycle'), s(CYCLE[month.period])],
            [s('From'), d(month.start)],
            [s('To'), d(month.end)],
            [s('Status'), s(statusOf(month))],
            [s('Income'), m(month.income)],
            [s('Spent'), spentCell],
            [s('Left'), m(month.remaining, 'B6-B7')],
            [s('Used'), p(month.income > 0 ? month.spent / month.income : 0, 'IF(B6>0,B7/B6,0)')],
            [s('Expenses'), month.detailsKept ? n(month.expenses.length) : s('Not kept for this period')],
            [],
            ['Date', 'Category', 'Notes', 'Amount'].map(s),
            ...month.expenses.map(e => [d(e.date), s(e.category), s(e.notes), m(e.amount)]),
        ];
        if (hasRows) {
            aoa.push([s('Total spent'), s(''), s(''), m(month.spent, `SUM(D${firstExp}:D${lastExp})`)]);
        } else {
            aoa.push([s(month.detailsKept ? 'Nothing was logged in this period.' : "Individual expenses weren't kept for this period.")]);
        }
        if (month.byCategory.length) {
            aoa.push([], ['By category', 'Spent', 'Share'].map(s));
            for (const c of month.byCategory) aoa.push([s(c.name), m(c.total), p(c.percent / 100)]);
        }

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 34 }, { wch: 14 }];
        if (hasRows) ws['!autofilter'] = { ref: `A${expenseHeaderRow}:D${lastExp}` };
        XLSX.utils.book_append_sheet(wb, ws, names[i]);
    });

    if (!wb.SheetNames.length) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[s('No household periods to export.')]]), 'Household');
    }
    return wb;
}

/** Build the household workbook, save it, and open the share sheet. Returns the file URI. */
export async function exportHouseholdExcel(report: HouseholdReport): Promise<string> {
    // Let the caller's spinner paint before the synchronous build blocks the JS thread.
    await new Promise(resolve => setTimeout(resolve, 0));
    return writeAndShareXlsx(buildHouseholdWorkbook(report), householdFileStem(report), 'Share household workbook');
}
