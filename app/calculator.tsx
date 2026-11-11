/**
 * Calculator: a simple everyday calculator with a saved history.
 *
 *   display   the calculation being typed (or the one behind the result),
 *             a live preview while typing, and whole results in words
 *   keypad    C ( ) % ÷ / 7 8 9 × / 4 5 6 − / 1 2 3 + / 0 . ⌫ =
 *   history   every "=" result, grouped by day; tap one to reuse it
 */
import { HeaderIconButton, ScreenHeader, ThemedText } from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { CalcKeypad } from '@/features/calculator/components/calc-keypad';
import { HistorySheet } from '@/features/calculator/components/history-sheet';
import { useCalcHistory } from '@/features/calculator/hooks/use-calc-history';
import {
    INITIAL_STATE,
    previewValue,
    pressKey,
    toInputString,
    type CalcKey,
    type CalcState,
} from '@/features/calculator/input';
import { resultInWords } from '@/features/calculator/utils';
import { useThemeColors } from '@/hooks/use-theme-colors';
import type { CalculatorHistoryEntry } from '@/lib/db/queries';
import { toast } from '@/lib/toast';
import { numberToWords } from '@/lib/utils/currency';
import { formatExpression, formatResult } from '@/lib/utils/expression';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Plain digits for the clipboard: no grouping, ASCII minus. */
const plain = (n: number) => String(n);

export default function CalculatorScreen() {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const { entries: historyEntries, add: addHistory, remove: removeHistory, clear: clearHistory } = useCalcHistory();
    const [state, setState] = useState<CalcState>(INITIAL_STATE);
    const [historyOpen, setHistoryOpen] = useState(false);
    // The latest state for the key handler, so it stays stable across renders.
    const stateRef = useRef(state);
    stateRef.current = state;

    const handleKey = useCallback((key: CalcKey) => {
        const { state: nextState, evaluated } = pressKey(stateRef.current, key);
        stateRef.current = nextState;
        setState(nextState);
        if (evaluated) addHistory(evaluated.expression, evaluated.result);
    }, [addHistory]);

    const clearAll = useCallback(() => {
        stateRef.current = INITIAL_STATE;
        setState(INITIAL_STATE);
    }, []);

    const showingResult = state.lastExpression !== null;
    const resultValue = showingResult ? Number(state.expr.replace('−', '-')) : null;
    const preview = useMemo(() => previewValue(state), [state]);
    const words = resultInWords(showingResult ? resultValue : preview, numberToWords);
    const display = state.expr ? formatExpression(state.expr) : '0';

    const copyValue = useCallback(async (value: number) => {
        try {
            await Clipboard.setStringAsync(plain(value));
            toast.success('Copied', formatResult(value));
        } catch {
            toast.error("Couldn't copy");
        }
    }, []);

    const handleCopyDisplay = () => {
        const value = showingResult ? resultValue : preview;
        if (value != null && Number.isFinite(value)) copyValue(value);
    };

    const loadEntry = useCallback((entry: CalculatorHistoryEntry) => {
        const next: CalcState = { expr: toInputString(entry.result), lastExpression: entry.expression, error: null };
        stateRef.current = next;
        setState(next);
    }, []);

    return (
        <View className="flex-1 bg-background dark:bg-dark-background" style={{ paddingBottom: insets.bottom + 16 }}>
            <View style={{ paddingTop: insets.top }}>
                <ScreenHeader
                    title="Calculator"
                    subtitle="Quick sums, saved as you go"
                    right={
                        <HeaderIconButton
                            icon="time-outline"
                            accessibilityLabel="Calculation history"
                            onPress={() => setHistoryOpen(true)}
                        />
                    }
                />
            </View>

            {/* ── Display ─────────────────────────────────────── */}
            <Pressable
                onLongPress={handleCopyDisplay}
                accessibilityRole="text"
                accessibilityLabel={showingResult ? `${state.lastExpression} equals ${display}` : display}
                accessibilityHint="Long press to copy the result"
                accessibilityLiveRegion="polite"
                className="flex-1 justify-end px-6 pb-5"
            >
                {showingResult && (
                    <ThemedText
                        numberOfLines={2}
                        className="text-right mb-1"
                        style={{ color: colors.textMuted, fontSize: 18, lineHeight: 24 }}
                    >
                        {formatExpression(state.lastExpression!)} =
                    </ThemedText>
                )}
                <ThemedText
                    type="figureLg"
                    numberOfLines={2}
                    adjustsFontSizeToFit
                    minimumFontScale={0.4}
                    className="text-right"
                    style={{ fontSize: 52, lineHeight: 62, color: colors.textPrimary }}
                >
                    {display}
                </ThemedText>
                <View style={{ minHeight: 30 }}>
                    {state.error ? (
                        <ThemedText className="text-right" style={{ color: colors.expense, fontSize: 16, lineHeight: 26 }}>
                            {state.error}
                        </ThemedText>
                    ) : preview != null ? (
                        <ThemedText type="figure" className="text-right" style={{ color: colors.textSecondary, fontSize: 22, lineHeight: 30 }}>
                            = {formatResult(preview)}
                        </ThemedText>
                    ) : null}
                </View>
                <View style={{ minHeight: 20 }}>
                    {!!words && (
                        <ThemedText type="caption" numberOfLines={2} className="text-right" style={{ color: colors.textMuted }}>
                            {words}
                        </ThemedText>
                    )}
                </View>
            </Pressable>

            <View className="border-t border-divider dark:border-dark-divider pt-4">
                <CalcKeypad onKey={handleKey} onClearAll={clearAll} />
            </View>

            <HistorySheet
                visible={historyOpen}
                onClose={() => setHistoryOpen(false)}
                entries={historyEntries}
                onSelect={loadEntry}
                onCopy={entry => copyValue(entry.result)}
                onDelete={removeHistory}
                onClear={clearHistory}
            />
        </View>
    );
}
