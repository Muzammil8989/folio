import React, { useEffect } from 'react';
import type { DimensionValue, ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

interface GrowBarProps {
    /** Final width, e.g. '42%'. */
    width: DimensionValue;
    color: string;
    style?: ViewStyle;
}

/**
 * Fill of a horizontal bar that grows in from the left when it first mounts.
 * Only `transform` animates, so it runs on the UI thread with no layout work.
 * With Reduce Motion on it simply appears at full width.
 */
export function GrowBar({ width, color, style }: GrowBarProps) {
    const reduceMotion = useReducedMotion();
    const scale = useSharedValue(reduceMotion ? 1 : 0);

    useEffect(() => {
        if (reduceMotion) return;
        scale.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
    }, [reduceMotion, scale]);

    const animated = useAnimatedStyle(() => ({ transform: [{ scaleX: scale.value }] }));

    return (
        <Animated.View
            style={[
                { height: '100%', width, backgroundColor: color, borderRadius: 2, transformOrigin: 'left' },
                style,
                animated,
            ]}
        />
    );
}
