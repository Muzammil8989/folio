import { AppModal, EmptyState, ScreenHeader, SegmentedControl, ThemedText } from '@/components/common';
import { CategoryFormModal } from '@/features/categories/components/category-form-modal';
import { CategoryRow } from '@/features/categories/components/category-row';
import {
    Category,
    deleteCategory,
    getCategories
} from '@/lib/db/queries';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
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
    category,
    onCancel,
    onConfirm,
    isDeleting,
}: {
    category: Category;
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
                    <View className="w-16 h-16 rounded-full items-center justify-center mx-auto mb-5 border border-divider dark:border-dark-divider">
                        <Ionicons name="trash-outline" size={30} color={colors.expense} />
                    </View>
                    <ThemedText type="headline" className="text-center mb-2" accessibilityRole="header">
                        Delete Category
                    </ThemedText>
                    <ThemedText className="text-[15px] text-center text-textSecondary dark:text-dark-textSecondary leading-6 mb-7 px-2">
                        Delete{' '}
                        <ThemedText className="font-bold text-textPrimary dark:text-dark-textPrimary">
                            {category.name}
                        </ThemedText>
                        ? This cannot be undone if there are transactions using this category.
                    </ThemedText>
                    <View className="flex-row gap-3">
                        <Pressable
                            onPress={onCancel}
                            className="flex-1 py-4 rounded-xl items-center border border-borderSoft dark:border-dark-borderSoft"
                            style={{ backgroundColor: colors.backgroundAlt }}
                        >
                            <ThemedText className="font-semibold text-sm">Cancel</ThemedText>
                        </Pressable>
                        <Pressable
                            onPress={onConfirm}
                            disabled={isDeleting}
                            className="flex-1 py-4 rounded-xl items-center"
                            style={{ backgroundColor: colors.expense }}
                        >
                            {isDeleting
                                ? <ActivityIndicator color={colors.white} size="small" />
                                : <ThemedText className="font-bold text-sm text-white">Delete</ThemedText>
                            }
                        </Pressable>
                    </View>
                </Animated.View>
            </View>
        </AppModal>
    );
}

export default function CategoriesScreen() {
    const insets = useSafeAreaInsets();
    const colors = useThemeColors();
    const [categories, setCategories] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalVisible, setModalVisible] = useState(false);
    // Bumped on every open so the form sheet remounts with fresh state.
    const [formKey, setFormKey] = useState(0);
    const [editingCategory, setEditingCategory] = useState<Category | null>(null);
    const [newCategoryType, setNewCategoryType] = useState<'income' | 'expense'>('expense');
    const [activeTab, setActiveTab] = useState<'expense' | 'income'>('expense');
    const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const fetchCategories = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getCategories();
            setCategories(data);
        } catch (error) {
            logger.error('Error fetching categories:', error);
            toast.error('Failed to load categories');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Defer DB fetch until the slide-in animation finishes — otherwise the
        // first render (spinner) and the second render (content) both happen
        // mid-animation and produce a visible flash.
        const task = InteractionManager.runAfterInteractions(() => {
            fetchCategories();
        });
        return () => task.cancel();
    }, [fetchCategories]);

    const openAddModal = useCallback((categoryType: 'income' | 'expense') => {
        setEditingCategory(null);
        setNewCategoryType(categoryType);
        setFormKey(k => k + 1);
        setModalVisible(true);
    }, []);

    const openEditModal = useCallback((category: Category) => {
        setEditingCategory(category);
        setFormKey(k => k + 1);
        setModalVisible(true);
    }, []);

    const closeModal = useCallback(() => setModalVisible(false), []);

    const handleSaved = useCallback(() => {
        setModalVisible(false);
        fetchCategories();
    }, [fetchCategories]);

    const handleDelete = useCallback((category: Category) => {
        setDeletingCategory(category);
    }, []);

    const handleConfirmDelete = async () => {
        if (!deletingCategory) return;
        setIsDeleting(true);
        try {
            await deleteCategory(deletingCategory.id);
            toast.success('Category deleted');
            setDeletingCategory(null);
            fetchCategories();
        } catch (error: any) {
            logger.error('Error deleting category:', error);
            toast.error(error.message || 'Cannot delete category with transactions');
        } finally {
            setIsDeleting(false);
        }
    };

    const expenseCategories = useMemo(() => categories.filter(c => c.type === 'expense'), [categories]);
    const incomeCategories = useMemo(() => categories.filter(c => c.type === 'income'), [categories]);

    const renderCategoryList = (categoryList: Category[], categoryType: 'income' | 'expense') => {
        if (categoryList.length === 0) {
            return (
                <EmptyState
                    icon={categoryType === 'income' ? 'trending-up-outline' : 'wallet-outline'}
                    title={`No ${categoryType === 'income' ? 'Income' : 'Expense'} Categories`}
                    subtitle={`Add your first ${categoryType} category to get started.`}
                    actionLabel="Add Category"
                    onAction={() => openAddModal(categoryType)}
                    iconColor={categoryType === 'income' ? colors.success : colors.error}
                    actionColor={categoryType === 'income' ? colors.success : colors.error}
                />
            );
        }

        return (
            <View className="gap-3 px-5">
                {categoryList.map((category, index) => (
                    <CategoryRow
                        key={category.id}
                        category={category}
                        index={index}
                        onEdit={openEditModal}
                        onDelete={handleDelete}
                    />
                ))}
            </View>
        );
    };

    return (
        <View className="flex-1 bg-background dark:bg-dark-background">
            {/* Header stays put; only the content below it scrolls */}
            <View style={{ paddingTop: insets.top }}>
                <ScreenHeader
                    title="Categories"
                    right={
                        <Pressable
                            onPress={() => openAddModal(activeTab)}
                            className="w-11 h-11 rounded-xl items-center justify-center"
                            style={{ backgroundColor: activeTab === 'income' ? colors.success : colors.error }}
                        >
                            <Ionicons name="add" size={26} color={colors.white} />
                        </Pressable>
                    }
                />
            </View>
            <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingBottom: 100 }}
            >
                {/* Tabs */}
                <SegmentedControl
                    options={[
                        { key: 'expense', label: `Expense (${expenseCategories.length})` },
                        { key: 'income', label: `Income (${incomeCategories.length})` },
                    ]}
                    value={activeTab}
                    onChange={setActiveTab}
                    className="mx-5 mb-5"
                />

                {/* Categories List */}
                {loading ? (
                    <View className="py-20 items-center">
                        <ActivityIndicator size="large" color={colors.primary} />
                    </View>
                ) : (
                    <>
                        {activeTab === 'expense'
                            ? renderCategoryList(expenseCategories, 'expense')
                            : renderCategoryList(incomeCategories, 'income')}
                    </>
                )}
            </ScrollView>

            <CategoryFormModal
                key={formKey}
                visible={modalVisible}
                editingCategory={editingCategory}
                defaultType={newCategoryType}
                onClose={closeModal}
                onSaved={handleSaved}
            />
            {deletingCategory && (
                <DeleteConfirmSheet
                    category={deletingCategory}
                    onCancel={() => setDeletingCategory(null)}
                    onConfirm={handleConfirmDelete}
                    isDeleting={isDeleting}
                />
            )}
        </View>
    );
}
