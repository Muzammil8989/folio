import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { DimensionValue, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { ThemedText } from './themed-text';
import { AppModal } from './app-modal';

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEK_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
/** Caps the 7-column day grid so cells stay ~56dp on tablets instead of ballooning. */
const CALENDAR_GRID_MAX_WIDTH = 7 * 56;

/** Format a local Date to YYYY-MM-DD without timezone shift */
export const toLocalDateStr = (d: Date): string => {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
};

export interface QuickAction {
    label: string;
    date: string; // YYYY-MM-DD
}

export interface CalendarPickerProps {
    selectedDate: string;           // YYYY-MM-DD
    onSelectDate: (date: string) => void;
    onClose: () => void;
    minimumDate?: string;           // YYYY-MM-DD — dates before this are disabled
    quickActions?: QuickAction[];   // shown at the bottom; defaults to Today + Yesterday
}

const today = () => {
    const d = new Date();
    return toLocalDateStr(d);
};
const yesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toLocalDateStr(d);
};

export function CalendarPicker({
    selectedDate,
    onSelectDate,
    onClose,
    minimumDate,
    quickActions,
}: CalendarPickerProps) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const [viewDate, setViewDate] = useState(() => {
        const [y, m, d] = selectedDate.split('-').map(Number);
        return new Date(y, m - 1, d);
    });

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const todayStr = toLocalDateStr(new Date());

    type DayObj = {
        date: string;
        day: number;
        isCurrentMonth: boolean;
        isToday: boolean;
        isSelected: boolean;
        isDisabled: boolean;
    };

    const calendarDays: DayObj[] = [];

    for (let i = 0; i < startDayOfWeek; i++) {
        calendarDays.push({ date: '', day: 0, isCurrentMonth: false, isToday: false, isSelected: false, isDisabled: true });
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = toLocalDateStr(new Date(year, month, day));
        const isDisabled = minimumDate ? dateStr < minimumDate : false;
        calendarDays.push({
            date: dateStr,
            day,
            isCurrentMonth: true,
            isToday: dateStr === todayStr,
            isSelected: dateStr === selectedDate,
            isDisabled,
        });
    }

    // Default quick actions: Today + Yesterday (filtered by minimumDate)
    const resolvedQuickActions: QuickAction[] = quickActions ?? [
        { label: 'Today', date: today() },
        { label: 'Yesterday', date: yesterday() },
    ].filter(qa => !minimumDate || qa.date >= minimumDate);

    return (
        <AppModal visible transparent animationType="none" onRequestClose={onClose}>
            <Pressable onPress={onClose} style={styles.backdrop} />
            <Animated.View
                entering={FadeInUp.duration(250)}
                exiting={FadeOutDown.duration(200)}
                style={[styles.container, { backgroundColor: colors.surface, paddingBottom: insets.bottom + 24 }]}
            >

            {/* Handle */}
            <View style={{ width: 48, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong, alignSelf: 'center', marginBottom: 20 }} />

            {/* Header */}
            <View style={styles.header}>
                <ThemedText style={{ fontSize: 18, fontWeight: '700', color: colors.textPrimary }}>
                    Select Date
                </ThemedText>
                <Pressable
                    onPress={onClose}
                    style={styles.closeButton}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                >
                    <Ionicons name="close" size={24} color={colors.expense} />
                </Pressable>
            </View>

            {/* Month / Year navigation */}
            <View style={styles.navRow}>
                <Pressable
                    onPress={() => setViewDate(new Date(year, month - 1, 1))}
                    style={styles.navButton}
                >
                    <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
                </Pressable>
                <ThemedText style={{ fontSize: 16, fontWeight: '700', color: colors.textPrimary }}>
                    {MONTH_NAMES[month]} {year}
                </ThemedText>
                <Pressable
                    onPress={() => setViewDate(new Date(year, month + 1, 1))}
                    style={styles.navButton}
                >
                    <Ionicons name="chevron-forward" size={24} color={colors.textPrimary} />
                </Pressable>
            </View>

            {/* Week-day labels */}
            <View style={styles.weekDaysRow}>
                {WEEK_DAYS.map((day, i) => (
                    <View key={i} style={styles.weekDayCell}>
                        <ThemedText style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted }}>
                            {day}
                        </ThemedText>
                    </View>
                ))}
            </View>

            {/* Day grid */}
            <View style={styles.calendarGrid}>
                {calendarDays.map((dayObj, index) => {
                    if (!dayObj.isCurrentMonth) {
                        return <View key={index} style={styles.dayCell} />;
                    }
                    return (
                        <View key={index} style={styles.dayCell}>
                            <Pressable
                                disabled={dayObj.isDisabled}
                                onPress={() => onSelectDate(dayObj.date)}
                                style={[
                                    styles.dayButton,
                                    {
                                        backgroundColor: dayObj.isSelected
                                            ? colors.primary
                                            : dayObj.isToday
                                                ? `${colors.primary}15`
                                                : 'transparent',
                                        opacity: dayObj.isDisabled ? 0.3 : 1,
                                    },
                                ]}
                            >
                                <ThemedText style={{
                                    fontSize: 14,
                                    fontWeight: dayObj.isSelected || dayObj.isToday ? '700' : '600',
                                    color: dayObj.isSelected
                                        ? '#fff'
                                        : dayObj.isToday
                                            ? colors.primary
                                            : colors.textPrimary,
                                }}>
                                    {dayObj.day}
                                </ThemedText>
                            </Pressable>
                        </View>
                    );
                })}
            </View>

            {/* Quick actions */}
            {resolvedQuickActions.length > 0 && (
                <View style={styles.quickActionsRow}>
                    {resolvedQuickActions.map(qa => (
                        <Pressable
                            key={qa.label}
                            onPress={() => onSelectDate(qa.date)}
                            style={[
                                styles.quickAction,
                                { backgroundColor: colors.backgroundAlt },
                            ]}
                        >
                            <ThemedText style={{ fontSize: 13, fontWeight: '600', color: colors.textPrimary }}>
                                {qa.label}
                            </ThemedText>
                        </Pressable>
                    ))}
                </View>
            )}
            </Animated.View>
        </AppModal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    container: {
        // No left/right insets: the sheet is centred and capped to the app's
        // reading column so it doesn't stretch edge-to-edge on tablets.
        position: 'absolute',
        bottom: 0,
        width: '100%',
        maxWidth: MAX_CONTENT_WIDTH,
        alignSelf: 'center',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 24,
        paddingTop: 24,
        paddingBottom: 40,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
        elevation: 24,
        zIndex: 1000,
    },
    gradient: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 120,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        zIndex: 1,
    },
    closeButton: { padding: 4 },
    navRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
    },
    navButton: { padding: 8 },
    weekDaysRow: { flexDirection: 'row', marginBottom: 12, width: '100%', maxWidth: CALENDAR_GRID_MAX_WIDTH, alignSelf: 'center' },
    weekDayCell: { flex: 1, alignItems: 'center' },
    calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20, width: '100%', maxWidth: CALENDAR_GRID_MAX_WIDTH, alignSelf: 'center' },
    dayCell: {
        width: `${100 / 7}%` as DimensionValue,
        aspectRatio: 1,
        padding: 2,
    },
    dayButton: {
        flex: 1,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    quickActionsRow: { flexDirection: 'row', gap: 8 },
    quickAction: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 12,
        alignItems: 'center',
    },
});
