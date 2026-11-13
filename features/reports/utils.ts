import type { PeriodKey } from '@/components/common/period-selector';
import tokens from '@/theme/tokens';
import { useContentWidth } from '@/hooks/use-content-width';

/** Chart width for the content column (updates on rotation / resize). */
export function useChartWidth(): number {
    return useContentWidth() - 32;
}

/** Editorial categorical palette (see theme/tokens.js). */
export const DEFAULT_COLORS: string[] = tokens.chartCategorical;

export type PeriodFilter = PeriodKey;

export const PERIOD_OPTIONS: { key: PeriodFilter; label: string }[] = [
    { key: 'month',   label: 'This Month' },
    { key: '3months', label: 'Last 3 Months' },
    { key: '6months', label: 'Last 6 Months' },
    { key: 'year',    label: 'This Year' },
];

export function getDateRange(period: PeriodFilter, now: Date = new Date()): { start: string; end: string; months: number } {
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (period === 'month') {
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { start: fmt(first), end: fmt(last), months: 1 };
    }
    if (period === '3months') {
        const first = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { start: fmt(first), end: fmt(last), months: 3 };
    }
    if (period === '6months') {
        const first = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        const last  = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { start: fmt(first), end: fmt(last), months: 6 };
    }
    const first = new Date(now.getFullYear(), 0, 1);
    const last  = new Date(now.getFullYear(), 11, 31);
    return { start: fmt(first), end: fmt(last), months: 12 };
}

export interface DonutSlice {
    key: string;
    label: string;
    value: number;
    color: string;
    percent: number;
}

export const OTHER_COLOR = '#B3AA9C';

/**
 * Slices for the category donut AND its legend, so both show the same
 * categories: at most `maxSlices` slices, the last being "Other" for the rest.
 * Percentages are of the full total, which equals the sum of the slices.
 */
export function buildDonutSlices(
    data: { categoryId: number; categoryName: string; categoryColor: string | null; total: number }[],
    maxSlices = 5,
): { slices: DonutSlice[]; total: number } {
    const total = data.reduce((s, c) => s + c.total, 0);
    const sorted = [...data].sort((a, b) => b.total - a.total);
    const top = sorted.length > maxSlices ? sorted.slice(0, maxSlices - 1) : sorted;
    const rest = sorted.slice(top.length);

    const slices: DonutSlice[] = top.map((c, i) => ({
        key: String(c.categoryId),
        label: c.categoryName,
        value: c.total,
        color: c.categoryColor || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        percent: 0,
    }));
    if (rest.length) {
        slices.push({ key: 'other', label: 'Other', value: rest.reduce((s, c) => s + c.total, 0), color: OTHER_COLOR, percent: 0 });
    }
    for (const slice of slices) slice.percent = total > 0 ? Math.round((slice.value / total) * 100) : 0;
    return { slices, total };
}

export const PERIOD_PHRASE: Record<PeriodFilter, string> = {
    month: 'this month',
    '3months': 'over the last 3 months',
    '6months': 'over the last 6 months',
    year: 'this year',
};

/**
 * One plain-English paragraph that leads the Insights page, e.g.
 * "You spent $2,910.00 this month — 31% less than came in. Groceries took
 *  the largest share at 28%."
 */
export function buildStandfirst(opts: {
    period: PeriodFilter | 'custom';
    income: number;
    expense: number;
    topCategory?: { name: string; percent: number } | null;
    format: (n: number) => string;
}): string {
    const { period, income, expense, topCategory, format } = opts;
    const when = period === 'custom' ? 'in these dates' : PERIOD_PHRASE[period];
    if (income === 0 && expense === 0) return `Nothing recorded ${when} yet.`;

    let lead: string;
    if (income === 0) {
        lead = `You spent ${format(expense)} ${when}, with no income recorded.`;
    } else if (expense === 0) {
        lead = `${format(income)} came in ${when} and nothing went out.`;
    } else if (expense <= income) {
        const pct = Math.round(((income - expense) / income) * 100);
        lead = pct === 0
            ? `You spent ${format(expense)} ${when} — exactly what came in.`
            : `You spent ${format(expense)} ${when} — ${pct}% less than came in.`;
    } else {
        lead = `You spent ${format(expense)} ${when} — ${format(expense - income)} more than came in.`;
    }

    const tail = topCategory && topCategory.percent > 0
        ? ` ${topCategory.name} took the largest share at ${topCategory.percent}%.`
        : '';
    return lead + tail;
}

