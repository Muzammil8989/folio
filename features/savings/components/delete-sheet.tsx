import { AppButton, AppModal, ThemedText } from '@/components/common';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeInUp, FadeOutDown } from 'react-native-reanimated';

interface DeleteSheetProps {
    name: string;
    onCancel: () => void;
    onConfirm: () => void;
    isDeleting: boolean;
}

export function DeleteSheet({ name, onCancel, onConfirm, isDeleting }: DeleteSheetProps) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();

    return (
        <AppModal visible animationType="fade" transparent onRequestClose={onCancel}>
            <View className="flex-1 justify-end bg-black/50">
                <Animated.View
                    entering={FadeInUp.duration(300).easing(Easing.out(Easing.cubic))}
                    style={{
                        width: '100%',
                        maxWidth: MAX_CONTENT_WIDTH,
                        alignSelf: 'center',
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

                    <View
                        className="w-16 h-16 rounded-full items-center justify-center mx-auto mb-5 border border-divider dark:border-dark-divider"
                    >
                        <Ionicons name="trash-outline" size={30} color={colors.expense} />
                    </View>

                    <ThemedText type="headline" className="text-center mb-2" accessibilityRole="header">
                        Delete Goal
                    </ThemedText>
                    <ThemedText className="text-[15px] text-center text-textSecondary dark:text-dark-textSecondary leading-6 mb-7 px-2">
                        Delete{' '}
                        <ThemedText className="font-bold text-textPrimary dark:text-dark-textPrimary">{name}</ThemedText>
                        {'? '}This cannot be undone.
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
