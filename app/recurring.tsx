import { AppButton, AppModal, EmptyState, ScreenHeader, SegmentedControl, ThemedText } from '@/components/common';
import { useAccounts } from '@/features/accounts/hooks/use-accounts';
import { useCategories } from '@/features/categories/hooks/use-categories';
import { RecurringFormModal } from '@/features/recurring/components/recurring-form-modal';
import { RecurringItem, RecurringRow } from '@/features/recurring/components/recurring-row';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useUser } from '@/features/user/context/user-context';
import {
    deleteRecurringExpense,
    getRecurringExpensesWithDetails,
    updateRecurringExpense,
} from '@/lib/db/queries';
import { resumeRecurring } from '@/features/recurring/services/recurring-processor';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { UserService } from '@/features/user/services/user-service';
import { useModalActions } from '@/providers/modal-context';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    InteractionManager,
    Pressable,
    ScrollView,
    View,
} from 'react-native';
import Animated, { Easing, FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function DeleteConfirmSheet({
    item,
    onCancel,
    onConfirm,
    isDeleting,
}: {
    item: RecurringItem;
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
                    <View className="w-16 h-16 items-center justify-center mx-auto mb-5">
                        <Ionicons name="trash-outline" size={32} color={colors.expense} />
                    </View>
                    <ThemedText type="headline" className="text-center mb-2" accessibilityRole="header">
                        Delete Recurring
                    </ThemedText>
                    <ThemedText className="text-[15px] text-center text-textSecondary dark:text-dark-textSecondary leading-6 mb-7 px-2">
                        Delete{' '}
                        <ThemedText className="font-bold text-textPrimary dark:text-dark-textPrimary">
                            {item.categoryName}
                        </ThemedText>
                        {' '}recurring {item.categoryType === 'income' ? 'income' : 'expense'}? This cannot be undone.
                    </ThemedText>
                    <View className="flex-row gap-3">
                        <AppButton label="Cancel" onPress={onCancel} variant="secondary" flex />
                        <AppButton label="Delete" onPress={onConfirm} variant="destructive" loading={isDeleting} disabled={isDeleting} flex />
                    </View>
                </Animated.View>
            </View>
        </AppModal>
    );
}

function ToggleConfirmSheet({
    item,
    onCancel,
    onConfirm,
    isLoading,
}: {
    item: RecurringItem;
    onCancel: () => void;
    onConfirm: () => void;
    isLoading: boolean;
}) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const isPaused = item.is_active !== 1;
    const actionColor = isPaused ? colors.success : colors.warning;
    return (
        <AppModal visible animationType="fade" transparent onRequestClose={onCancel}>
            <View className="flex-1 justify-end bg-black/50">
                <Animated.View
                    entering={FadeInUp.duration(300).easing(Easing.out(Easing.cubic))}
                    exiting={FadeOutDown.duration(200).easing(Easing.in(Easing.cubic))}
                    style={{
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
                    <View className="w-16 h-16 items-center justify-center mx-auto mb-5">
                        <Ionicons name={isPaused ? 'play' : 'pause'} size={32} color={actionColor} />
                    </View>
                    <ThemedText type="headline" className="text-center mb-2" accessibilityRole="header">
                        {isPaused ? 'Resume' : 'Pause'} Recurring
                    </ThemedText>
                    <ThemedText className="text-[15px] text-center text-textSecondary dark:text-dark-textSecondary leading-6 mb-7 px-2">
                        {isPaused ? 'Resume' : 'Pause'}{' '}
                        <ThemedText className="font-bold text-textPrimary dark:text-dark-textPrimary">
                            {item.categoryName}
                        </ThemedText>
                        {' '}recurring {item.categoryType === 'income' ? 'income' : 'expense'}?
                    </ThemedText>
                    <View className="flex-row gap-3">
                        <AppButton label="Cancel" onPress={onCancel} variant="secondary" flex />
                        <AppButton label={isPaused ? 'Resume' : 'Pause'} onPress={onConfirm} color={actionColor} loading={isLoading} disabled={isLoading} flex />
                    </View>
                </Animated.View>
            </View>
        </AppModal>
    );
}

export default function RecurringScreen() {
    const insets = useSafeAreaInsets();
    const colors = useThemeColors();
    const { profile } = useUser();
    const { categories } = useCategories();
    const { accounts } = useAccounts();
    const { triggerRefresh } = useModalActions();

    const [items, setItems] = useState<RecurringItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'expense' | 'income'>('expense');

    // Add sheet stays mounted (so it can slide out); bumping the key on each
    // open remounts it with fresh form state.
    const [addModalVisible, setAddModalVisible] = useState(false);
    const [addFormKey, setAddFormKey] = useState(0);
    const [editItem, setEditItem] = useState<RecurringItem | null>(null);
    const [deletingItem, setDeletingItem] = useState<RecurringItem | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [togglingItem, setTogglingItem] = useState<RecurringItem | null>(null);
    const [isToggling, setIsToggling] = useState(false);

    const currencySymbol = UserService.getCurrencySymbol(profile.currency);

    const mountedRef = React.useRef(true);
    React.useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const fetchItems = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getRecurringExpensesWithDetails();
            if (!mountedRef.current) return;
            setItems(data);
        } catch (error) {
            if (!mountedRef.current) return;
            logger.error('Error fetching recurring items:', error);
            toast.error('Failed to load recurring items');
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Defer DB fetch until after the slide-in animation so the screen
        // doesn't re-render mid-animation (spinner → content flash).
        const task = InteractionManager.runAfterInteractions(() => {
            fetchItems();
        });
        return () => task.cancel();
    }, [fetchItems]);

    const openAddModal = useCallback(() => {
        setAddFormKey(k => k + 1);
        setAddModalVisible(true);
    }, []);

    const closeAddModal = useCallback(() => setAddModalVisible(false), []);

    const handleAdded = useCallback(() => {
        setAddModalVisible(false);
        fetchItems();
        triggerRefresh();
    }, [fetchItems, triggerRefresh]);

    const openEditModal = useCallback((item: RecurringItem) => {
        setEditItem(item);
    }, []);

    const closeEditModal = useCallback(() => setEditItem(null), []);

    const handleEdited = useCallback(() => {
        setEditItem(null);
        fetchItems();
        triggerRefresh();
    }, [fetchItems, triggerRefresh]);

    const handleToggleActive = useCallback((item: RecurringItem) => {
        setTogglingItem(item);
    }, []);

    const handleConfirmToggle = async () => {
        if (!togglingItem) return;
        const newActive = togglingItem.is_active === 1 ? 0 : 1;
        setIsToggling(true);
        try {
            // Resuming skips the paused periods instead of back-filling them.
            if (newActive === 1) await resumeRecurring(togglingItem.id);
            else await updateRecurringExpense(togglingItem.id, { is_active: 0 });
            toast.success(`Recurring item ${newActive === 1 ? 'resumed' : 'paused'}`);
            setTogglingItem(null);
            fetchItems();
        } catch (error) {
            logger.error('Error toggling recurring item:', error);
            toast.error('Failed to update');
        } finally {
            setIsToggling(false);
        }
    };

    const handleDelete = useCallback((item: RecurringItem) => {
        setDeletingItem(item);
    }, []);

    const handleConfirmDelete = async () => {
        if (!deletingItem) return;
        setIsDeleting(true);
        try {
            await deleteRecurringExpense(deletingItem.id);
            toast.success('Recurring item deleted');
            setDeletingItem(null);
            fetchItems();
        } catch (error) {
            logger.error('Error deleting recurring item:', error);
            toast.error('Failed to delete');
        } finally {
            setIsDeleting(false);
        }
    };

    const filteredItems = useMemo(() => items.filter(i => i.categoryType === activeTab), [items, activeTab]);

    return (
        <View className="flex-1" style={{ backgroundColor: colors.background }}>
            {/* Header stays put; only the content below it scrolls */}
            <View style={{ paddingTop: insets.top }}>
                <ScreenHeader
                    title="Subscriptions & Bills"
                    right={
                        <Pressable
                            onPress={openAddModal}
                            className="w-11 h-11 rounded-xl items-center justify-center"
                            style={{ backgroundColor: colors.primary }}
                        >
                            <Ionicons name="add" size={26} color={colors.white} />
                        </Pressable>
                    }
                />
            </View>
            <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingBottom: 100 }}
                contentInsetAdjustmentBehavior="never"
            >
                {/* Expense / Income Tabs */}
                <SegmentedControl
                    options={[
                        { key: 'expense', label: 'Expenses' },
                        { key: 'income', label: 'Income' },
                    ]}
                    value={activeTab}
                    onChange={setActiveTab}
                    className="mx-5 mb-5"
                />

                {loading ? (
                    <View className="py-20 items-center">
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                ) : filteredItems.length === 0 ? (
                    <EmptyState
                        icon={activeTab === 'income' ? 'trending-up-outline' : 'trending-down-outline'}
                        title={`No Recurring ${activeTab === 'income' ? 'Income' : 'Expenses'}`}
                        subtitle={`Your recurring ${activeTab === 'income' ? 'income' : 'expenses'} will appear here.`}
                    />
                ) : (
                    <View className="px-5">
                        {filteredItems.map((item, i) => (
                            <RecurringRow
                                key={item.id}
                                item={item}
                                index={i}
                                currency={profile.currency}
                                onEdit={openEditModal}
                                onToggleActive={handleToggleActive}
                                onDelete={handleDelete}
                            />
                        ))}
                    </View>
                )}
            </ScrollView>

            <RecurringFormModal
                key={addFormKey}
                visible={addModalVisible}
                editItem={null}
                type={activeTab}
                categories={categories}
                accounts={accounts}
                currencySymbol={currencySymbol}
                onClose={closeAddModal}
                onSaved={handleAdded}
            />
            {editItem && (
                <RecurringFormModal
                    key={editItem.id}
                    visible
                    editItem={editItem}
                    type={activeTab}
                    categories={categories}
                    accounts={accounts}
                    currencySymbol={currencySymbol}
                    onClose={closeEditModal}
                    onSaved={handleEdited}
                />
            )}
            {deletingItem && (
                <DeleteConfirmSheet
                    item={deletingItem}
                    onCancel={() => setDeletingItem(null)}
                    onConfirm={handleConfirmDelete}
                    isDeleting={isDeleting}
                />
            )}
            {togglingItem && (
                <ToggleConfirmSheet
                    item={togglingItem}
                    onCancel={() => setTogglingItem(null)}
                    onConfirm={handleConfirmToggle}
                    isLoading={isToggling}
                />
            )}
        </View>
    );
}
