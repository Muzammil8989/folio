/**
 * One past household month from History: its own income (editable), what was
 * spent and left, and every expense logged in it.
 */
import {
    AmountInput,
    AppButton,
    BottomSheet,
    BottomSheetRef,
    EmptyState,
    FormScrollView,
    ScreenHeader,
    SheetHeader,
    ThemedText,
} from '@/components/common';
import { ExpenseItem } from '@/features/household/components/expense-item';
import { HouseholdExportSheet } from '@/features/household/components/household-export-sheet';
import { SummaryBar } from '@/features/household/components/summary-bar';
import { formatPeriodRange as formatRange } from '@/features/household/hooks/use-household';
import { useUser } from '@/features/user/context/user-context';
import { POPULAR_CURRENCIES, UserService } from '@/features/user/services/user-service';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { isDbReady } from '@/lib/db/db-client';
import {
    getHouseholdExpenses,
    getHouseholdHistoryEntry,
    updateHouseholdHistoryIncome,
    type HouseholdExpenseWithCategory,
    type HouseholdHistoryEntry,
} from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { parseAmount } from '@/lib/utils/currency';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ListRenderItem, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PERIOD_NOUN: Record<string, string> = { monthly: 'month', weekly: 'week', yearly: 'year' };

const keyExtractor = (item: HouseholdExpenseWithCategory) => String(item.id);

function EditIncomeSheet({
    visible,
    entry,
    currencyCode,
    onClose,
    onSaved,
}: {
    visible: boolean;
    entry: HouseholdHistoryEntry;
    currencyCode: string;
    onClose: () => void;
    onSaved: () => void;
}) {
    const insets = useSafeAreaInsets();
    const sheetRef = useRef<BottomSheetRef>(null);
    const [amount, setAmount] = useState(String(entry.income_amount));
    const [saving, setSaving] = useState(false);
    const currencySymbol = POPULAR_CURRENCIES.find(c => c.code === currencyCode)?.symbol ?? '$';
    const noun = PERIOD_NOUN[entry.period] ?? 'period';

    useEffect(() => {
        if (visible) setAmount(String(entry.income_amount));
    }, [visible, entry.income_amount]);

    const save = async () => {
        const parsed = parseAmount(amount);
        if (!amount || isNaN(parsed) || parsed <= 0) {
            toast.error('Please enter a valid income amount');
            return;
        }
        setSaving(true);
        try {
            await updateHouseholdHistoryIncome(entry.id, parsed);
            toast.success(`Income updated for this ${noun}`);
            sheetRef.current?.dismiss(onSaved);
        } catch (e) {
            logger.error('HouseholdPeriodScreen: income update failed', e);
            toast.error('Failed to update income');
        } finally {
            setSaving(false);
        }
    };

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            paddingHorizontal={24}
            paddingTop={16}
            paddingBottom={insets.bottom + 32}
        >
            <SheetHeader
                kicker={formatRange(entry.start_date, entry.end_date)}
                title={`This ${noun}'s income`}
                onClose={() => sheetRef.current?.dismiss(onClose)}
            />
            <FormScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                <AmountInput value={amount} onChange={setAmount} currencySymbol={currencySymbol} />
                <ThemedText className="text-xs mb-6 text-textMuted dark:text-dark-textMuted">
                    {`Changes this ${noun} only. Other ${noun}s and the current one keep their own income.`}
                </ThemedText>
                <AppButton label="Save Income" onPress={save} loading={saving} disabled={saving} />
            </FormScrollView>
        </BottomSheet>
    );
}

