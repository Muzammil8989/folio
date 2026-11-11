/**
 * One holding: value and return, the position (quantity, average cost,
 * invested), price history against average cost, every buy / sell /
 * dividend, and actions to add entries, update the price, edit or delete. Opened as /holding?id=<id>.
 */
import {
    AppButton,
    EmptyState,
    HeaderIconButton,
    ScreenHeader,
    Skeleton,
    ThemedText,
} from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { ConfirmDialog, FigureTile, formatShortDay } from '@/features/investments/components/form-parts';
import { HoldingFormSheet } from '@/features/investments/components/holding-form-sheet';
import { TradeSheet } from '@/features/investments/components/trade-sheet';
import { UpdatePricesSheet } from '@/features/investments/components/update-prices-sheet';
import { useHolding } from '@/features/investments/hooks/use-portfolio';
import {
    ASSET_TYPE_LABELS,
    formatPct,
    formatPrice,
    formatQuantity,
    formatSigned,
    priceHistory,
    sortTrades,
    TRADE_LABELS,
    unitLabel,
    type TradeType,
} from '@/features/investments/utils';
import { compactMoney, useChartTheme } from '@/features/reports/chart-theme';
import { ChartCard } from '@/features/reports/components/chart-card';
import { LineChart } from '@/features/reports/components/line-chart';
import { useUser } from '@/features/user/context/user-context';
import { UserService } from '@/features/user/services/user-service';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { deleteHolding, type InvestmentTrade } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { getCurrencySymbol } from '@/lib/utils/currency';
import { useModalActions } from '@/providers/modal-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const TRADE_ICONS: Record<TradeType, React.ComponentProps<typeof Ionicons>['name']> = {
    buy: 'arrow-down-circle-outline',
    sell: 'arrow-up-circle-outline',
    dividend: 'gift-outline',
};

