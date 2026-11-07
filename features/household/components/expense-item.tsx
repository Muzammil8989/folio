import { ThemedText } from '@/components/common';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { HouseholdExpenseWithCategory } from '@/lib/db/queries';
import { UserService } from '@/features/user/services/user-service';
import { IoniconsName } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import React, { memo } from 'react';
import { Pressable, View } from 'react-native';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(isoDate: string): string {
    const [y, m, d] = isoDate.split('-').map(Number);
    return `${MONTH_NAMES[m - 1]} ${d}, ${y}`;
}

interface ExpenseItemProps {
    item: HouseholdExpenseWithCategory;
    currencyCode: string;
    /** Omit both to show the entry read-only (e.g. a past month in History). */
    onEdit?: (item: HouseholdExpenseWithCategory) => void;
    onDelete?: (item: HouseholdExpenseWithCategory) => void;
}

export const ExpenseItem = memo(function ExpenseItem({ item, currencyCode, onEdit, onDelete }: ExpenseItemProps) {
    const colors = useThemeColors();
    const isDark = colors.scheme === 'dark';

    const isTransfer = !!item.notes?.startsWith('transfer-out:');
    const transferAccountName = isTransfer ? item.notes!.replace('transfer-out:', '') : null;

    const categoryColor = isTransfer ? colors.success : (item.categoryColor || colors.primary);
    const categoryIcon = (isTransfer ? 'swap-horizontal-outline' : (item.categoryIcon || 'fast-food')) as IoniconsName;
    const displayName = isTransfer ? 'Transfer Out' : (item.categoryName ?? 'Uncategorised');
    const amountColor = isTransfer ? colors.success : colors.error;

    return (
        <Pressable
            onPress={onEdit && !isTransfer ? () => onEdit(item) : undefined}
            onLongPress={onDelete ? () => onDelete(item) : undefined}
            disabled={!onEdit && !onDelete}
            className="flex-row items-center bg-surface dark:bg-dark-surface border border-divider dark:border-dark-divider rounded-xl p-4 mb-3 overflow-hidden"
        >
            {/* Subtle card gradient */}
            {/* Decorative circle */}
            <View
                style={{
                    position: 'absolute',
                    bottom: -20,
                    right: -20,
                    width: 64,
                    height: 64,
                    borderRadius: 32,
                    backgroundColor: isDark ? `${categoryColor}18` : `${categoryColor}0C`,
                }}
                pointerEvents="none"
            />

            {/* Icon */}
            <View
                className="items-center justify-center mr-3 shrink-0"
                style={{ width: 36, height: 36 }}
            >
                <Ionicons name={categoryIcon} size={24} color={categoryColor} />
            </View>

            {/* Content */}
            <View className="flex-1">
                <ThemedText
                    className="text-base font-medium text-textPrimary dark:text-dark-textPrimary"
                    numberOfLines={1}
                >
                    {displayName}
                </ThemedText>
                <ThemedText
                    className="text-sm text-textMuted dark:text-dark-textMuted mt-0.5"
                    numberOfLines={1}
                >
                    {isTransfer ? `To: ${transferAccountName}` : (item.notes || formatDate(item.date))}
                </ThemedText>
            </View>

            {/* Amount + date */}
            <View className="items-end ml-4">
                <ThemedText
                    className="text-base font-bold"
                    style={{ color: amountColor, fontFamily: 'SpaceGrotesk_700Bold' }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                >
                    -{UserService.formatCurrency(item.amount, currencyCode)}
                </ThemedText>
                <ThemedText
                    className="text-xs font-medium text-textMuted dark:text-dark-textMuted mt-0.5"
                    numberOfLines={1}
                >
                    {formatDate(item.date)}
                </ThemedText>
            </View>
        </Pressable>
    );
});
