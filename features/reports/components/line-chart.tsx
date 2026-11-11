import { ThemedText } from '@/components/common';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { niceMax, useChartTheme } from '../chart-theme';
import { ChartTooltip, axisLabelWidth, indexAt, useChartScrub, useMeasuredWidth } from './chart-card';

export interface LineSeries {
    key: string;
    label: string;
    color: string;
    values: number[];
    dashed?: boolean;
    /** Soft gradient under the line (use for one series at most). */
    fill?: boolean;
}

interface LineChartProps {
    /** One label per point (x axis). */
    labels: string[];
    series: LineSeries[];
    /** Full value for the tooltip and screen readers. */
    formatValue: (n: number) => string;
    /** Short value for axis ticks, e.g. compactMoney. */
    formatAxis: (n: number) => string;
    /** Spoken summary of the chart. */
    accessibilityLabel: string;
    /** Start the y axis at zero (totals) or fit it to the data (prices). */
    zeroBased?: boolean;
    /** A dashed horizontal rule, e.g. average cost. */
    reference?: { value: number; color: string };
    height?: number;
}

const LABEL_H = 20;
const TOP_PAD = 8;
const RIGHT_PAD = 8;
const MAX_X_LABELS = 6;

/**
 * Three ticks at a round step that cover [min, max], for charts that zoom in
 * on the data (prices). Never below zero when the data isn't.
 */
export function fittedTicks(min: number, max: number): number[] {
    if (min === max) {
        const pad = Math.abs(min) * 0.1 || 1;
        min -= pad;
        max += pad;
    }
    let step = niceMax((max - min) / 2);
    let lo = Math.floor(min / step) * step;
    for (let i = 0; i < 6 && lo + 2 * step < max; i++) {
        step = niceMax(step * 1.01);
        lo = Math.floor(min / step) * step;
    }
    if (min >= 0) lo = Math.max(0, lo);
    return [lo, lo + step, lo + 2 * step];
}

/**
 * Lines over a shared x axis, one or more series. Touch or drag to read every
 * series at a point; the tooltip hides once you let go.
 */
