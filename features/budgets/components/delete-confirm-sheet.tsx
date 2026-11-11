import { AppButton, AppModal, ThemedText } from '@/components/common';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeInUp } from 'react-native-reanimated';


interface DeleteConfirmSheetProps {
    title: string;
    onCancel: () => void;
    onConfirm: () => void;
    isDeleting: boolean;
}

export function DeleteConfirmSheet({ title, onCancel, onConfirm, isDeleting }: DeleteConfirmSheetProps) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();

    return (
        <AppModal visible animationType="fade" transparent onRequestClose={onCancel}>
            <View className="flex-1 justify-end bg-black/50">
                <Animated.View
                    entering={FadeInUp.duration(300).easing(Easing.out(Easing.cubic))}
                    style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.divider, paddingBottom: insets.bottom + 32 }]}
                >

                    <View className="w-9 h-1 bg-borderStrong dark:bg-dark-borderStrong rounded-full mx-auto mb-5" />

                    <View
                        className="w-16 h-16 rounded-xl items-center justify-center mx-auto mb-5"
                        style={{ backgroundColor: `${colors.expense}18` }}
                    >
                        <Ionicons name="trash-outline" size={30} color={colors.expense} />
                    </View>

                    <ThemedText type="headline" className="text-center mb-2" accessibilityRole="header">
                        Delete Budget
                    </ThemedText>

                    <ThemedText className="text-[15px] text-center text-textSecondary dark:text-dark-textSecondary leading-6 mb-7 px-2">
                        Are you sure you want to delete{' '}
                        <ThemedText className="font-bold text-textPrimary dark:text-dark-textPrimary">
                            {title}
                        </ThemedText>
                        {'? '}This action cannot be undone.
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

const styles = StyleSheet.create({
    sheet: {
        // Same reading column as the app on tablets / landscape.
        width: '100%',
        maxWidth: MAX_CONTENT_WIDTH,
        alignSelf: 'center',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 24,
        paddingTop: 16,
        overflow: 'hidden',
        borderTopWidth: 1,
    },
});