// ── Insights: ranges, comparisons and plain-English lines ────────────────────

/** A preset period, or a custom date range chosen in the filter sheet. */
export type InsightsPeriod = PeriodFilter | 'custom';

export interface InsightsRange {
    /** First day, YYYY-MM-DD. */
    start: string;
    /** Last day, capped at today: future-dated entries are left out everywhere. */
    end: string;
    /** Calendar months the period spans (for the month-by-month charts). */
    months: number;
    /** Days from start to end, inclusive. */
    days: number;
}

const DAY_MS = 86_400_000;

function daysBetween(start: string, end: string): number {
    const [sy, sm, sd] = start.split('-').map(Number);
    const [ey, em, ed] = end.split('-').map(Number);
    return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / DAY_MS) + 1;
}

function isoDay(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The dates a period covers, ending today at the latest. */
export function resolveRange(
    period: InsightsPeriod,
    custom: { start: string; end: string } | null,
    now: Date = new Date(),
): InsightsRange {
    const today = isoDay(now);
    let start: string;
    let end: string;
    if (period === 'custom' && custom) {
        start = custom.start <= custom.end ? custom.start : custom.end;
        end = custom.start <= custom.end ? custom.end : custom.start;
    } else {
        const r = getDateRange(period === 'custom' ? 'month' : period, now);
        start = r.start;
        end = r.end;
    }
    if (end > today) end = today;
    if (start > end) start = end;
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    return { start, end, months: (ey - sy) * 12 + (em - sm) + 1, days: daysBetween(start, end) };
}

/** Months a preset period moves back by to find "the same days" before it. */
const PRESET_SHIFT: Record<PeriodFilter, number> = { month: 1, '3months': 3, '6months': 6, year: 12 };

/**
 * The period to compare against. Presets compare with the same days one
 * period earlier (1–11 Nov → 1–11 Oct), custom ranges with the equally long
 * stretch just before them.
 */
export function previousRange(period: InsightsPeriod, range: InsightsRange): { start: string; end: string } {
    const [sy, sm, sd] = range.start.split('-').map(Number);
    const [ey, em, ed] = range.end.split('-').map(Number);
    if (period !== 'custom') {
        const shift = PRESET_SHIFT[period];
        const shiftBack = (y: number, m: number, d: number) => {
            const target = new Date(y, m - 1 - shift, 1);
            const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
            return isoDay(new Date(target.getFullYear(), target.getMonth(), Math.min(d, last)));
        };
        return { start: shiftBack(sy, sm, sd), end: shiftBack(ey, em, ed) };
    }
    const prevEnd = new Date(sy, sm - 1, sd - 1);
    const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() - (range.days - 1));
    return { start: isoDay(prevStart), end: isoDay(prevEnd) };
}

/** Percentage change from `prev` to `cur`; null when there's nothing to compare with. */
export function pctChange(cur: number, prev: number): number | null {
    if (!(prev > 0)) return null;
    return ((cur - prev) / prev) * 100;
}

export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface InsightLine {
    key: string;
    icon: 'speedometer-outline' | 'flame-outline' | 'swap-vertical-outline' | 'pie-chart-outline' | 'bar-chart-outline';
    text: string;
    /** good / bad colour the icon; neutral leaves it muted. */
    tone: 'good' | 'bad' | 'neutral';
}

interface CategoryTotal { categoryId: number; categoryName: string; total: number }

/**
 * Up to four short observations that the rest of the Insights page doesn't
 * already show (the key-figure tiles carry the change vs before, the weekday
 * chart carries the busiest day):
 *
 *   category-move   the category whose spending moved most vs before
 *   projection      where this month's spending is heading
 *   concentration   how much of spending the top three categories take
 *   overspent       months where spending beat income (multi-month periods)
 *   daily-average   fallback for a quiet period
 */
