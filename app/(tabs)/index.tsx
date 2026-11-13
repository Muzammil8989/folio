/**
 * Overview — the home tab, laid out like the front page of a report:
 *
 *   masthead      date kicker, serif greeting, avatar → Settings
 *   balance       current balance + how much it moved this month
 *   this month    money in / money out, with the change vs last month
 *   cash flow     6-month income vs spending bars
 *   watch list    budgets past their alert threshold (only when any are)
 *   savings       one-line progress across all goals
 *   recent        last 5 transactions
 *   tools         Bills, Household, Loans, Accounts, Categories, Export
 */

import { EmptyState, IconSymbol, ProgressRing, Section, Skeleton, StatFigure, ThemedText } from '@/components/common';
import { useAccounts } from '@/features/accounts/hooks/use-accounts';
import { BudgetCard } from '@/features/budgets/components/budget-card';
import { useBudgets, type BudgetWithSpend } from '@/features/budgets/hooks/use-budgets';
import { getBudgetStatus } from '@/features/budgets/utils';
import { PortfolioCard } from '@/features/investments/components/portfolio-card';
import { usePortfolio } from '@/features/investments/hooks/use-portfolio';
import { formatPct, portfolioSeries } from '@/features/investments/utils';
import { ToolsGrid } from '@/features/overview/components/tools-grid';
import { TransactionItem } from '@/features/overview/components/transaction-item';
import { CashflowBars } from '@/features/reports/components/cashflow-bars';
import { useChartWidth } from '@/features/reports/utils';
import { useSavingsGoals } from '@/features/savings/hooks/use-savings-goals';
import { useTransactions } from '@/features/transactions/hooks/use-transactions';
import { useUser } from '@/features/user/context/user-context';
import { UserService } from '@/features/user/services/user-service';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { getMonthOverMonthTotals, getMonthlyTotals, type MonthOverMonthTotals, type MonthlyTotals } from '@/lib/db/queries';
import { parseLocalDate, toISODateString } from '@/lib/utils/date';
import { logger } from '@/lib/logger';
import { useModalActions, useRefreshSignal } from '@/providers/modal-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { type Href, router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { InteractionManager, RefreshControl, ScrollView, View } from 'react-native';
import { Pressable } from '@/components/common/pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function greeting(now: Date): string {
    const h = now.getHours();
    if (h < 5) return 'Good evening';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
}

const RECENT_OPTIONS = { limit: 5 } as const;

function pctChange(current: number, previous: number): number | null {
    if (previous <= 0) return null;
    return ((current - previous) / previous) * 100;
}

function OverviewSkeleton() {
    return (
        <View className="px-5">
            <Skeleton width="45%" height={12} borderRadius={4} style={{ marginBottom: 10 }} />
            <Skeleton width="70%" height={40} borderRadius={6} style={{ marginBottom: 28 }} />
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 28 }}>
                <Skeleton height={56} borderRadius={6} style={{ flex: 1 }} />
                <Skeleton height={56} borderRadius={6} style={{ flex: 1 }} />
            </View>
            <Skeleton height={140} borderRadius={6} style={{ marginBottom: 28 }} />
            {[0, 1, 2, 3].map(i => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}>
                    <Skeleton width={36} height={36} borderRadius={18} />
                    <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <Skeleton width="50%" height={13} borderRadius={4} style={{ marginBottom: 6 }} />
                        <Skeleton width="30%" height={10} borderRadius={4} />
                    </View>
                    <Skeleton width={64} height={13} borderRadius={4} />
                </View>
            ))}
        </View>
    );
}

