/**
 * Insights — a short written report for the chosen period and filters:
 *
 *   header        date range, title, Filter, Export (PDF / Excel)
 *   filters       period tabs, plus chips for custom dates / account / category
 *   key figures   income, spending, net, savings rate (▲/▼ vs the period before)
 *   key insights  a few generated observations the charts don't already show
 *   cash flow     income vs spending by month (tooltip gives each month's net)
 *   categories    ranked bars, spending or income; tap one to drill in
 *   daily         spending per day (this month, or short custom ranges)
 *   largest       the five biggest expenses
 *   budgets       each budget against its limit (this month, unfiltered)
 *   net worth     accounts + savings + investments + lent − owed, today
 */

import {
    EmptyState,
    ErrorRetry,
    HeaderIconButton,
    PERIOD_SEGMENTS,
    ScreenHeader,
    SegmentedControl,
    Skeleton,
    StatFigure,
    ThemedText,
    type SegmentOption,
} from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { useAccounts } from '@/features/accounts/hooks/use-accounts';
import { useBudgets } from '@/features/budgets/hooks/use-budgets';
import { useCategories } from '@/features/categories/hooks/use-categories';
import { usePortfolio } from '@/features/investments/hooks/use-portfolio';
import { compactMoney, useChartTheme } from '@/features/reports/chart-theme';
import { CashflowBars } from '@/features/reports/components/cashflow-bars';
import { CategoryBars } from '@/features/reports/components/category-bars';
import { ChartCard } from '@/features/reports/components/chart-card';
import { DailySpendingCard } from '@/features/reports/components/daily-spending-card';
import { InsightsFilterSheet } from '@/features/reports/components/insights-filter-sheet';
import {
    BudgetBars,
    InsightLines,
    NetWorthBreakdown,
    TopExpensesList,
} from '@/features/reports/components/insights-sections';
import { LineChart } from '@/features/reports/components/line-chart';
import { DEFAULT_FILTERS, useInsights, type InsightsFilters } from '@/features/reports/hooks/use-insights';
import { buildInsights, pctChange, resolveRange } from '@/features/reports/utils';
import { useUser } from '@/features/user/context/user-context';
import { UserService } from '@/features/user/services/user-service';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { getCurrencySymbol } from '@/lib/utils/currency';
import { formatTooltipDate, parseLocalDate } from '@/lib/utils/date';
import { useModalActions } from '@/providers/modal-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { type Href, router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import Animated, {
    Easing,
    FadeIn,
    FadeInDown,
    FadeOut,
    LinearTransition,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const CATEGORY_MODES: readonly SegmentOption<'expense' | 'income'>[] = [
    { key: 'expense', label: 'Spending' },
    { key: 'income', label: 'Income' },
];

function formatRange(start: string, end: string): string {
    const s = parseLocalDate(start);
    const e = parseLocalDate(end);
    const sameYear = s.getFullYear() === e.getFullYear();
    const sFmt = s.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
    const eFmt = e.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return start === end ? eFmt : `${sFmt} – ${eFmt}`;
}

/** Same shape as the loaded page (four tiles, insights, cash flow, categories) so nothing jumps. */
function ReportsSkeleton() {
    return (
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading insights" style={{ paddingHorizontal: 20, marginTop: 20 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {[0, 1, 2, 3].map(i => (
                    <Skeleton key={i} height={80} borderRadius={16} style={{ flexBasis: '46%', flexGrow: 1 }} />
                ))}
            </View>
            <Skeleton height={112} borderRadius={16} style={{ marginTop: 20 }} />
            <Skeleton height={240} borderRadius={16} style={{ marginTop: 20 }} />
            <View style={{ marginTop: 20 }}>
                {[0, 1, 2, 3].map(i => (
                    <View key={i} style={{ marginBottom: 16 }}>
                        <Skeleton width={`${70 - i * 12}%`} height={12} borderRadius={4} style={{ marginBottom: 6 }} />
                        <Skeleton height={8} borderRadius={2} />
                    </View>
                ))}
            </View>
        </View>
    );
}

/** Each section's entrance on the first load: a short staggered rise. */
const reveal = (i: number) => FadeInDown.delay(i * 50).duration(300).easing(Easing.out(Easing.cubic));
/** Cards that appear or disappear later (filter changes) just fade. */
const CARD_IN = FadeIn.duration(200);
const CARD_OUT = FadeOut.duration(150);
/** Cards below a change slide to their new place instead of jumping. */
const CARD_LAYOUT = LinearTransition.duration(220);

