import { ThemedText } from '@/components/common';
import { formatTooltipDate, parseLocalDate } from '@/lib/utils/date';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { compactMoney, niceMax, useChartTheme } from '../chart-theme';
import { ChartTooltip, axisLabelWidth, indexAt, useChartScrub, useMeasuredWidth } from './chart-card';

interface DailySpendingCardProps {
    lineData: { value: number; dataPointText: string }[];
    /** Formats amounts for the tooltip and caption, e.g. UserService.formatCurrency. */
    formatValue?: (n: number) => string;
    /** Currency symbol for the y-axis ticks. */
    symbol?: string;
    /** Date of the first point (YYYY-MM-DD), so the tooltip can show real dates. */
    startDate?: string;
    height?: number;
}

/** "Wed, 5 Nov 2026" for point `i` after `startDate`; "Day N" without a start date. */
function pointDate(startDate: string | undefined, i: number): string {
    if (!startDate) return `Day ${i + 1}`;
    const start = parseLocalDate(startDate);
    return formatTooltipDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

const LABEL_H = 20;
const TOP_PAD = 8;
const RIGHT_PAD = 6; // keeps the end dot and last label inside the chart

/**
 * Daily spending this month: a thin area line with a dashed average rule.
 * Touch or drag to read any day (the tooltip hides once you let go); the
 * caption states the average and the peak.
 */
function DailySpendingCardInner({ lineData, formatValue = n => n.toFixed(2), symbol = '', startDate, height = 150 }: DailySpendingCardProps) {
    const t = useChartTheme();
    const [width, onLayout] = useMeasuredWidth();
    const n = lineData.length;

    const { values, avg, peakIdx, peak } = useMemo(() => {
        const values = lineData.map(d => d.value);
        const sum = values.reduce((s, v) => s + v, 0);
        const peakIdx = values.reduce((best, v, i) => (v > values[best] ? i : best), 0);
        return { values, avg: values.length ? sum / values.length : 0, peakIdx, peak: values[peakIdx] ?? 0 };
    }, [lineData]);

    const max = niceMax(Math.max(1, peak, avg));
    const ticks = [0, max / 2, max];
    const tickLabels = ticks.map(v => compactMoney(v, symbol));
    const axisW = axisLabelWidth(tickLabels);
    const plotW = Math.max(0, width - axisW - RIGHT_PAD);
    const plotH = height - LABEL_H - TOP_PAD;
    const x = (i: number) => axisW + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const y = (v: number) => TOP_PAD + plotH - (v / max) * plotH;

    const { line, area } = useMemo(() => {
        if (!n || plotW <= 0) return { line: '', area: '' };
        const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
        const line = `M${pts.join(' L')}`;
        const area = `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
        return { line, area };
        // x / y are derived from the values listed here
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [values, n, plotW, plotH, max, axisW]);

    // Day labels: 1, 8, 15, 22, 29 … plus the last day, without crowding.
    const dayLabels = useMemo(() => {
        const minGap = 22;
        const out: number[] = [];
        for (let i = 0; i < n; i += 7) out.push(i);
        if (n > 1 && out[out.length - 1] !== n - 1) {
            if (x(n - 1) - x(out[out.length - 1]) < minGap) out.pop();
            out.push(n - 1);
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [n, plotW, axisW]);

    const { active, handlers, select } = useChartScrub(px => indexAt(px, axisW, plotW, n, true));
    const selected = active != null && active < n ? active : null;
    const selV = selected != null ? values[selected] ?? 0 : 0;

    return (
        <View
            onLayout={onLayout}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`Daily spending this month. Average ${formatValue(avg)} a day. Highest on ${pointDate(startDate, peakIdx)} at ${formatValue(peak)}.`}
            accessibilityValue={{ text: selected != null ? `${pointDate(startDate, selected)}: ${formatValue(selV)}` : 'None selected' }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={e => {
                const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
                const from = selected ?? (step > 0 ? -1 : n);
                select(Math.max(0, Math.min(n - 1, from + step)));
            }}
        >
            {width > 0 && (
                <>
                    <Svg width={width} height={height}>
                        <Defs>
                            <LinearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                                <Stop offset="0" stopColor={t.accent} stopOpacity={0.22} />
                                <Stop offset="1" stopColor={t.accent} stopOpacity={0.02} />
                            </LinearGradient>
                        </Defs>

                        {ticks.map((v, i) => (
                            <React.Fragment key={v}>
                                <Line x1={axisW} x2={width - RIGHT_PAD} y1={y(v)} y2={y(v)} stroke={t.grid} strokeWidth={1} />
                                <SvgText x={axisW - 6} y={y(v) + 3.5} fontSize={10} fill={t.axis} textAnchor="end" fontFamily={t.axisText.fontFamily}>
                                    {tickLabels[i]}
                                </SvgText>
                            </React.Fragment>
                        ))}

                        {!!area && <Path d={area} fill="url(#dailyFill)" />}
                        {!!line && <Path d={line} stroke={t.accent} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />}

                        {avg > 0 && (
                            <Line x1={axisW} x2={width - RIGHT_PAD} y1={y(avg)} y2={y(avg)} stroke={t.muted} strokeWidth={1} strokeDasharray="4 4" />
                        )}

                        {/* Touched day */}
                        {selected != null && (
                            <>
                                <Line x1={x(selected)} x2={x(selected)} y1={TOP_PAD} y2={y(0)} stroke={t.muted} strokeWidth={1} opacity={0.5} />
                                <Circle cx={x(selected)} cy={y(selV)} r={4.5} fill={t.accent} stroke={t.surface} strokeWidth={2} />
                            </>
                        )}

                        {dayLabels.map((i, k) => (
                            <SvgText
                                key={i}
                                x={x(i)}
                                y={height - 5}
                                fontSize={10}
                                fill={i === selected ? t.ink : t.axis}
                                textAnchor={k === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                                fontFamily={t.axisText.fontFamily}
                            >
                                {i + 1}
                            </SvgText>
                        ))}
                    </Svg>

                    {selected != null && (
                        <ChartTooltip x={x(selected)} y={y(selV)} width={width}>
                            <ThemedText type="label" className="text-[11px] leading-4" style={{ color: t.surface }}>
                                {pointDate(startDate, selected)}
                            </ThemedText>
                            <ThemedText type="figure" className="text-[13px] leading-5" style={{ color: t.surface }}>
                                {formatValue(selV)}
                            </ThemedText>
                            {avg > 0 && (
                                <ThemedText type="caption" className="text-[11px] leading-4" style={{ color: t.surface, opacity: 0.75 }}>
                                    {selected === peakIdx && peak > 0
                                        ? 'Highest day'
                                        : selV === 0
                                            ? 'No spending'
                                            : `${Math.round(Math.abs(selV - avg) / avg * 100)}% ${selV >= avg ? 'above' : 'below'} average`}
                                </ThemedText>
                            )}
                        </ChartTooltip>
                    )}

                    {/* Touch layer: touch or drag to show a day */}
                    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height }} {...handlers} />
                </>
            )}

            <ThemedText type="caption" className="mt-2">
                Average {formatValue(avg)}/day · highest {formatValue(peak)} on {pointDate(startDate, peakIdx)}
            </ThemedText>
        </View>
    );
}

// Memoized: the Insights screen re-renders while loading and on period changes.
export const DailySpendingCard = React.memo(DailySpendingCardInner);
