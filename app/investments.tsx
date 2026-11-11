/**
 * Portfolio — stocks, funds, crypto, gold and the rest, tracked by hand:
 *
 *   summary      value now, money invested, total return, realised, dividends
 *   value        market value vs money invested, month by month (6M / 1Y / All)
 *   allocation   share of value by holding or by type
 *   returns      total return per holding, gains right, losses left
 *   holdings     filter by type, sort, open one for details
 *
 * A separate record: nothing here changes account balances or Insights.
 */
import {
    AppButton,
    EmptyState,
    HeaderIconButton,
    ScreenHeader,
    SegmentedControl,
    Skeleton,
    ThemedText,
    type SegmentOption,
} from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { FigureTile, FilterChips } from '@/features/investments/components/form-parts';
import { HoldingFormSheet } from '@/features/investments/components/holding-form-sheet';
import { HoldingRow } from '@/features/investments/components/holding-row';
import { UpdatePricesSheet } from '@/features/investments/components/update-prices-sheet';
import { usePortfolio } from '@/features/investments/hooks/use-portfolio';
import {
    allocation,
    ASSET_TYPE_LABELS,
    formatPct,
    formatSigned,
    holdingColor,
    portfolioSeries,
    sortSummaries,
    type HoldingSort,
    type SeriesRange,
} from '@/features/investments/utils';
import { compactMoney, useChartTheme } from '@/features/reports/chart-theme';
import { ChartCard } from '@/features/reports/components/chart-card';
import { DivergingBars } from '@/features/reports/components/diverging-bars';
import { DonutChart } from '@/features/reports/components/donut-chart';
import { LineChart } from '@/features/reports/components/line-chart';
import { OTHER_COLOR } from '@/features/reports/utils';
import { useUser } from '@/features/user/context/user-context';
import { UserService } from '@/features/user/services/user-service';
import { useThemeColors } from '@/hooks/use-theme-colors';
import type { AssetType } from '@/lib/db/schema';
import { getCurrencySymbol } from '@/lib/utils/currency';
import { toISODateString } from '@/lib/utils/date';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const RANGE_OPTIONS: readonly SegmentOption<SeriesRange>[] = [
    { key: '6m', label: '6M', accessibilityLabel: 'Last 6 months' },
    { key: '1y', label: '1Y', accessibilityLabel: 'Last 12 months' },
    { key: 'all', label: 'All', accessibilityLabel: 'Since the first purchase' },
];

const SORT_OPTIONS: readonly SegmentOption<HoldingSort>[] = [
    { key: 'value', label: 'Value' },
    { key: 'gain', label: 'Return' },
    { key: 'gainPct', label: 'Return %' },
    { key: 'name', label: 'Name' },
];

const ALLOCATION_OPTIONS: readonly SegmentOption<'holding' | 'type'>[] = [
    { key: 'holding', label: 'By holding' },
    { key: 'type', label: 'By type' },
];

/** Prices older than this are flagged as worth updating. */
const STALE_DAYS = 7;

