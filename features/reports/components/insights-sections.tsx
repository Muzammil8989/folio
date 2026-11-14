/**
 * Smaller Insights sections: the plain-English lines, the largest expenses, budgets against spending, and net worth.
 */
import { ThemedText } from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import type { BudgetWithSpend } from '@/features/budgets/hooks/use-budgets';
import { useThemeColors } from '@/hooks/use-theme-colors';
import type { NetWorthParts, TopExpense } from '@/lib/db/queries';
import { parseLocalDate } from '@/lib/utils/date';
import { IoniconsName } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useChartTheme } from '../chart-theme';
import { type InsightLine } from '../utils';
import { GrowBar } from './grow-bar';

// ── Insight lines ────────────────────────────────────────────────────────────

export const InsightLines = React.memo(function InsightLines({ lines }: { lines: InsightLine[] }) {
    const colors = useThemeColors();
    if (!lines.length) return null;
    return (
        <View className="mx-5 mt-5 rounded-2xl border border-divider dark:border-dark-divider bg-surface dark:bg-dark-surface px-4 pt-4 pb-2">
            <ThemedText type="kicker" className="mb-2">Key insights</ThemedText>
            {lines.map(line => (
                <View key={line.key} className="flex-row items-start mb-3">
                    <Ionicons
                        name={line.icon}
                        size={18}
                        style={{ marginTop: 2 }}
                        color={line.tone === 'good' ? colors.income : line.tone === 'bad' ? colors.expense : colors.textMuted}
                    />
                    <ThemedText className="flex-1 ml-3 text-[15px] leading-[22px]" style={{ color: colors.textSecondary }}>
                        {line.text}
                    </ThemedText>
                </View>
            ))}
        </View>
    );
});

// ── Top expenses ─────────────────────────────────────────────────────────────

export const TopExpensesList = React.memo(function TopExpensesList({
    items,
    format,
    onPressCategory,
}: {
    items: TopExpense[];
    format: (n: number) => string;
    onPressCategory?: (categoryId: number) => void;
}) {
    const colors = useThemeColors();
    const dates = useMemo(
        () => items.map(tx => parseLocalDate(tx.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })),
        [items],
    );
    return (
        <View>
            {items.map((tx, i) => {
                const date = dates[i];
                const title = tx.notes?.trim() || tx.categoryName || 'Expense';
                const sub = [tx.notes?.trim() ? tx.categoryName : null, date, tx.accountName].filter(Boolean).join(' · ');
                const row = (
                    <View className={`flex-row items-center py-3 ${i < items.length - 1 ? 'border-b border-divider dark:border-dark-divider' : ''}`}>
                        <ThemedText type="figure" className="w-5 text-xs" style={{ color: colors.textMuted }}>{i + 1}</ThemedText>
                        <View
                            className="w-9 h-9 rounded-full items-center justify-center mr-3"
                            style={{ backgroundColor: colors.backgroundAlt }}
                        >
                            <Ionicons
                                name={(tx.categoryIcon || 'pricetag-outline') as IoniconsName}
                                size={16}
                                color={tx.categoryColor || colors.textSecondary}
                            />
                        </View>
                        <View className="flex-1 mr-3">
                            <ThemedText type="label" numberOfLines={1}>{title}</ThemedText>
                            <ThemedText type="caption" numberOfLines={1}>{sub}</ThemedText>
                        </View>
                        <ThemedText type="figure" className="text-sm" style={{ color: colors.expense }}>{format(tx.amount)}</ThemedText>
                    </View>
                );
                return onPressCategory ? (
                    <Pressable
                        key={tx.id}
                        onPress={() => onPressCategory(tx.categoryId)}
                        accessibilityRole="button"
                        accessibilityLabel={`${title}, ${format(tx.amount)}, ${sub}`}
                        accessibilityHint="Shows only this category"
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                        {row}
                    </Pressable>
                ) : (
                    <View key={tx.id}>{row}</View>
                );
            })}
        </View>
    );
});

// ── Budgets vs spending ──────────────────────────────────────────────────────

const PERIOD_WORD: Record<BudgetWithSpend['period'], string> = {
    daily: 'today',
    weekly: 'this week',
    monthly: 'this month',
    yearly: 'this year',
};

/** Each budget's spending against its limit, fullest first. */
export const BudgetBars = React.memo(function BudgetBars({ budgets, format }: { budgets: BudgetWithSpend[]; format: (n: number) => string }) {
    const colors = useThemeColors();
    const t = useChartTheme();
    const sorted = useMemo(() => [...budgets].sort((a, b) => b.percentUsed - a.percentUsed).slice(0, 6), [budgets]);
    return (
        <View>
            {sorted.map(b => {
                const over = b.spent > b.amount;
                const warn = !over && b.percentUsed >= (b.alert_threshold ?? 80);
                const color = over ? colors.expense : warn ? colors.warning : t.accent;
                const name = b.categoryName ?? 'All spending';
                return (
                    <View
                        key={b.id}
                        className="mb-3.5"
                        accessible
                        accessibilityLabel={`${name}: ${format(b.spent)} of ${format(b.amount)} ${PERIOD_WORD[b.period]}, ${Math.round(b.percentUsed)} percent${over ? ', over budget' : ''}`}
                    >
                        <View className="flex-row items-baseline mb-1.5">
                            <ThemedText type="label" className="flex-1 mr-2" numberOfLines={1}>{name}</ThemedText>
                            <ThemedText type="figure" className="text-[13px]">
                                {format(b.spent)}
                                <ThemedText type="caption">{` of ${format(b.amount)}`}</ThemedText>
                            </ThemedText>
                        </View>
                        <View className="h-2 rounded-sm" style={{ backgroundColor: t.grid }}>
                            <GrowBar width={`${Math.min(100, Math.max(1.5, b.percentUsed))}%`} color={color} />
                        </View>
                        <ThemedText type="caption" className="mt-1" style={over ? { color: colors.expense } : undefined}>
                            {over
                                ? `Over by ${format(b.spent - b.amount)} ${PERIOD_WORD[b.period]}`
                                : `${format(b.remaining)} left ${PERIOD_WORD[b.period]} · ${Math.round(b.percentUsed)}% used`}
                        </ThemedText>
                    </View>
                );
            })}
        </View>
    );
});