const tick = () => Haptics.selectionAsync().catch(() => {});

/** One key figure in a surface tile; two tiles per row. */
const FigureTile = React.memo(function FigureTile({
    label,
    value,
    valueColor,
    delta,
    invertDelta,
}: {
    label: string;
    value: string;
    valueColor?: string;
    delta?: number | null;
    invertDelta?: boolean;
}) {
    return (
        <View
            className="rounded-2xl border border-divider dark:border-dark-divider bg-surface dark:bg-dark-surface px-4 py-3"
            style={{ flexBasis: '46%', flexGrow: 1 }}
        >
            <StatFigure label={label} value={value} valueColor={valueColor} delta={delta} invertDelta={invertDelta} deltaCaption="vs before" />
        </View>
    );
});

/** A removable chip showing one active filter. */
function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
    const colors = useThemeColors();
    return (
        <Pressable
            onPress={() => { tick(); onRemove(); }}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="button"
            accessibilityLabel={`Remove filter: ${label}`}
            className="flex-row items-center rounded-full pl-3 pr-2"
            style={({ pressed }) => ({ minHeight: 32, backgroundColor: pressed ? colors.borderSoft : colors.backgroundAlt })}
        >
            <ThemedText type="label" className="text-[13px]" numberOfLines={1}>{label}</ThemedText>
            <Ionicons name="close" size={14} color={colors.textMuted} style={{ marginLeft: 4 }} />
        </Pressable>
    );
}

