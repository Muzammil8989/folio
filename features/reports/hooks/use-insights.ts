import { isDbReady } from '@/lib/db/db-client';
import {
    getCategoryTotals,
    getDailySpending,
    getMonthlyTotals,
    getNetWorthParts,
    getSpendByWeekday,
    getSummaryByDateRange,
    getTopExpenses,
    type CategoryExpense,
    type DailySpend,
    type MonthlyTotals,
    type NetWorthParts,
    type ReportFilters,
    type TopExpense,
    type WeekdaySpend,
} from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { parseLocalDate } from '@/lib/utils/date';
import { useRefreshSignal } from '@/providers/modal-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { previousRange, resolveRange, type InsightsPeriod, type InsightsRange } from '../utils';

export interface InsightsFilters {
    period: InsightsPeriod;
    /** Only used when period is 'custom'. */
    custom: { start: string; end: string } | null;
    accountId: number | null;
    categoryId: number | null;
}

export const DEFAULT_FILTERS: InsightsFilters = { period: 'month', custom: null, accountId: null, categoryId: null };

export interface InsightsData {
    range: InsightsRange;
    prev: { start: string; end: string };
    income: number;
    expense: number;
    prevIncome: number;
    prevExpense: number;
    expenseCategories: CategoryExpense[];
    incomeCategories: CategoryExpense[];
    prevExpenseCategories: CategoryExpense[];
    /** Month by month, at least six months for context, ending with the range's last month. */
    monthly: MonthlyTotals[];
    /** Per day; only for ranges of two months or less. */
    daily: DailySpend[];
    weekdays: WeekdaySpend[];
    top: TopExpense[];
    netWorth: NetWorthParts;
}

/** Ranges up to this many days get a day-by-day chart. */
export const DAILY_MAX_DAYS = 62;
const MAX_MONTHS = 24;

function totalsOf(rows: { type: string; total: string | number | null }[]) {
    let income = 0, expense = 0;
    for (const r of rows) {
        if (r.type === 'income') income = Number(r.total) || 0;
        else expense = Number(r.total) || 0;
    }
    return { income, expense };
}

/** Load every figure and chart on Insights for the chosen filters. */
export async function loadInsights(f: InsightsFilters, now: Date = new Date()): Promise<InsightsData> {
    const range = resolveRange(f.period, f.custom, now);
    const prev = previousRange(f.period, range);
    const filters: ReportFilters = { accountId: f.accountId, categoryId: f.categoryId };
    const monthsToShow = Math.min(MAX_MONTHS, f.period === 'year' ? range.months : Math.max(range.months, 6));

    const [summary, prevSummary, expenseCategories, incomeCategories, prevExpenseCategories, monthly, daily, weekdays, top, netWorth] =
        await Promise.all([
            getSummaryByDateRange(range.start, range.end, filters),
            getSummaryByDateRange(prev.start, prev.end, filters),
            getCategoryTotals('expense', range.start, range.end, filters),
            getCategoryTotals('income', range.start, range.end, filters),
            getCategoryTotals('expense', prev.start, prev.end, filters),
            getMonthlyTotals(monthsToShow, parseLocalDate(range.end), filters),
            range.days <= DAILY_MAX_DAYS ? getDailySpending(range.start, range.end, now, filters) : Promise.resolve([]),
            getSpendByWeekday(range.start, range.end, filters, now),
            getTopExpenses(range.start, range.end, filters, 5),
            getNetWorthParts(),
        ]);

    const cur = totalsOf(summary);
    const before = totalsOf(prevSummary);
    return {
        range,
        prev,
        income: cur.income,
        expense: cur.expense,
        prevIncome: before.income,
        prevExpense: before.expense,
        expenseCategories,
        incomeCategories,
        prevExpenseCategories,
        monthly,
        daily,
        weekdays,
        top,
        netWorth,
    };
}

export function useInsights(filters: InsightsFilters) {
    const [data, setData] = useState<InsightsData | null>(null);
    const [loading, setLoading] = useState(true);
    const refreshSignal = useRefreshSignal();
    const mountedRef = useRef(true);
    // Only the latest request may update state, so quick filter changes can't
    // be overwritten by a slower, older load.
    const requestRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const { period, custom, accountId, categoryId } = filters;
    const stable = useMemo(
        () => ({ period, custom, accountId, categoryId }),
        // custom is compared by value
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [period, custom?.start, custom?.end, accountId, categoryId],
    );

    const refresh = useCallback(async () => {
        if (!isDbReady()) return;
        const id = ++requestRef.current;
        setLoading(true);
        try {
            const next = await loadInsights(stable);
            if (mountedRef.current && id === requestRef.current) setData(next);
        } catch (e) {
            logger.error('Failed to load insights', e);
        } finally {
            if (mountedRef.current && id === requestRef.current) setLoading(false);
        }
    }, [stable]);

    useEffect(() => {
        const task = InteractionManager.runAfterInteractions(() => refresh());
        return () => task.cancel();
    }, [refresh, refreshSignal]);

    return { data, loading, refresh };
}