// ── Net worth ────────────────────────────────────────────────────────────────

interface NetWorthItem { key: string; label: string; value: number; color: string; icon: IoniconsName }

/** What you own minus what you owe, with a bar showing what the assets are made of. */
export const NetWorthBreakdown = React.memo(function NetWorthBreakdown({
    parts,
    portfolio,
    format,
    onOpenPortfolio,
}: {
    parts: NetWorthParts;
    portfolio: number;
    format: (n: number) => string;
    onOpenPortfolio?: () => void;
}) {
    const colors = useThemeColors();
    const t = useChartTheme();
    const palette = t.categorical;
    const assets: NetWorthItem[] = [
        { key: 'accounts', label: 'Accounts', value: Math.max(0, parts.accounts), color: palette[0], icon: 'card-outline' },
        { key: 'savings', label: 'Savings goals', value: parts.savings, color: palette[1], icon: 'flag-outline' },
        { key: 'portfolio', label: 'Investments', value: portfolio, color: palette[2], icon: 'trending-up-outline' },
        { key: 'lent', label: 'Lent out', value: parts.lent, color: palette[3], icon: 'arrow-redo-outline' },
    ].filter(a => a.value > 0) as NetWorthItem[];
    const owed = parts.borrowed + Math.max(0, -parts.accounts);
    const totalAssets = assets.reduce((s, a) => s + a.value, 0);
    const net = totalAssets - owed;

    return (
        <View>
            <View accessible accessibilityLabel={`Net worth ${net < 0 ? 'minus ' : ''}${format(Math.abs(net))}. Own ${format(totalAssets)}, owe ${format(owed)}.`}>
                <ThemedText type="figure" className="text-[26px] leading-8" style={{ color: net < 0 ? colors.expense : colors.textPrimary }}>
                    {net < 0 ? '−' : ''}{format(Math.abs(net))}
                </ThemedText>
                <ThemedText type="caption">
                    You own {format(totalAssets)}{owed > 0 ? ` and owe ${format(owed)}` : ''}
                </ThemedText>
            </View>

            {totalAssets > 0 && (
                <View className="flex-row h-3 rounded-sm overflow-hidden mt-4" style={{ gap: 2 }}>
                    {assets.map(a => (
                        <View key={a.key} style={{ flex: a.value / totalAssets, backgroundColor: a.color }} />
                    ))}
                </View>
            )}

            <View className="mt-3">
                {assets.map(a => {
                    const row = (
                        <View className="flex-row items-center py-2">
                            <View className="w-2.5 h-2.5 rounded-sm mr-2.5" style={{ backgroundColor: a.color }} />
                            <ThemedText type="label" className="flex-1">{a.label}</ThemedText>
                            <ThemedText type="figure" className="text-[12px] mr-3" style={{ color: t.muted }}>
                                {totalAssets > 0 ? Math.round((a.value / totalAssets) * 100) : 0}%
                            </ThemedText>
                            <ThemedText type="figure" className="text-sm">{format(a.value)}</ThemedText>
                            {a.key === 'portfolio' && onOpenPortfolio && (
                                <Ionicons name="chevron-forward" size={14} color={t.muted} style={{ marginLeft: 4 }} />
                            )}
                        </View>
                    );
                    return a.key === 'portfolio' && onOpenPortfolio ? (
                        <Pressable key={a.key} onPress={onOpenPortfolio} accessibilityRole="link" accessibilityLabel={`Investments ${format(a.value)}. Open portfolio`}>
                            {row}
                        </Pressable>
                    ) : (
                        <View key={a.key}>{row}</View>
                    );
                })}
                {owed > 0 && (
                    <View className="flex-row items-center py-2 border-t border-divider dark:border-dark-divider mt-1">
                        <Ionicons name="remove-circle-outline" size={14} color={colors.expense} style={{ marginRight: 8 }} />
                        <ThemedText type="label" className="flex-1">
                            {parts.borrowed > 0 && parts.accounts < 0 ? 'Borrowed + negative balances' : parts.borrowed > 0 ? 'Borrowed' : 'Negative balances'}
                        </ThemedText>
                        <ThemedText type="figure" className="text-sm" style={{ color: colors.expense }}>−{format(owed)}</ThemedText>
                    </View>
                )}
            </View>
        </View>
    );
});
