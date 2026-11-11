import { ThemedText } from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { useContentWidth } from '@/hooks/use-content-width';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { memo } from 'react';
import { useWindowDimensions, View } from 'react-native';
import type { CalcKey } from '../input';

const ROWS: CalcKey[][] = [
    ['clear', '()', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '−'],
    ['1', '2', '3', '+'],
    ['0', '.', 'back', '='],
];

const GAP = 10;

/** Light tap feedback; never lets a haptics failure interrupt input. */
function haptic(style: Haptics.ImpactFeedbackStyle) {
    try {
        Promise.resolve(Haptics.impactAsync(style)).catch(() => {});
    } catch {
        // Haptics unavailable on this device.
    }
}
const PADDING_X = 20;

type Variant = 'digit' | 'function' | 'operator' | 'equals';

const KEY_INFO: Partial<Record<CalcKey, { label: string; a11y: string; variant: Variant }>> = {
    clear: { label: 'C', a11y: 'Clear', variant: 'function' },
    '()': { label: '( )', a11y: 'Bracket', variant: 'function' },
    '%': { label: '%', a11y: 'Percent', variant: 'function' },
    back: { label: '', a11y: 'Delete', variant: 'function' },
    '÷': { label: '÷', a11y: 'Divide', variant: 'operator' },
    '×': { label: '×', a11y: 'Multiply', variant: 'operator' },
    '−': { label: '−', a11y: 'Minus', variant: 'operator' },
    '+': { label: '+', a11y: 'Plus', variant: 'operator' },
    '=': { label: '=', a11y: 'Equals', variant: 'equals' },
    '.': { label: '.', a11y: 'Decimal point', variant: 'digit' },
};

const CalcButton = memo(function CalcButton({
    k,
    width,
    height,
    onPress,
    onLongPress,
}: {
    k: CalcKey;
    width: number;
    height: number;
    onPress: (k: CalcKey) => void;
    onLongPress?: (k: CalcKey) => void;
}) {
    const colors = useThemeColors();
    const info = KEY_INFO[k] ?? { label: k, a11y: k, variant: 'digit' as Variant };

    const palette: Record<Variant, { bg: string; pressed: string; text: string; border?: string }> = {
        digit: { bg: colors.surface, pressed: colors.backgroundAlt, text: colors.textPrimary, border: colors.divider },
        function: { bg: colors.backgroundAlt, pressed: colors.borderSoft, text: colors.textSecondary },
        operator: { bg: colors.backgroundAlt, pressed: colors.borderSoft, text: colors.primary },
        equals: { bg: colors.primary, pressed: colors.primary, text: colors.textOnPrimary },
    };
    const p = palette[info.variant];
    const fontSize = info.variant === 'digit' ? 28 : info.variant === 'function' ? 22 : 30;

    return (
        <Pressable
            onPress={() => {
                haptic(Haptics.ImpactFeedbackStyle.Light);
                onPress(k);
            }}
            onLongPress={onLongPress ? () => {
                haptic(Haptics.ImpactFeedbackStyle.Medium);
                onLongPress(k);
            } : undefined}
            accessibilityRole="button"
            accessibilityLabel={info.a11y}
            accessibilityHint={k === 'back' ? 'Long press to clear everything' : undefined}
            style={({ pressed }) => ({
                width,
                height,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? p.pressed : p.bg,
                borderWidth: p.border ? 1 : 0,
                borderColor: p.border,
                opacity: pressed && info.variant === 'equals' ? 0.85 : 1,
            })}
        >
            {k === 'back' ? (
                <Ionicons name="backspace-outline" size={26} color={p.text} />
            ) : (
                <ThemedText type="figure" style={{ fontSize, lineHeight: fontSize + 8, color: p.text }}>
                    {info.label}
                </ThemedText>
            )}
        </Pressable>
    );
});

/** 4 × 5 calculator keypad that sizes its keys to the screen. */
export function CalcKeypad({ onKey, onClearAll }: { onKey: (k: CalcKey) => void; onClearAll: () => void }) {
    const contentWidth = useContentWidth();
    const { height: windowHeight } = useWindowDimensions();
    const keyWidth = Math.floor((contentWidth - PADDING_X * 2 - GAP * 3) / 4);
    // Keep the keypad to about half the screen so the display stays readable on short phones.
    const keyHeight = Math.max(48, Math.min(Math.round(keyWidth * 0.82), Math.floor((windowHeight * 0.5 - GAP * 4) / 5)));

    return (
        <View style={{ paddingHorizontal: PADDING_X, gap: GAP }}>
            {ROWS.map((row, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: GAP }}>
                    {row.map(k => (
                        <CalcButton
                            key={k}
                            k={k}
                            width={keyWidth}
                            height={keyHeight}
                            onPress={onKey}
                            onLongPress={k === 'back' ? onClearAll : undefined}
                        />
                    ))}
                </View>
            ))}
        </View>
    );
}
