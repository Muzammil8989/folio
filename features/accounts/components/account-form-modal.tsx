import { parseAmount } from '@/lib/utils/currency';
import tokens from '@/theme/tokens';
import { AppButton, AppModal, FormScrollView, ThemedText } from '@/components/common';
import { useUser } from '@/features/user/context/user-context';
import { AccountWithBalance, createAccount, updateAccount } from '@/lib/db/queries';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { IoniconsName } from '@/types';
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

type AccountType = 'checking' | 'savings' | 'credit' | 'cash' | 'other';

const ACCOUNT_TYPES: { value: AccountType; label: string; icon: IoniconsName }[] = [
    { value: 'checking', label: 'Checking', icon: 'card' },
    { value: 'savings', label: 'Savings', icon: 'wallet' },
    { value: 'credit', label: 'Credit Card', icon: 'card-outline' },
    { value: 'cash', label: 'Cash', icon: 'cash' },
    { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle' },
];

const ACCOUNT_COLORS: string[] = tokens.swatches;

const ACCOUNT_ICONS = [
    'wallet', 'card', 'cash', 'business', 'briefcase',
    'gift', 'home', 'planet', 'rocket', 'shield'
] as const;

interface AccountFormModalProps {
    visible: boolean;
    /** Account being edited, or null when adding a new one. */
    editingAccount: AccountWithBalance | null;
    onClose: () => void;
    onSaved: () => void;
}

/**
 * Add / edit sheet for a payment method. Owns its form state so typing only
 * re-renders the sheet, not the account list behind it. The parent remounts
 * it (via `key`) each time it opens, so the initial state below is the reset.
 */
export function AccountFormModal({ visible, editingAccount, onClose, onSaved }: AccountFormModalProps) {
    const insets = useSafeAreaInsets();
    const colors = useThemeColors();
    const { profile } = useUser();

    const [name, setName] = useState(editingAccount?.name ?? '');
    const [type, setType] = useState<AccountType>(editingAccount?.type ?? 'checking');
    // Edit the stored opening balance; `balance` includes all transactions.
    const [balance, setBalance] = useState(editingAccount ? editingAccount.initial_balance.toString() : '0');
    const [selectedColor, setSelectedColor] = useState(editingAccount?.color || ACCOUNT_COLORS[0]);
    const [selectedIcon, setSelectedIcon] = useState<typeof ACCOUNT_ICONS[number]>(
        (editingAccount?.icon as typeof ACCOUNT_ICONS[number]) || 'wallet'
    );
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSave = async () => {
        if (!name.trim()) {
            toast.error('Please enter a name');
            return;
        }

        const numBalance = parseAmount(balance) || 0;

        setIsSubmitting(true);
        try {
            if (editingAccount) {
                await updateAccount(editingAccount.id, {
                    name: name.trim(),
                    type,
                    balance: numBalance,
                    color: selectedColor,
                    icon: selectedIcon,
                });
                toast.success('Payment method updated');
            } else {
                await createAccount({
                    name: name.trim(),
                    type,
                    balance: numBalance,
                    currency: profile.currency || 'USD',
                    color: selectedColor,
                    icon: selectedIcon,
                });
                toast.success('Payment method added');
            }
            onSaved();
        } catch (error: any) {
            logger.error('Error saving account:', error);
            toast.error(error.message || 'Failed to save payment method');
        } finally {
            setIsSubmitting(false);
        }
    };

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
                            {editingAccount ? 'Edit Payment Method' : 'Add Payment Method'}
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
                        {/* Name Input */}
                        <View className="mb-6">
                            <ThemedText type="kicker" className="mb-2">
                                Name
                            </ThemedText>
                            <TextInput
                                value={name}
                                onChangeText={setName}
                                placeholder="e.g., Chase Bank, Cash Wallet"
                                placeholderTextColor={colors.textMuted}
                                className="w-full rounded-xl px-6 py-4 text-textPrimary dark:text-dark-textPrimary text-base font-semibold"
                                style={{ backgroundColor: colors.backgroundAlt, fontFamily: 'PlusJakartaSans_600SemiBold' }}
                            />
                        </View>

                        {/* Type Selection */}
                        <View className="mb-6">
                            <ThemedText type="kicker" className="mb-3">
                                Type
                            </ThemedText>
                            <View className="flex-row flex-wrap gap-3">
                                {ACCOUNT_TYPES.map((accountType) => (
                                    <Pressable
                                        key={accountType.value}
                                        onPress={() => setType(accountType.value)}
                                        className="px-5 py-3 rounded-xl flex-row items-center gap-2"
                                        style={{ backgroundColor: type === accountType.value ? colors.primary : colors.backgroundAlt }}
                                    >
                                        <Ionicons
                                            name={accountType.icon}
                                            size={18}
                                            color={type === accountType.value ? colors.white : colors.textMuted}
                                        />
                                        <ThemedText
                                            className="text-sm font-bold"
                                            style={{ color: type === accountType.value ? colors.white : colors.textPrimary }}
                                        >
                                            {accountType.label}
                                        </ThemedText>
                                    </Pressable>
                                ))}
                            </View>
                        </View>

                        {/* Balance Input */}
                        <View className="mb-6">
                            <ThemedText type="kicker" className="mb-2">
                                Initial Balance
                            </ThemedText>
                            <TextInput
                                value={balance}
                                onChangeText={setBalance}
                                placeholder="0.00"
                                placeholderTextColor={colors.textMuted}
                                keyboardType="decimal-pad"
                                className="w-full rounded-xl px-6 py-4 text-textPrimary dark:text-dark-textPrimary text-base font-semibold"
                                style={{ backgroundColor: colors.backgroundAlt, fontFamily: 'SpaceGrotesk_600SemiBold' }}
                            />
                        </View>

                        {/* Icon Selection */}
                        <View className="mb-6">
                            <ThemedText type="kicker" className="mb-3">
                                Icon
                            </ThemedText>
                            <View className="flex-row flex-wrap gap-3">
                                {ACCOUNT_ICONS.map((icon) => (
                                    <Pressable
                                        key={icon}
                                        onPress={() => setSelectedIcon(icon)}
                                        className="w-14 h-14 rounded-xl items-center justify-center"
                                        style={{ backgroundColor: selectedIcon === icon ? colors.primary : colors.backgroundAlt }}
                                    >
                                        <Ionicons
                                            name={icon as IoniconsName}
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
                                {ACCOUNT_COLORS.map((color) => (
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
                            label={`${editingAccount ? 'Update' : 'Add'} Payment Method`}
                            onPress={handleSave}
                            loading={isSubmitting}
                            disabled={isSubmitting}
                        />
                    </FormScrollView>
                </Animated.View>
            </KeyboardAvoidingView>
        </AppModal>
    );
}
