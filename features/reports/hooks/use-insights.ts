import { isDbReady } from '@/lib/db/db-client';
import {
    getCategoryTotals,
    getDailySpending,
    getMonthlyTotals,
    getNetWorthParts,
    getSummaryByDateRange,
    getTopExpenses,
    type CategoryExpense,
    type DailySpend,
    type MonthlyTotals,
    type NetWorthParts,
    type ReportFilters,
    type TopExpense,
} from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { parseLocalDate } from '@/lib/utils/date';
import { useRefreshSignal, type RefreshDomain } from '@/providers/modal-context';
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

    const [summary, prevSummary, expenseCategories, incomeCategories, prevExpenseCategories, monthly, daily, top, netWorth] =
        await Promise.all([
            getSummaryByDateRange(range.start, range.end, filters),
            getSummaryByDateRange(prev.start, prev.end, filters),
            getCategoryTotals('expense', range.start, range.end, filters),
            getCategoryTotals('income', range.start, range.end, filters),
            getCategoryTotals('expense', prev.start, prev.end, filters),
            getMonthlyTotals(monthsToShow, parseLocalDate(range.end), filters),
            range.days <= DAILY_MAX_DAYS ? getDailySpending(range.start, range.end, now, filters) : Promise.resolve([]),
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
        top,
        netWorth,
    };
}

/** Everything Insights reads; budgets and household don't affect it. */
const REFRESH_DOMAINS: readonly RefreshDomain[] = ['transactions', 'accounts', 'savings', 'loans', 'categories', 'investments'];

/** Quick taps through the period tabs settle into one load. */
const FILTER_DEBOUNCE_MS = 150;

export function useInsights(filters: InsightsFilters) {
    const [data, setData] = useState<InsightsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<unknown>(null);
    const refreshSignal = useRefreshSignal(REFRESH_DOMAINS);
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
        if (!isDbReady()) {
            // Nothing to load right now (e.g. mid-restore). Don't leave the
            // screen marked as loading; the next refresh signal reloads it.
            if (mountedRef.current) setLoading(false);
            return;
        }
        const id = ++requestRef.current;
        setLoading(true);
        try {
            const next = await loadInsights(stable);
            if (mountedRef.current && id === requestRef.current) {
                setData(next);
                setError(null);
            }
        } catch (e) {
            logger.error('Failed to load insights', e);
            if (mountedRef.current && id === requestRef.current) setError(e);
        } finally {
            if (mountedRef.current && id === requestRef.current) setLoading(false);
        }
    }, [stable]);

    // First load and filter changes. After the first load, wait a moment so a
    // run of quick filter taps loads once; mark loading straight away so the
    // screen can show the old figures as stale in the meantime.
    const firstLoadRef = useRef(true);
    useEffect(() => {
        const delay = firstLoadRef.current ? 0 : FILTER_DEBOUNCE_MS;
        if (!firstLoadRef.current) setLoading(true);
        firstLoadRef.current = false;
        let task: { cancel: () => void } | null = null;
        const timer = setTimeout(() => {
            task = InteractionManager.runAfterInteractions(() => refresh());
        }, delay);
        return () => {
            clearTimeout(timer);
            task?.cancel();
        };
    }, [refresh]);

    // Data changed elsewhere in the app: reload straight away — unless the
    // filters changed in the same commit, when the load above covers it.
    const lastSignalRef = useRef(refreshSignal);
    const lastRefreshRef = useRef(refresh);
    useEffect(() => {
        const filtersChanged = lastRefreshRef.current !== refresh;
        lastRefreshRef.current = refresh;
        if (lastSignalRef.current === refreshSignal) return;
        lastSignalRef.current = refreshSignal;
        if (filtersChanged) return;
        const task = InteractionManager.runAfterInteractions(() => refresh());
        return () => task.cancel();
    }, [refresh, refreshSignal]);

    return { data, loading, error, refresh };
}
