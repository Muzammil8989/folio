import { AppModal, ThemedText } from '@/components/common';
import { shadows } from '@/theme/shadows';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import tokens from '@/theme/tokens';

// Selected-day fill carries white text: brand teal is 7.7:1 against white in both themes.
const PRIMARY_COLOR = tokens.brand.primary;
const RIPPLE_COLOR = 'rgba(13,92,99,0.12)';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Static cell text config — never build NativeWind classes dynamically
const CELL_TEXT = {
    selected: 'text-sm font-semibold text-white',
    default: 'text-sm font-semibold text-textPrimary dark:text-dark-textPrimary',
} as const;

interface DatePickerModalProps {
    visible: boolean;
    mode: 'start' | 'end';
    selectedDate: Date;
    onDateChange: (d: Date) => void;
    viewDate: Date;
    onViewDateChange: (d: Date) => void;
    onClose: () => void;
    /** Days before this are disabled (e.g. the end date can't precede the start). */
    minDate?: Date;
    /** Days after this are disabled. */
    maxDate?: Date;
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function DatePickerModal({
    visible,
    mode,
    selectedDate,
    onDateChange,
    viewDate,
    onViewDateChange,
    onClose,
    minDate,
    maxDate,
}: DatePickerModalProps) {
    // Taps only change a draft; "Done" applies it and "Cancel" discards it.
    // (Previously every tap applied immediately, so Cancel did nothing.)
    const [draft, setDraft] = useState(selectedDate);
    useEffect(() => {
        if (visible) setDraft(selectedDate);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible]);
    const isOutOfRange = (d: Date) =>
        (minDate !== undefined && dayStart(d) < dayStart(minDate)) ||
        (maxDate !== undefined && dayStart(d) > dayStart(maxDate));
    // textPrimary changes per theme — hook required for Ionicons color prop
    const colors = useThemeColors();
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    const calendarDays = useMemo<(number | null)[]>(() => {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const days: (number | null)[] = [];
        for (let i = 0; i < firstDayOfMonth; i++) days.push(null);
        for (let i = 1; i <= daysInMonth; i++) days.push(i);
        return days;
    }, [year, month]);

    return (
        <AppModal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
            <View className="flex-1 justify-center items-center px-5 bg-black/40">
                {/* M3 Elevated card — bg-surfaceAlt + shadow, no border */}
                <View
                    className="rounded-xl p-6 w-full max-w-sm bg-surfaceAlt dark:bg-dark-surfaceAlt"
                    style={shadows.lg}
                >
                    <ThemedText
                        type="defaultSemiBold"
                        className="text-textPrimary dark:text-dark-textPrimary mb-5"
                    >
                        Select {mode === 'start' ? 'Start' : 'End'} Date
                    </ThemedText>

                    {/* Month navigation */}
                    <View className="flex-row items-center justify-between mb-4">
                        {/* M3 Filled — bg-backgroundAlt, no border, no shadow */}
                        <Pressable
                            onPress={() => onViewDateChange(new Date(year, month - 1, 1))}
                            className="p-2 rounded-xl bg-backgroundAlt dark:bg-dark-backgroundAlt overflow-hidden"
                            android_ripple={{ color: RIPPLE_COLOR, borderless: false }}
                            accessibilityRole="button"
                            accessibilityLabel="Previous month"
                        >
                            {({ pressed }) => (
                                <>
                                    <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
                                    {pressed && Platform.OS === 'ios' && (
                                        <View style={[StyleSheet.absoluteFillObject, styles.pressedOverlay]} />
                                    )}
                                </>
                            )}
                        </Pressable>
                        <ThemedText
                            type="defaultSemiBold"
                            className="text-textPrimary dark:text-dark-textPrimary"
                        >
                            {MONTH_NAMES[month]} {year}
                        </ThemedText>
                        <Pressable
                            onPress={() => onViewDateChange(new Date(year, month + 1, 1))}
                            className="p-2 rounded-xl bg-backgroundAlt dark:bg-dark-backgroundAlt overflow-hidden"
                            android_ripple={{ color: RIPPLE_COLOR, borderless: false }}
                            accessibilityRole="button"
                            accessibilityLabel="Next month"
                        >
                            {({ pressed }) => (
                                <>
                                    <Ionicons name="chevron-forward" size={22} color={colors.textPrimary} />
                                    {pressed && Platform.OS === 'ios' && (
                                        <View style={[StyleSheet.absoluteFillObject, styles.pressedOverlay]} />
                                    )}
                                </>
                            )}
                        </Pressable>
                    </View>

                    {/* Day labels — decorative, no interactivity */}
                    <View className="flex-row mb-1">
                        {DAY_LABELS.map(d => (
                            <View key={d} className="flex-1 items-center py-1.5">
                                <ThemedText className="text-[11px] font-semibold text-textMuted dark:text-dark-textMuted">
                                    {d}
                                </ThemedText>
                            </View>
                        ))}
                    </View>

                    {/* Calendar grid */}
                    <View className="flex-row flex-wrap">
                        {calendarDays.map((day, i) => {
                            const isSelected =
                                day !== null &&
                                new Date(year, month, day).toDateString() === draft.toDateString();
                            const disabled = day === null || isOutOfRange(new Date(year, month, day));
                            return (
                                <Pressable
                                    key={day !== null ? `${year}-${month}-${day}` : `empty-${i}`}
                                    className="w-[14.28%] items-center py-3 overflow-hidden"
                                    disabled={disabled}
                                    onPress={() => day !== null && setDraft(new Date(year, month, day))}
                                    android_ripple={{ color: RIPPLE_COLOR, borderless: false }}
                                    accessibilityRole="button"
                                    accessibilityLabel={
                                        day !== null ? `${MONTH_NAMES[month]} ${day}, ${year}` : undefined
                                    }
                                    accessibilityState={{ disabled, selected: isSelected }}
                                    style={[isSelected ? styles.daySelected : styles.dayDefault, disabled && day !== null && styles.dayDisabled]}
                                >
                                    {({ pressed }) => (
                                        <>
                                            {day !== null && (
                                                <ThemedText className={CELL_TEXT[isSelected ? 'selected' : 'default']}>
                                                    {day}
                                                </ThemedText>
                                            )}
                                            {pressed && Platform.OS === 'ios' && (
                                                <View style={[StyleSheet.absoluteFillObject, styles.pressedOverlay]} />
                                            )}
                                        </>
                                    )}
                                </Pressable>
                            );
                        })}
                    </View>

                    {/* Actions */}
                    <View className="flex-row gap-2 mt-5">
                        {/* M3 Filled Tonal (secondary action) — bg-backgroundAlt, no border, no shadow */}
                        <Pressable
                            onPress={onClose}
                            className="flex-1 py-3 rounded-xl items-center bg-backgroundAlt dark:bg-dark-backgroundAlt overflow-hidden"
                            android_ripple={{ color: RIPPLE_COLOR, borderless: false }}
                            accessibilityRole="button"
                            accessibilityLabel="Cancel"
                        >
                            {({ pressed }) => (
                                <>
                                    <ThemedText type="defaultSemiBold" className="text-textPrimary dark:text-dark-textPrimary">
                                        Cancel
                                    </ThemedText>
                                    {pressed && Platform.OS === 'ios' && (
                                        <View style={[StyleSheet.absoluteFillObject, styles.pressedOverlay]} />
                                    )}
                                </>
                            )}
                        </Pressable>
                        {/* Primary action */}
                        <Pressable
                            onPress={() => { onDateChange(draft); onClose(); }}
                            className="flex-1 py-3 rounded-xl items-center bg-primary overflow-hidden"
                            android_ripple={{ color: RIPPLE_COLOR, borderless: false }}
                            accessibilityRole="button"
                            accessibilityLabel="Confirm date selection"
                        >
                            {({ pressed }) => (
                                <>
                                    <ThemedText type="defaultSemiBold" className="text-white">Done</ThemedText>
                                    {pressed && Platform.OS === 'ios' && (
                                        <View style={[StyleSheet.absoluteFillObject, styles.pressedOverlay]} />
                                    )}
                                </>
                            )}
                        </Pressable>
                    </View>
                </View>
            </View>
        </AppModal>
    );
}

const styles = StyleSheet.create({
    // M3 date picker uses circular day indicators (rounded-full = 9999)
    daySelected: {
        backgroundColor: PRIMARY_COLOR,
        borderRadius: 9999,
    },
    dayDisabled: {
        opacity: 0.3,
    },
    dayDefault: {
        backgroundColor: 'transparent',
        borderRadius: 9999,
    },
    // borderRadius omitted — parent overflow-hidden handles clipping
    pressedOverlay: {
        backgroundColor: RIPPLE_COLOR,
    },
});
