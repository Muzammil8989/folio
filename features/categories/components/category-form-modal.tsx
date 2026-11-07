import { AppButton, AppModal, FormScrollView, ThemedText } from '@/components/common';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { Category, createCategory, updateCategory } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import tokens from '@/theme/tokens';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
    Pressable,
    TextInput,
    View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

const CATEGORY_COLORS: string[] = tokens.swatches;

const EXPENSE_ICONS = [
    'fast-food', 'cart', 'car', 'home', 'medical',
    'fitness', 'shirt', 'cafe', 'game-controller', 'airplane',
    'book', 'school', 'gift', 'paw', 'phone-portrait',
    'bus', 'train', 'bicycle', 'restaurant', 'pizza',
    'beer', 'film', 'musical-notes', 'barbell', 'footsteps'
] as const;

const INCOME_ICONS = [
    'cash', 'wallet', 'trending-up', 'briefcase', 'card',
    'gift', 'rocket', 'trophy', 'star', 'diamond-outline',
    'business', 'medal-outline', 'ribbon-outline', 'flash', 'bulb-outline'
] as const;

type CategoryType = 'income' | 'expense';

interface CategoryFormModalProps {
    visible: boolean;
    /** Category being edited, or null when adding a new one. */
    editingCategory: Category | null;
    /** Type a new category starts as (ignored when editing). */
    defaultType: CategoryType;
    onClose: () => void;
    onSaved: () => void;
}

/**
 * Add / edit sheet for a category. Owns its form state so typing only
 * re-renders the sheet, not the category list behind it. The parent remounts
 * it (via `key`) each time it opens, so the initial state below is the reset.
 */
