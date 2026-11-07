import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { AppModal, ThemedText } from '@/components/common';
import { shadows } from '@/theme/shadows';
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TimeFilter } from '../utils';

// Identical in light + dark — module-level constants, no hook
// Teal at 12% — the pressed-state layer; reads on both paper themes.
const RIPPLE_COLOR = 'rgba(13,92,99,0.12)';

// Static chip configs — never build NativeWind classes dynamically
const CHIP = {
    active: 'px-5 py-2.5 rounded-full bg-primary overflow-hidden',
    inactive: 'px-5 py-2.5 rounded-full bg-backgroundAlt dark:bg-dark-backgroundAlt overflow-hidden',
} as const;

const CHIP_TEXT = {
    active: 'text-xs font-bold uppercase text-white',
    inactive: 'text-xs font-bold uppercase text-textMuted dark:text-dark-textMuted',
} as const;

interface FilterModalProps {
    visible: boolean;
    onClose: () => void;
    activeTimeFilter: TimeFilter | null;
    onTimeFilterChange: (f: TimeFilter) => void;
    customStartDate: Date;
    customEndDate: Date;
    onStartDatePress: () => void;
    onEndDatePress: () => void;
}

export function FilterModal({
    visible,
    onClose,
    activeTimeFilter,
    onTimeFilterChange,
    customStartDate,
    customEndDate,
    onStartDatePress,
    onEndDatePress,
}: FilterModalProps) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();

    return (
        <AppModal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View className="flex-1 justify-end bg-black/50">
                <View
                    className="rounded-t-3xl bg-surfaceAlt dark:bg-dark-surfaceAlt p-6 overflow-hidden"
                    style={[shadows.lg, { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', maxHeight: '80%', paddingBottom: Math.max(insets.bottom + 16, 24) }]}
                >
                    {/* Handle */}
                    <View className="w-9 h-1 bg-borderStrong dark:bg-dark-borderStrong rounded-full mx-auto mb-5" />

                    <View className="flex-row items-center justify-between mb-6">
                        {/* type="subtitle" gives text-xl font-semibold — no duplicate weight class */}
                        <ThemedText type="subtitle" className="text-textPrimary dark:text-dark-textPrimary">
                            Filters
                        </ThemedText>
                        <Pressable
                            onPress={onClose}
                            className="p-1 rounded-full overflow-hidden"
                            android_ripple={{ color: RIPPLE_COLOR, borderless: false }}
                            accessibilityRole="button"
                            accessibilityLabel="Close filters"
                        >
                            {({ pressed }) => (
                                <>
                                    <Ionicons name="close" size={22} color={colors.textSecondary} />
                                    {pressed && Platform.OS === 'ios' && (
                                        <View style={[StyleSheet.absoluteFillObject, styles.pressedOverlay]} />
                                    )}
                                </>
                            )}
                        </Pressable>
                    </View>

                    <ScrollView showsVerticalScrollIndicator={false}>
                        {/* Time period */}
                        <View className="mb-8">
                            <ThemedText type="kicker" className="mb-4">
                                Time Period
                            </ThemedText>
                            <View className="flex-row flex-wrap gap-2">
                                {(['Month', 'Day', 'Week', 'Custom'] as TimeFilter[]).map((f) => {
                                    const isActive = activeTimeFilter === f;
                                    return (
                                        <Pressable
                                            key={f}
                                            onPress={() => onTimeFilterChange(f)}
                                            className={CHIP[isActive ? 'active' : 'inactive']}
                                            android_ripple={{ color: RIPPLE_COLOR, borderless: false }}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${f} time filter`}
                                            accessibilityState={{ selected: isActive }}
                                        >
                                            {({ pressed }) => (
                                                <>
                                                    <ThemedText className={CHIP_TEXT[isActive ? 'active' : 'inactive']}>
                                                        {f}
                                                    </ThemedText>
                                                    {pressed && Platform.OS === 'ios' && (
                                                        <View style={[StyleSheet.absoluteFillObject, styles.pressedOverlay]} />
                                                    )}
                                                </>
                                            )}
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>

                        {/* Custom date range */}
                        {activeTimeFilter === 'Custom' && (
                            <View className="mb-8">
                                <ThemedText type="kicker" className="mb-4">
                                    Custom Date Range
                                </ThemedText>
                                <View className="gap-3">
                                    {/* M3 Outlined — bg-surface + border-borderSoft, no shadow */}
                                    <Pressable
                                        onPress={onStartDatePress}
                                        className="p-4 rounded-xl flex-row items-center justify-between bg-backgroundAlt dark:bg-dark-backgroundAlt overflow-hidden"
                                        android_ripple={{ color: RIPPLE_COLOR, borderless: false }}
                                        accessibilityRole="button"
                                        accessibilityLabel="Select start date"
                                    >
                                        {({ pressed }) => (
                                            <>
                                                <View>
                                                    <ThemedText className="text-[11px] mb-1 font-bold text-textMuted dark:text-dark-textMuted">
                                                        START DATE
                                                    </ThemedText>
                                                    {/* type="small" gives text-sm; font-semibold not a duplicate */}
                                                    <ThemedText type="small" className="font-semibold text-textPrimary dark:text-dark-textPrimary">
                                                        {customStartDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                    </ThemedText>
                                                </View>
                                                <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                                                {pressed && Platform.OS === 'ios' && (
                                                    <View style={[StyleSheet.absoluteFillObject, styles.pressedOverlay]} />
                                                )}
                                            </>
                                        )}
                                    </Pressable>

                                    <Pressable
                                        onPress={onEndDatePress}
                                        className="p-4 rounded-xl flex-row items-center justify-between bg-backgroundAlt dark:bg-dark-backgroundAlt overflow-hidden"
                                        android_ripple={{ color: RIPPLE_COLOR, borderless: false }}
                                        accessibilityRole="button"
                                        accessibilityLabel="Select end date"
                                    >
                                        {({ pressed }) => (
                                            <>
                                                <View>
                                                    <ThemedText className="text-[11px] mb-1 font-bold text-textMuted dark:text-dark-textMuted">
                                                        END DATE
                                                    </ThemedText>
                                                    <ThemedText type="small" className="font-semibold text-textPrimary dark:text-dark-textPrimary">
                                                        {customEndDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                                                    </ThemedText>
                                                </View>
                                                <Ionicons name="calendar-outline" size={20} color={colors.primary} />
                                                {pressed && Platform.OS === 'ios' && (
                                                    <View style={[StyleSheet.absoluteFillObject, styles.pressedOverlay]} />
                                                )}
                                            </>
                                        )}
                                    </Pressable>
                                </View>
                            </View>
                        )}
                    </ScrollView>

                    <Pressable
                        onPress={onClose}
                        className="py-4 rounded-xl items-center bg-primary mt-4 overflow-hidden"
                        android_ripple={{ color: RIPPLE_COLOR, borderless: false }}
                        accessibilityRole="button"
                        accessibilityLabel="Apply filters"
                    >
                        {({ pressed }) => (
                            <>
                                {/* type="defaultSemiBold" gives text-base font-semibold — no duplicate weight class */}
                                <ThemedText type="defaultSemiBold" className="text-white">Apply Filters</ThemedText>
                                {pressed && Platform.OS === 'ios' && (
                                    <View style={[StyleSheet.absoluteFillObject, styles.pressedOverlay]} />
                                )}
                            </>
                        )}
                    </Pressable>
                </View>
            </View>
        </AppModal>
    );
}

const styles = StyleSheet.create({
    pressedOverlay: {
        backgroundColor: RIPPLE_COLOR,
    },
});
