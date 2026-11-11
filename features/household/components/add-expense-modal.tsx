import { parseAmount } from '@/lib/utils/currency';
import { AmountInput, BottomSheet, BottomSheetRef, FormScrollView, SheetHeader, ThemedText } from '@/components/common';
import { CalendarPicker, toLocalDateStr } from '@/components/common/calendar-picker';
import { CategoryChips } from '@/features/transactions/components/category-chips';
import { useCategories } from '@/features/categories/hooks/use-categories';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { createHouseholdExpense, updateHouseholdExpense, type HouseholdExpenseWithCategory } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { POPULAR_CURRENCIES } from '@/features/user/services/user-service';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    Pressable,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AddExpenseModalProps {
    visible: boolean;
    onClose: () => void;
    onSuccess: () => void;
    editingExpense: HouseholdExpenseWithCategory | null;
    currencyCode: string;
    /**
     * Start of the current household period. Earlier dates are disabled: an
     * expense before the period start would never be shown, archived or cleared.
     */
    periodStart?: string;
}

export function AddExpenseModal({ visible, onClose, onSuccess, editingExpense, currencyCode, periodStart }: AddExpenseModalProps) {
    const insets = useSafeAreaInsets();
    const colors = useThemeColors();
    const { categories, refresh: refreshCategories } = useCategories('expense');
    const currencySymbol = POPULAR_CURRENCIES.find(c => c.code === currencyCode)?.symbol ?? '$';

    const [amount, setAmount] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
    const [date, setDate] = useState(toLocalDateStr(new Date()));
    const [notes, setNotes] = useState('');
    const [showCalendar, setShowCalendar] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const amountInputRef = useRef<TextInput>(null);
    const sheetRef = useRef<BottomSheetRef>(null);

    const isEditing = !!editingExpense;

    useEffect(() => {
        if (!visible || isEditing) return;
        const t = setTimeout(() => amountInputRef.current?.focus(), 400);
        return () => clearTimeout(t);
    }, [visible, isEditing]);

    useEffect(() => {
        if (visible) {
            refreshCategories();
            if (editingExpense) {
                setAmount(String(editingExpense.amount));
                setSelectedCategoryId(editingExpense.category_id);
                setDate(editingExpense.date);
                setNotes(editingExpense.notes ?? '');
            } else {
                setAmount('');
                setSelectedCategoryId(null);
                setDate(toLocalDateStr(new Date()));
                setNotes('');
            }
        }
    }, [visible, editingExpense, refreshCategories]);

    const handleClose = () => {
        amountInputRef.current?.blur();
        Keyboard.dismiss();
        setShowCalendar(false);
        sheetRef.current?.dismiss(onClose);
    };

    const handleSubmit = async () => {
        const parsed = parseAmount(amount);
        if (!amount || isNaN(parsed) || parsed <= 0) {
            toast.error('Please enter a valid amount');
            return;
        }
        if (!selectedCategoryId) {
            toast.error('Please select a category');
            return;
        }
        setIsSubmitting(true);
        try {
            if (isEditing && editingExpense) {
                await updateHouseholdExpense(editingExpense.id, {
                    amount: parsed,
                    category_id: selectedCategoryId,
                    date,
                    notes: notes.trim() || null,
                });
                toast.success('Expense updated');
            } else {
                await createHouseholdExpense({
                    amount: parsed,
                    category_id: selectedCategoryId,
                    date,
                    notes: notes.trim() || null,
                });
                toast.success('Expense added');
            }
            handleClose();
            onSuccess();
        } catch (e) {
            logger.error('AddExpenseModal: failed to save', e);
            toast.error('Failed to save expense');
        } finally {
            setIsSubmitting(false);
        }
    };

    const formattedDate = (() => {
        const [y, m, d] = date.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    })();

    if (showCalendar) {
        return (
            <CalendarPicker
                selectedDate={date}
                onSelectDate={(d) => { setDate(d); setShowCalendar(false); }}
                onClose={() => setShowCalendar(false)}
                minimumDate={periodStart || undefined}
            />
        );
    }

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            maxHeight="92%"
            paddingHorizontal={32}
            paddingTop={48}
            paddingBottom={insets.bottom + 32}
            gradientColors={['rgba(239,68,68,0.14)', 'rgba(239,68,68,0.04)', 'transparent']}
            keyboardAvoiding
        >
            <SheetHeader title={isEditing ? 'Edit Expense' : 'Add Expense'} onClose={handleClose} />

            <FormScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
            >
                <AmountInput
                    ref={amountInputRef}
                    value={amount}
                    onChange={setAmount}
                    currencySymbol={currencySymbol}
                    color={colors.expense}
                />

                {/* Category */}
                <View className="mb-6">
                    <ThemedText type="kicker" className="mb-4" style={{ color: colors.textMuted }}>
                        Category
                    </ThemedText>
                    <CategoryChips
                        categories={categories}
                        selectedCategoryId={selectedCategoryId}
                        onSelect={setSelectedCategoryId}
                    />
                </View>

                {/* Date */}
                <View className="mb-4">
                    <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
                        Date
                    </ThemedText>
                    <Pressable
                        onPress={() => setShowCalendar(true)}
                        className="flex-row items-center px-4 py-3.5 rounded-xl"
                        style={{ backgroundColor: colors.scheme === 'dark' ? colors.gray800 : colors.gray100 }}
                    >
                        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                        <ThemedText className="flex-1 ml-3 font-bold" style={{ color: colors.textPrimary }}>
                            {formattedDate}
                        </ThemedText>
                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </Pressable>
                </View>

                {/* Notes */}
                <View className="mb-8">
                    <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
                        Notes (optional)
                    </ThemedText>
                    <TextInput
                        value={notes}
                        onChangeText={setNotes}
                        placeholder="Add a note..."
                        placeholderTextColor={colors.textMuted}
                        multiline
                        numberOfLines={2}
                        className="px-4 py-3 rounded-xl"
                        style={{
                            backgroundColor: colors.scheme === 'dark' ? colors.gray800 : colors.gray100,
                            color: colors.textPrimary,
                            fontWeight: '600',
                            minHeight: 72,
                            textAlignVertical: 'top',
                        }}
                    />
                </View>

                {/* Submit */}
                <Pressable
                    onPress={handleSubmit}
                    disabled={isSubmitting}
                    className="w-full py-4 rounded-xl items-center"
                    style={{ backgroundColor: colors.error }}
                >
                    {isSubmitting
                        ? <ActivityIndicator color="#fff" />
                        : <ThemedText className="font-black text-base text-white">
                            {isEditing ? 'Update Expense' : 'Add Expense'}
                        </ThemedText>
                    }
                </Pressable>
            </FormScrollView>
        </BottomSheet>
    );
}
