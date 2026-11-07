import { parseAmount } from '@/lib/utils/currency';
import { AmountInput, AppButton, BottomSheet, BottomSheetRef, FormScrollView, SegmentedControl, SheetHeader, ThemedText } from '@/components/common';
import { CategoryChips } from '@/features/transactions/components/category-chips';
import { useUser } from '@/features/user/context/user-context';
import { BudgetWithSpend } from '../hooks/use-budgets';
import { useCategories } from '@/features/categories/hooks/use-categories';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { createBudget, deleteBudget, updateBudget } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { POPULAR_CURRENCIES } from '@/features/user/services/user-service';
import React, { useEffect, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PERIODS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
type Period = typeof PERIODS[number];
const PERIOD_SEGMENTS = PERIODS.map(p => ({ key: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));

interface AddBudgetModalProps {
    visible: boolean;
    onClose: () => void;
    onSuccess: () => void;
    editBudget?: BudgetWithSpend | null;
}

export function AddBudgetModal({ visible, onClose, onSuccess, editBudget }: AddBudgetModalProps) {
    const { profile } = useUser();
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const { categories, refresh: refreshCategories } = useCategories('expense');

    const [amount, setAmount] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
    const [period, setPeriod] = useState<Period>('monthly');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const amountInputRef = useRef<TextInput>(null);
    const sheetRef = useRef<BottomSheetRef>(null);

    const isEditing = !!editBudget;
    const currencySymbol = POPULAR_CURRENCIES.find(c => c.code === profile.currency)?.symbol || '$';

    useEffect(() => {
        if (visible) {
            refreshCategories();
            setConfirmDelete(false);
            if (editBudget) {
                setAmount(String(editBudget.amount));
                setSelectedCategoryId(editBudget.category_id);
                setPeriod(editBudget.period);
            } else {
                setAmount('');
                setSelectedCategoryId(null);
                setPeriod('monthly');
            }
        }
    }, [visible, editBudget, refreshCategories]);

    useEffect(() => {
        if (visible && !isEditing) {
            const t = setTimeout(() => amountInputRef.current?.focus(), 400);
            return () => clearTimeout(t);
        }
    }, [visible, isEditing]);

    const handleClose = () => {
        amountInputRef.current?.blur();
        Keyboard.dismiss();
        setAmount('');
        setSelectedCategoryId(null);
        setPeriod('monthly');
        sheetRef.current?.dismiss(onClose);
    };

    const handleSubmit = async () => {
        const parsedAmount = parseAmount(amount);
        if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) { toast.error('Please enter a valid budget amount'); return; }
        if (!selectedCategoryId) { toast.error('Please select a category'); return; }

        setIsSubmitting(true);
        try {
            if (isEditing && editBudget) {
                await updateBudget(editBudget.id, { category_id: selectedCategoryId, amount: parsedAmount, period });
                toast.success('Budget updated');
            } else {
                await createBudget({ category_id: selectedCategoryId, amount: parsedAmount, period, is_active: 1, alert_threshold: 80 });
                toast.success('Budget created');
            }
            handleClose();
            onSuccess();
        } catch (e) {
            logger.error('Failed to save budget', e);
            toast.error('Failed to save budget');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!editBudget) return;
        if (!confirmDelete) { setConfirmDelete(true); return; }
        setIsSubmitting(true);
        try {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
            await deleteBudget(editBudget.id);
            toast.success('Budget deleted');
            handleClose();
            onSuccess();
        } catch (e) {
            logger.error('Failed to delete budget', e);
            toast.error('Failed to delete budget');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            maxHeight="90%"
            paddingHorizontal={24}
            paddingTop={16}
            paddingBottom={insets.bottom + 40}
            keyboardAvoiding
        >
            <SheetHeader
                kicker={isEditing ? (editBudget?.categoryName ?? 'All categories') : 'Spending limit'}
                title={isEditing ? 'Edit budget' : 'New budget'}
                onClose={handleClose}
            />

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
                />

                <View className="mb-8">
                    <ThemedText type="kicker" className="mb-3">Category</ThemedText>
                    <CategoryChips categories={categories} selectedCategoryId={selectedCategoryId} onSelect={setSelectedCategoryId} />
                </View>

                <View className="mb-10">
                    <ThemedText type="kicker" className="mb-1">Resets every</ThemedText>
                    <SegmentedControl options={PERIOD_SEGMENTS} value={period} onChange={setPeriod} />
                </View>

                <AppButton
                    label={isEditing ? 'Save changes' : 'Create budget'}
                    onPress={handleSubmit}
                    loading={isSubmitting}
                    disabled={isSubmitting}
                />

                {isEditing && (
                    <View className="mt-4 flex-row items-center justify-center gap-3">
                        {confirmDelete && (
                            <Pressable
                                onPress={() => setConfirmDelete(false)}
                                className="min-h-[44px] px-4 justify-center"
                                accessibilityRole="button"
                            >
                                <ThemedText type="label" style={{ color: colors.textSecondary }}>Keep it</ThemedText>
                            </Pressable>
                        )}
                        <Pressable
                            onPress={handleDelete}
                            disabled={isSubmitting}
                            className="min-h-[44px] px-4 justify-center"
                            accessibilityRole="button"
                            accessibilityHint={confirmDelete ? 'Deletes this budget permanently' : 'Asks for confirmation'}
                        >
                            <ThemedText type="label" style={{ color: colors.expense }}>
                                {confirmDelete ? 'Confirm delete' : 'Delete budget'}
                            </ThemedText>
                        </Pressable>
                    </View>
                )}
            </FormScrollView>
        </BottomSheet>
    );
}
