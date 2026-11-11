import { ThemedText } from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { Ionicons } from '@expo/vector-icons';
import React, { memo } from 'react';
import { View } from 'react-native';
import { ASSET_TYPE_ICONS, formatPct, formatPrice, formatQuantity, formatSigned, unitLabel, type HoldingSummary } from '../utils';

interface HoldingRowProps {
    summary: HoldingSummary;
    color: string;
    fmt: (n: number) => string;
    symbol: string;
    onPress: (id: number) => void;
    ruled?: boolean;
}

/** Name, quantity × average cost, market value and total return (▲/▼ with sign). */
export const HoldingRow = memo(function HoldingRow({ summary: s, color, fmt, symbol, onPress, ruled = true }: HoldingRowProps) {
    const colors = useThemeColors();
    const h = s.holding;
    const up = s.totalReturn >= 0;
    const returnColor = Math.abs(s.totalReturn) < 0.005 ? colors.textMuted : up ? colors.income : colors.expense;
    const detail = s.isOpen
        ? `${formatQuantity(s.position.quantity)} ${unitLabel(h.asset_type, s.position.quantity)} · avg ${formatPrice(s.position.avgCost, fmt, symbol)}`
        : s.position.tradeCount === 0
            ? 'No purchases yet'
            : 'Sold out';
    const value = s.isOpen ? fmt(s.marketValue) : fmt(0);

    return (
        <Pressable
            onPress={() => onPress(h.id)}
            accessibilityRole="button"
            accessibilityLabel={`${h.name}. ${detail}. Value ${value}. Total return ${formatSigned(s.totalReturn, fmt)}, ${formatPct(s.totalReturnPct)}`}
            className={`flex-row items-center py-3.5 ${ruled ? 'border-b border-divider dark:border-dark-divider' : ''}`}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
            <View
                className="w-10 h-10 rounded-full items-center justify-center mr-3"
                style={{ backgroundColor: colors.backgroundAlt, borderWidth: 2, borderColor: color }}
            >
                <Ionicons name={ASSET_TYPE_ICONS[h.asset_type]} size={17} color={colors.textSecondary} />
            </View>
            <View className="flex-1 mr-3">
                <ThemedText type="label" numberOfLines={1}>
                    {h.name}
                    {!!h.symbol && <ThemedText type="caption">{`  ${h.symbol}`}</ThemedText>}
                </ThemedText>
                <ThemedText type="caption" numberOfLines={1}>{detail}</ThemedText>
            </View>
            <View className="items-end">
                <ThemedText type="figure" numberOfLines={1}>{value}</ThemedText>
                <ThemedText type="figure" className="text-xs" style={{ color: returnColor }} numberOfLines={1}>
                    {up ? '▲' : '▼'} {formatSigned(s.totalReturn, fmt)} · {formatPct(s.totalReturnPct)}
                </ThemedText>
            </View>
        </Pressable>
    );
});