function LineChartInner({
    labels,
    series,
    formatValue,
    formatAxis,
    accessibilityLabel,
    zeroBased = true,
    reference,
    height = 170,
}: LineChartProps) {
    const t = useChartTheme();
    const [width, onLayout] = useMeasuredWidth();
    const n = labels.length;

    const ticks = useMemo(() => {
        const all = series.flatMap(s => s.values).concat(reference ? [reference.value] : []);
        const max = Math.max(0, ...all);
        if (zeroBased) {
            const top = niceMax(Math.max(1, max));
            return [0, top / 2, top];
        }
        return fittedTicks(Math.min(...all), Math.max(...all));
    }, [series, reference, zeroBased]);

    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const tickLabels = ticks.map(formatAxis);
    const axisW = axisLabelWidth(tickLabels);
    const plotW = Math.max(0, width - axisW - RIGHT_PAD);
    const plotH = height - LABEL_H - TOP_PAD;
    const x = (i: number) => axisW + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
    const y = (v: number) => TOP_PAD + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

    const paths = useMemo(() => {
        if (!n || plotW <= 0) return [];
        return series.map(s => {
            const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
            const line = `M${pts.join(' L')}`;
            const area = s.fill ? `${line} L${x(n - 1).toFixed(1)},${y(lo)} L${x(0).toFixed(1)},${y(lo)} Z` : '';
            return { key: s.key, line, area };
        });
        // x / y depend only on the values listed here
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [series, n, plotW, plotH, lo, hi, axisW]);

    const xLabels = useMemo(() => {
        if (n <= MAX_X_LABELS) return labels.map((_, i) => i);
        const stride = Math.ceil((n - 1) / (MAX_X_LABELS - 1));
        const out: number[] = [];
        for (let i = 0; i < n; i += stride) out.push(i);
        if (out[out.length - 1] !== n - 1) {
            if (n - 1 - out[out.length - 1] < stride / 2) out.pop();
            out.push(n - 1);
        }
        return out;
    }, [labels, n]);

    const { active, handlers, select } = useChartScrub(px => indexAt(px, axisW, plotW, n, true));
    const selected = active != null && active < n ? active : null;
    const topY = selected != null ? Math.min(...series.map(s => y(s.values[selected] ?? lo))) : 0;
    const describe = (i: number) =>
        `${labels[i]}: ${series.map(s => `${s.label} ${formatValue(s.values[i] ?? 0)}`).join(', ')}`;

    return (
        <View
            onLayout={onLayout}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={accessibilityLabel}
            accessibilityValue={{ text: selected != null ? describe(selected) : 'None selected' }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={e => {
                const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
                const from = selected ?? (step > 0 ? -1 : n);
                select(Math.max(0, Math.min(n - 1, from + step)));
            }}
        >
            {width > 0 && n > 0 && (
                <>
                    <Svg width={width} height={height}>
                        <Defs>
                            {series.filter(s => s.fill).map(s => (
                                <LinearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                                    <Stop offset="0" stopColor={s.color} stopOpacity={0.2} />
                                    <Stop offset="1" stopColor={s.color} stopOpacity={0.02} />
                                </LinearGradient>
                            ))}
                        </Defs>

                        {ticks.map((v, i) => (
                            <React.Fragment key={i}>
                                <Line x1={axisW} x2={width - RIGHT_PAD} y1={y(v)} y2={y(v)} stroke={t.grid} strokeWidth={1} />
                                <SvgText x={axisW - 6} y={y(v) + 3.5} fontSize={10} fill={t.axis} textAnchor="end" fontFamily={t.axisText.fontFamily}>
                                    {tickLabels[i]}
                                </SvgText>
                            </React.Fragment>
                        ))}

                        {reference && (
                            <Line
                                x1={axisW}
                                x2={width - RIGHT_PAD}
                                y1={y(reference.value)}
                                y2={y(reference.value)}
                                stroke={reference.color}
                                strokeWidth={1}
                                strokeDasharray="4 4"
                            />
                        )}

                        {paths.map((p, i) => (
                            <React.Fragment key={p.key}>
                                {!!p.area && <Path d={p.area} fill={`url(#fill-${p.key})`} />}
                                <Path
                                    d={p.line}
                                    stroke={series[i].color}
                                    strokeWidth={2}
                                    strokeDasharray={series[i].dashed ? '5 4' : undefined}
                                    fill="none"
                                    strokeLinejoin="round"
                                    strokeLinecap="round"
                                />
                            </React.Fragment>
                        ))}

                        {/* A lone point has no line, so draw it as a dot. */}
                        {n === 1 && series.map(s => (
                            <Circle key={s.key} cx={x(0)} cy={y(s.values[0] ?? lo)} r={4} fill={s.color} />
                        ))}

                        {selected != null && (
                            <>
                                <Line x1={x(selected)} x2={x(selected)} y1={TOP_PAD} y2={TOP_PAD + plotH} stroke={t.muted} strokeWidth={1} opacity={0.5} />
                                {series.map(s => (
                                    <Circle
                                        key={s.key}
                                        cx={x(selected)}
                                        cy={y(s.values[selected] ?? lo)}
                                        r={4.5}
                                        fill={s.color}
                                        stroke={t.surface}
                                        strokeWidth={2}
                                    />
                                ))}
                            </>
                        )}

                        {xLabels.map((i, k) => (
                            <SvgText
                                key={i}
                                x={x(i)}
                                y={height - 5}
                                fontSize={10}
                                fill={i === selected ? t.ink : t.axis}
                                textAnchor={n === 1 ? 'middle' : k === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                                fontFamily={t.axisText.fontFamily}
                            >
                                {labels[i]}
                            </SvgText>
                        ))}
                    </Svg>

                    {selected != null && (
                        <ChartTooltip x={x(selected)} y={topY} width={width}>
                            <ThemedText type="label" className="text-[11px] leading-4" style={{ color: t.surface }}>
                                {labels[selected]}
                            </ThemedText>
                            {series.map(s => (
                                <ThemedText key={s.key} type="figure" className="text-[12px] leading-4" style={{ color: t.surface }}>
                                    {series.length > 1 ? `${s.label} ` : ''}{formatValue(s.values[selected] ?? 0)}
                                </ThemedText>
                            ))}
                        </ChartTooltip>
                    )}

                    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height }} {...handlers} />
                </>
            )}
        </View>
    );
}

export const LineChart = React.memo(LineChartInner);