export default function ReportsScreen() {
    const { profile } = useUser();
    const colors = useThemeColors();
    const chart = useChartTheme();
    const insets = useSafeAreaInsets();
    const { openModal } = useModalActions();
    const currency = profile.currency;
    const symbol = getCurrencySymbol(currency);
    const fmt = useCallback((n: number) => UserService.formatCurrency(n, currency), [currency]);

    const [filters, setFilters] = useState<InsightsFilters>(DEFAULT_FILTERS);
    const [filterOpen, setFilterOpen] = useState(false);
    const [categoryMode, setCategoryMode] = useState<'expense' | 'income'>('expense');
    const { data, loading, error, refresh } = useInsights(filters);
    const { accounts } = useAccounts();
    const { categories } = useCategories();
    const { budgets } = useBudgets();
    const portfolio = usePortfolio();

    const accountName = accounts.find(a => a.id === filters.accountId)?.name;
    const categoryName = categories.find(c => c.id === filters.categoryId)?.name;
    const filtered = filters.accountId != null || filters.categoryId != null;
    const activeCount = (filters.period === 'custom' ? 1 : 0) + (filters.accountId != null ? 1 : 0) + (filters.categoryId != null ? 1 : 0);

    const figures = useMemo(() => {
        const income = data?.income ?? 0;
        const expense = data?.expense ?? 0;
        const net = income - expense;
        return {
            income,
            expense,
            net,
            savingsRate: income > 0 ? Math.round((net / income) * 100) : null,
            incomeDelta: data ? pctChange(income, data.prevIncome) : null,
            expenseDelta: data ? pctChange(expense, data.prevExpense) : null,
        };
    }, [data]);

    const insightLines = useMemo(() => {
        if (!data) return [];
        return buildInsights({
            period: filters.period,
            range: data.range,
            expense: data.expense,
            prevExpense: data.prevExpense,
            categories: filters.categoryId ? [] : data.expenseCategories,
            prevCategories: filters.categoryId ? [] : data.prevExpenseCategories,
            // With a category filter the monthly totals only hold that
            // category, so "spending beat income" would be meaningless.
            monthly: filters.categoryId ? [] : data.monthly,
            format: fmt,
        });
    }, [data, filters.period, filters.categoryId, fmt]);

    const categoryData = useMemo(
        () => (categoryMode === 'expense' ? data?.expenseCategories : data?.incomeCategories) ?? [],
        [data, categoryMode],
    );

    const monthly = useMemo(() => data?.monthly ?? [], [data]);
    const hasMonthly = monthly.some(m => m.income > 0 || m.expense > 0);

    const daily = useMemo(() => data?.daily ?? [], [data]);
    const lineData = useMemo(() => daily.map(d => ({ value: d.amount, dataPointText: '' })), [daily]);
    const customDaily = useMemo(() => {
        if (!data || filters.period !== 'custom') return { axis: [] as string[], full: [] as string[] };
        const start = parseLocalDate(data.range.start);
        const dates = daily.map((_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
        return {
            axis: dates.map(d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })),
            full: dates.map(d => formatTooltipDate(d)),
        };
    }, [data, daily, filters.period]);

    const dailySeries = useMemo(
        () => [{ key: 'daily', label: 'Spent', color: chart.accent, values: daily.map(d => d.amount), fill: true }],
        [daily, chart.accent],
    );
    const formatAxis = useCallback((n: number) => compactMoney(n, symbol), [symbol]);
    const cashflowLegend = useMemo(
        () => [
            { label: 'Income', color: colors.chartIncome },
            { label: 'Spending', color: colors.chartExpense },
        ],
        [colors.chartIncome, colors.chartExpense],
    );
    const dailyLegend = useMemo(
        () => [
            { label: 'Spent per day', color: colors.primary },
            { label: 'Daily average', color: colors.textMuted, dashed: true },
        ],
        [colors.primary, colors.textMuted],
    );
    const hasHoldings = portfolio.holdings.length > 0;
    const openPortfolio = useCallback(() => router.push('/investments' as Href), []);

    const noData = !!data && figures.income === 0 && figures.expense === 0 && !hasMonthly;
    // No figures yet: show the skeleton, unless the load failed (and isn't
    // being retried right now).
    const showSkeleton = !data && (!error || loading);
    // Worked out from the filters, not the loaded data, so the header has its
    // final height from the first frame. Recomputed after every load too, so
    // it follows the date when the app stays open past midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const range = useMemo(() => resolveRange(filters.period, filters.custom), [filters.period, filters.custom, data]);
    const kicker = formatRange(range.start, range.end);

    const update = useCallback((patch: Partial<InsightsFilters>) => setFilters(prev => ({ ...prev, ...patch })), []);
    const drillInto = useCallback((categoryId: number) => {
        setFilters(prev => ({ ...prev, categoryId }));
    }, []);
    const clearAll = useCallback(() => setFilters(DEFAULT_FILTERS), []);

    // Pull-to-refresh is the only time the spinner shows; filter changes dim
    // the current figures instead.
    const [pulling, setPulling] = useState(false);
    const onPull = useCallback(async () => {
        setPulling(true);
        try {
            await refresh();
        } finally {
            setPulling(false);
        }
    }, [refresh]);

    // Dim the figures while new ones load, and keep them dimmed if that load
    // failed, since they no longer match the filters.
    const stale = !!data && !pulling && (loading || !!error);
    const contentOpacity = useSharedValue(1);
    useEffect(() => {
        contentOpacity.value = withTiming(stale ? 0.55 : 1, { duration: 150 });
    }, [stale, contentOpacity]);
    const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));

    // Sections rise in once, on the first load; after that only cards that
    // come and go with a filter change animate.
    const [revealed, setRevealed] = useState(false);
    useEffect(() => {
        if (data && !revealed) setRevealed(true);
    }, [data, revealed]);
    const enter = (i: number) => (revealed ? CARD_IN : reveal(i));

    return (
        <View className="flex-1 bg-background dark:bg-dark-background">
            {/* Header stays put; only the content below it scrolls */}
            <View className="pb-2" style={{ paddingTop: insets.top }}>
                <ScreenHeader
                    showBack={false}
                    kicker={kicker}
                    title="Insights"
                    right={
                        <>
                            <View>
                                <HeaderIconButton
                                    icon="options-outline"
                                    accessibilityLabel={activeCount ? `Filter, ${activeCount} active` : 'Filter'}
                                    onPress={() => setFilterOpen(true)}
                                />
                                {activeCount > 0 && (
                                    <View
                                        pointerEvents="none"
                                        className="absolute items-center justify-center rounded-full"
                                        style={{ top: 2, right: 2, minWidth: 16, height: 16, paddingHorizontal: 3, backgroundColor: colors.primary }}
                                    >
                                        <ThemedText className="text-[10px] leading-3 font-bold" style={{ color: colors.textOnPrimary }}>{activeCount}</ThemedText>
                                    </View>
                                )}
                            </View>
                            <HeaderIconButton
                                icon="share-outline"
                                accessibilityLabel="Export report as PDF or Excel"
                                onPress={() => openModal('export')}
                            />
                        </>
                    }
                />
                <SegmentedControl
                    options={PERIOD_SEGMENTS}
                    value={filters.period === 'custom' ? null : filters.period}
                    onChange={p => update({ period: p, custom: null })}
                    className="mx-5"
                />
                {activeCount > 0 && (
                    <Animated.View entering={CARD_IN} exiting={CARD_OUT} style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, marginTop: 12, gap: 8 }}>
                        {filters.period === 'custom' && (
                            <ActiveChip label={kicker} onRemove={() => update({ period: 'month', custom: null })} />
                        )}
                        {filters.accountId != null && (
                            <ActiveChip label={accountName ?? 'Account'} onRemove={() => update({ accountId: null })} />
                        )}
                        {filters.categoryId != null && (
                            <ActiveChip label={categoryName ?? 'Category'} onRemove={() => update({ categoryId: null })} />
                        )}
                        {activeCount > 1 && (
                            <Pressable
                                onPress={() => { tick(); clearAll(); }}
                                hitSlop={{ top: 6, bottom: 6 }}
                                accessibilityRole="button"
                                className="justify-center px-2 min-h-[32px]"
                            >
                                <ThemedText type="label" className="text-[13px]" style={{ color: colors.primary }}>Clear all</ThemedText>
                            </Pressable>
                        )}
                    </Animated.View>
                )}
            </View>

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={pulling}
                        onRefresh={onPull}
                        tintColor={colors.primary}
                        colors={[colors.primary]}
                    />
                }
            >
                {/* A reload failed but older figures are on screen: say so. */}
                {!!error && !!data && !loading && (
                    <Animated.View
                        entering={CARD_IN}
                        exiting={CARD_OUT}
                        accessibilityRole="alert"
                        style={{ marginHorizontal: 20, marginTop: 16, padding: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.backgroundAlt }}
                    >
                        <Ionicons name="alert-circle-outline" size={18} color={colors.expense} style={{ marginRight: 8 }} />
                        <ThemedText type="caption" className="flex-1">
                            Couldn&apos;t update for these filters. These are the last figures that loaded.
                        </ThemedText>
                        <Pressable onPress={refresh} accessibilityRole="button" hitSlop={8} className="ml-3 justify-center min-h-[32px]">
                            <ThemedText type="label" className="text-[13px]" style={{ color: colors.primary }}>Try again</ThemedText>
                        </Pressable>
                    </Animated.View>
                )}
                <Animated.View style={contentStyle}>
                {showSkeleton ? (
                    <ReportsSkeleton />
                ) : error && !data ? (
                    <ErrorRetry message="Couldn't load your insights." onRetry={refresh} />
                ) : noData ? (
                    <EmptyState
                        icon="bar-chart-outline"
                        title={activeCount ? 'Nothing matches' : 'No data yet'}
                        subtitle={activeCount
                            ? 'No income or spending fits these filters. Try a longer period or fewer filters.'
                            : 'Add a few transactions and this page will turn them into a report.'}
                        actionLabel={activeCount ? 'Clear filters' : undefined}
                        onAction={activeCount ? clearAll : undefined}
                    />
                ) : data ? (
                    <>
                        {/* ── Key figures ──────────────────────────────── */}
                        <Animated.View entering={enter(0)} layout={CARD_LAYOUT}>
                            <View className="px-5 mt-5 flex-row flex-wrap" style={{ gap: 10 }}>
                                <FigureTile label="Income" value={fmt(figures.income)} valueColor={colors.income} delta={figures.incomeDelta} />
                                <FigureTile label="Spending" value={fmt(figures.expense)} valueColor={colors.expense} delta={figures.expenseDelta} invertDelta />
                                <FigureTile
                                    label="Net"
                                    value={`${figures.net < 0 ? '−' : '+'}${fmt(Math.abs(figures.net))}`}
                                    valueColor={figures.net < 0 ? colors.expense : colors.textPrimary}
                                />
                                <FigureTile
                                    label="Savings rate"
                                    value={figures.savingsRate == null ? '—' : `${figures.savingsRate}%`}
                                    valueColor={figures.savingsRate != null && figures.savingsRate < 0 ? colors.expense : undefined}
                                />
                            </View>
                        </Animated.View>

                        {/* ── Key insights ─────────────────────────────── */}
                        {insightLines.length > 0 && (
                            <Animated.View entering={enter(1)} exiting={CARD_OUT} layout={CARD_LAYOUT}>
                                <InsightLines lines={insightLines} />
                            </Animated.View>
                        )}

                        {/* ── Cash flow ────────────────────────────────── */}
                        {hasMonthly && (
                            <Animated.View entering={enter(2)} exiting={CARD_OUT} layout={CARD_LAYOUT}>
                                <ChartCard
                                    kicker={filters.period === 'custom'
                                        ? `${monthly.length} months to ${monthly[monthly.length - 1].month} ${monthly[monthly.length - 1].year}`
                                        : `Last ${monthly.length} months`}
                                    title={categoryName ? `${categoryName} by month` : 'Income vs spending'}
                                    legend={cashflowLegend}
                                >
                                    <CashflowBars data={monthly} currency={currency} />
                                </ChartCard>
                            </Animated.View>
                        )}

                        {/* ── Categories ───────────────────────────────── */}
                        {!filters.categoryId && (data.expenseCategories.length > 0 || data.incomeCategories.length > 0) && (
                            <Animated.View entering={enter(3)} exiting={CARD_OUT} layout={CARD_LAYOUT}>
                                <ChartCard kicker={categoryMode === 'expense' ? 'Where it went' : 'Where it came from'} title="By category">
                                    <SegmentedControl options={CATEGORY_MODES} value={categoryMode} onChange={setCategoryMode} className="mb-4" />
                                    {categoryData.length === 0 ? (
                                        <ThemedText type="caption" className="py-6 text-center">
                                            No {categoryMode === 'expense' ? 'spending' : 'income'} in this period.
                                        </ThemedText>
                                    ) : (
                                        <>
                                            <CategoryBars
                                                categoryData={categoryData}
                                                currency={currency}
                                                kind={categoryMode}
                                                onPressCategory={drillInto}
                                            />
                                            <ThemedText type="caption" className="mt-2">Tap a category to see only that category.</ThemedText>
                                        </>
                                    )}
                                </ChartCard>
                            </Animated.View>
                        )}

                        {/* ── Daily ────────────────────────────────────── */}
                        {filters.period === 'month' && lineData.length > 1 && (
                            <Animated.View entering={enter(4)} exiting={CARD_OUT} layout={CARD_LAYOUT}>
                                <ChartCard kicker="This month" title="Daily spending" legend={dailyLegend}>
                                    <DailySpendingCard lineData={lineData} formatValue={fmt} symbol={symbol} startDate={data.range.start} />
                                </ChartCard>
                            </Animated.View>
                        )}
                        {filters.period === 'custom' && daily.length > 1 && (
                            <Animated.View entering={enter(4)} exiting={CARD_OUT} layout={CARD_LAYOUT}>
                                <ChartCard kicker="Day by day" title="Daily spending">
                                    <LineChart
                                        labels={customDaily.axis}
                                        tooltipLabels={customDaily.full}
                                        series={dailySeries}
                                        formatValue={fmt}
                                        formatAxis={formatAxis}
                                        accessibilityLabel={`Spending per day from ${customDaily.full[0]} to ${customDaily.full[customDaily.full.length - 1]}.`}
                                    />
                                </ChartCard>
                            </Animated.View>
                        )}

                        {/* ── Largest expenses ─────────────────────────── */}
                        {data.top.length > 0 && (
                            <Animated.View entering={enter(5)} exiting={CARD_OUT} layout={CARD_LAYOUT}>
                                <ChartCard kicker="Biggest items" title="Largest expenses">
                                    <TopExpensesList items={data.top} format={fmt} onPressCategory={filters.categoryId ? undefined : drillInto} />
                                </ChartCard>
                            </Animated.View>
                        )}

                        {/* ── Budgets ──────────────────────────────────── */}
                        {filters.period === 'month' && !filtered && budgets.length > 0 && (
                            <Animated.View entering={enter(6)} exiting={CARD_OUT} layout={CARD_LAYOUT}>
                                <ChartCard kicker="Limits" title="Budgets vs spending">
                                    <BudgetBars budgets={budgets} format={fmt} />
                                </ChartCard>
                            </Animated.View>
                        )}
                    </>
                ) : null}

                {/* ── Net worth (today, never filtered) ────────────── */}
                {data && !showSkeleton && (
                    <Animated.View entering={enter(7)} layout={CARD_LAYOUT}>
                        <ChartCard kicker="Today · everything" title="Net worth">
                            <NetWorthBreakdown
                                parts={data.netWorth}
                                portfolio={portfolio.summary.value}
                                format={fmt}
                                onOpenPortfolio={hasHoldings ? openPortfolio : undefined}
                            />
                        </ChartCard>
                    </Animated.View>
                )}
                </Animated.View>
            </ScrollView>

            <InsightsFilterSheet
                visible={filterOpen}
                onClose={() => setFilterOpen(false)}
                value={filters}
                onApply={setFilters}
                accounts={accounts}
                categories={categories}
            />
        </View>
    );
}
