import { parseAmount } from '@/lib/utils/currency';
import { BottomSheet, BottomSheetRef, FormScrollView, SheetHeader, ThemedText } from '@/components/common';
import { useAccounts } from '@/features/accounts/hooks/use-accounts';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { createHouseholdTransfer, getCategories } from '@/lib/db/queries';
import { formatWithCommas } from '@/lib/utils/format-amount';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { POPULAR_CURRENCIES } from '@/features/user/services/user-service';
import { IoniconsName } from '@/types';
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
import { toLocalDateStr } from '@/components/common/calendar-picker';

interface TransferModalProps {
    visible: boolean;
    onClose: () => void;
    onSuccess: () => void;
    remaining: number;
    currencyCode: string;
}

export function TransferModal({ visible, onClose, onSuccess, remaining, currencyCode }: TransferModalProps) {
    const insets = useSafeAreaInsets();
    const colors = useThemeColors();
    const { accounts, refresh: refreshAccounts } = useAccounts();
    const currencySymbol = POPULAR_CURRENCIES.find(c => c.code === currencyCode)?.symbol ?? '$';
    const sheetRef = useRef<BottomSheetRef>(null);

    const [amount, setAmount] = useState('');
    const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (visible) {
            refreshAccounts();
            // Round to cents: remaining can carry float noise (0.30000000000000004).
            setAmount(remaining > 0 ? (Math.round(remaining * 100) / 100).toFixed(2) : '');
            setSelectedAccountId(null);
        }
    }, [visible, remaining]);

    const handleClose = () => {
        Keyboard.dismiss();
        sheetRef.current?.dismiss(onClose);
    };

    const handleTransfer = async () => {
        const parsed = parseAmount(amount);
        if (!amount || isNaN(parsed) || parsed <= 0) {
            toast.error('Please enter a valid transfer amount');
            return;
        }
        if (Math.round(parsed * 100) > Math.round(remaining * 100)) {
            toast.error(`Cannot exceed remaining balance (${currencySymbol}${remaining.toLocaleString('en-US', { maximumFractionDigits: 2 })})`);
            return;
        }
        if (!selectedAccountId) {
            toast.error('Please select a destination account');
            return;
        }

        const selectedAccount = accounts.find(a => a.id === selectedAccountId);
        const accountName = selectedAccount?.name ?? 'Account';
        const today = toLocalDateStr(new Date());

        setIsSubmitting(true);
        try {
            const incomeCategories = await getCategories('income');
            const otherIncome = incomeCategories.find(c => c.name === 'Other Income') ?? incomeCategories[0];
            if (!otherIncome) {
                toast.error('No income category found. Add one in Settings → Categories.');
                setIsSubmitting(false);
                return;
            }

            await createHouseholdTransfer({
                amount: parsed,
                accountId: selectedAccountId,
                accountName,
                incomeCategoryId: otherIncome.id,
                date: today,
            });

            toast.success(`${currencySymbol}${parsed.toLocaleString('en-US')} transferred to ${accountName}`);
            handleClose();
            onSuccess();
        } catch (e) {
            logger.error('TransferModal: failed to transfer', e);
            toast.error('Transfer failed. Please try again.');
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
            paddingHorizontal={32}
            paddingTop={48}
            paddingBottom={insets.bottom + 32}
            gradientColors={['rgba(16,185,129,0.16)', 'rgba(16,185,129,0.04)', 'transparent']}
            keyboardAvoiding
        >
            <View className="flex-row items-center justify-between mb-2">
                <ThemedText className="text-xl font-black">Transfer to Account</ThemedText>
                <Pressable onPress={handleClose} className="p-2" hitSlop={4} accessibilityRole="button" accessibilityLabel="Close">
                    <Ionicons name="close" size={24} color={colors.expense} />
                </Pressable>
            </View>
            <ThemedText className="text-sm mb-6" style={{ color: colors.textMuted }}>
                Remaining balance will be deducted from household and added to your account. Both entries can be deleted independently.
            </ThemedText>

            <FormScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
            >
                {/* Available */}
                <View
                    className="flex-row items-center justify-between px-4 py-3 rounded-xl mb-6"
                    style={{ backgroundColor: `${colors.success}18` }}
                >
                    <ThemedText className="text-sm font-bold" style={{ color: colors.success }}>
                        Available to transfer
                    </ThemedText>
                    <ThemedText className="text-base font-black" style={{ color: colors.success }}>
                        {currencySymbol}{remaining.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </ThemedText>
                </View>

                {/* How it works */}
                <View className="mb-6 gap-2">
                    <View className="flex-row items-center gap-2 px-3 py-2.5 rounded-xl bg-backgroundAlt dark:bg-dark-backgroundAlt">
                        <Ionicons name="remove-circle-outline" size={16} color={colors.expense} />
                        <ThemedText className="text-xs font-medium flex-1 text-textPrimary dark:text-dark-textPrimary">
                            Household balance reduces by transfer amount
                        </ThemedText>
                    </View>
                    <View className="flex-row items-center gap-2 px-3 py-2.5 rounded-xl bg-backgroundAlt dark:bg-dark-backgroundAlt">
                        <Ionicons name="add-circle-outline" size={16} color={colors.success} />
                        <ThemedText className="text-xs font-medium flex-1 text-textPrimary dark:text-dark-textPrimary">
                            Selected account balance increases by same amount
                        </ThemedText>
                    </View>
                </View>

                {/* Amount Input */}
                <View className="mb-6">
                    <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
                        Amount to Transfer
                    </ThemedText>
                    <View
                        className="flex-row items-center px-4 rounded-xl"
                        style={{ backgroundColor: colors.scheme === 'dark' ? colors.gray800 : colors.gray100 }}
                    >
                        <ThemedText className="text-lg font-bold mr-2" style={{ color: colors.success }}>
                            {currencySymbol}
                        </ThemedText>
                        <TextInput
                            value={amount}
                            onChangeText={setAmount}
                            placeholder={String(remaining)}
                            placeholderTextColor={colors.textMuted}
                            keyboardType="decimal-pad"
                            style={{
                                flex: 1,
                                paddingVertical: 14,
                                fontSize: 18,
                                fontFamily: 'SpaceGrotesk_700Bold',
                                color: colors.textPrimary,
                            }}
                        />
                    </View>
                    {!!amount && !isNaN(parseAmount(amount)) && parseAmount(amount) > 0 && (
                        <ThemedText className="text-xs font-medium mt-1.5 ml-1" style={{ color: colors.textMuted }}>
                            {formatWithCommas(amount)}
                        </ThemedText>
                    )}
                </View>

                {/* Account Picker */}
                <View className="mb-8">
                    <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
                        Destination Account
                    </ThemedText>
                    {accounts.length === 0 ? (
                        <ThemedText className="text-sm text-center py-4" style={{ color: colors.textMuted }}>
                            No accounts available
                        </ThemedText>
                    ) : (
                        <View className="gap-2">
                            {accounts.map(account => {
                                const isSelected = selectedAccountId === account.id;
                                const acColor = account.color || colors.primary;
                                return (
                                    <Pressable
                                        key={account.id}
                                        onPress={() => setSelectedAccountId(account.id)}
                                        className="flex-row items-center px-4 py-3 rounded-xl"
                                        style={{
                                            backgroundColor: isSelected
                                                ? `${colors.success}15`
                                                : colors.scheme === 'dark' ? colors.gray800 : colors.gray100,
                                            borderWidth: isSelected ? 1.5 : 0,
                                            borderColor: isSelected ? colors.success : 'transparent',
                                        }}
                                    >
                                        <View
                                            className="w-10 h-10 rounded-xl items-center justify-center mr-3"
                                            style={{ backgroundColor: `${acColor}20` }}
                                        >
                                            <Ionicons name={(account.icon as IoniconsName) || 'wallet'} size={18} color={acColor} />
                                        </View>
                                        <View className="flex-1">
                                            <ThemedText className="text-sm font-bold text-textPrimary dark:text-dark-textPrimary">
                                                {account.name}
                                            </ThemedText>
                                            <ThemedText className="text-xs capitalize text-textMuted dark:text-dark-textMuted">
                                                {account.type}
                                            </ThemedText>
                                        </View>
                                        {isSelected && <Ionicons name="checkmark-circle" size={20} color={colors.success} />}
                                    </Pressable>
                                );
                            })}
                        </View>
                    )}
                </View>

                {/* Submit */}
                <Pressable
                    onPress={handleTransfer}
                    disabled={isSubmitting}
                    className="w-full py-4 rounded-xl items-center"
                    style={{ backgroundColor: colors.success }}
                >
                    {isSubmitting
                        ? <ActivityIndicator color="#fff" />
                        : <ThemedText className="font-black text-base text-white">
                            Transfer to Balance
                        </ThemedText>
                    }
                </Pressable>
            </FormScrollView>
        </BottomSheet>
    );
}
