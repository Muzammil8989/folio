import { ThemedText } from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { useThemeColors } from '@/hooks/use-theme-colors';
import React from 'react';
import { View } from 'react-native';

export interface DivergingItem {
    key: string;
    label: string;
    value: number;
    /** Small text after the value, e.g. "+12.4%". */
    detail?: string;
}

interface DivergingBarsProps {
    items: DivergingItem[];
    /** Signed value text, e.g. "+Rs 1,200". */
    formatValue: (n: number) => string;
    positiveColor: string;
    negativeColor: string;
    onPressItem?: (key: string) => void;
}

/**
 * Gains to the right of a zero line, losses to the left, one row per item.
 * Direction is also given by the sign in the text, not by colour alone.
 */
export function DivergingBars({ items, formatValue, positiveColor, negativeColor, onPressItem }: DivergingBarsProps) {
    const colors = useThemeColors();
    const maxPos = Math.max(0, ...items.map(i => i.value));
    const maxNeg = Math.max(0, ...items.map(i => -i.value));
    const span = maxPos + maxNeg || 1;
    const zero = maxNeg / span; // where the zero line sits, 0–1

    return (
        <View>
            {items.map(item => {
                const positive = item.value >= 0;
                const frac = Math.abs(item.value) / span;
                const row = (
                    <View className="py-2">
                        <View className="flex-row items-baseline mb-1.5">
                            <ThemedText type="label" numberOfLines={1} className="flex-1 mr-2">{item.label}</ThemedText>
                            <ThemedText type="figure" className="text-sm" style={{ color: positive ? positiveColor : negativeColor }}>
                                {formatValue(item.value)}
                            </ThemedText>
                            {!!item.detail && (
                                <ThemedText type="caption" className="ml-1.5">{item.detail}</ThemedText>
                            )}
                        </View>
                        <View style={{ height: 8, borderRadius: 2, backgroundColor: colors.backgroundAlt }}>
                            <View
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    bottom: 0,
                                    borderRadius: 2,
                                    backgroundColor: positive ? positiveColor : negativeColor,
                                    left: `${(positive ? zero : zero - frac) * 100}%`,
                                    width: `${Math.max(frac * 100, item.value === 0 ? 0 : 0.8)}%`,
                                }}
                            />
                            {maxNeg > 0 && maxPos > 0 && (
                                <View style={{ position: 'absolute', top: -2, bottom: -2, width: 1, left: `${zero * 100}%`, backgroundColor: colors.textMuted }} />
                            )}
                        </View>
                    </View>
                );
                return onPressItem ? (
                    <Pressable
                        key={item.key}
                        onPress={() => onPressItem(item.key)}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.label}: ${formatValue(item.value)}${item.detail ? `, ${item.detail}` : ''}`}
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                        {row}
                    </Pressable>
                ) : (
                    <View key={item.key} accessible accessibilityLabel={`${item.label}: ${formatValue(item.value)}`}>
                        {row}
                    </View>
                );
            })}
        </View>
    );
}
