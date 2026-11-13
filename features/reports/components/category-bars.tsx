import { ThemedText } from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { UserService } from '@/features/user/services/user-service';
import type { CategoryExpense } from '@/lib/db/queries';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useChartTheme } from '../chart-theme';
import { buildDonutSlices } from '../utils';

interface CategoryBarsProps {
    categoryData: CategoryExpense[];
    currency: string;
    /** Rows before the rest fold into "Other". */
    maxRows?: number;
    /** Spending (default) or income; only changes the wording. */
    kind?: 'expense' | 'income';
    /** Tap a category (not "Other") to drill into it. */
    onPressCategory?: (categoryId: number) => void;
}

/**
 * Spending by category as a sorted horizontal bar list — easier to compare
 * than a donut once there are more than a handful of categories. Every bar
 * carries its name, amount and share as text, so colour is never the only cue.
 */
function CategoryBarsInner({ categoryData, currency, maxRows = 6, kind = 'expense', onPressCategory }: CategoryBarsProps) {
    const t = useChartTheme();
    const { slices, total } = useMemo(() => buildDonutSlices(categoryData, maxRows), [categoryData, maxRows]);
    const top = slices[0]?.value ?? 0;
    const noun = kind === 'income' ? 'income' : 'spending';

    return (
        <View>
            {slices.map(s => {
                const label = `${s.label}: ${UserService.formatCurrency(s.value, currency)}, ${s.percent} percent of ${noun}`;
                const tappable = !!onPressCategory && s.key !== 'other';
                const body = (
                    <>
                        <View className="flex-row items-baseline mb-1.5">
                            <ThemedText type="label" className="flex-1 mr-2" numberOfLines={1}>{s.label}</ThemedText>
                            <ThemedText type="figure" className="text-[13px] mr-2">
                                {UserService.formatCurrency(s.value, currency)}
                            </ThemedText>
                            <ThemedText type="figure" className="text-[12px] w-9 text-right" style={{ color: t.muted }}>
                                {s.percent}%
                            </ThemedText>
                        </View>
                        <View className="h-2 rounded-sm" style={{ backgroundColor: t.grid }}>
                            <View
                                className="h-full rounded-sm"
                                style={{
                                    width: `${top > 0 ? Math.max((s.value / top) * 100, 1.5) : 0}%`,
                                    backgroundColor: s.key === 'other' ? t.muted : kind === 'income' ? t.income : t.accent,
                                    opacity: s.key === 'other' ? 0.6 : 1,
                                }}
                            />
                        </View>
                    </>
                );
                return tappable ? (
                    <Pressable
                        key={s.key}
                        className="mb-3.5"
                        onPress={() => onPressCategory!(Number(s.key))}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        accessibilityHint="Shows only this category"
                        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                    >
                        {body}
                    </Pressable>
                ) : (
                    <View key={s.key} className="mb-3.5" accessible accessibilityLabel={label}>
                        {body}
                    </View>
                );
            })}
            <View className="flex-row justify-between pt-2 border-t border-divider dark:border-dark-divider">
                <ThemedText type="kicker">Total {noun}</ThemedText>
                <ThemedText type="figure" className="text-[13px]">{UserService.formatCurrency(total, currency)}</ThemedText>
            </View>
        </View>
    );
}

// Memoized: the Insights screen re-renders while loading and on period changes.
export const CategoryBars = React.memo(CategoryBarsInner);