export function CategoryFormModal({ visible, editingCategory, defaultType, onClose, onSaved }: CategoryFormModalProps) {
    const insets = useSafeAreaInsets();
    const colors = useThemeColors();

    const [name, setName] = useState(editingCategory?.name ?? '');
    const [type, setType] = useState<CategoryType>(editingCategory?.type ?? defaultType);
    const [selectedColor, setSelectedColor] = useState(editingCategory?.color || CATEGORY_COLORS[0]);
    const [selectedIcon, setSelectedIcon] = useState<string>(() => {
        const t = editingCategory?.type ?? defaultType;
        return editingCategory?.icon || (t === 'income' ? 'wallet' : 'fast-food');
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error('Please enter a category name');
            return;
        }

        setIsSubmitting(true);
        try {
            if (editingCategory) {
                await updateCategory(editingCategory.id, {
                    name: name.trim(),
                    type,
                    color: selectedColor,
                    icon: selectedIcon,
                });
                toast.success('Category updated');
            } else {
                await createCategory({
                    name: name.trim(),
                    type,
                    color: selectedColor,
                    icon: selectedIcon,
                });
                toast.success('Category added');
            }
            onSaved();
        } catch (error: any) {
            logger.error('Error saving category:', error);
            if (error.message?.includes('UNIQUE constraint failed')) {
                toast.error('A category with this name already exists');
            } else {
                toast.error(error.message || 'Failed to save category');
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const iconList = type === 'income' ? INCOME_ICONS : EXPENSE_ICONS;

    return (
        <AppModal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <KeyboardAvoidingView
                behavior="padding"
                style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}
            >
                <Animated.View
                    entering={FadeInDown.duration(350)}
                    className="bg-surface dark:bg-dark-surface rounded-t-3xl px-6 pt-4 max-h-[90%]"
                    // Same reading column as the app on tablets / landscape.
                    style={{ paddingBottom: insets.bottom + 40, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}
                >
                    <View className="w-9 h-1 bg-borderStrong dark:bg-dark-borderStrong rounded-full mx-auto mb-5" />
                    <View className="flex-row justify-between items-center mb-8">
                        <ThemedText type="title" className="text-2xl font-bold">
                            {editingCategory ? 'Edit Category' : 'Add Category'}
                        </ThemedText>
                        <Pressable onPress={onClose} hitSlop={4} className="p-2">
                            <Ionicons name="close" size={24} color={colors.expense} />
                        </Pressable>
                    </View>

                    <FormScrollView
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingBottom: 24 }}
                    >
                        {/* Type Toggle (only when adding new) */}
                        {!editingCategory && (
                            <View className="mb-6">
                                <View className="flex-row p-1 rounded-xl" style={{ backgroundColor: colors.backgroundAlt }}>
                                    <Pressable
                                        onPress={() => {
                                            setType('expense');
                                            setSelectedIcon('fast-food');
                                        }}
                                        className="flex-1 py-3.5 rounded-xl"
                                        style={type === 'expense' ? { backgroundColor: colors.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 1 } : undefined}
                                    >
                                        <ThemedText
                                            className="text-sm font-bold text-center"
                                            style={{ color: type === 'expense' ? colors.error : colors.textMuted }}
                                        >
                                            Expense
                                        </ThemedText>
                                    </Pressable>
                                    <Pressable
                                        onPress={() => {
                                            setType('income');
                                            setSelectedIcon('wallet');
                                        }}
                                        className="flex-1 py-3.5 rounded-xl"
                                        style={type === 'income' ? { backgroundColor: colors.surface, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2, elevation: 1 } : undefined}
                                    >
                                        <ThemedText
                                            className="text-sm font-bold text-center"
                                            style={{ color: type === 'income' ? colors.success : colors.textMuted }}
                                        >
                                            Income
                                        </ThemedText>
                                    </Pressable>
                                </View>
                            </View>
                        )}

                        {/* Name Input */}
                        <View className="mb-6">
                            <ThemedText type="kicker" className="mb-2">
                                Category Name
                            </ThemedText>
                            <TextInput
                                value={name}
                                onChangeText={setName}
                                placeholder={type === 'income' ? 'e.g., Salary, Freelance' : 'e.g., Food, Transport'}
                                placeholderTextColor={colors.textMuted}
                                className="w-full rounded-xl px-6 py-4 text-textPrimary dark:text-dark-textPrimary text-base font-semibold"
                                style={{ backgroundColor: colors.backgroundAlt, fontFamily: 'PlusJakartaSans_600SemiBold' }}
                            />
                        </View>

                        {/* Icon Selection */}
                        <View className="mb-6">
                            <ThemedText type="kicker" className="mb-3">
                                Icon
                            </ThemedText>
                            <View className="flex-row flex-wrap gap-3">
                                {iconList.map((icon) => (
                                    <Pressable
                                        key={icon}
                                        onPress={() => setSelectedIcon(icon)}
                                        className="w-14 h-14 rounded-xl items-center justify-center"
                                        style={{ backgroundColor: selectedIcon === icon ? colors.primary : colors.backgroundAlt }}
                                    >
                                        <Ionicons
                                            name={icon}
                                            size={24}
                                            color={selectedIcon === icon ? colors.white : colors.textMuted}
                                        />
                                    </Pressable>
                                ))}
                            </View>
                        </View>

                        {/* Color Selection */}
                        <View className="mb-8">
                            <ThemedText type="kicker" className="mb-3">
                                Color
                            </ThemedText>
                            <View className="flex-row flex-wrap gap-3">
                                {CATEGORY_COLORS.map((color) => (
                                    <Pressable
                                        key={color}
                                        onPress={() => setSelectedColor(color)}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected: selectedColor === color }}
                                        className="w-14 h-14 rounded-xl items-center justify-center"
                                        style={{
                                            backgroundColor: color,
                                            borderWidth: selectedColor === color ? 3 : 0,
                                            borderColor: colors.textPrimary,
                                        }}
                                    >
                                        {selectedColor === color && (
                                            <Ionicons name="checkmark" size={24} color={colors.white} />
                                        )}
                                    </Pressable>
                                ))}
                            </View>
                        </View>

                        <AppButton
                            label={`${editingCategory ? 'Update' : 'Add'} Category`}
                            onPress={handleSave}
                            loading={isSubmitting}
                            disabled={isSubmitting}
                            color={type === 'income' ? colors.success : colors.error}
                        />
                    </FormScrollView>
                </Animated.View>
            </KeyboardAvoidingView>
        </AppModal>
    );
}
