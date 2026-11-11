import { Section, ThemedText } from '@/components/common';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { type Href, router } from 'expo-router';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { formatPct, formatSigned, type PortfolioSummary, type SeriesPoint } from '../utils';

const SPARK_W = 96;
const SPARK_H = 36;

/** Tiny trend line of portfolio value; nothing when there are fewer than two points. */
function Sparkline({ points, color }: { points: number[]; color: string }) {
    const d = useMemo(() => {
        if (points.length < 2) return '';
        const min = Math.min(...points);
        const max = Math.max(...points);
        const span = max - min || 1;
        return points
            .map((v, i) => {
                const x = (i / (points.length - 1)) * (SPARK_W - 4) + 2;
                const y = SPARK_H - 3 - ((v - min) / span) * (SPARK_H - 6);
                return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(' ');
    }, [points]);
    if (!d) return null;
    return (
        <Svg width={SPARK_W} height={SPARK_H} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
    );
}

/** Home card: portfolio value, total return and a six-month sparkline. */
export function PortfolioCard({
    summary,
    series,
    fmt,
}: {
    summary: PortfolioSummary;
    series: SeriesPoint[];
    fmt: (n: number) => string;
}) {
    const colors = useThemeColors();
    const up = summary.totalReturn >= 0;
    const tone = Math.abs(summary.totalReturn) < 0.005 ? colors.textMuted : up ? colors.income : colors.expense;
    const values = series.map(p => p.value);

    return (
        <Section title="Portfolio" actionLabel="Open" onAction={() => router.push('/investments' as Href)}>
            <View
                className="flex-row items-center"
                accessible
                accessibilityLabel={`Portfolio value ${fmt(summary.value)}. Total return ${formatSigned(summary.totalReturn, fmt)}, ${formatPct(summary.totalReturnPct)}.`}
            >
                <View className="flex-1 mr-3">
                    <ThemedText type="figure" className="text-[22px] leading-7" numberOfLines={1} adjustsFontSizeToFit>
                        {fmt(summary.value)}
                    </ThemedText>
                    <ThemedText type="figure" className="text-xs mt-0.5" style={{ color: tone }}>
                        {up ? '▲' : '▼'} {formatSigned(summary.totalReturn, fmt)} · {formatPct(summary.totalReturnPct)}
                        <ThemedText type="caption">
                            {'  '}{summary.openCount} {summary.openCount === 1 ? 'holding' : 'holdings'}
                        </ThemedText>
                    </ThemedText>
                </View>
                <Sparkline points={values} color={tone === colors.textMuted ? colors.primary : tone} />
            </View>
        </Section>
    );
}
