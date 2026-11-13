import { ThemedText } from '@/components/common';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

export interface LegendItem {
    label: string;
    color: string;
    /** Draw a dashed line swatch instead of a filled square. */
    dashed?: boolean;
}

interface ChartCardProps {
    title: string;
    kicker?: string;
    legend?: LegendItem[];
    children: React.ReactNode;
    className?: string;
}

/**
 * Surface card that frames one chart: kicker + serif title, an optional
 * legend that wraps on narrow screens, then the chart.
 */
export function ChartCard({ title, kicker, legend, children, className = '' }: ChartCardProps) {
    return (
        <View className={`mx-5 mt-5 rounded-2xl border border-divider dark:border-dark-divider bg-surface dark:bg-dark-surface px-4 pt-4 pb-3 ${className}`}>
            {!!kicker && <ThemedText type="kicker" className="mb-1">{kicker}</ThemedText>}
            <ThemedText type="headline" className="text-lg leading-6" accessibilityRole="header">{title}</ThemedText>
            {!!legend?.length && (
                <View className="flex-row flex-wrap mt-2" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {legend.map(l => (
                        <View key={l.label} className="flex-row items-center mr-4 mb-1">
                            {l.dashed ? (
                                <View style={{ width: 12, height: 0, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: l.color, marginRight: 6 }} />
                            ) : (
                                <View className="w-2.5 h-2.5 rounded-sm mr-1.5" style={{ backgroundColor: l.color }} />
                            )}
                            <ThemedText type="caption">{l.label}</ThemedText>
                        </View>
                    ))}
                </View>
            )}
            <View className="mt-3">{children}</View>
        </View>
    );
}

/** Width of the view it's attached to; 0 until the first layout. */
export function useMeasuredWidth(): [number, (e: LayoutChangeEvent) => void] {
    const [width, setWidth] = useState(0);
    const onLayout = useCallback((e: LayoutChangeEvent) => {
        const w = Math.floor(e.nativeEvent.layout.width);
        setWidth(prev => (prev === w ? prev : w));
    }, []);
    return [width, onLayout];
}

interface ChartTooltipProps {
    /** x of the point the tooltip describes, in the chart's coordinates. */
    x: number;
    /** y of the point's top; the bubble sits just above it when there's room. */
    y: number;
    /** Chart width, so the bubble never leaves the chart. */
    width: number;
    children: React.ReactNode;
}

/** Small floating bubble above (x, y), clamped inside the chart. */
export function ChartTooltip({ x, y, width, children }: ChartTooltipProps) {
    const [size, setSize] = useState({ w: 0, h: 0 });
    const left = Math.max(0, Math.min(x - size.w / 2, width - size.w));
    const top = Math.max(0, y - size.h - 8);
    return (
        <View
            onLayout={e => {
                const { width: w, height: h } = e.nativeEvent.layout;
                setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
            }}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="absolute rounded-lg px-2.5 py-1.5 bg-textPrimary dark:bg-dark-textPrimary"
            style={{ left, top, opacity: size.w ? 1 : 0, maxWidth: width, elevation: 4, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } }}
        >
            {children}
        </View>
    );
}

const HIDE_AFTER_MS = 3000;

/**
 * Touch handling shared by the charts: nothing is selected until the user
 * touches the chart; dragging moves the selection; it clears a few seconds
 * after the finger lifts. `toIndex` maps a touch x to a data index.
 *
 * Spread `handlers` onto a View. They include `collapsable: false`: without
 * it Android drops a View that only does layout from the native tree, the
 * touch never reaches it, and the tooltip never shows.
 */
export function useChartScrub(toIndex: (x: number) => number) {
    const [active, setActive] = useState<number | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const toIndexRef = useRef(toIndex);
    toIndexRef.current = toIndex;

    const clearTimer = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    };
    useEffect(() => clearTimer, []);

    const handlers = useMemo(() => {
        const pick = (e: GestureResponderEvent) => {
            const i = toIndexRef.current(e.nativeEvent.locationX);
            setActive(prev => (prev === i ? prev : i));
        };
        const release = () => {
            clearTimer();
            timer.current = setTimeout(() => setActive(null), HIDE_AFTER_MS);
        };
        return {
            collapsable: false,
            onStartShouldSetResponder: () => true,
            onResponderGrant: (e: GestureResponderEvent) => { clearTimer(); pick(e); },
            onResponderMove: pick,
            onResponderRelease: release,
            onResponderTerminate: release,
            onResponderTerminationRequest: () => true,
        } as const;
    }, []);

    /** Select an index directly (screen-reader adjust), then fade out as usual. */
    const select = useCallback((i: number) => {
        clearTimer();
        setActive(i);
        timer.current = setTimeout(() => setActive(null), HIDE_AFTER_MS * 2);
    }, []);

    return { active, handlers, select };
}

/** Index under a touch at `x` when `count` slots share `plotW` starting at `offset`. */
export function indexAt(x: number, offset: number, plotW: number, count: number, continuous = false): number {
    if (count <= 1 || plotW <= 0) return 0;
    const rel = (x - offset) / plotW;
    const i = continuous ? Math.round(rel * (count - 1)) : Math.floor(rel * count);
    return Math.max(0, Math.min(count - 1, i));
}

/** Rough width of an axis label at 10px, for sizing the y-axis gutter. */
export function axisLabelWidth(labels: string[]): number {
    const longest = labels.reduce((m, l) => Math.max(m, l.length), 0);
    return Math.max(24, Math.ceil(longest * 6.2) + 8);
}
