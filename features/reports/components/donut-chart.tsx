import { ThemedText } from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { useThemeColors } from '@/hooks/use-theme-colors';
import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

export interface DonutSlice {
    key: string;
    label: string;
    value: number;
    /** 0–100. */
    percent: number;
    color: string;
}

interface DonutChartProps {
    slices: DonutSlice[];
    /** Shown in the middle when no slice is selected, e.g. "Total". */
    centerLabel: string;
    centerValue: string;
    formatValue: (n: number) => string;
    size?: number;
}

const STROKE = 18;
const GAP_PX = 2;

/**
 * Ring of slices with a legend underneath. Tap a legend row to show that
 * slice in the middle; tap it again to go back to the total.
 */
export function DonutChart({ slices, centerLabel, centerValue, formatValue, size = 164 }: DonutChartProps) {
    const colors = useThemeColors();
    const [selected, setSelected] = useState<string | null>(null);
    const r = (size - STROKE) / 2;
    const circ = 2 * Math.PI * r;
    const active = slices.find(s => s.key === selected) ?? null;
    // The selection can outlive its slice (new period, holding sold out).
    const activeKey = active?.key ?? null;
    const gap = slices.length > 1 ? GAP_PX : 0;

    let offset = 0;
    const arcs = slices.map(s => {
        const len = (s.percent / 100) * circ;
        const arc = { ...s, dash: Math.max(0, len - gap), offset };
        offset += len;
        return arc;
    });

    const summary = slices.map(s => `${s.label} ${Math.round(s.percent)} percent`).join(', ');

    return (
        <View>
            <View
                className="items-center"
                accessible
                accessibilityLabel={`${centerLabel} ${centerValue}. ${summary}`}
            >
                <View style={{ width: size, height: size }}>
                    <Svg width={size} height={size}>
                        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
                            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.backgroundAlt} strokeWidth={STROKE} fill="none" />
                            {arcs.map(a => (
                                <Circle
                                    key={a.key}
                                    cx={size / 2}
                                    cy={size / 2}
                                    r={r}
                                    stroke={a.color}
                                    strokeWidth={activeKey && activeKey !== a.key ? STROKE - 6 : STROKE}
                                    strokeOpacity={activeKey && activeKey !== a.key ? 0.35 : 1}
                                    strokeDasharray={`${a.dash} ${circ - a.dash}`}
                                    strokeDashoffset={-a.offset}
                                    fill="none"
                                />
                            ))}
                        </G>
                    </Svg>
                    <View
                        pointerEvents="none"
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: STROKE + 8 }}
                    >
                        <ThemedText type="kicker" numberOfLines={1} className="text-center">
                            {active ? active.label : centerLabel}
                        </ThemedText>
                        <ThemedText type="figure" numberOfLines={1} adjustsFontSizeToFit className="text-center text-lg">
                            {active ? `${Math.round(active.percent)}%` : centerValue}
                        </ThemedText>
                        {active && (
                            <ThemedText type="caption" numberOfLines={1} adjustsFontSizeToFit className="text-center">
                                {formatValue(active.value)}
                            </ThemedText>
                        )}
                    </View>
                </View>
            </View>

            <View className="mt-4">
                {slices.map(s => {
                    const on = activeKey === s.key;
                    return (
                        <Pressable
                            key={s.key}
                            onPress={() => setSelected(on ? null : s.key)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            accessibilityLabel={`${s.label}, ${Math.round(s.percent)} percent, ${formatValue(s.value)}`}
                            className="flex-row items-center py-2 px-2 -mx-2 rounded-lg min-h-[40px]"
                            style={({ pressed }) => ({ backgroundColor: on || pressed ? colors.backgroundAlt : 'transparent' })}
                        >
                            <View className="w-2.5 h-2.5 rounded-sm mr-2.5" style={{ backgroundColor: s.color }} />
                            <ThemedText type="label" numberOfLines={1} className="flex-1">{s.label}</ThemedText>
                            <ThemedText type="figure" className="text-sm ml-2" style={{ color: colors.textMuted }}>
                                {Math.round(s.percent)}%
                            </ThemedText>
                            <ThemedText type="figure" className="text-sm ml-3 text-right" style={{ minWidth: 92 }} numberOfLines={1}>
                                {formatValue(s.value)}
                            </ThemedText>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}