export default function InvestmentsScreen() {
    const colors = useThemeColors();
    const chart = useChartTheme();
    const insets = useSafeAreaInsets();
    const { profile } = useUser();
    const currency = profile.currency;
    const symbol = getCurrencySymbol(currency);
    const fmt = useCallback((n: number) => UserService.formatCurrency(n, currency), [currency]);
    const portfolio = usePortfolio();
    const { summaries, summary, holdings, loading } = portfolio;

    const [range, setRange] = useState<SeriesRange>('6m');
    const [allocBy, setAllocBy] = useState<'holding' | 'type'>('holding');
    const [sort, setSort] = useState<HoldingSort>('value');
    const [typeFilter, setTypeFilter] = useState<AssetType | 'all'>('all');
    const [showClosed, setShowClosed] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [pricesOpen, setPricesOpen] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const open = useMemo(() => summaries.filter(s => s.isOpen), [summaries]);

    const series = useMemo(
        () => portfolioSeries(holdings, portfolio.tradesByHolding, portfolio.pricesByHolding, range),
        [holdings, portfolio.tradesByHolding, portfolio.pricesByHolding, range],
    );
    const showSeries = series.length >= 2 && series.some(p => p.value > 0);

    const slices = useMemo(
        () => allocation(summaries, allocBy, chart.categorical, OTHER_COLOR),
        [summaries, allocBy, chart.categorical],
    );

    const returns = useMemo(
        () => sortSummaries(summaries.filter(s => s.position.tradeCount > 0), 'gain').map(s => ({
            key: String(s.holding.id),
            label: s.holding.symbol || s.holding.name,
            value: s.totalReturn,
            detail: formatPct(s.totalReturnPct),
        })),
        [summaries],
    );

    const typesPresent = useMemo(() => {
        const set = new Set(summaries.filter(s => showClosed || s.isOpen).map(s => s.holding.asset_type));
        return [...set];
    }, [summaries, showClosed]);

    // If the chosen type has no holdings left (deleted, or now hidden as sold out), show all.
    const activeType = typeFilter !== 'all' && typesPresent.includes(typeFilter) ? typeFilter : 'all';

    const visible = useMemo(() => {
        const list = summaries.filter(s =>
            (showClosed || s.isOpen || s.position.tradeCount === 0) &&
            (activeType === 'all' || s.holding.asset_type === activeType));
        return sortSummaries(list, sort);
    }, [summaries, showClosed, activeType, sort]);

    const closedCount = summaries.filter(s => !s.isOpen && s.position.tradeCount > 0).length;

    const staleCount = useMemo(() => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - STALE_DAYS);
        const limit = toISODateString(cutoff);
        return open.filter(s => !s.price || s.price.date < limit).length;
    }, [open]);

    const onRefresh = useCallback(async () => {
        setRefreshing(true);
        await portfolio.refresh();
        setRefreshing(false);
    }, [portfolio]);

    const openHolding = useCallback((id: number) => {
        router.push({ pathname: '/holding', params: { id: String(id) } });
    }, []);

    const totalTone = Math.abs(summary.totalReturn) < 0.005 ? colors.textMuted : summary.totalReturn >= 0 ? colors.income : colors.expense;
    const unrealTone = Math.abs(summary.unrealized) < 0.005 ? colors.textMuted : summary.unrealized >= 0 ? colors.income : colors.expense;
    const isEmpty = !loading && holdings.length === 0;

    return (
        <View className="flex-1 bg-background dark:bg-dark-background">
            <View style={{ paddingTop: insets.top }}>
                <ScreenHeader
                    title="Portfolio"
                    subtitle="Stocks, funds, crypto and more"
                    right={
                        <>
                            {open.length > 0 && (
                                <HeaderIconButton icon="pricetags-outline" accessibilityLabel="Update prices" onPress={() => setPricesOpen(true)} />
                            )}
                            <HeaderIconButton icon="add" accessibilityLabel="Add a holding" onPress={() => setAddOpen(true)} />
                        </>
                    }
                />
            </View>

            <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingBottom: insets.bottom + 48 }}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
            >
                {loading && holdings.length === 0 ? (
                    <View className="px-5 pt-4">
                        <Skeleton width="50%" height={14} borderRadius={4} style={{ marginBottom: 10 }} />
                        <Skeleton width="70%" height={40} borderRadius={6} style={{ marginBottom: 24 }} />
                        <Skeleton height={180} borderRadius={12} style={{ marginBottom: 16 }} />
                        <Skeleton height={56} borderRadius={8} style={{ marginBottom: 8 }} />
                        <Skeleton height={56} borderRadius={8} />
                    </View>
                ) : isEmpty ? (
                    <EmptyState
                        icon="trending-up-outline"
                        title="Track your investments"
                        subtitle="Add stocks, mutual funds, crypto or gold. You type in the prices, and nothing here changes your account balances."
                        actionLabel="Add a holding"
                        onAction={() => setAddOpen(true)}
                    />
                ) : (
                    <>
                        {/* ── Summary ───────────────────────────────────── */}
                        <View
                            className="px-5 pt-3"
                            accessible
                            accessibilityLabel={`Portfolio value ${fmt(summary.value)}. Unrealised ${formatSigned(summary.unrealized, fmt)}, ${formatPct(summary.unrealizedPct)}.`}
                        >
                            <ThemedText type="kicker">Value now</ThemedText>
                            <ThemedText type="figureLg" className="text-[38px] leading-[46px]" numberOfLines={1} adjustsFontSizeToFit>
                                {fmt(summary.value)}
                            </ThemedText>
                            <ThemedText type="figure" className="text-sm" style={{ color: unrealTone }}>
                                {summary.unrealized >= 0 ? '▲' : '▼'} {formatSigned(summary.unrealized, fmt)} ({formatPct(summary.unrealizedPct)})
                                <ThemedText type="caption"> on what you hold now</ThemedText>
                            </ThemedText>
                        </View>

                        <View className="px-5 mt-5 flex-row flex-wrap" style={{ gap: 10 }}>
                            <FigureTile label="Invested" value={fmt(summary.invested)} detail={`${summary.openCount} open ${summary.openCount === 1 ? 'holding' : 'holdings'}`} />
                            <FigureTile
                                label="Total return"
                                value={formatSigned(summary.totalReturn, fmt)}
                                valueColor={totalTone}
                                detail={formatPct(summary.totalReturnPct)}
                            />
                            <FigureTile
                                label="Realised"
                                value={formatSigned(summary.realized, fmt)}
                                valueColor={Math.abs(summary.realized) < 0.005 ? undefined : summary.realized >= 0 ? colors.income : colors.expense}
                                detail="From sales"
                            />
                            <FigureTile label="Dividends" value={fmt(summary.dividends)} detail="Received" />
                        </View>

                        {staleCount > 0 && (
                            <Pressable
                                onPress={() => setPricesOpen(true)}
                                accessibilityRole="button"
                                accessibilityLabel={`${staleCount} prices are more than a week old. Update prices`}
                                className="mx-5 mt-4 flex-row items-center rounded-xl px-4 py-3"
                                style={({ pressed }) => ({ backgroundColor: pressed ? colors.borderSoft : colors.backgroundAlt })}
                            >
                                <Ionicons name="time-outline" size={18} color={colors.warning} />
                                <ThemedText type="caption" className="flex-1 ml-2.5">
                                    {staleCount === 1 ? '1 price is' : `${staleCount} prices are`} over a week old
                                </ThemedText>
                                <ThemedText type="label" style={{ color: colors.primary }}>Update</ThemedText>
                            </Pressable>
                        )}

                        {/* ── Value over time ───────────────────────────── */}
                        {showSeries && (
                            <ChartCard
                                kicker="Value over time"
                                title="Value vs invested"
                                legend={[
                                    { label: 'Market value', color: chart.accent },
                                    { label: 'Invested', color: chart.muted, dashed: true },
                                ]}
                            >
                                <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} className="mb-3" />
                                <LineChart
                                    labels={series.map(p => p.label)}
                                    series={[
                                        { key: 'value', label: 'Value', color: chart.accent, values: series.map(p => p.value), fill: true },
                                        { key: 'invested', label: 'Invested', color: chart.muted, values: series.map(p => p.invested), dashed: true },
                                    ]}
                                    formatValue={fmt}
                                    formatAxis={v => compactMoney(v, symbol)}
                                    accessibilityLabel={`Portfolio value month by month, from ${fmt(series[0].value)} to ${fmt(series[series.length - 1].value)}.`}
                                />
                                <ThemedText type="caption" className="mt-2">
                                    Month-end values, using the latest price you entered at the time.
                                </ThemedText>
                            </ChartCard>
                        )}

                        {/* ── Allocation ────────────────────────────────── */}
                        {slices.length > 0 && (
                            <ChartCard kicker="Where it sits" title="Allocation">
                                <SegmentedControl options={ALLOCATION_OPTIONS} value={allocBy} onChange={setAllocBy} className="mb-4" />
                                <DonutChart
                                    key={allocBy}
                                    slices={slices}
                                    centerLabel="Total"
                                    centerValue={compactMoney(summary.value, symbol)}
                                    formatValue={fmt}
                                />
                            </ChartCard>
                        )}

                        {/* ── Return by holding ─────────────────────────── */}
                        {returns.length > 0 && (
                            <ChartCard kicker="Winners and losers" title="Return by holding">
                                <DivergingBars
                                    items={returns}
                                    formatValue={n => formatSigned(n, fmt)}
                                    positiveColor={chart.income}
                                    negativeColor={chart.expense}
                                    onPressItem={key => openHolding(Number(key))}
                                />
                                <ThemedText type="caption" className="mt-2">
                                    Unrealised + realised gains + dividends.
                                </ThemedText>
                            </ChartCard>
                        )}

                        {/* ── Holdings ──────────────────────────────────── */}
                        <View className="px-5 mt-7">
                            <ThemedText type="headline" className="text-xl leading-7 mb-3" accessibilityRole="header">Holdings</ThemedText>
                            {typesPresent.length > 1 && (
                                <View className="mb-3">
                                    <FilterChips
                                        options={[
                                            { key: 'all' as const, label: 'All' },
                                            ...typesPresent.map(t => ({ key: t, label: ASSET_TYPE_LABELS[t] })),
                                        ]}
                                        value={activeType}
                                        onChange={setTypeFilter}
                                    />
                                </View>
                            )}
                            <SegmentedControl options={SORT_OPTIONS} value={sort} onChange={setSort} className="mb-1" />

                            {visible.length === 0 ? (
                                <ThemedText type="caption" className="py-6 text-center">Nothing matches this filter.</ThemedText>
                            ) : (
                                visible.map((s, i) => (
                                    <HoldingRow
                                        key={s.holding.id}
                                        summary={s}
                                        color={holdingColor(s.holding, chart.categorical)}
                                        fmt={fmt}
                                        symbol={symbol}
                                        onPress={openHolding}
                                        ruled={i < visible.length - 1}
                                    />
                                ))
                            )}

                            {closedCount > 0 && (
                                <Pressable
                                    onPress={() => setShowClosed(v => !v)}
                                    accessibilityRole="button"
                                    className="min-h-[44px] items-center justify-center mt-2"
                                >
                                    <ThemedText type="label" style={{ color: colors.primary }}>
                                        {showClosed ? 'Hide sold-out holdings' : `Show ${closedCount} sold-out ${closedCount === 1 ? 'holding' : 'holdings'}`}
                                    </ThemedText>
                                </Pressable>
                            )}

                            <View className="mt-5">
                                <AppButton label="Add a holding" variant="secondary" icon="add" onPress={() => setAddOpen(true)} />
                            </View>
                        </View>
                    </>
                )}
            </ScrollView>

            <HoldingFormSheet visible={addOpen} onClose={() => setAddOpen(false)} onSaved={openHolding} />
            <UpdatePricesSheet visible={pricesOpen} onClose={() => setPricesOpen(false)} holdings={open} />
        </View>
    );
}
