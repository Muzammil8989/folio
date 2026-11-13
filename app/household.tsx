import { AppModal, EmptyState, Fab, ScreenHeader, ThemedText } from '@/components/common';
import { IncomeCard } from '@/features/household/components/income-card';
import { SummaryBar } from '@/features/household/components/summary-bar';
import { ExpenseItem } from '@/features/household/components/expense-item';
import { IncomeSetupModal } from '@/features/household/components/income-setup-modal';
import { AddExpenseModal } from '@/features/household/components/add-expense-modal';
import { TransferModal } from '@/features/household/components/transfer-modal';
import { HouseholdExportSheet } from '@/features/household/components/household-export-sheet';
import { useHousehold } from '@/features/household/hooks/use-household';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useUser } from '@/features/user/context/user-context';
import { UserService } from '@/features/user/services/user-service';
import { confirmHouseholdIncome, deleteHouseholdExpenseWithLink, HouseholdExpenseWithCategory } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { NotificationService } from '@/features/notifications/services/notification-service';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    FlatList,
    ListRenderItem,
    Pressable,
    View,
} from 'react-native';
import Animated, { Easing, FadeInDown, FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';

const keyExtractor = (item: HouseholdExpenseWithCategory) => String(item.id);

function DeleteConfirmSheet({
    expense,
    onCancel,
    onConfirm,
    isDeleting,
}: {
    expense: HouseholdExpenseWithCategory;
    onCancel: () => void;
    onConfirm: () => void;
    isDeleting: boolean;
}) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();

    return (
        <AppModal visible animationType="fade" transparent onRequestClose={onCancel}>
            <View className="flex-1 justify-end bg-black/50">
                <Animated.View
                    entering={FadeInUp.duration(300).easing(Easing.out(Easing.cubic))}
                    exiting={FadeOutDown.duration(200).easing(Easing.in(Easing.cubic))}
                    style={{
                        width: '100%',
                        maxWidth: MAX_CONTENT_WIDTH,
                        alignSelf: 'center',
                        backgroundColor: colors.surface,
                        borderTopLeftRadius: 24,
                        borderTopRightRadius: 24,
                        paddingHorizontal: 24,
                        paddingTop: 16,
                        paddingBottom: insets.bottom + 32,
                        overflow: 'hidden',
                        borderTopWidth: 1,
                        borderColor: colors.divider,
                    }}
                >
                    <View className="w-9 h-1 bg-borderStrong dark:bg-dark-borderStrong rounded-full mx-auto mb-5" />

                    <View
                        className="w-16 h-16 rounded-full items-center justify-center mx-auto mb-5 border border-divider dark:border-dark-divider"
                    >
                        <Ionicons name="trash-outline" size={28} color={colors.expense} />
                    </View>

                    <ThemedText type="headline" className="text-center mb-2" accessibilityRole="header">
                        Delete Expense?
                    </ThemedText>
                    <ThemedText className="text-sm text-center mb-8 text-textMuted dark:text-dark-textMuted">
                        “{expense.categoryName ?? 'Expense'}” will be permanently removed.
                    </ThemedText>

                    <View className="gap-3">
                        <Pressable
                            onPress={onConfirm}
                            disabled={isDeleting}
                            className="w-full py-4 rounded-xl items-center"
                            style={{ backgroundColor: colors.error }}
                        >
                            {isDeleting
                                ? <ActivityIndicator color="#fff" />
                                : <ThemedText className="font-semibold text-base text-white">Delete</ThemedText>
                            }
                        </Pressable>
                        <Pressable
                            onPress={onCancel}
                            className="w-full py-4 rounded-xl items-center bg-backgroundAlt dark:bg-dark-backgroundAlt"
                        >
                            <ThemedText className="font-semibold text-base text-textPrimary dark:text-dark-textPrimary">
                                Cancel
                            </ThemedText>
                        </Pressable>
                    </View>
                </Animated.View>
            </View>
        </AppModal>
    );
}

const PERIOD_NOUN = { monthly: 'month', weekly: 'week', yearly: 'year' } as const;

/** Shown when a new month has started: its income is last month's, carried over. */
function NewPeriodIncomeBanner({
    period,
    amount,
    busy,
    onKeep,
    onChange,
}: {
    period: keyof typeof PERIOD_NOUN;
    amount: string;
    busy: boolean;
    onKeep: () => void;
    onChange: () => void;
}) {
    const colors = useThemeColors();
    const noun = PERIOD_NOUN[period];
    return (
        <View
            className="p-4 rounded-xl mb-4"
            style={{ backgroundColor: `${colors.primary}12`, borderWidth: 1, borderColor: `${colors.primary}30` }}
            accessibilityRole="alert"
        >
            <View className="flex-row items-center gap-2 mb-1">
                <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                <ThemedText className="font-semibold text-sm" style={{ color: colors.primary }}>
                    {`New ${noun} started`}
                </ThemedText>
            </View>
            <ThemedText className="text-xs mb-3 text-textSecondary dark:text-dark-textSecondary">
                {`Last ${noun} was saved to History. Set this ${noun}'s household income: it is ${amount} for now, the same as last ${noun}.`}
            </ThemedText>
            <View className="flex-row gap-2">
                <Pressable
                    onPress={onKeep}
                    disabled={busy}
                    accessibilityRole="button"
                    className="flex-1 py-2.5 rounded-xl items-center"
                    style={{ backgroundColor: colors.primary }}
                >
                    {busy
                        ? <ActivityIndicator color="#fff" />
                        : <ThemedText className="text-xs font-semibold text-white">{`Keep ${amount}`}</ThemedText>}
                </Pressable>
                <Pressable
                    onPress={onChange}
                    disabled={busy}
                    accessibilityRole="button"
                    className="flex-1 py-2.5 rounded-xl items-center"
                    style={{ borderWidth: 1, borderColor: colors.primary }}
                >
                    <ThemedText className="text-xs font-semibold" style={{ color: colors.primary }}>
                        Change amount
                    </ThemedText>
                </Pressable>
            </View>
        </View>
    );
}