export function buildInsights(opts: {
    period: InsightsPeriod;
    range: InsightsRange;
    expense: number;
    prevExpense: number;
    categories: CategoryTotal[];
    prevCategories: CategoryTotal[];
    /** Month-by-month totals, oldest first, ending with the range's last month. */
    monthly?: { income: number; expense: number }[];
    format: (n: number) => string;
    now?: Date;
}): InsightLine[] {
    const { period, range, expense, prevExpense, categories, prevCategories, monthly = [], format } = opts;
    const now = opts.now ?? new Date();
    const out: InsightLine[] = [];
    const vs = period === 'custom' ? 'the period before' : period === 'month' ? 'the same days last month' : 'the same stretch before';

    // 1. The category that changed most (in money), if the move is meaningful.
    if (prevCategories.length) {
        const prev = new Map(prevCategories.map(c => [c.categoryId, c.total]));
        let best: { name: string; diff: number; pct: number | null } | null = null;
        for (const c of categories) {
            const before = prev.get(c.categoryId) ?? 0;
            const diff = c.total - before;
            if (!best || Math.abs(diff) > Math.abs(best.diff)) best = { name: c.categoryName, diff, pct: pctChange(c.total, before) };
        }
        for (const c of prevCategories) {
            if (categories.some(x => x.categoryId === c.categoryId)) continue;
            if (!best || c.total > Math.abs(best.diff)) best = { name: c.categoryName, diff: -c.total, pct: -100 };
        }
        const scale = Math.max(expense, prevExpense);
        if (best && scale > 0 && Math.abs(best.diff) >= scale * 0.05) {
            const amount = `${best.diff > 0 ? '+' : '−'}${format(Math.abs(best.diff))}`;
            const text = best.pct == null
                ? `${best.name} is new compared with ${vs} (${amount}) and is the biggest change of any category.`
                : best.pct === -100
                    ? `Nothing spent on ${best.name}, against ${format(-best.diff)} in ${vs} — the biggest change of any category.`
                    : `${best.name} is ${best.diff > 0 ? 'up' : 'down'} ${Math.round(Math.abs(best.pct))}% on ${vs} (${amount}), the biggest change of any category.`;
            out.push({ key: 'category-move', icon: 'swap-vertical-outline', text, tone: best.diff > 0 ? 'bad' : 'good' });
        }
    }

    // 2. Month-end projection (this month only, once a few days have passed).
    if (period === 'month' && range.start.slice(0, 7) === isoDay(now).slice(0, 7)) {
        const elapsed = now.getDate();
        const inMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        if (elapsed >= 3 && elapsed < inMonth && expense > 0) {
            out.push({
                key: 'projection',
                icon: 'speedometer-outline',
                text: `On current pace, spending will reach about ${format((expense / elapsed) * inMonth)} by month end — ${format(expense / elapsed)} a day for the remaining ${inMonth - elapsed} days.`,
                tone: 'neutral',
            });
        }
    }

    // 3. Concentration: how much of spending the top three categories take.
    if (categories.length >= 4 && expense > 0) {
        const top3 = [...categories].sort((a, b) => b.total - a.total).slice(0, 3);
        const share = Math.round((top3.reduce((s, c) => s + c.total, 0) / expense) * 100);
        if (share >= 60) {
            out.push({
                key: 'concentration',
                icon: 'pie-chart-outline',
                text: `${share}% of spending went to three categories: ${top3[0].categoryName}, ${top3[1].categoryName} and ${top3[2].categoryName} — the first place to look for savings.`,
                tone: 'neutral',
            });
        }
    }

    // 4. Months where spending beat income, over the months of a longer period.
    const months = range.months >= 3 ? monthly.slice(-range.months).filter(m => m.income > 0 || m.expense > 0) : [];
    if (months.length >= 3) {
        const over = months.filter(m => m.expense > m.income).length;
        out.push({
            key: 'overspent',
            icon: 'bar-chart-outline',
            text: over === 0
                ? `You spent less than you earned in all ${months.length} months.`
                : `Spending was higher than income in ${over} of ${months.length} months.`,
            tone: over === 0 ? 'good' : 'bad',
        });
    }

    // Fallback so a quiet period still says something useful. Not for "this
    // month": the daily spending card already states the daily average.
    if (out.length < 2 && expense > 0 && range.days > 1 && period !== 'month') {
        out.push({
            key: 'daily-average',
            icon: 'flame-outline',
            text: `You spent ${format(expense / range.days)} a day on average.`,
            tone: 'neutral',
        });
    }
    return out.slice(0, 4);
}
