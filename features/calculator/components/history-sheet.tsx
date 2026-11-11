import {
    AppButton,
    BottomSheet,
    EmptyState,
    FormScrollView,
    SheetHeader,
    ThemedText,
    type BottomSheetRef,
} from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { useThemeColors } from '@/hooks/use-theme-colors';
import type { CalculatorHistoryEntry } from '@/lib/db/queries';
import { formatExpression, formatResult } from '@/lib/utils/expression';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatTime, groupByDay, parseTimestamp } from '../utils';

interface HistorySheetProps {
    visible: boolean;
    onClose: () => void;
    entries: CalculatorHistoryEntry[];
    /** Load a past calculation back onto the calculator. */
    onSelect: (entry: CalculatorHistoryEntry) => void;
    onCopy: (entry: CalculatorHistoryEntry) => void;
    onDelete: (id: number) => void;
    onClear: () => void;
}

function HistoryRow({
    entry,
    onSelect,
    onCopy,
    onDelete,
}: {
    entry: CalculatorHistoryEntry;
    onSelect: () => void;
    onCopy: () => void;
    onDelete: () => void;
}) {
    const colors = useThemeColors();
    const expression = formatExpression(entry.expression);
    const result = formatResult(entry.result);
    return (
        <View className="flex-row items-center border-b border-divider dark:border-dark-divider">
            <Pressable
                onPress={onSelect}
                onLongPress={onCopy}
                accessibilityRole="button"
                accessibilityLabel={`${expression} equals ${result}`}
                accessibilityHint="Tap to use this result. Long press to copy it."
                className="flex-1 py-3 pr-2"
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
                <ThemedText type="caption" numberOfLines={2} style={{ color: colors.textMuted }}>
                    {expression}
                </ThemedText>
                <ThemedText type="figure" numberOfLines={1} style={{ fontSize: 20, lineHeight: 28 }}>
                    = {result}
                </ThemedText>
            </Pressable>
            <ThemedText type="caption" style={{ color: colors.textMuted }}>
                {formatTime(parseTimestamp(entry.created_at))}
            </ThemedText>
            <Pressable
                onPress={onDelete}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${expression}`}
                style={({ pressed }) => ({
                    width: 40, height: 40, borderRadius: 20, marginLeft: 4, marginRight: -8,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: pressed ? colors.backgroundAlt : 'transparent',
                })}
            >
                <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
        </View>
    );
}

export function HistorySheet({ visible, onClose, entries, onSelect, onCopy, onDelete, onClear }: HistorySheetProps) {
    const insets = useSafeAreaInsets();
    const colors = useThemeColors();
    const sheetRef = useRef<BottomSheetRef>(null);
    const [confirmClear, setConfirmClear] = useState(false);
    const groups = useMemo(() => groupByDay(entries), [entries]);

    useEffect(() => {
        if (!visible) setConfirmClear(false);
    }, [visible]);

    const close = () => sheetRef.current?.dismiss(onClose);

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            maxHeight="85%"
            paddingHorizontal={24}
            paddingTop={16}
            paddingBottom={insets.bottom + 24}
            keyboardAvoiding={false}
        >
            <SheetHeader
                kicker={entries.length ? `${entries.length} saved` : 'Calculator'}
                title="History"
                onClose={close}
            />

            {entries.length === 0 ? (
                <EmptyState
                    compact
                    icon="time-outline"
                    title="No calculations yet"
                    subtitle="Every result you get with = is saved here."
                />
            ) : (
                <>
                    <FormScrollView
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingBottom: 16 }}
                    >
                        {groups.map(group => (
                            <View key={group.label} className="mb-4">
                                <ThemedText type="kicker" className="mb-1">{group.label}</ThemedText>
                                {group.items.map(entry => (
                                    <HistoryRow
                                        key={entry.id}
                                        entry={entry}
                                        onSelect={() => sheetRef.current?.dismiss(() => { onClose(); onSelect(entry); })}
                                        onCopy={() => onCopy(entry)}
                                        onDelete={() => onDelete(entry.id)}
                                    />
                                ))}
                            </View>
                        ))}
                    </FormScrollView>

                    {confirmClear ? (
                        <View className="pt-3">
                            <ThemedText className="text-center mb-3" style={{ color: colors.textSecondary }}>
                                Delete all {entries.length} calculations? This can&apos;t be undone.
                            </ThemedText>
                            <View className="flex-row gap-3">
                                <AppButton label="Cancel" variant="secondary" onPress={() => setConfirmClear(false)} flex />
                                <AppButton
                                    label="Clear all"
                                    variant="destructive"
                                    onPress={() => { setConfirmClear(false); onClear(); }}
                                    flex
                                />
                            </View>
                        </View>
                    ) : (
                        <View className="pt-3">
                            <AppButton label="Clear history" variant="secondary" icon="trash-outline" onPress={() => setConfirmClear(true)} />
                        </View>
                    )}
                </>
            )}
        </BottomSheet>
    );
}
