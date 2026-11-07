import { useThemeColors } from '@/hooks/use-theme-colors';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { LinearGradient } from 'expo-linear-gradient';
import React, { forwardRef, useCallback, useEffect, useImperativeHandle } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppModal } from './app-modal';

/** Resolve a '90%' / px maxHeight against the window height. */
function toPixels(maxHeight: `${number}%` | number, windowHeight: number): number {
    return typeof maxHeight === 'number' ? maxHeight : (parseFloat(maxHeight) / 100) * windowHeight;
}

/** Bottom padding kept under the content while the keyboard is open. */
const KEYBOARD_PADDING_BOTTOM = 12;

export interface BottomSheetRef {
    dismiss: (onDone?: () => void) => void;
}

export interface BottomSheetProps {
    visible: boolean;
    onClose: () => void;
    children: React.ReactNode;
    maxHeight?: `${number}%` | number;
    gradientColors?: readonly [string, string, ...string[]];
    paddingHorizontal?: number;
    paddingTop?: number;
    paddingBottom?: number;
    borderTopRadius?: number;
    backgroundColor?: string;
    showHandle?: boolean;
    keyboardAvoiding?: boolean;
}

export const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    function BottomSheet(
        {
            visible,
            onClose,
            children,
            maxHeight = '90%',
            gradientColors,
            paddingHorizontal = 32,
            paddingTop = 48,
            paddingBottom = 64,
            borderTopRadius = 48,
            backgroundColor,
            showHandle = true,
            keyboardAvoiding = true,
        },
        ref
    ) {
        const colors = useThemeColors();
        // Read on every render so rotation / split-screen resizes are respected.
        const { height: windowHeight } = useWindowDimensions();
        const { top: topInset } = useSafeAreaInsets();
        const maxHeightPx = toPixels(maxHeight, windowHeight);
        const sheetY = useSharedValue(windowHeight);
        const backdropOpacity = useSharedValue(0);
        // The sheet renders in the main window (AppModal), where
        // react-native-keyboard-controller tracks the keyboard reliably even
        // though the app is edge-to-edge and Android never resizes the window.
        // `height` is negative while the keyboard is open.
        const keyboard = useReanimatedKeyboardAnimation();
        const keyboardPaddingBottom = Math.min(paddingBottom, KEYBOARD_PADDING_BOTTOM);
        const sheetStyle = useAnimatedStyle(() => {
            const keyboardLift = keyboardAvoiding ? -keyboard.height.value : 0;
            const keyboardProgress = keyboardAvoiding ? keyboard.progress.value : 0;
            // Shrink while the keyboard is up so the sheet's header (and close
            // button) is never pushed above the top of the screen.
            const available = windowHeight - keyboardLift - topInset;
            return {
                transform: [{ translateY: sheetY.value - keyboardLift }],
                maxHeight: Math.min(maxHeightPx, available),
                // The bottom padding clears the navigation bar; the keyboard
                // covers that, so give the space back to the form while typing.
                paddingBottom: interpolate(keyboardProgress, [0, 1], [paddingBottom, keyboardPaddingBottom]),
            };
        });
        const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

        const resolvedBg = backgroundColor ?? colors.surface;

        const dismiss = useCallback((onDone?: () => void) => {
            sheetY.value = withTiming(windowHeight, { duration: 300, easing: Easing.in(Easing.cubic) });
            backdropOpacity.value = withTiming(0, { duration: 280 });
            setTimeout(() => {
                sheetY.value = windowHeight;
                if (onDone) { onDone(); } else { onClose(); }
            }, 320);
        // sheetY and backdropOpacity are stable Reanimated refs
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [onClose, windowHeight]);

        useImperativeHandle(ref, () => ({ dismiss }), [dismiss]);

        useEffect(() => {
            if (visible) {
                backdropOpacity.value = withTiming(1, { duration: 300 });
                sheetY.value = withSpring(0, { damping: 22, stiffness: 200, mass: 0.8 });
            }
        // sheetY and backdropOpacity are stable Reanimated refs
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [visible]);

        const sheet = (
            <Animated.View
                style={[
                    sheetStyle,
                    {
                        // Same reading column as the app on tablets / landscape.
                        width: '100%',
                        maxWidth: MAX_CONTENT_WIDTH,
                        alignSelf: 'center',
                        backgroundColor: resolvedBg,
                        borderTopLeftRadius: borderTopRadius,
                        borderTopRightRadius: borderTopRadius,
                        paddingHorizontal,
                        paddingTop,
                        overflow: 'hidden',
                        borderTopWidth: 1,
                        borderColor: colors.divider,
                    },
                ]}
            >
                {!!gradientColors && (
                    <LinearGradient
                        colors={gradientColors}
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 160 }}
                    />
                )}
                {showHandle && (
                    <View
                        style={{
                            width: 36,
                            height: 4,
                            backgroundColor: colors.borderStrong,
                            borderRadius: 2,
                            alignSelf: 'center',
                            marginBottom: 20,
                        }}
                    />
                )}
                {children}
            </Animated.View>
        );

        return (
            <AppModal visible={visible} animationType="none" transparent onRequestClose={() => dismiss()}>
                <View style={StyleSheet.absoluteFillObject}>
                    <Animated.View
                        style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.overlay }, backdropStyle]}
                    >
                        <Pressable
                            style={StyleSheet.absoluteFillObject}
                            onPress={() => dismiss()}
                            accessibilityRole="button"
                            accessibilityLabel="Close"
                        />
                    </Animated.View>
                    {/* box-none: taps outside the sheet reach the backdrop (closes it) */}
                    <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
                        {sheet}
                    </View>
                </View>
            </AppModal>
        );
    }
);
