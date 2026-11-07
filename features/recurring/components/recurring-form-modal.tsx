import { AppButton, AppModal, FormScrollView, ThemedText } from '@/components/common';
import type { Category } from '@/features/categories/hooks/use-categories';
import { processRecurringTransactions } from '@/features/recurring/services/recurring-processor';
import { CategoryChips } from '@/features/transactions/components/category-chips';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { Account, createRecurringExpense, updateRecurringExpense } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { formatWithCommas, numberToWords, parseAmount } from '@/lib/utils/currency';
import { todayString } from '@/lib/utils/date';
import { IoniconsName } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
    Pressable,
    TextInput,
    View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FREQUENCY_LABELS, RecurringFrequency, RecurringItem } from './recurring-row';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

interface RecurringFormModalProps {
    visible: boolean;
    /** Item being edited, or null when adding a new one. */
    editItem: RecurringItem | null;
    /** Type a new item is added as (ignored when editing). */
    type: 'expense' | 'income';
    categories: Category[];
    accounts: Account[];
    currencySymbol: string;
    onClose: () => void;
    onSaved: () => void;
}

/**
 * Add / edit sheet for a recurring income or expense. Owns its form state so
 * typing only re-renders the sheet, not the list behind it. The parent
 * remounts it (via `key`) each time it opens, so the initial state below is
 * the reset.
 */