export default function HoldingScreen() {
    const colors = useThemeColors();
    const chart = useChartTheme();
    const insets = useSafeAreaInsets();
    const { profile } = useUser();
    const { triggerRefresh } = useModalActions();
    const currency = profile.currency;
    const symbol = getCurrencySymbol(currency);
    const fmt = useCallback((n: number) => UserService.formatCurrency(n, currency), [currency]);
    const { id: idParam } = useLocalSearchParams<{ id?: string }>();
    const id = Number(idParam);
    const { holding, trades, prices, summary, loading, missing } = useHolding(id);

    const [tradeSheet, setTradeSheet] = useState<{ type: TradeType; editing: InvestmentTrade | null } | null>(null);
    const [editOpen, setEditOpen] = useState(false);
    const [priceOpen, setPriceOpen] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [busy, setBusy] = useState(false);

    const history = useMemo(() => priceHistory(trades, prices), [trades, prices]);
    const newestFirst = useMemo(() => sortTrades(trades).reverse(), [trades]);

    if (!Number.isFinite(id) || missing) {
        return (
            <View className="flex-1 bg-background dark:bg-dark-background" style={{ paddingTop: insets.top }}>
                <ScreenHeader title="Holding" />
                <EmptyState icon="trending-up-outline" title="Holding not found" subtitle="It may have been deleted." actionLabel="Back to portfolio" onAction={() => router.back()} />
            </View>
        );
    }

    if (loading || !holding || !summary) {
        return (
            <View className="flex-1 bg-background dark:bg-dark-background" style={{ paddingTop: insets.top }}>
                <ScreenHeader title="Holding" />
                <View className="px-5">
                    <Skeleton width="60%" height={40} borderRadius={6} style={{ marginBottom: 20 }} />
                    <Skeleton height={120} borderRadius={12} style={{ marginBottom: 16 }} />
                    <Skeleton height={160} borderRadius={12} />
                </View>
            </View>
        );
    }

    const p = summary.position;
    const unit = (q: number) => unitLabel(holding.asset_type, q);
    const tone = (n: number) => (Math.abs(n) < 0.005 ? undefined : n >= 0 ? colors.income : colors.expense);
    const subtitle = [holding.symbol, holding.market, ASSET_TYPE_LABELS[holding.asset_type]].filter(Boolean).join(' · ');
    const handleDelete = async () => {
        setBusy(true);
        try {
            await deleteHolding(holding.id);
            triggerRefresh(['investments']);
            toast.success('Holding deleted');
            setConfirmDelete(false);
            router.back();
        } catch (e) {
            logger.error('Failed to delete holding', e);
            toast.error("Couldn't delete the holding");
        } finally {
            setBusy(false);
        }
    };

    const tradeLine = (t: InvestmentTrade) => {
        if (t.type === 'dividend') return { title: 'Dividend', amount: `+${fmt(t.amount ?? 0)}` };
        const q = t.quantity ?? 0;
        const priceText = t.price ? formatPrice(t.price, fmt, symbol) : 'free (bonus)';
        const total = q * (t.price ?? 0) + (t.type === 'buy' ? t.fees : -t.fees);
        return {
            title: `${TRADE_LABELS[t.type]} · ${formatQuantity(q)} ${unit(q)} @ ${priceText}`,
            amount: fmt(total),
        };
    };

    return (
        <View className="flex-1 bg-background dark:bg-dark-background">
            <View style={{ paddingTop: insets.top }}>
                <ScreenHeader
                    title={holding.name}
                    subtitle={subtitle}
                    right={<HeaderIconButton icon="create-outline" accessibilityLabel="Edit holding" onPress={() => setEditOpen(true)} />}
                />
            </View>

            <ScrollView className="flex-1" contentContainerStyle={{ paddingBottom: insets.bottom + 48 }} showsVerticalScrollIndicator={false}>
                {/* ── Value ─────────────────────────────────────────── */}
                <View className="px-5 pt-2">
                    <ThemedText type="kicker">{summary.isOpen ? 'Value now' : p.tradeCount === 0 ? 'No purchases yet' : 'Sold out'}</ThemedText>
                    <ThemedText type="figureLg" className="text-[36px] leading-[44px]" numberOfLines={1} adjustsFontSizeToFit>
                        {fmt(summary.marketValue)}
                    </ThemedText>
                    <ThemedText type="figure" className="text-sm" style={{ color: tone(summary.totalReturn) ?? colors.textMuted }}>
                        {summary.totalReturn >= 0 ? '▲' : '▼'} {formatSigned(summary.totalReturn, fmt)} ({formatPct(summary.totalReturnPct)})
                        <ThemedText type="caption"> total return</ThemedText>
                    </ThemedText>
                </View>

                {/* ── Price ─────────────────────────────────────────── */}
                <View className="mx-5 mt-4 flex-row items-center rounded-xl px-4 py-3" style={{ backgroundColor: colors.backgroundAlt }}>
                    <View className="flex-1">
                        <ThemedText type="caption">Price per {unit(1)}</ThemedText>
                        <ThemedText type="figure" className="text-base">
                            {summary.price ? formatPrice(summary.price.price, fmt, symbol) : 'Not set'}
                            {!!summary.price && (
                                <ThemedText type="caption">
                                    {`  ${summary.price.source === 'manual' ? 'entered' : 'last trade'} ${formatShortDay(summary.price.date)}`}
                                </ThemedText>
                            )}
                        </ThemedText>
                    </View>
                    <AppButton label="Update" size="sm" variant="secondary" icon="pricetag-outline" onPress={() => setPriceOpen(true)} />
                </View>

                {/* ── Position ──────────────────────────────────────── */}
                <View className="px-5 mt-4 flex-row flex-wrap" style={{ gap: 10 }}>
                    <FigureTile label="Quantity" value={formatQuantity(p.quantity)} detail={unit(p.quantity)} />
                    <FigureTile label="Average cost" value={formatPrice(p.avgCost, fmt, symbol)} detail={`per ${unit(1)}, fees included`} />
                    <FigureTile label="Invested" value={fmt(p.costBasis)} detail="In what you hold now" />
                    <FigureTile
                        label="Unrealised"
                        value={formatSigned(summary.unrealized, fmt)}
                        valueColor={tone(summary.unrealized)}
                        detail={formatPct(summary.unrealizedPct)}
                    />
                    <FigureTile label="Realised" value={formatSigned(p.realized, fmt)} valueColor={tone(p.realized)} detail="From sales" />
                    <FigureTile label="Dividends" value={fmt(p.dividends)} detail={`Fees paid ${fmt(p.fees)}`} />
                </View>

                {/* ── Actions ───────────────────────────────────────── */}
                <View className="px-5 mt-5 flex-row" style={{ gap: 8 }}>
                    <AppButton label="Buy" size="sm" icon="add" onPress={() => setTradeSheet({ type: 'buy', editing: null })} flex />
                    <AppButton label="Sell" size="sm" variant="secondary" onPress={() => setTradeSheet({ type: 'sell', editing: null })} disabled={!summary.isOpen} flex />
                    <AppButton label="Dividend" size="sm" variant="secondary" onPress={() => setTradeSheet({ type: 'dividend', editing: null })} flex />
                </View>

                {/* ── Price history ─────────────────────────────────── */}
                {history.length >= 2 && (
                    <ChartCard
                        kicker="Price history"
                        title={`Price per ${unit(1)}`}
                        legend={[
                            { label: 'Price', color: chart.accent },
                            ...(p.quantity > 0 ? [{ label: 'Your average cost', color: chart.muted, dashed: true }] : []),
                        ]}
                    >
                        <LineChart
                            labels={history.map(h => formatShortDay(h.date))}
                            series={[{ key: 'price', label: 'Price', color: chart.accent, values: history.map(h => h.price) }]}
                            reference={p.quantity > 0 ? { value: p.avgCost, color: chart.muted } : undefined}
                            zeroBased={false}
                            formatValue={v => formatPrice(v, fmt, symbol)}
                            formatAxis={v => (Math.abs(v) >= 1000 ? compactMoney(v, symbol) : `${symbol}${Number.parseFloat(v.toPrecision(3))}`)}
                            accessibilityLabel={`Price history, from ${formatPrice(history[0].price, fmt, symbol)} to ${formatPrice(history[history.length - 1].price, fmt, symbol)}.`}
                        />
                    </ChartCard>
                )}

                {/* ── Activity ──────────────────────────────────────── */}
                <View className="px-5 mt-7">
                    <ThemedText type="headline" className="text-xl leading-7 mb-1" accessibilityRole="header">Activity</ThemedText>
                    <ThemedText type="caption" className="mb-2">Tap an entry to edit or delete it.</ThemedText>
                    {newestFirst.length === 0 ? (
                        <ThemedText type="caption" className="py-6 text-center">No buys, sells or dividends yet.</ThemedText>
                    ) : (
                        newestFirst.map((t, i) => {
                            const line = tradeLine(t);
                            return (
                                <Pressable
                                    key={t.id}
                                    onPress={() => setTradeSheet({ type: t.type, editing: t })}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${line.title}, ${formatShortDay(t.date)}, ${line.amount}. Edit`}
                                    className={`flex-row items-center py-3 ${i < newestFirst.length - 1 ? 'border-b border-divider dark:border-dark-divider' : ''}`}
                                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                                >
                                    <Ionicons
                                        name={TRADE_ICONS[t.type]}
                                        size={22}
                                        color={t.type === 'sell' ? colors.expense : t.type === 'dividend' ? colors.income : colors.primary}
                                    />
                                    <View className="flex-1 mx-3">
                                        <ThemedText type="label" numberOfLines={2}>{line.title}</ThemedText>
                                        <ThemedText type="caption" numberOfLines={1}>
                                            {formatShortDay(t.date)}
                                            {t.type !== 'dividend' && t.fees > 0 ? ` · fees ${fmt(t.fees)}` : ''}
                                            {t.notes ? ` · ${t.notes}` : ''}
                                        </ThemedText>
                                    </View>
                                    <ThemedText type="figure" className="text-sm">{line.amount}</ThemedText>
                                </Pressable>
                            );
                        })
                    )}
                </View>

                {/* ── Manage ────────────────────────────────────────── */}
                <View className="px-5 mt-8">
                    <AppButton label="Delete holding" variant="destructive" icon="trash-outline" onPress={() => setConfirmDelete(true)} />
                </View>
            </ScrollView>

            {tradeSheet && (
                <TradeSheet
                    visible
                    onClose={() => setTradeSheet(null)}
                    holding={holding}
                    trades={trades}
                    editing={tradeSheet.editing}
                    initialType={tradeSheet.type}
                />
            )}
            <HoldingFormSheet visible={editOpen} onClose={() => setEditOpen(false)} editing={holding} />
            <UpdatePricesSheet visible={priceOpen} onClose={() => setPriceOpen(false)} holdings={[summary]} />
            {confirmDelete && (
                <ConfirmDialog
                    title="Delete holding"
                    message={`Delete ${holding.name} and all ${trades.length} of its entries? This can't be undone.`}
                    confirmLabel="Delete"
                    busy={busy}
                    onCancel={() => setConfirmDelete(false)}
                    onConfirm={handleDelete}
                />
            )}
        </View>
    );
}