export default function HouseholdPeriodScreen() {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const { profile } = useUser();
    const currencyCode = profile.currency;
    const { id } = useLocalSearchParams<{ id?: string }>();
    const entryId = Number(id);

    const [entry, setEntry] = useState<HouseholdHistoryEntry | null>(null);
    const [expenses, setExpenses] = useState<HouseholdExpenseWithCategory[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingIncome, setEditingIncome] = useState(false);
    const [exportVisible, setExportVisible] = useState(false);

    const load = useCallback(async () => {
        if (!isDbReady() || !Number.isFinite(entryId)) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const found = await getHouseholdHistoryEntry(entryId);
            setEntry(found);
            setExpenses(found?.entries_kept ? await getHouseholdExpenses(found.start_date, found.end_date) : []);
        } catch (e) {
            logger.error('HouseholdPeriodScreen: load failed', e);
            toast.error('Failed to load this period');
        } finally {
            setLoading(false);
        }
    }, [entryId]);

    useEffect(() => {
        load();
    }, [load]);

    const renderExpense = useCallback<ListRenderItem<HouseholdExpenseWithCategory>>(({ item }) => (
        <View className="px-5">
            <ExpenseItem item={item} currencyCode={currencyCode} />
        </View>
    ), [currencyCode]);

    const noun = entry ? PERIOD_NOUN[entry.period] ?? 'period' : 'period';
    const title = entry ? formatRange(entry.start_date, entry.end_date) : 'Household History';

    return (
        <View className="flex-1 bg-background dark:bg-dark-background">
            <View style={{ paddingTop: insets.top }}>
                <ScreenHeader
                    title={title}
                    subtitle={entry ? `Household budget for this ${noun}` : undefined}
                    right={entry ? (
                        <Pressable
                            onPress={() => setExportVisible(true)}
                            accessibilityRole="button"
                            accessibilityLabel={`Export this ${noun} as PDF or Excel`}
                            className="w-11 h-11 rounded-xl items-center justify-center"
                            style={{ borderWidth: 1, borderColor: colors.borderStrong }}
                            hitSlop={6}
                        >
                            <Ionicons name="share-outline" size={20} color={colors.primary} />
                        </Pressable>
                    ) : undefined}
                />
            </View>

            {loading ? (
                <View className="py-24 items-center">
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : !entry ? (
                <View className="px-5">
                    <EmptyState
                        icon="alert-circle-outline"
                        title="Period not found"
                        subtitle="It may have been deleted from History."
                        compact
                    />
                </View>
            ) : (
                <FlatList
                    className="flex-1"
                    data={expenses}
                    keyExtractor={keyExtractor}
                    renderItem={renderExpense}
                    contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
                    showsVerticalScrollIndicator={false}
                    ListHeaderComponent={
                        <View style={{ paddingHorizontal: 20 }}>
                            <View
                                className="flex-row items-center justify-between rounded-xl p-4 mb-4"
                                style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.divider }}
                            >
                                <View className="flex-1">
                                    <ThemedText type="kicker" className="mb-0.5">{`This ${noun}'s income`}</ThemedText>
                                    <ThemedText
                                        className="text-2xl font-semibold text-textPrimary dark:text-dark-textPrimary"
                                        numberOfLines={1}
                                        adjustsFontSizeToFit
                                    >
                                        {UserService.formatCurrency(entry.income_amount, currencyCode)}
                                    </ThemedText>
                                </View>
                                <Pressable
                                    onPress={() => setEditingIncome(true)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Edit this ${noun}'s income`}
                                    className="flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl"
                                    style={{ borderWidth: 1, borderColor: colors.borderStrong }}
                                    hitSlop={8}
                                >
                                    <Ionicons name="pencil-outline" size={13} color={colors.primary} />
                                    <ThemedText className="text-[11px] font-semibold" style={{ color: colors.primary }}>
                                        Edit
                                    </ThemedText>
                                </Pressable>
                            </View>

                            <SummaryBar
                                summary={{ income: entry.income_amount, spent: entry.spent_amount, remaining: entry.remaining_amount }}
                                currencyCode={currencyCode}
                            />

                            <View className="flex-row items-center justify-between mb-3">
                                <ThemedText type="kicker">{`Expenses this ${noun}`}</ThemedText>
                                <ThemedText className="text-xs font-medium text-textMuted dark:text-dark-textMuted">
                                    {entry.expense_count} {entry.expense_count === 1 ? 'item' : 'items'}
                                </ThemedText>
                            </View>
                        </View>
                    }
                    ListEmptyComponent={
                        <View className="px-5">
                            {entry.entries_kept ? (
                                <EmptyState
                                    icon="receipt-outline"
                                    title="No expenses"
                                    subtitle={`Nothing was logged this ${noun}.`}
                                    compact
                                />
                            ) : (
                                <ThemedText className="text-sm text-center py-8 text-textMuted dark:text-dark-textMuted">
                                    {`Individual expenses weren't kept for ${noun}s that closed before this update. The totals above are what was recorded at the time.`}
                                </ThemedText>
                            )}
                        </View>
                    }
                />
            )}

            {entry && (
                <HouseholdExportSheet
                    visible={exportVisible}
                    scope={{ kind: 'history', id: entry.id }}
                    onClose={() => setExportVisible(false)}
                />
            )}

            {entry && (
                <EditIncomeSheet
                    visible={editingIncome}
                    entry={entry}
                    currencyCode={currencyCode}
                    onClose={() => setEditingIncome(false)}
                    onSaved={() => {
                        setEditingIncome(false);
                        load();
                    }}
                />
            )}
        </View>
    );
}
