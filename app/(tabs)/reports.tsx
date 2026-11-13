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
 *   weekdays      average spending per weekday
 *   largest       the five biggest expenses
 *   budgets       each budget against its limit (this month, unfiltered)
 *   net worth     accounts + savings + investments + lent − owed, today
 */

import {
    EmptyState,
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
    WeekdayBars,
} from '@/features/reports/components/insights-sections';
import { LineChart } from '@/features/reports/components/line-chart';
import { DEFAULT_FILTERS, useInsights, type InsightsFilters } from '@/features/reports/hooks/use-insights';
import { buildInsights, pctChange } from '@/features/reports/utils';
import { useUser } from '@/features/user/context/user-context';
import { UserService } from '@/features/user/services/user-service';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { getCurrencySymbol } from '@/lib/utils/currency';
import { formatTooltipDate, parseLocalDate } from '@/lib/utils/date';
import { useModalActions } from '@/providers/modal-context';
import { Ionicons } from '@expo/vector-icons';
import { type Href, router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
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

function ReportsSkeleton() {
    return (
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
            <Skeleton height={14} borderRadius={4} style={{ marginBottom: 8 }} />
            <Skeleton width="80%" height={14} borderRadius={4} style={{ marginBottom: 28 }} />
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 16 }}>
                <Skeleton height={52} borderRadius={6} style={{ flex: 1 }} />
                <Skeleton height={52} borderRadius={6} style={{ flex: 1 }} />
            </View>
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 32 }}>
                <Skeleton height={52} borderRadius={6} style={{ flex: 1 }} />
                <Skeleton height={52} borderRadius={6} style={{ flex: 1 }} />
            </View>
            <Skeleton height={180} borderRadius={6} style={{ marginBottom: 32 }} />
            {[0, 1, 2, 3].map(i => (
                <View key={i} style={{ marginBottom: 16 }}>
                    <Skeleton width="60%" height={12} borderRadius={4} style={{ marginBottom: 6 }} />
                    <Skeleton height={8} borderRadius={2} />
                </View>
            ))}
        </View>
    );
}

