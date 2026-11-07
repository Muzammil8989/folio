/**
 * Portal: render overlays (sheets, dialogs, pickers) at the root of the app
 * instead of where they are declared.
 *
 * Why not React Native's <Modal>: on Android every Modal is a separate native
 * window. The app is edge-to-edge, so Android never resizes those windows for
 * the keyboard, and keyboard tracking inside them is unreliable (worse still
 * for a modal opened on top of another modal). Overlays rendered here live in
 * the main window, where keyboard tracking works.
 *
 *   <PortalProvider>
 *     …app…
 *     <PortalHost />   // overlays render here, newest on top
 *   </PortalProvider>
 *
 * Without a provider (unit tests, anything outside the root), a Portal renders
 * its children in place.
 */
import React, { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

type Entry = { key: string; node: React.ReactNode };

interface PortalActions {
  mount: (key: string, node: React.ReactNode) => void;
  unmount: (key: string) => void;
}

const PortalActionsContext = createContext<PortalActions | null>(null);
const PortalEntriesContext = createContext<Entry[]>([]);

export function PortalProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  const mount = useCallback((key: string, node: React.ReactNode) => {
    setEntries(prev => {
      const index = prev.findIndex(e => e.key === key);
      // Updating an open overlay keeps its place in the stack.
      if (index === -1) return [...prev, { key, node }];
      const next = prev.slice();
      next[index] = { key, node };
      return next;
    });
  }, []);

  const unmount = useCallback((key: string) => {
    setEntries(prev => prev.filter(e => e.key !== key));
  }, []);

  const actions = useMemo(() => ({ mount, unmount }), [mount, unmount]);

  return (
    <PortalActionsContext.Provider value={actions}>
      <PortalEntriesContext.Provider value={entries}>{children}</PortalEntriesContext.Provider>
    </PortalActionsContext.Provider>
  );
}

/** Where overlays are drawn. Place it above the app content, below the lock screen. */
export function PortalHost() {
  const entries = useContext(PortalEntriesContext);
  if (entries.length === 0) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="portal-host">
      {entries.map(e => (
        <React.Fragment key={e.key}>{e.node}</React.Fragment>
      ))}
    </View>
  );
}

/** True while any overlay is open, e.g. to hide the app underneath from screen readers. */
export function usePortalActive() {
  return useContext(PortalEntriesContext).length > 0;
}

export function Portal({ children }: { children: React.ReactNode }) {
  const actions = useContext(PortalActionsContext);
  const key = React.useId();

  // Layout effects so the overlay appears in the same frame it is opened.
  useLayoutEffect(() => {
    actions?.mount(key, children);
  }, [actions, key, children]);

  useLayoutEffect(() => {
    if (!actions) return;
    return () => actions.unmount(key);
  }, [actions, key]);

  return actions ? null : <>{children}</>;
}
