/**
 * FormScrollView: a ScrollView for forms that keeps the field being typed in
 * visible above the keyboard.
 *
 * It scrolls the focused input into view when the keyboard opens, when focus
 * moves to another field, and while typing (a multi-line note that grows).
 * It works anywhere, including inside Modals and bottom sheets, because it
 * compares real on-screen positions: whatever lifted or shrank the container
 * (a sheet, a KeyboardAvoidingView), the field ends up above the keyboard and
 * inside the visible part of this scroll view.
 *
 * Use it in place of ScrollView for any scrollable content with text inputs.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, ScrollView, ScrollViewProps, TextInput } from 'react-native';
import {
  useFocusedInputHandler,
  useKeyboardHandler,
  useReanimatedKeyboardAnimation,
  useWindowDimensions,
} from 'react-native-keyboard-controller';
import { runOnJS } from 'react-native-reanimated';

/** Space kept between the focused field and the keyboard (or the scroll view's edge). */
const FIELD_GAP = 24;
/** Wait for the container's own keyboard animation/layout to settle before measuring. */
const SETTLE_MS = 60;

type HostNode = React.ComponentRef<typeof TextInput>;

/**
 * The scroll offset that brings a field (positions inside the scroll content)
 * fully into the visible part of the scroll view, or null if it already is.
 */
export function revealOffset({
  fieldTop,
  fieldHeight,
  scrollY,
  visibleHeight,
  gap = FIELD_GAP,
}: {
  fieldTop: number;
  fieldHeight: number;
  scrollY: number;
  visibleHeight: number;
  gap?: number;
}): number | null {
  const fieldBottom = fieldTop + fieldHeight;
  if (fieldBottom + gap > scrollY + visibleHeight) {
    // Below the visible area: bring its bottom just above the keyboard, but
    // never push its top out of view (a tall multi-line field).
    return Math.max(0, Math.min(fieldBottom + gap - visibleHeight, fieldTop - gap));
  }
  if (fieldTop - gap < scrollY) return Math.max(0, fieldTop - gap);
  return null;
}

export const FormScrollView = forwardRef<ScrollView, ScrollViewProps>(function FormScrollView(
  { onScroll, scrollEventThrottle = 16, keyboardShouldPersistTaps = 'handled', ...props },
  ref,
) {
  const scrollRef = useRef<ScrollView>(null);
  useImperativeHandle(ref, () => scrollRef.current as ScrollView, []);

  const scrollY = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const { height: windowHeight } = useWindowDimensions();
  const windowHeightRef = useRef(windowHeight);
  windowHeightRef.current = windowHeight;

  const reveal = useCallback(() => {
    const scroll = scrollRef.current;
    const input = TextInput.State.currentlyFocusedInput() as HostNode | null;
    // getInnerViewRef exists at runtime (RN 0.81) but is missing from the TS types.
    const content = (scroll as (ScrollView & { getInnerViewRef?: () => HostNode | null }) | null)
      ?.getInnerViewRef?.();
    if (!scroll || !input || !content) return;

    // Where the field sits inside the scroll content. Fails (and we do
    // nothing) when the focused field belongs to some other view.
    input.measureLayout(
      content,
      (_x, fieldTop, _w, fieldHeight) => {
        scroll.getNativeScrollRef()?.measureInWindow((_sx, viewTop, _sw, viewHeight) => {
          // keyboardHeight is negative while the keyboard is open.
          const keyboardTop = windowHeightRef.current + keyboardHeight.value;
          const visibleHeight = Math.min(viewHeight, keyboardTop - viewTop);
          if (visibleHeight <= 0) return;

          const target = revealOffset({ fieldTop, fieldHeight, scrollY: scrollY.current, visibleHeight });
          if (target !== null) scroll.scrollTo({ y: target, animated: true });
        });
      },
      () => {},
    );
  }, [keyboardHeight]);

  const scheduleReveal = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(reveal, SETTLE_MS);
  }, [reveal]);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Keyboard finished opening (or resized, or focus moved between fields).
  useKeyboardHandler(
    {
      onEnd: (e) => {
        'worklet';
        if (e.height > 0) runOnJS(scheduleReveal)();
      },
    },
    [scheduleReveal],
  );

  // Focus moved to another field, or the field grew while typing.
  useFocusedInputHandler(
    {
      onSelectionChange: () => {
        'worklet';
        runOnJS(scheduleReveal)();
      },
      onChangeText: () => {
        'worklet';
        runOnJS(scheduleReveal)();
      },
    },
    [scheduleReveal],
  );

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
      onScroll?.(e);
    },
    [onScroll],
  );

  return (
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      scrollEventThrottle={scrollEventThrottle}
      onScroll={handleScroll}
      {...props}
    />
  );
});
