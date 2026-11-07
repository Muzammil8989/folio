/**
 * DatabaseGate: opens the database and runs migrations before rendering the
 * app. A failed or stalled open shows a retry screen; user data is never
 * wiped automatically (migrations run in transactions and roll back).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { SQLiteDatabase, SQLiteProvider } from 'expo-sqlite';
import { ErrorRetry } from '@/components/common';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setDbInstance } from '@/lib/db/db-client';
import { DatabaseMigrationError, initializeDatabase } from '@/lib/db/migrations';
import { logger } from '@/lib/logger';
import { darkColors, lightColors } from '@/theme/colors';
import { StartupScreen } from './startup-screen';

export const DATABASE_NAME = 'folio.db';
export const DB_OPEN_TIMEOUT_MS = 20_000;

/**
 * SQLiteProvider is React.memo'd with a comparator that ignores `children`, so
 * it keeps rendering the children it was first given. Anything that changes
 * after the first render (fonts finishing, for one) would never show up, and
 * the app would sit on the startup screen forever. The children therefore
 * travel through this context, which updates through memo boundaries, and are
 * rendered by GateOutlet inside the provider.
 */
const GateChildrenContext = createContext<React.ReactNode>(null);

function GateOutlet() {
  return <>{useContext(GateChildrenContext)}</>;
}

export function DatabaseGate({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;

  // One identity per attempt: SQLiteProvider reopens the database when it changes.
  const onInit = useCallback(
    async (db: SQLiteDatabase) => {
      try {
        await initializeDatabase(db);
      } catch (e) {
        logger.error('Database initialization failed', e);
        throw e;
      }
      // An attempt that timed out and was retried may still finish later.
      // Its connection must not replace the current one.
      if (attemptRef.current !== attempt) {
        db.closeAsync().catch(() => {});
        return;
      }
      setDbInstance(db);
      setReady(true);
    },
    [attempt],
  );

  // SQLiteProvider reports errors during render; defer the state update so
  // React doesn't warn about updating another component while rendering.
  const onError = useCallback((e: Error) => {
    Promise.resolve().then(() => setError(prev => prev ?? e));
  }, []);

  // Watchdog: never leave the user on the startup screen if opening the
  // database stalls. Show the retry screen instead.
  useEffect(() => {
    if (ready || error) return;
    const timer = setTimeout(() => {
      logger.error(`Database did not open within ${DB_OPEN_TIMEOUT_MS} ms`);
      setError(new Error('Database open timed out'));
    }, DB_OPEN_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [ready, error, attempt]);

  if (error) {
    // A file written by a newer app version can't be opened by this one; retrying won't help.
    const isDowngrade = error instanceof DatabaseMigrationError && error.reason === 'downgrade';
    return (
      <DatabaseErrorScreen
        message={
          isDowngrade
            ? 'Your data was saved by a newer version of Folio. Please update the app to open it. Nothing has been deleted.'
            : `Folio couldn't open your data. Nothing has been deleted. Try again, or restart the app.\n\nDetails: ${error.message}`
        }
        onRetry={() => {
          setReady(false);
          setAttempt(a => a + 1);
          setError(null);
        }}
      />
    );
  }

  // SQLiteProvider renders nothing until the database is open, which would
  // leave a black screen once the splash hides. The startup screen covers it.
  return (
    <GateChildrenContext.Provider value={children}>
      <SQLiteProvider key={attempt} databaseName={DATABASE_NAME} onInit={onInit} onError={onError}>
        <GateOutlet />
      </SQLiteProvider>
      {!ready && <StartupScreen databaseReady={false} />}
    </GateChildrenContext.Provider>
  );
}

function DatabaseErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colorScheme = useColorScheme();
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        backgroundColor: colorScheme === 'dark' ? darkColors.background : lightColors.background,
      }}
    >
      <ErrorRetry message={message} onRetry={onRetry} />
    </View>
  );
}
