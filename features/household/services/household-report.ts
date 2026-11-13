/**
 * Household budget as report data for the PDF and Excel exports: one entry
 * per month (or week / year, following the household's cycle), each with its
 * own income, spending, category split and expense list.
 */
import { computePeriodRange, formatPeriodRange } from '@/features/household/hooks/use-household';
import {
    getHouseholdConfig,
    getHouseholdExpenses,
    getHouseholdHistoryEntry,
    listHouseholdHistory,
    type HouseholdExpenseWithCategory,
    type HouseholdHistoryEntry,
} from '@/lib/db/queries';

export type HouseholdCycle = 'monthly' | 'weekly' | 'yearly';

export interface HouseholdReportExpense {
    date: string;
    category: string;
    notes: string;
    amount: number;
}

export interface HouseholdMonthReport {
    /** "Nov 1 – Nov 30, 2026" */
    label: string;
    period: HouseholdCycle;
    start: string;
    end: string;
    /** The period still running today (not yet in History). */
    isCurrent: boolean;
    income: number;
    spent: number;
    remaining: number;
    /** Share of income spent, rounded to one decimal (0 when there is no income). */
    percentUsed: number;
    /** Oldest first, as a statement reads. */
    expenses: HouseholdReportExpense[];
    /** Biggest first. */
    byCategory: { name: string; total: number; percent: number }[];
    /** False for periods closed before DB v12: only their totals were kept. */
    detailsKept: boolean;
}

export interface HouseholdReport {
    title: string;
    /** "This month", "All months", … */
    scopeLabel: string;
    currency: string;
    ownerName?: string;
    generatedAt: string;
    /** Oldest first. */
    months: HouseholdMonthReport[];
    totals: { income: number; spent: number; remaining: number; expenseCount: number };
}

const TRANSFER_PREFIX = 'transfer-out:';
const round2 = (n: number) => Math.round(n * 100) / 100;

/** How an expense row reads in a report. Transfers out show where the money went. */
export function describeExpense(e: Pick<HouseholdExpenseWithCategory, 'categoryName' | 'notes'>): { category: string; notes: string } {
    if (e.notes?.startsWith(TRANSFER_PREFIX)) {
        return { category: 'Transfer to account', notes: e.notes.slice(TRANSFER_PREFIX.length) };
    }
    return { category: e.categoryName ?? 'Uncategorised', notes: e.notes ?? '' };
}

/** One period's report. Pure: totals come from the given expenses when they were kept. */
export function buildMonthReport(opts: {
    period: HouseholdCycle;
    start: string;
    end: string;
    income: number;
    isCurrent: boolean;
    expenses: HouseholdExpenseWithCategory[];
    detailsKept?: boolean;
    /** Stored totals for periods whose expenses were not kept. */
    storedSpent?: number;
}): HouseholdMonthReport {
    const detailsKept = opts.detailsKept ?? true;
    const rows: HouseholdReportExpense[] = detailsKept
        ? [...opts.expenses]
            .sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1))
            .map(e => ({ date: e.date, amount: e.amount, ...describeExpense(e) }))
        : [];
    const spent = round2(detailsKept ? rows.reduce((sum, e) => sum + e.amount, 0) : opts.storedSpent ?? 0);

    const totals = new Map<string, number>();
    for (const e of rows) totals.set(e.category, (totals.get(e.category) ?? 0) + e.amount);
    const byCategory = [...totals.entries()]
        .map(([name, total]) => ({ name, total: round2(total), percent: spent > 0 ? (total / spent) * 100 : 0 }))
        .sort((a, b) => b.total - a.total);

    return {
        label: formatPeriodRange(opts.start, opts.end),
        period: opts.period,
        start: opts.start,
        end: opts.end,
        isCurrent: opts.isCurrent,
        income: opts.income,
        spent,
        remaining: round2(opts.income - spent),
        percentUsed: opts.income > 0 ? Math.round((spent / opts.income) * 1000) / 10 : 0,
        expenses: rows,
        byCategory,
        detailsKept,
    };
}

/** Wrap months (any order) into a report: sorted oldest first, with grand totals. */
export function buildHouseholdReport(
    months: HouseholdMonthReport[],
    meta: { scopeLabel: string; currency: string; ownerName?: string; now?: Date },
): HouseholdReport {
    const sorted = [...months].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    const income = round2(sorted.reduce((s, m) => s + m.income, 0));
    const spent = round2(sorted.reduce((s, m) => s + m.spent, 0));
    return {
        title: 'Household Budget',
        scopeLabel: meta.scopeLabel,
        currency: meta.currency,
        ownerName: meta.ownerName || undefined,
        generatedAt: (meta.now ?? new Date()).toISOString(),
        months: sorted,
        totals: {
            income,
            spent,
            remaining: round2(income - spent),
            expenseCount: sorted.reduce((s, m) => s + m.expenses.length, 0),
        },
    };
}

/** File name without extension: one period, or the span of all of them. */
export function householdFileStem(report: Pick<HouseholdReport, 'months'>): string {
    const { months } = report;
    if (months.length === 1) return `Folio-household-${months[0].start}-to-${months[0].end}`;
    const first = months[0]?.start ?? 'none';
    const last = months[months.length - 1]?.end ?? 'none';
    return `Folio-household-all-${first}-to-${last}`;
}

async function historyMonth(entry: HouseholdHistoryEntry): Promise<HouseholdMonthReport> {
    const expenses = entry.entries_kept ? await getHouseholdExpenses(entry.start_date, entry.end_date) : [];
    return buildMonthReport({
        period: entry.period,
        start: entry.start_date,
        end: entry.end_date,
        income: entry.income_amount,
        isCurrent: false,
        expenses,
        detailsKept: !!entry.entries_kept,
        storedSpent: entry.spent_amount,
    });
}

/** The period running now, or null before the household budget is set up. */
export async function loadCurrentMonth(): Promise<HouseholdMonthReport | null> {
    const config = await getHouseholdConfig();
    if (!config) return null;
    const range = computePeriodRange(config);
    const expenses = await getHouseholdExpenses(range.start, range.end);
    return buildMonthReport({
        period: config.period,
        start: range.start,
        end: range.end,
        income: config.income_amount,
        isCurrent: true,
        expenses,
    });
}

/** One past period from History, or null if it no longer exists. */
export async function loadHistoryMonth(id: number): Promise<HouseholdMonthReport | null> {
    const entry = await getHouseholdHistoryEntry(id);
    return entry ? historyMonth(entry) : null;
}

/**
 * Every period: the running one plus all of History, optionally only one
 * cycle type (the History screen's filter chip).
 */
export async function loadAllMonths(filter: HouseholdCycle | 'all' = 'all'): Promise<HouseholdMonthReport[]> {
    const [current, history] = await Promise.all([loadCurrentMonth(), listHouseholdHistory()]);
    const past = await Promise.all(history.filter(h => filter === 'all' || h.period === filter).map(historyMonth));
    const all = current && (filter === 'all' || current.period === filter) ? [...past, current] : past;
    return all;
}