export default function OverviewScreen() {
    const { profile } = useUser();
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const chartWidth = useChartWidth() - 8;
    const { openModal } = useModalActions();
    // Stable so the memoized BudgetCards don't re-render with the screen.
    const openBudget = useCallback((budget: BudgetWithSpend) => openModal('budget', { budget }), [openModal]);
    const refreshSignal = useRefreshSignal();
    // Only the 5 rows Recent shows; month figures are totalled in SQL.
    const { transactions: recent, loading: txLoading, refresh } = useTransactions(undefined, RECENT_OPTIONS);
    const { goals, loading: goalsLoading, refresh: refreshGoals } = useSavingsGoals();
    const portfolio = usePortfolio();
    const refreshPortfolio = portfolio.refresh;
    const { accounts, refresh: refreshAccounts } = useAccounts();
    const { budgets, refresh: refreshBudgets } = useBudgets();
    const [monthly, setMonthly] = useState<MonthlyTotals[]>([]);
    const [totals, setTotals] = useState<MonthOverMonthTotals | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const loading = txLoading || goalsLoading;
    const showSkeleton = loading && recent.length === 0;
    const currency = profile.currency;
    // Re-evaluated when the calendar day changes, so "this month" rolls over
    // even if the tab stays mounted across midnight.
    const today = toISODateString(new Date());
    const now = useMemo(() => parseLocalDate(today), [today]);

    const loadMonthly = useCallback(async () => {
        try {
            const [months, monthTotals] = await Promise.all([getMonthlyTotals(6), getMonthOverMonthTotals()]);
            setMonthly(months);
            setTotals(monthTotals);
        } catch (e) {
            logger.error('Failed to load monthly totals', e);
        }
    }, []);

    // `today` too: "this month" rolls over if the tab stays mounted past midnight.
    useEffect(() => {
        const task = InteractionManager.runAfterInteractions(() => { loadMonthly(); });
        return () => task.cancel();
    }, [loadMonthly, refreshSignal, today]);

    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await Promise.all([refresh(), refreshGoals(), refreshAccounts(), refreshBudgets(), loadMonthly(), refreshPortfolio()]);
        setIsRefreshing(false);
    }, [refresh, refreshGoals, refreshAccounts, refreshBudgets, loadMonthly, refreshPortfolio]);

    // Portfolio: a six-month sparkline for the card, and the value for the Tools row.
    const hasPortfolio = portfolio.holdings.length > 0;
    const portfolioSpark = useMemo(
        () => (hasPortfolio ? portfolioSeries(portfolio.holdings, portfolio.tradesByHolding, portfolio.pricesByHolding, '6m') : []),
        [hasPortfolio, portfolio.holdings, portfolio.tradesByHolding, portfolio.pricesByHolding],
    );
    const portfolioHint = hasPortfolio
        ? `${UserService.formatCurrency(portfolio.summary.value, profile.currency)} · ${formatPct(portfolio.summary.totalReturnPct)} total return`
        : undefined;

    const stats = useMemo(() => {
        // Transfers (lending, between accounts, savings) and future-dated
        // entries are already left out by the query.
        const income = totals?.thisMonth.income ?? 0;
        const expense = totals?.thisMonth.expense ?? 0;
        const lastIncome = totals?.lastMonth.income ?? 0;
        const lastExpense = totals?.lastMonth.expense ?? 0;
        const allIncome = totals?.allIncome ?? 0;
        const allExpense = totals?.allExpense ?? 0;
        // Account balances already include opening balances + all transactions,
        // so the total matches Payment Methods and the add-expense balance check.
        const balance = accounts.length
            ? accounts.reduce((sum, a) => sum + a.balance, 0)
            : allIncome - allExpense;
        return {
            balance,
            income,
            expense,
            net: income - expense,
            incomeDelta: pctChange(income, lastIncome),
            expenseDelta: pctChange(expense, lastExpense),
        };
    }, [totals, accounts]);

    const atRisk = useMemo(
        () => budgets
            .filter(b => getBudgetStatus(b.percentUsed, b.alert_threshold ?? 80).tone !== 'ok')
            .sort((a, b) => b.percentUsed - a.percentUsed)
            .slice(0, 2),
        [budgets],
    );

    const savings = useMemo(() => {
        const active = goals.filter(g => g.is_completed !== 1);
        const target = goals.reduce((s, g) => s + g.target_amount, 0);
        const saved = goals.reduce((s, g) => s + g.saved_amount, 0);
        return { count: goals.length, active: active.length, target, saved, pct: target > 0 ? (saved / target) * 100 : 0 };
    }, [goals]);

    const hasCashflow = monthly.some(m => m.income > 0 || m.expense > 0);
    const spentShare = stats.income > 0 ? Math.min((stats.expense / stats.income) * 100, 100) : 0;
    const firstName = (profile.name || '').trim().split(/\s+/)[0];

    return (
        <View className="flex-1 bg-background dark:bg-dark-background" style={{ paddingTop: insets.top }}>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
                showsVerticalScrollIndicator={false}
                // The name + balance band (child 1) pins to the top while scrolling.
                stickyHeaderIndices={[1]}
                refreshControl={
                    <RefreshControl
                        refreshing={isRefreshing}
                        onRefresh={handleRefresh}
                        tintColor={colors.primary}
                        colors={[colors.primary]}
                    />
                }
            >
                {/* 0 ── Masthead (scrolls away) ─────────────────────────── */}
                <View className="px-5 pt-4 pb-4 flex-row items-start">
                    <View className="flex-1 mr-3">
                        <ThemedText type="kicker" className="mb-1.5">
                            {now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
                        </ThemedText>
                        <ThemedText type="display" numberOfLines={1} adjustsFontSizeToFit accessibilityRole="header">
                            {greeting(new Date())}
                        </ThemedText>
                    </View>
                    {/* Clearly labelled way into Settings (the avatar below also opens it). */}
                    <Pressable
                        onPress={() => router.push('/settings' as Href)}
                        accessibilityRole="button"
                        accessibilityLabel="Settings"
                        accessibilityHint="Profile, currency, security, backup and more"
                        className="flex-row items-center h-11 pl-3 pr-4 rounded-full border border-borderStrong dark:border-dark-borderStrong"
                        style={({ pressed }) => ({ backgroundColor: pressed ? colors.backgroundAlt : colors.surface })}
                    >
                        <Ionicons name="settings-outline" size={18} color={colors.textPrimary} />
                        <ThemedText type="label" className="ml-1.5">Settings</ThemedText>
                    </Pressable>
                </View>

                {/* 1 ── Sticky band: name + balance ─────────────────────── */}
                <View
                    className="px-5 pt-3 pb-3 bg-background dark:bg-dark-background border-t-2 border-b border-t-textPrimary dark:border-t-dark-textPrimary border-b-divider dark:border-b-dark-divider"
                >
                    <View className="flex-row items-center">
                        <Pressable
                            onPress={() => router.push('/settings' as Href)}
                            accessibilityRole="button"
                            accessibilityLabel="Profile and settings"
                            className="w-11 h-11 rounded-full items-center justify-center overflow-hidden border border-divider dark:border-dark-divider mr-3"
                            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, backgroundColor: colors.surface })}
                        >
                            {profile.avatar ? (
                                <Image source={{ uri: profile.avatar }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                            ) : (
                                <IconSymbol name="person.fill" color={colors.textSecondary} size={20} />
                            )}
                        </Pressable>
                        <View className="flex-1 mr-3">
                            <ThemedText type="headline" className="text-[20px] leading-7" numberOfLines={1}>
                                {firstName || profile.name || 'Welcome'}
                            </ThemedText>
                            {(stats.income > 0 || stats.expense > 0) ? (
                                <ThemedText type="caption" numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
                                    <ThemedText type="caption" style={{ color: stats.net >= 0 ? colors.income : colors.expense, fontVariant: ['tabular-nums'] }}>
                                        {stats.net >= 0 ? '+' : '−'}{UserService.formatCurrency(Math.abs(stats.net), currency)}
                                    </ThemedText>
                                    {' '}this month
                                </ThemedText>
                            ) : (
                                <ThemedText type="caption" numberOfLines={1}>Your money, clearly kept</ThemedText>
                            )}
                        </View>
                        <View
                            className="items-end"
                            accessible
                            accessibilityLabel={showSkeleton ? 'Current Balance: loading' : `Current Balance: ${UserService.formatCurrency(stats.balance, currency)}`}
                        >
                            <ThemedText type="kicker" className="mb-0.5">Balance</ThemedText>
                            {showSkeleton ? (
                                <Skeleton width={110} height={26} borderRadius={4} />
                            ) : (
                                <ThemedText type="figure" className="text-[24px] leading-8" numberOfLines={1} adjustsFontSizeToFit style={{ maxWidth: 190 }}>
                                    {UserService.formatCurrency(stats.balance, currency)}
                                </ThemedText>
                            )}
                        </View>
                    </View>
                </View>

                {/* 2 ── Content ─────────────────────────────────────────── */}
                <View>
                {showSkeleton ? (
                    <OverviewSkeleton />
                ) : (
                    <>
                        {/* ── This month ──────────────────────────────────── */}
                        <View className="px-5 mt-5">
                            <ThemedText type="kicker" className="mb-3">
                                {now.toLocaleDateString(undefined, { month: 'long' })} so far
                            </ThemedText>
                            <View className="flex-row">
                                <View className="flex-1">
                                    <StatFigure
                                        label="Money in"
                                        value={UserService.formatCurrency(stats.income, currency)}
                                        delta={stats.incomeDelta}
                                        deltaCaption="vs last month"
                                    />
                                </View>
                                <View className="w-px bg-divider dark:bg-dark-divider mx-4" />
                                <View className="flex-1">
                                    <StatFigure
                                        label="Money out"
                                        value={UserService.formatCurrency(stats.expense, currency)}
                                        delta={stats.expenseDelta}
                                        deltaCaption="vs last month"
                                        invertDelta
                                    />
                                </View>
                            </View>
                            {stats.income > 0 && (
                                <View className="mt-4">
                                    <View className="h-1 rounded-full bg-backgroundAlt dark:bg-dark-surfaceAlt overflow-hidden">
                                        <View
                                            className="h-full rounded-full"
                                            style={{ width: `${spentShare}%`, backgroundColor: stats.expense > stats.income ? colors.expense : colors.primary }}
                                        />
                                    </View>
                                    <ThemedText type="caption" className="mt-1.5">
                                        {stats.expense > stats.income
                                            ? `You've spent ${UserService.formatCurrency(stats.expense - stats.income, currency)} more than came in.`
                                            : `You've spent ${Math.round(spentShare)}% of what came in.`}
                                    </ThemedText>
                                </View>
                            )}
                        </View>

                        {/* ── Cash flow ───────────────────────────────────── */}
                        {hasCashflow && (
                            <Section
                                kicker="Last 6 months"
                                title="Cash flow"
                                actionLabel="Insights"
                                onAction={() => router.push('/(tabs)/reports' as Href)}
                            >
                                <CashflowBars data={monthly} currency={currency} width={chartWidth} height={150} compact />
                            </Section>
                        )}

                        {/* ── Watch list: budgets at or past their alert ─── */}
                        {atRisk.length > 0 && (
                            <Section
                                kicker="Needs attention"
                                title="Budgets to watch"
                                actionLabel="All budgets"
                                onAction={() => router.push('/(tabs)/budget' as Href)}
                            >
                                {atRisk.map(b => (
                                    <BudgetCard
                                        key={b.id}
                                        budget={b}
                                        currency={currency}
                                        onEdit={openBudget}
                                        onDelete={openBudget}
                                    />
                                ))}
                            </Section>
                        )}

                        {/* ── Savings ─────────────────────────────────────── */}
                        {savings.count > 0 && (
                            <Section title="Savings" actionLabel="Goals" onAction={() => router.push('/(tabs)/savings' as Href)}>
                                <View className="flex-row items-center">
                                    <ProgressRing percent={savings.pct} size={52} stroke={4} />
                                    <View className="flex-1 ml-4">
                                        <ThemedText type="figure" className="text-lg">
                                            {UserService.formatCurrency(savings.saved, currency)}
                                            <ThemedText type="caption" style={{ fontVariant: ['tabular-nums'] }}>
                                                {' '}of {UserService.formatCurrency(savings.target, currency)}
                                            </ThemedText>
                                        </ThemedText>
                                        <ThemedText type="caption">
                                            {savings.active === 0
                                                ? 'Every goal reached'
                                                : `${savings.active} active ${savings.active === 1 ? 'goal' : 'goals'}`}
                                        </ThemedText>
                                    </View>
                                </View>
                            </Section>
                        )}

                        {/* ── Portfolio ───────────────────────────────────── */}
                        {hasPortfolio && (
                            <PortfolioCard
                                summary={portfolio.summary}
                                series={portfolioSpark}
                                fmt={n => UserService.formatCurrency(n, currency)}
                            />
                        )}

                        {/* ── Recent ──────────────────────────────────────── */}
                        <Section
                            title="Recent activity"
                            actionLabel={recent.length > 0 ? 'See all' : undefined}
                            onAction={recent.length > 0 ? () => router.push('/(tabs)/transactions' as Href) : undefined}
                        >
                            {recent.length === 0 ? (
                                <EmptyState
                                    icon="receipt-outline"
                                    title="Nothing recorded yet"
                                    subtitle="Tap + to add your first expense or income."
                                    compact
                                />
                            ) : (
                                recent.map((tx, i) => (
                                    <TransactionItem key={tx.id} tx={tx} currency={currency} ruled={i < recent.length - 1} />
                                ))
                            )}
                        </Section>

                        {/* ── Tools ───────────────────────────────────────── */}
                        <Section title="Tools">
                            <ToolsGrid portfolioHint={portfolioHint} />
                        </Section>
                    </>
                )}
                </View>
            </ScrollView>
        </View>
    );
}