export default function HouseholdScreen() {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const { profile } = useUser();
    const currencyCode = profile.currency;

    const { config, expenses, summary, periodRange, loading, refresh, incomeConfirmed } = useHousehold();
    const [isConfirmingIncome, setIsConfirmingIncome] = useState(false);

    // A new month started with last month's income carried over: keep it as-is.
    const keepCarriedIncome = async () => {
        setIsConfirmingIncome(true);
        try {
            await confirmHouseholdIncome();
            await refresh();
        } catch (e) {
            logger.error('HouseholdScreen: confirm income failed', e);
            toast.error('Failed to save income');
        } finally {
            setIsConfirmingIncome(false);
        }
    };

    const [incomeModalVisible, setIncomeModalVisible] = useState(false);
    const [addExpenseVisible, setAddExpenseVisible] = useState(false);
    const [editingExpense, setEditingExpense] = useState<HouseholdExpenseWithCategory | null>(null);
    const [deletingExpense, setDeletingExpense] = useState<HouseholdExpenseWithCategory | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [transferVisible, setTransferVisible] = useState(false);
    const [exportVisible, setExportVisible] = useState(false);

    const openAddExpense = () => {
        if (config && summary.remaining <= 0) {
            toast.error('No remaining budget — transfer or adjust your income first.');
            return;
        }
        setEditingExpense(null);
        setAddExpenseVisible(true);
    };

    const openEditExpense = useCallback((item: HouseholdExpenseWithCategory) => {
        setEditingExpense(item);
        setAddExpenseVisible(true);
    }, []);

    const renderExpense = useCallback<ListRenderItem<HouseholdExpenseWithCategory>>(({ item }) => (
        <View className="px-5">
            <ExpenseItem
                item={item}
                currencyCode={currencyCode}
                onEdit={openEditExpense}
                onDelete={setDeletingExpense}
            />
        </View>
    ), [currencyCode, openEditExpense]);

    const confirmDelete = async () => {
        if (!deletingExpense) return;
        setIsDeleting(true);
        try {
            await deleteHouseholdExpenseWithLink(deletingExpense);
            toast.success('Expense deleted');
            setDeletingExpense(null);
            refresh();
        } catch (e) {
            logger.error('HouseholdScreen: delete failed', e);
            toast.error('Failed to delete expense');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <View className="flex-1 bg-background dark:bg-dark-background">

            {/* Header stays put; only the content below it scrolls */}
            <View style={{ paddingTop: insets.top }}>
                <ScreenHeader
                    title="Household Budget"
                    subtitle="Track home expenses separately"
                    right={
                        <View className="flex-row items-center gap-2">
                            {config && (
                                <Pressable
                                    onPress={() => setExportVisible(true)}
                                    accessibilityRole="button"
                                    accessibilityLabel="Export this period as PDF or Excel"
                                    className="w-11 h-11 rounded-xl items-center justify-center"
                                    style={{ borderWidth: 1, borderColor: colors.borderStrong }}
                                    hitSlop={6}
                                >
                                    <Ionicons name="share-outline" size={20} color={colors.primary} />
                                </Pressable>
                            )}
                            <Pressable
                                onPress={() => router.push('/household-history')}
                                className="w-11 h-11 rounded-xl items-center justify-center"
                                style={{ borderWidth: 1, borderColor: colors.borderStrong }}
                                hitSlop={6}
                            >
                                <Ionicons name="time-outline" size={20} color={colors.primary} />
                            </Pressable>
                            {!config && (
                                <Pressable
                                    onPress={() => setIncomeModalVisible(true)}
                                    className="w-11 h-11 rounded-xl bg-primary items-center justify-center"
                                >
                                    <Ionicons name="add" size={24} color="#fff" />
                                </Pressable>
                            )}
                        </View>
                    }
                />
            </View>
            {/* Single scroller: summary cards are the list header, expenses are virtualized rows */}
            <FlatList
                className="flex-1"
                data={loading || !config ? [] : expenses}
                keyExtractor={keyExtractor}
                renderItem={renderExpense}
                contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
                showsVerticalScrollIndicator={false}
                ListHeaderComponent={
                    loading || !config ? null : (
                        /* ── Main Content ── */
                        <Animated.View
                            style={{ paddingHorizontal: 20 }}
                            entering={FadeInDown.duration(350).easing(Easing.out(Easing.cubic))}
                        >
                            {/* New month: confirm or change its income (each month has its own) */}
                            {!incomeConfirmed && (
                                <NewPeriodIncomeBanner
                                    period={config.period}
                                    amount={UserService.formatCurrency(config.income_amount, currencyCode)}
                                    busy={isConfirmingIncome}
                                    onKeep={keepCarriedIncome}
                                    onChange={() => setIncomeModalVisible(true)}
                                />
                            )}

                            {/* Income Card */}
                            <IncomeCard
                                config={config}
                                periodRange={periodRange}
                                currencyCode={currencyCode}
                                onEdit={() => setIncomeModalVisible(true)}
                            />

                            {/* Summary Bar */}
                            <SummaryBar summary={summary} currencyCode={currencyCode} />

                            {/* Transfer Button */}
                            {summary.remaining > 0 && (
                                <Pressable
                                    onPress={() => setTransferVisible(true)}
                                    className="flex-row items-center justify-center gap-2 py-3.5 rounded-xl mb-4"
                                    style={{
                                        backgroundColor: `${colors.success}15`,
                                        borderWidth: 1,
                                        borderColor: `${colors.success}35`,
                                    }}
                                >
                                    <Ionicons name="swap-horizontal" size={16} color={colors.success} />
                                    <ThemedText className="font-semibold text-sm" style={{ color: colors.success }}>
                                        Transfer Remaining to Account
                                    </ThemedText>
                                </Pressable>
                            )}

                            {/* Over budget banner */}
                            {summary.remaining < 0 && (
                                <View
                                    className="flex-row items-center gap-2 py-3 px-4 rounded-xl mb-4"
                                    style={{ backgroundColor: `${colors.error}12` }}
                                >
                                    <Ionicons name="warning-outline" size={16} color={colors.expense} />
                                    <ThemedText className="text-xs font-semibold flex-1" style={{ color: colors.expense }}>
                                        Over budget by {UserService.formatCurrency(Math.abs(summary.remaining), currencyCode)}
                                    </ThemedText>
                                </View>
                            )}

                            {/* Section label */}
                            <View className="flex-row items-center justify-between mb-3">
                                <ThemedText type="kicker">
                                    Expenses This Period
                                </ThemedText>
                                <ThemedText className="text-xs font-medium text-textMuted dark:text-dark-textMuted">
                                    {expenses.length} {expenses.length === 1 ? 'item' : 'items'}
                                </ThemedText>
                            </View>
                        </Animated.View>
                    )
                }
                ListEmptyComponent={
                    <View className="px-5">
                        {loading ? (
                            <View className="py-24 items-center">
                                <ActivityIndicator size="large" color={colors.primary} />
                            </View>
                        ) : !config ? (
                            <EmptyState
                                icon="home-outline"
                                title="Set Up Household Budget"
                                subtitle={`Track your home expenses separately.\nSet this month's income and log household expenses against it. Every month keeps its own income and expenses in History.`}
                                actionLabel="Get Started"
                                onAction={() => setIncomeModalVisible(true)}
                                iconColor={colors.primary}
                            />
                        ) : (
                            <EmptyState
                                icon="receipt-outline"
                                title="No Expenses Yet"
                                subtitle="Tap + to log your first home expense."
                                compact
                            />
                        )}
                    </View>
                }
            />

            {/* FAB — shown once budget is set up */}
            {config && (
                <Fab
                    onPress={openAddExpense}
                    accessibilityLabel="Add household expense"
                    style={{ position: 'absolute', bottom: insets.bottom + 24, right: 20 }}
                />
            )}

            {/* Modals */}
            <IncomeSetupModal
                visible={incomeModalVisible}
                onClose={() => setIncomeModalVisible(false)}
                onSuccess={() => {
                    setIncomeModalVisible(false);
                    refresh();
                    NotificationService.scheduleHouseholdPeriodReminder().catch(() => {});
                }}
                existingConfig={config}
                currencyCode={currencyCode}
            />

            <AddExpenseModal
                visible={addExpenseVisible}
                onClose={() => { setAddExpenseVisible(false); setEditingExpense(null); }}
                onSuccess={() => { setAddExpenseVisible(false); setEditingExpense(null); refresh(); }}
                editingExpense={editingExpense}
                currencyCode={currencyCode}
                periodStart={periodRange.start}
            />

            <TransferModal
                visible={transferVisible}
                onClose={() => setTransferVisible(false)}
                onSuccess={() => { setTransferVisible(false); refresh(); }}
                remaining={summary.remaining}
                currencyCode={currencyCode}
            />

            <HouseholdExportSheet
                visible={exportVisible}
                scope={{ kind: 'current' }}
                onClose={() => setExportVisible(false)}
            />

            {deletingExpense && (
                <DeleteConfirmSheet
                    expense={deletingExpense}
                    onCancel={() => setDeletingExpense(null)}
                    onConfirm={confirmDelete}
                    isDeleting={isDeleting}
                />
            )}
        </View>
    );
}
