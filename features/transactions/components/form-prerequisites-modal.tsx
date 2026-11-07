import { AppModal, ThemedText } from '@/components/common';
import { useThemeColors } from '@/hooks/use-theme-colors';
import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

interface FormPrerequisitesModalProps {
    visible: boolean;
    onClose: () => void;
    loading: boolean;
    hasCategories: boolean;
    hasAccounts: boolean;
}

/**
 * Shown instead of a transaction form while categories / payment methods load,
 * or when there are none. Previously this was a "Loading..." spinner that never
 * went away when either list was empty.
 */
export function FormPrerequisitesModal({ visible, onClose, loading, hasCategories, hasAccounts }: FormPrerequisitesModalProps) {
    const colors = useThemeColors();
    const missing = !hasAccounts ? 'payment method' : !hasCategories ? 'category' : null;

    return (
        <AppModal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
            <View className="flex-1 justify-center items-center bg-black/40 px-8">
                <View className="bg-surface dark:bg-dark-surface rounded-xl p-8 w-full items-center">
                    {loading || !missing ? (
                        <>
                            <ActivityIndicator size="large" color={colors.primary} />
                            <ThemedText className="mt-4 text-center">Loading...</ThemedText>
                        </>
                    ) : (
                        <>
                            <ThemedText className="text-lg font-bold text-center mb-2">
                                {`No ${missing} yet`}
                            </ThemedText>
                            <ThemedText className="text-center text-textMuted dark:text-dark-textMuted">
                                {`Add a ${missing} in Settings before adding transactions.`}
                            </ThemedText>
                        </>
                    )}
                    <Pressable
                        onPress={onClose}
                        accessibilityRole="button"
                        className="mt-6 px-6 py-3 rounded-xl"
                        style={{ borderWidth: 1, borderColor: colors.borderStrong }}
                    >
                        <ThemedText className="font-semibold" style={{ color: colors.primary }}>Close</ThemedText>
                    </Pressable>
                </View>
            </View>
        </AppModal>
    );
}