/** One key figure in a surface tile; two tiles per row. */
function FigureTile({
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
}

/** A removable chip showing one active filter. */
function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
    const colors = useThemeColors();
    return (
        <Pressable
            onPress={onRemove}
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
    const { data, loading, refresh } = useInsights(filters);
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
            monthly: data.monthly,
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

    const weekdayHasData = (data?.weekdays ?? []).some(w => w.total > 0);
    const noData = !!data && figures.income === 0 && figures.expense === 0 && !hasMonthly;
    const showSkeleton = loading && !data;
    const kicker = data ? formatRange(data.range.start, data.range.end) : '';

    const update = (patch: Partial<InsightsFilters>) => setFilters(prev => ({ ...prev, ...patch }));
    const drillInto = useCallback((categoryId: number) => {
        setFilters(prev => ({ ...prev, categoryId }));
    }, []);

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
                    <View className="flex-row flex-wrap px-5 mt-3" style={{ gap: 8 }}>
                        {filters.period === 'custom' && data && (
                            <ActiveChip label={formatRange(data.range.start, data.range.end)} onRemove={() => update({ period: 'month', custom: null })} />
                        )}
                        {filters.accountId != null && (
                            <ActiveChip label={accountName ?? 'Account'} onRemove={() => update({ accountId: null })} />
                        )}
                        {filters.categoryId != null && (
                            <ActiveChip label={categoryName ?? 'Category'} onRemove={() => update({ categoryId: null })} />
                        )}
                        {activeCount > 1 && (
                            <Pressable onPress={() => setFilters(DEFAULT_FILTERS)} accessibilityRole="button" className="justify-center px-2 min-h-[32px]">
                                <ThemedText type="label" className="text-[13px]" style={{ color: colors.primary }}>Clear all</ThemedText>
                            </Pressable>
                        )}
                    </View>
                )}
            </View>

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={loading && !!data}
                        onRefresh={refresh}
                        tintColor={colors.primary}
                        colors={[colors.primary]}
                    />
                }
            >
                {showSkeleton ? (
                    <ReportsSkeleton />
                ) : noData ? (
                    <EmptyState
                        icon="bar-chart-outline"
                        title={activeCount ? 'Nothing matches' : 'No data yet'}
                        subtitle={activeCount
                            ? 'No income or spending fits these filters. Try a longer period or fewer filters.'
                            : 'Add a few transactions and this page will turn them into a report.'}
                        actionLabel={activeCount ? 'Clear filters' : undefined}
                        onAction={activeCount ? () => setFilters(DEFAULT_FILTERS) : undefined}
                    />
                ) : data ? (
                    <>
                        {/* ── Key figures ──────────────────────────────── */}
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

                        {/* ── Key insights ─────────────────────────────── */}
                        <InsightLines lines={insightLines} />

                        {/* ── Cash flow ────────────────────────────────── */}
                        {hasMonthly && (
                            <ChartCard
                                kicker={filters.period === 'custom'
                                    ? `${monthly.length} months to ${monthly[monthly.length - 1].month} ${monthly[monthly.length - 1].year}`
                                    : `Last ${monthly.length} months`}
                                title={categoryName ? `${categoryName} by month` : 'Income vs spending'}
                                legend={[
                                    { label: 'Income', color: colors.chartIncome },
                                    { label: 'Spending', color: colors.chartExpense },
                                ]}
                            >
                                <CashflowBars data={monthly} currency={currency} />
                            </ChartCard>
                        )}

                        {/* ── Categories ───────────────────────────────── */}
                        {!filters.categoryId && (data.expenseCategories.length > 0 || data.incomeCategories.length > 0) && (
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
                        )}

                        {/* ── Daily ────────────────────────────────────── */}
                        {filters.period === 'month' && lineData.length > 1 && (
                            <ChartCard
                                kicker="This month"
                                title="Daily spending"
                                legend={[
                                    { label: 'Spent per day', color: colors.primary },
                                    { label: 'Daily average', color: colors.textMuted, dashed: true },
                                ]}
                            >
                                <DailySpendingCard lineData={lineData} formatValue={fmt} symbol={symbol} startDate={data.range.start} />
                            </ChartCard>
                        )}
                        {filters.period === 'custom' && daily.length > 1 && (
                            <ChartCard kicker="Day by day" title="Daily spending">
                                <LineChart
                                    labels={customDaily.axis}
                                    tooltipLabels={customDaily.full}
                                    series={[{ key: 'daily', label: 'Spent', color: chart.accent, values: daily.map(d => d.amount), fill: true }]}
                                    formatValue={fmt}
                                    formatAxis={n => compactMoney(n, symbol)}
                                    accessibilityLabel={`Spending per day from ${customDaily.full[0]} to ${customDaily.full[customDaily.full.length - 1]}.`}
                                />
                            </ChartCard>
                        )}

                        {/* ── Weekdays ─────────────────────────────────── */}
                        {weekdayHasData && (
                            <ChartCard kicker="Habits" title="Spending by weekday">
                                <WeekdayBars data={data.weekdays} format={fmt} />
                                <ThemedText type="caption" className="mt-2">Average spent on each day of the week.</ThemedText>
                            </ChartCard>
                        )}

                        {/* ── Largest expenses ─────────────────────────── */}
                        {data.top.length > 0 && (
                            <ChartCard kicker="Biggest items" title="Largest expenses">
                                <TopExpensesList items={data.top} format={fmt} onPressCategory={filters.categoryId ? undefined : drillInto} />
                            </ChartCard>
                        )}

                        {/* ── Budgets ──────────────────────────────────── */}
                        {filters.period === 'month' && !filtered && budgets.length > 0 && (
                            <ChartCard kicker="Limits" title="Budgets vs spending">
                                <BudgetBars budgets={budgets} format={fmt} />
                            </ChartCard>
                        )}
                    </>
                ) : null}

                {/* ── Net worth (today, never filtered) ────────────── */}
                {data && !showSkeleton && (
                    <ChartCard kicker="Today · everything" title="Net worth">
                        <NetWorthBreakdown
                            parts={data.netWorth}
                            portfolio={portfolio.summary.value}
                            format={fmt}
                            onOpenPortfolio={portfolio.holdings.length ? () => router.push('/investments' as Href) : undefined}
                        />
                    </ChartCard>
                )}
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
