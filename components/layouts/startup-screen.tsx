/**
 * StartupScreen: shown while launch work is still pending, in place of an
 * empty (black) root view. It matches the native splash colour.
 *
 * If launch takes unusually long it names the step still pending, so a stuck
 * start is visible on screen and reportable, and logs it once.
 *
 * Every pending step is read from live state (contexts and props), never from
 * a value recorded by some other component: a component that has not mounted
 * cannot report that it is done.
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/common';
import { useAuth } from '@/features/auth/context/auth-context';
import { useUser } from '@/features/user/context/user-context';
import { logger } from '@/lib/logger';
import { lightColors } from '@/theme/colors';

/** After this long since launch, the startup screen says what it is waiting for. */
export const STARTUP_SLOW_MS = 10_000;

/** Module load is as close to process start as JS gets. */
const LAUNCHED_AT = Date.now();

/** Whether custom fonts have loaded (or been given up on). Provided by the root layout. */
export const FontsReadyContext = createContext(true);

export function useStartupPending({ databaseReady = true }: { databaseReady?: boolean } = {}) {
  const fontsReady = useContext(FontsReadyContext);
  const { isLoading: isAuthLoading } = useAuth();
  const { isLoading: isUserLoading } = useUser();

  const pending: string[] = [];
  if (!fontsReady) pending.push('fonts');
  if (!databaseReady) pending.push('database');
  if (isAuthLoading) pending.push('security settings');
  if (isUserLoading) pending.push('profile');
  return pending;
}

function useLaunchIsSlow() {
  const remaining = STARTUP_SLOW_MS - (Date.now() - LAUNCHED_AT);
  const [slow, setSlow] = useState(remaining <= 0);
  useEffect(() => {
    if (slow) return;
    const timer = setTimeout(() => setSlow(true), Math.max(0, remaining));
    return () => clearTimeout(timer);
    // `remaining` is only read when the timer is first set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slow]);
  return slow;
}

export function StartupScreen({ databaseReady = true }: { databaseReady?: boolean }) {
  const pending = useStartupPending({ databaseReady });
  const slow = useLaunchIsSlow();
  const pendingKey = pending.join(', ');

  useEffect(() => {
    if (slow && pendingKey) {
      logger.error(`Startup still pending after ${STARTUP_SLOW_MS} ms: ${pendingKey}`);
    }
  }, [slow, pendingKey]);

  return (
    <View
      style={[StyleSheet.absoluteFillObject, styles.container]}
      accessibilityLabel="Folio is starting"
      testID="startup-screen"
    >
      <ActivityIndicator size="large" color="#FFFFFF" />
      {slow && pendingKey !== '' && (
        <ThemedText style={styles.text}>
          {`Folio is taking longer than usual to start.\nWaiting for: ${pendingKey}`}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: lightColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  text: {
    marginTop: 20,
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
});
