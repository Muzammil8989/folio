import { AppModal, EmptyState, ScreenHeader, ThemedText } from '@/components/common';
import { AccountFormModal } from '@/features/accounts/components/account-form-modal';
import { AccountRow } from '@/features/accounts/components/account-row';
import { useUser } from '@/features/user/context/user-context';
import {
    AccountWithBalance,
    deleteAccount,
    getAccountsWithBalance
} from '@/lib/db/queries';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
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
    account,
    onCancel,
    onConfirm,
    isDeleting,
}: {
    account: AccountWithBalance;
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
                        Delete Account
                    </ThemedText>
                    <ThemedText className="text-[15px] text-center text-textSecondary dark:text-dark-textSecondary leading-6 mb-7 px-2">
                        Delete{' '}
                        <ThemedText className="font-bold text-textPrimary dark:text-dark-textPrimary">
                            {account.name}
                        </ThemedText>
                        ? This cannot be undone if there are associated transactions.
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

export default function PaymentMethodsScreen() {
    const insets = useSafeAreaInsets();
    const colors = useThemeColors();
    const { profile } = useUser();
    const [accounts, setAccounts] = useState<AccountWithBalance[]>([]);
    const [loading, setLoading] = useState(true);
    const [modalVisible, setModalVisible] = useState(false);
    // Bumped on every open so the form sheet remounts with fresh state.
    const [formKey, setFormKey] = useState(0);
    const [editingAccount, setEditingAccount] = useState<AccountWithBalance | null>(null);
    const [deletingAccount, setDeletingAccount] = useState<AccountWithBalance | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    const fetchAccounts = useCallback(async () => {
        try {
            setLoading(true);
            const data = await getAccountsWithBalance();
            setAccounts(data);
        } catch (error) {
            logger.error('Error fetching accounts:', error);
            toast.error('Failed to load payment methods');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        // Defer DB fetch until the slide-in animation finishes so the screen
        // doesn't re-render mid-animation (spinner → content flash).
        const task = InteractionManager.runAfterInteractions(() => {
            fetchAccounts();
        });
        return () => task.cancel();
    }, [fetchAccounts]);

    const openAddModal = useCallback(() => {
        setEditingAccount(null);
        setFormKey(k => k + 1);
        setModalVisible(true);
    }, []);

    const openEditModal = useCallback((account: AccountWithBalance) => {
        setEditingAccount(account);
        setFormKey(k => k + 1);
        setModalVisible(true);
    }, []);

    const closeModal = useCallback(() => setModalVisible(false), []);

    const handleSaved = useCallback(() => {
        setModalVisible(false);
        fetchAccounts();
    }, [fetchAccounts]);

    const handleDelete = useCallback((account: AccountWithBalance) => {
        setDeletingAccount(account);
    }, []);

    const handleConfirmDelete = async () => {
        if (!deletingAccount) return;
        setIsDeleting(true);
        try {
            await deleteAccount(deletingAccount.id);
            toast.success('Payment method deleted');
            setDeletingAccount(null);
            fetchAccounts();
        } catch (error: any) {
            logger.error('Error deleting account:', error);
            toast.error(error.message || 'Cannot delete payment method with transactions');
        } finally {
            setIsDeleting(false);
        }
    };

    return (
        <View className="flex-1 bg-background dark:bg-dark-background">
            {/* Header stays put; only the content below it scrolls */}
            <View style={{ paddingTop: insets.top }}>
                <ScreenHeader
                    title="Accounts & Wallets"
                    right={
                        <Pressable
                            onPress={openAddModal}
                            className="w-11 h-11 rounded-xl bg-primary items-center justify-center"
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
                {/* Payment Methods List */}
                <View className="px-5">
                    {loading ? (
                        <View className="py-20 items-center">
                            <ActivityIndicator size="large" color={colors.primary} />
                        </View>
                    ) : accounts.length === 0 ? (
                        <EmptyState
                            icon="wallet-outline"
                            title="No Accounts Yet"
                            subtitle="Add your first account or wallet to start tracking your finances."
                            actionLabel="Add Account"
                            onAction={openAddModal}
                        />
                    ) : (
                        <View className="gap-4">
                            {accounts.map((account, index) => (
                                <AccountRow
                                    key={account.id}
                                    account={account}
                                    index={index}
                                    currency={profile.currency}
                                    onEdit={openEditModal}
                                    onDelete={handleDelete}
                                />
                            ))}
                        </View>
                    )}
                </View>
            </ScrollView>

            <AccountFormModal
                key={formKey}
                visible={modalVisible}
                editingAccount={editingAccount}
                onClose={closeModal}
                onSaved={handleSaved}
            />
            {deletingAccount && (
                <DeleteConfirmSheet
                    account={deletingAccount}
                    onCancel={() => setDeletingAccount(null)}
                    onConfirm={handleConfirmDelete}
                    isDeleting={isDeleting}
                />
            )}
        </View>
    );
}
