/**
 * AppModal + Portal: every sheet/dialog renders in the main window (so the
 * keyboard can be tracked) instead of a separate native <Modal> window.
 */
import { AppModal } from '@/components/common/app-modal';
import { PortalHost, PortalProvider, usePortalActive } from '@/components/common/portal';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import React, { useState } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';

/** Capture hardware-back handlers and press back the way Android does: newest first. */
function installBackHandler() {
  const handlers: (() => boolean | null | undefined)[] = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.push(handler);
    return {
      remove: () => {
        const i = handlers.indexOf(handler);
        if (i !== -1) handlers.splice(i, 1);
      },
    };
  });
  return () =>
    act(() => {
      for (let i = handlers.length - 1; i >= 0; i--) {
        if (handlers[i]()) return;
      }
    });
}

function Root({ children }: { children: React.ReactNode }) {
  return (
    <PortalProvider>
      <View testID="app-content">{children}</View>
      <PortalHost />
    </PortalProvider>
  );
}

function ActiveIndicator() {
  return <Text>{usePortalActive() ? 'overlay open' : 'no overlay'}</Text>;
}

afterEach(() => jest.restoreAllMocks());

describe('AppModal', () => {
  it('renders its content in the portal host, not where it is declared', () => {
    render(
      <Root>
        <AppModal visible transparent>
          <Text>Sheet content</Text>
        </AppModal>
      </Root>,
    );
    expect(within(screen.getByTestId('portal-host')).getByText('Sheet content')).toBeTruthy();
    expect(within(screen.getByTestId('app-content')).queryByText('Sheet content')).toBeNull();
  });

  it('renders nothing while hidden', () => {
    render(
      <Root>
        <AppModal visible={false} transparent>
          <Text>Sheet content</Text>
        </AppModal>
      </Root>,
    );
    expect(screen.queryByText('Sheet content')).toBeNull();
    expect(screen.queryByTestId('portal-host')).toBeNull();
  });

  it('updates the overlay when its content changes', () => {
    function Counter() {
      const [n, setN] = useState(0);
      return (
        <AppModal visible transparent>
          <Pressable onPress={() => setN(n + 1)}>
            <Text>{`Count ${n}`}</Text>
          </Pressable>
        </AppModal>
      );
    }
    render(
      <Root>
        <Counter />
      </Root>,
    );
    fireEvent.press(screen.getByText('Count 0'));
    expect(screen.getByText('Count 1')).toBeTruthy();
  });

  it('stacks a picker opened from a sheet on top, and back closes only the picker', () => {
    const pressBack = installBackHandler();
    const closeSheet = jest.fn();
    function SheetWithPicker() {
      const [pickerOpen, setPickerOpen] = useState(true);
      return (
        <>
          <AppModal visible transparent onRequestClose={closeSheet}>
            <Text>Sheet</Text>
          </AppModal>
          <AppModal visible={pickerOpen} transparent onRequestClose={() => setPickerOpen(false)}>
            <Text>Picker</Text>
          </AppModal>
        </>
      );
    }
    render(
      <Root>
        <SheetWithPicker />
      </Root>,
    );

    const host = screen.getByTestId('portal-host');
    const texts = within(host).getAllByText(/Sheet|Picker/, { includeHiddenElements: true }).map(t => t.props.children);
    // Picker drawn last = on top; the sheet under it is hidden from screen readers.
    expect(texts).toEqual(['Sheet', 'Picker']);

    pressBack();
    expect(screen.queryByText('Picker')).toBeNull();
    expect(screen.getByText('Sheet')).toBeTruthy();
    expect(closeSheet).not.toHaveBeenCalled();

    pressBack();
    expect(closeSheet).toHaveBeenCalledTimes(1);
  });

  it('reports whether an overlay is open', () => {
    function Toggle() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Pressable onPress={() => setOpen(o => !o)}>
            <Text>toggle</Text>
          </Pressable>
          <AppModal visible={open} transparent>
            <Text>Sheet</Text>
          </AppModal>
        </>
      );
    }
    render(
      <Root>
        <Toggle />
        <ActiveIndicator />
      </Root>,
    );
    expect(screen.getByText('no overlay')).toBeTruthy();
    fireEvent.press(screen.getByText('toggle'));
    expect(screen.getByText('overlay open')).toBeTruthy();
    fireEvent.press(screen.getByText('toggle'));
    expect(screen.getByText('no overlay')).toBeTruthy();
  });

  it('renders in place when there is no portal host (tests, outside the root)', () => {
    render(
      <AppModal visible transparent>
        <Text>Inline content</Text>
      </AppModal>,
    );
    expect(screen.getByText('Inline content')).toBeTruthy();
  });
});