export function RecurringFormModal({
    visible,
    editItem,
    type,
    categories,
    accounts,
    currencySymbol,
    onClose,
    onSaved,
}: RecurringFormModalProps) {
    const insets = useSafeAreaInsets();
    const colors = useThemeColors();

    const [amount, setAmount] = useState(editItem ? editItem.amount.toString() : '');
    const [frequency, setFrequency] = useState<RecurringFrequency>(editItem?.frequency ?? 'monthly');
    const [categoryId, setCategoryId] = useState<number | null>(editItem?.category_id ?? null);
    const [accountId, setAccountId] = useState<number | null>(editItem ? editItem.account_id : (accounts?.[0]?.id ?? null));
    const [notes, setNotes] = useState(editItem?.notes || '');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const itemType = editItem ? editItem.categoryType : type;
    const isIncome = itemType === 'income';
    const filteredCategories = useMemo(
        () => (categories || []).filter(c => c?.type === itemType),
        [categories, itemType],
    );

    const handleSubmit = async () => {
        const parsedAmount = parseAmount(amount);
        if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
            toast.error('Please enter a valid amount');
            return;
        }
        if (!categoryId) {
            toast.error('Please select a category');
            return;
        }
        if (!accountId) {
            toast.error('Please select a payment method');
            return;
        }

        setIsSubmitting(true);
        try {
            if (editItem) {
                await updateRecurringExpense(editItem.id, {
                    amount: parsedAmount,
                    frequency,
                    category_id: categoryId,
                    account_id: accountId,
                    notes: notes.trim() || null,
                });
                toast.success('Recurring item updated');
            } else {
                await createRecurringExpense({
                    amount: parsedAmount,
                    frequency,
                    category_id: categoryId,
                    account_id: accountId,
                    start_date: todayString(),
                    notes: notes.trim() || null,
                    is_active: 1,
                });
                // Book today's occurrence now rather than on next app launch.
                await processRecurringTransactions();
                toast.success('Recurring item added');
            }
            onSaved();
        } catch (error) {
            if (editItem) {
                logger.error('Error updating recurring item:', error);
                toast.error('Failed to update');
            } else {
                logger.error('Error creating recurring item:', error);
                toast.error('Failed to add');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AppModal
            visible={visible}
            animationType="slide"
            transparent
            onRequestClose={onClose}
        >
            <KeyboardAvoidingView
                behavior="padding"
                style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
            >
                <Animated.View
                    entering={FadeInDown.duration(350)}
                    style={{
                        // Same reading column as the app on tablets / landscape.
                        width: '100%',
                        maxWidth: MAX_CONTENT_WIDTH,
                        alignSelf: 'center',
                        backgroundColor: colors.surface,
                        borderTopLeftRadius: 24,
                        borderTopRightRadius: 24,
                        paddingHorizontal: 24,
                        paddingTop: 16,
                        paddingBottom: insets.bottom + 40,
                        maxHeight: '90%',
                        overflow: 'hidden',
                    }}
                >
                    <View className="flex-row justify-between items-center mb-8">
                        <View className="flex-row items-center gap-3">
                            <Ionicons name="repeat" size={22} color={isIncome ? colors.success : colors.error} />
                            <ThemedText className="text-xl font-bold">
                                {editItem ? 'Edit Recurring' : `New ${isIncome ? 'Income' : 'Expense'}`}
                            </ThemedText>
                        </View>
                        <Pressable onPress={onClose} hitSlop={4} className="p-2">
                            <Ionicons name="close" size={24} color={colors.expense} />
                        </Pressable>
                    </View>

                    <FormScrollView
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingBottom: 24 }}
                    >
                        {/* Amount */}
                        <View className="mb-6">
                            <ThemedText type="kicker" className="mb-2" style={{ color: colors.textMuted }}>Amount</ThemedText>
                            <View className="flex-row items-center rounded-xl px-6 py-4" style={{ backgroundColor: colors.backgroundAlt }}>
                                <ThemedText className="text-lg font-bold mr-2" style={{ color: colors.textMuted }}>{currencySymbol}</ThemedText>
                                <TextInput
                                    value={amount}
                                    onChangeText={setAmount}
                                    keyboardType="decimal-pad"
                                    placeholder="0.00"
                                    placeholderTextColor={colors.textMuted}
                                    className="flex-1 text-lg font-bold"
                                    style={{ color: colors.textPrimary, fontFamily: 'SpaceGrotesk_700Bold' }}
                                />
                            </View>
                            {!!amount && !isNaN(parseAmount(amount)) && parseAmount(amount) > 0 && (
                                <View className="items-center mt-2 gap-0.5">
                                    <ThemedText className="text-sm font-bold" style={{ color: colors.primary }}>
                                        {formatWithCommas(amount)}
                                    </ThemedText>
                                    <ThemedText className="text-xs font-medium" style={{ color: colors.textMuted }}>
                                        {numberToWords(parseAmount(amount))}
                                    </ThemedText>
                                </View>
                            )}
                        </View>

                        {/* Frequency */}
                        <View className="mb-6">
                            <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>Frequency</ThemedText>
                            <View className="flex-row gap-2">
                                {(['daily', 'weekly', 'monthly', 'yearly'] as const).map(freq => (
                                    <Pressable
                                        key={freq}
                                        onPress={() => setFrequency(freq)}
                                        className="flex-1 py-3 rounded-xl items-center"
                                        style={{
                                            backgroundColor: frequency === freq ? colors.primary : colors.backgroundAlt,
                                        }}
                                    >
                                        <ThemedText
                                            className="text-xs font-bold"
                                            style={{ color: frequency === freq ? colors.white : colors.textSecondary }}
                                        >
                                            {FREQUENCY_LABELS[freq]}
                                        </ThemedText>
                                    </Pressable>
                                ))}
                            </View>
                        </View>

                        {/* Category */}
                        <View className="mb-6">
                            <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>Category</ThemedText>
                            <CategoryChips
                                categories={filteredCategories}
                                selectedCategoryId={categoryId}
                                onSelect={setCategoryId}
                            />
                        </View>

                        {/* Account */}
                        <View className="mb-6">
                            <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>Payment Method</ThemedText>
                            <View className="flex-row flex-wrap gap-2">
                                {(accounts || []).map(acc => {
                                    if (!acc?.id) return null;
                                    const isSelected = accountId === acc.id;
                                    return (
                                        <Pressable
                                            key={acc.id}
                                            onPress={() => setAccountId(acc.id)}
                                            className="px-4 py-3 rounded-xl flex-row items-center gap-2"
                                            style={{
                                                backgroundColor: isSelected ? colors.primary : colors.backgroundAlt,
                                                borderWidth: isSelected ? 0 : 1,
                                                borderColor: isSelected ? 'transparent' : colors.borderSoft,
                                            }}
                                        >
                                            <Ionicons name={(acc.icon || 'wallet') as IoniconsName} size={16} color={isSelected ? colors.white : (acc.color || colors.textMuted)} />
                                            <ThemedText className="text-sm font-bold" style={{ color: isSelected ? colors.white : colors.textSecondary }}>
                                                {acc.name}
                                            </ThemedText>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>

                        {/* Notes */}
                        <View className="mb-8">
                            <ThemedText type="kicker" className="mb-2" style={{ color: colors.textMuted }}>Note</ThemedText>
                            <TextInput
                                value={notes}
                                onChangeText={setNotes}
                                placeholder="Description..."
                                placeholderTextColor={colors.textMuted}
                                multiline
                                numberOfLines={2}
                                className="w-full rounded-xl py-3 px-4 text-sm font-bold"
                                style={{ color: colors.textPrimary, backgroundColor: colors.backgroundAlt, fontFamily: 'PlusJakartaSans_700Bold' }}
                            />
                        </View>

                        {editItem ? (
                            <AppButton
                                label="Update Recurring"
                                onPress={handleSubmit}
                                loading={isSubmitting}
                                disabled={isSubmitting}
                            />
                        ) : (
                            <AppButton
                                label={`Add Recurring ${isIncome ? 'Income' : 'Expense'}`}
                                onPress={handleSubmit}
                                loading={isSubmitting}
                                disabled={isSubmitting}
                                color={isIncome ? colors.success : colors.error}
                            />
                        )}
                    </FormScrollView>
                </Animated.View>
            </KeyboardAvoidingView>
        </AppModal>
    );
}
