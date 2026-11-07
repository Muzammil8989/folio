/**
 * AppModal: drop-in replacement for React Native's <Modal> that renders in the
 * main app window through the Portal (see portal.tsx for why).
 *
 * Behaves like a transparent Modal:
 * - renders nothing while hidden;
 * - covers the whole screen while visible, above the tabs and screens;
 * - the Android back button calls onRequestClose. Back handlers run newest
 *   first, so with a picker open over a sheet, back closes the picker first.
 */
import React, { useEffect, useRef } from 'react';
import { BackHandler, Keyboard, StyleSheet, TextInput } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { Portal } from './portal';

export interface AppModalProps {
  visible?: boolean;
  /** Overlays are always transparent; kept so call sites read like <Modal>. */
  transparent?: boolean;
  animationType?: 'none' | 'fade' | 'slide';
  onRequestClose?: () => void;
  onShow?: () => void;
  /** Native-window options of <Modal>; meaningless for an in-window overlay. */
  statusBarTranslucent?: boolean;
  navigationBarTranslucent?: boolean;
  children?: React.ReactNode;
}

const ANIMATIONS = {
  none: { entering: undefined, exiting: undefined },
  fade: { entering: FadeIn.duration(200), exiting: FadeOut.duration(150) },
  slide: { entering: SlideInDown.duration(280), exiting: SlideOutDown.duration(220) },
} as const;

export function AppModal({
  visible = true,
  animationType = 'none',
  onRequestClose,
  onShow,
  children,
}: AppModalProps) {
  const onRequestCloseRef = useRef(onRequestClose);
  onRequestCloseRef.current = onRequestClose;
  const onShowRef = useRef(onShow);
  onShowRef.current = onShow;

  useEffect(() => {
    if (!visible) return;
    onShowRef.current?.();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onRequestCloseRef.current?.();
      // Like <Modal>: back never falls through to the screen underneath.
      return true;
    });
    return () => {
      sub.remove();
      // A native Modal took the keyboard down with its window; an overlay
      // doesn't, so close it if a field was still focused.
      if (TextInput.State.currentlyFocusedInput()) Keyboard.dismiss();
    };
  }, [visible]);

  if (!visible) return null;

  const { entering, exiting } = ANIMATIONS[animationType];
  return (
    <Portal>
      <Animated.View
        entering={entering}
        exiting={exiting}
        style={StyleSheet.absoluteFill}
        accessibilityViewIsModal
      >
        {children}
      </Animated.View>
    </Portal>
  );
}
