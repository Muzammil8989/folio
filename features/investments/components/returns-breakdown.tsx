import { ThemedText } from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { View } from 'react-native';
import { formatPct, formatSigned } from '../utils';
import { FIGURE_DEFINITIONS } from './form-parts';

export interface ReturnsFigures {
    /** Market value of the units held now. */
    value: number;
    /** What the units held now cost (average cost × quantity, fees included). */
    cost: number;
    unrealized: number;
    unrealizedPct: number | null;
    realized: number;
    dividends: number;
    totalReturn: number;
    totalReturnPct: number | null;
    /** Everything ever spent on buys, fees included. */
    totalBought: number;
}

function Row({ label, definition, formula, value, valueColor, strong }: {
    label: string;
    definition: string;
    formula?: string;
    value: string;
    valueColor?: string;
    strong?: boolean;
}) {
    return (
        <View className={`py-2.5 ${strong ? 'border-t border-divider dark:border-dark-divider mt-1' : ''}`}>
            <View className="flex-row items-baseline">
                <ThemedText type="label" className="flex-1 mr-3">{label}</ThemedText>
                <ThemedText type="figure" className={strong ? 'text-base' : 'text-sm'} style={{ color: valueColor }}>{value}</ThemedText>
            </View>
            <ThemedText type="caption" className="mt-0.5">{definition}</ThemedText>
            {!!formula && <ThemedText type="caption" className="mt-0.5" style={{ opacity: 0.8 }}>{formula}</ThemedText>}
        </View>
    );
}

/**
 * "How is this calculated?" — a collapsible card that shows how the return
 * figures above it are built, each with a one-line definition and the
 * screen's own numbers:
 *
 *   unrealised   = value now − invested (cost of what you hold)
 *   realised     = what sales brought in − average cost of the units sold
 *   total return = unrealised + realised + dividends
 */
export function ReturnsBreakdown({
    figures: f,
    fmt,
    priceTerm = 'Price',
}: {
    figures: ReturnsFigures;
    fmt: (n: number) => string;
    /** "NAV" for a mutual fund, "Price" otherwise. */
    priceTerm?: 'NAV' | 'Price';
}) {
    const colors = useThemeColors();
    const [open, setOpen] = useState(false);
    const tone = (n: number) => (Math.abs(n) < 0.005 ? colors.textPrimary : n >= 0 ? colors.income : colors.expense);
    const term = priceTerm.toLowerCase() === 'nav' ? 'NAV' : 'price';

    return (
        <View className="mx-5 mt-4 rounded-2xl border border-divider dark:border-dark-divider bg-surface dark:bg-dark-surface">
            <Pressable
                onPress={() => setOpen(o => !o)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel="How is this calculated?"
                className="flex-row items-center px-4 min-h-[48px]"
            >
                <Ionicons name="calculator-outline" size={18} color={colors.textSecondary} />
                <ThemedText type="label" className="flex-1 ml-2.5">How is this calculated?</ThemedText>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </Pressable>

            {open && (
                <View className="px-4 pb-3">
                    <Row
                        label="Invested"
                        definition={FIGURE_DEFINITIONS.invested}
                        formula="Every purchase with its fees, less the average cost of units sold."
                        value={fmt(f.cost)}
                    />
                    <Row
                        label="Value now"
                        definition={`Units held × current ${term}.`}
                        value={fmt(f.value)}
                    />
                    <Row
                        label="Unrealised"
                        definition={FIGURE_DEFINITIONS.unrealised}
                        formula={`Value now ${fmt(f.value)} − invested ${fmt(f.cost)}`}
                        value={`${formatSigned(f.unrealized, fmt)} (${formatPct(f.unrealizedPct)})`}
                        valueColor={tone(f.unrealized)}
                    />
                    <Row
                        label="Realised"
                        definition={FIGURE_DEFINITIONS.realised}
                        formula="Sale amount after fees − average cost of the units sold"
                        value={formatSigned(f.realized, fmt)}
                        valueColor={tone(f.realized)}
                    />
                    <Row
                        label="Dividends"
                        definition={FIGURE_DEFINITIONS.dividends}
                        value={fmt(f.dividends)}
                    />
                    <Row
                        label="Total return"
                        definition={FIGURE_DEFINITIONS.totalReturn}
                        formula={`% is against all purchases with fees: ${fmt(f.totalBought)}`}
                        value={`${formatSigned(f.totalReturn, fmt)} (${formatPct(f.totalReturnPct)})`}
                        valueColor={tone(f.totalReturn)}
                        strong
                    />
                    <ThemedText type="caption" className="mt-2">
                        Uses the average-cost method, as brokers do. The current {term} is the one you entered,
                        or the last buy or sell {term} if that is newer.
                    </ThemedText>
                </View>
            )}
        </View>
    );
}
