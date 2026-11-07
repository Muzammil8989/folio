import { AppModal, ThemedText } from '@/components/common';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { IoniconsName } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

interface Account {
    id: number;
    name: string;
    type: string;
    icon: string | null;
    color: string | null;
}

interface AccountPickerProps {
    visible: boolean;
    accounts: Account[];
    selectedAccountId: number | null;
    onSelect: (id: number) => void;
    onClose: () => void;
}

export function AccountPicker({ visible, accounts, selectedAccountId, onSelect, onClose }: AccountPickerProps) {
    const colors = useThemeColors();

    return (
        <AppModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <Pressable onPress={onClose} style={styles.overlay}>
                <Pressable style={[styles.card, { backgroundColor: colors.surface }]}>
                    <ThemedText style={{ fontSize: 20, fontWeight: '700', marginBottom: 20, color: colors.textPrimary }}>Select Payment Method</ThemedText>

                    <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
                        {accounts && accounts.length > 0 ? (
                            accounts.map(account => {
                                if (!account || !account.id) return null;
                                const isSelected = selectedAccountId === account.id;
                                return (
                                    <Pressable
                                        key={account.id}
                                        onPress={() => onSelect(account.id)}
                                        style={[
                                            styles.accountRow,
                                            {
                                                backgroundColor: isSelected ? `${colors.primary}15` : colors.backgroundAlt,
                                                borderWidth: isSelected ? 2 : 0,
                                                borderColor: isSelected ? colors.primary : 'transparent',
                                            },
                                        ]}
                                    >
                                        <View style={[styles.iconBox, { backgroundColor: `${account.color || colors.primary}20` }]}>
                                            <Ionicons name={(account.icon as IoniconsName) || 'wallet'} size={24} color={account.color || colors.primary} />
                                        </View>
                                        <View style={styles.accountInfo}>
                                            <ThemedText style={{ fontSize: 15, fontWeight: '700', marginBottom: 3, color: colors.textPrimary }}>{account.name}</ThemedText>
                                            <ThemedText style={{ fontSize: 12, textTransform: 'capitalize', color: colors.textMuted }}>{account.type}</ThemedText>
                                        </View>
                                        {isSelected && <Ionicons name="checkmark-circle" size={24} color={colors.primary} />}
                                    </Pressable>
                                );
                            })
                        ) : (
                            <View style={styles.emptyState}>
                                <ThemedText style={{ color: colors.textMuted }}>No payment methods available</ThemedText>
                            </View>
                        )}
                    </ScrollView>

                    <Pressable
                        onPress={onClose}
                        style={[styles.cancelButton, { backgroundColor: colors.backgroundAlt }]}
                    >
                        <ThemedText style={{ fontWeight: '700', color: colors.textSecondary }}>Cancel</ThemedText>
                    </Pressable>
                </Pressable>
            </Pressable>
        </AppModal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        paddingHorizontal: 16,
    },
    card: {
        borderRadius: 28,
        padding: 24,
        width: '100%',
        maxWidth: 380,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.2,
        shadowRadius: 28,
        elevation: 24,
    },
    scrollArea: { maxHeight: 320 },
    accountRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
    },
    iconBox: {
        width: 48,
        height: 48,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 16,
    },
    accountInfo: { flex: 1 },
    emptyState: { paddingVertical: 32, alignItems: 'center' },
    cancelButton: { marginTop: 16, paddingVertical: 14, borderRadius: 16, alignItems: 'center' },
});
