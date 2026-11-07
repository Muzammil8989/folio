import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import {
  PlayfairDisplay_400Regular_Italic,
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_700Bold_Italic,
} from '@expo-google-fonts/playfair-display';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, AppState, InteractionManager, LogBox, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import '../global.css';

import { ErrorBoundary, LockScreen, ObscuredContent } from '@/components/layouts';
import { ErrorRetry, ThemedText } from '@/components/common';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { darkColors, lightColors } from '@/theme/colors';
import { MAX_CONTENT_WIDTH } from '@/hooks/use-content-width';
import { logger } from '@/lib/logger';
import { SQLiteDatabase, SQLiteProvider } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/features/auth/context/auth-context';
import { ModalProvider, useModalActions } from '@/providers/modal-context';
import { UserProvider, useUser } from '@/features/user/context/user-context';
import { setDbInstance } from '@/lib/db/db-client';
import { DatabaseMigrationError, initializeDatabase } from '@/lib/db/migrations';
import React, { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { NotificationService } from '@/features/notifications/services/notification-service';
import { processRecurringTransactions } from '@/features/recurring/services/recurring-processor';

const PRIMARY_COLOR = lightColors.primary;
const OVERLAY_FADE_MS = 220;
const AUTO_BACKUP_DELAY_MS = 1500;
const DB_OPEN_TIMEOUT_MS = 20_000;
const SPLASH_FAILSAFE_MS = 10_000;
// Custom fonts are cosmetic: never let a stalled font load hold up launch.
const FONT_LOAD_TIMEOUT_MS = 4_000;

/** What has finished during launch; logged by the splash failsafe. */
const startupProgress = { fonts: false, database: false, auth: false, profile: false };

const STARTUP_STEP_LABELS: Record<keyof typeof startupProgress, string> = {
  fonts: 'fonts',
  database: 'database',
  auth: 'security settings',
  profile: 'profile',
};

/**
 * Shown while launch work is still pending, in place of an empty (black) root
 * view. Matches the native splash colour. If launch takes unusually long it
 * says which step is still pending, so a stuck start is visible and reportable.
 */
function StartupScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SPLASH_FAILSAFE_MS);
    return () => clearTimeout(timer);
  }, []);
  const pending = (Object.keys(startupProgress) as (keyof typeof startupProgress)[])
    .filter((step) => !startupProgress[step])
    .map((step) => STARTUP_STEP_LABELS[step]);

  return (
    <View style={[StyleSheet.absoluteFillObject, styles.startup]}>
      <ActivityIndicator size="large" color="#FFFFFF" />
      {slow && (
        <ThemedText style={styles.startupText}>
          {pending.length
            ? `Folio is taking longer than usual to start.\nWaiting for: ${pending.join(', ')}`
            : 'Folio is taking longer than usual to start.'}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * Run non-urgent launch work once the first interactions/animations settle,
 * plus an optional delay, so it never competes with the first frames.
 */
function runAfterStartup(fn: () => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const task = InteractionManager.runAfterInteractions(() => {
    timer = setTimeout(fn, delayMs);
  });
  return {
    cancel: () => {
      task.cancel();
      if (timer) clearTimeout(timer);
    },
  };
}

SplashScreen.preventAutoHideAsync().catch(() => {});

// Migrations run in transactions, so a failure leaves the data as it was.
// The error surfaces in DatabaseGate (retry screen) instead of wiping the DB.
const initDb = async (db: SQLiteDatabase) => {
  try {
    await initializeDatabase(db);
    setDbInstance(db);
  } catch (e) {
    logger.error('Database initialization failed', e);
    throw e;
  }
};

LogBox.ignoreLogs([
  'SafeAreaView has been deprecated',
  "Couldn't find a navigation context",
  'navigation context',
  'NavigationContainer',
]);

// Strip the default Android underline / focus highlight from every TextInput.
// Individual inputs can still override by passing their own underlineColorAndroid.
(TextInput as unknown as { defaultProps?: Record<string, unknown> }).defaultProps = {
  ...((TextInput as unknown as { defaultProps?: Record<string, unknown> }).defaultProps ?? {}),
  underlineColorAndroid: 'transparent',
  selectionColor: PRIMARY_COLOR,
  // Same cap as ThemedText, so large amount inputs don't overflow at 2x system font size.
  maxFontSizeMultiplier: 1.3,
};

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (e) {
  logger.error('Failed to set notification handler', e);
}

export const unstable_settings = {
  anchor: '(tabs)',
};

// React Navigation's DefaultTheme / DarkTheme set colors.background to white/black.
// During the very first push of a lazy-imported screen, react-native-screens paints
// that color in the gap before the screen content mounts — visible as a hairline
// "shadow" leaking at the slide edge. Override with the app's real backgrounds.
const APP_LIGHT_BG = lightColors.background;
const APP_DARK_BG = darkColors.background;

const AppLightTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: APP_LIGHT_BG },
};
const AppDarkTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: APP_DARK_BG },
};

function RootLayoutContent() {
  const colorScheme = useColorScheme();
  const { isLocked, isSecurityEnabled, isLoading: isAuthLoading } = useAuth();
  const { profile, isLoading: isUserLoading } = useUser();
  const isLoading = isAuthLoading || isUserLoading;
  startupProgress.auth = !isAuthLoading;
  startupProgress.profile = !isUserLoading;

  // Keep the native splash up until the user profile (which carries the
  // theme preference) has actually loaded. Hiding the splash on fonts-loaded
  // alone makes the JS app paint with the device color scheme first and then
  // flip to the user's saved theme — the visible black-to-white flash on boot.
  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync().catch(() => {});
  }, [isLoading]);

  // Defers Stack render to the second commit so NativeWind's appearance observer
  // doesn't fire state updates on components that haven't mounted yet.
  const [mounted, setMounted] = useState(false);

  const hasNotifiedRef = useRef(false);
  const prevIsOnboardedRef = useRef<boolean | null>(null);

  const overlayOpacity = useSharedValue(1);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));

  // Mark as mounted after the first commit — Stack renders from here onwards.
  useEffect(() => {
    setMounted(true);
    // One-time cleanup of legacy "WealthFlow" daily reminder left over from
    // pre-rebrand builds. Without this, existing users get duplicate 9 PM
    // notifications (legacy + new) until they reschedule via settings.
    // Deferred so the native call doesn't compete with the first frames.
    const task = InteractionManager.runAfterInteractions(() => {
      Notifications.cancelScheduledNotificationAsync('wf-daily-reminder').catch(() => {});
    });
    return () => task.cancel();
  }, []);

  // App-wide auto-backup. Runs whenever the app is opened or brought back to the
  // foreground; BackupService enforces the 12h interval internally, so this only
  // actually writes a backup once per window. Previously this lived on the
  // Settings screen, so it never fired unless the user happened to open Settings.
  useEffect(() => {
    if (isLoading) return;

    // Loaded lazily: a due backup reads every table and serialises it, which
    // must not land on the first frames after launch.
    const checkAutoBackup = () => {
      import('@/features/backup/services/backup-service')
        .then(({ BackupService }) => BackupService.runAutoBackupIfNeeded())
        .catch((error) => {
          logger.error('Auto-backup check failed', error);
        });
    };

    const startup = runAfterStartup(checkAutoBackup, AUTO_BACKUP_DELAY_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkAutoBackup();
    });
    return () => {
      startup.cancel();
      sub.remove();
    };
  }, [isLoading]);

  // Book due recurring bills/income on launch and whenever the app returns to
  // the foreground (the date may have rolled over while it was backgrounded).
  const { triggerRefresh } = useModalActions();
  useEffect(() => {
    if (isLoading || !profile.isOnboarded) return;

    const runRecurring = () => {
      processRecurringTransactions().then((result) => {
        if (result.success && result.created > 0) triggerRefresh();
      });
    };

    const startup = runAfterStartup(runRecurring, 0);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') runRecurring();
    });
    return () => {
      startup.cancel();
      sub.remove();
    };
  }, [isLoading, profile.isOnboarded, triggerRefresh]);

  // Effect 1: once mounted and data loaded, resolve the initial route then fade the overlay.
  useEffect(() => {
    if (!mounted || isLoading) return;

    prevIsOnboardedRef.current = profile.isOnboarded;

    if (!profile.isOnboarded) {
      router.replace('/onboarding');
    }

    // Prefetch every push-stack route so its JS module is parsed BEFORE the
    // user first navigates. Without this, the first push of e.g. /settings
    // runs the import + first render during the slide animation — which is
    // the "buggy / skeleton-y" flash on first navigation only.
    const PREFETCH_ROUTES = [
      '/settings',
      '/security-setup',
      '/payment-methods',
      '/categories',
      '/recurring',
      '/household',
      '/household-history',
      '/loans',
      '/terms',
      '/privacy',
    ] as const;
    // After the overlay fade, so prefetching doesn't drop frames from it.
    const prefetch = runAfterStartup(() => {
      PREFETCH_ROUTES.forEach((path) => {
        try { router.prefetch(path as never); } catch { /* harmless if route doesn't exist yet */ }
      });
    }, OVERLAY_FADE_MS);

    overlayOpacity.value = withTiming(
      0,
      { duration: OVERLAY_FADE_MS, easing: Easing.out(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(setOverlayVisible)(false);
      },
    );
    // Backup for the animation callback: if it never fires, the faded overlay
    // would stay mounted over the app and swallow every touch.
    const overlayFallback = setTimeout(() => setOverlayVisible(false), OVERLAY_FADE_MS + 500);
    return () => {
      prefetch.cancel();
      clearTimeout(overlayFallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, isLoading]);

  // Effect 2: react to profile.isOnboarded changes after init (completing onboarding).
  // Navigation to the tabs is done by the onboarding screen itself.
  useEffect(() => {
    if (!mounted || isLoading || prevIsOnboardedRef.current === null) return;

    const isNowOnboarded = profile.isOnboarded;
    prevIsOnboardedRef.current = isNowOnboarded;

    if (isNowOnboarded && !hasNotifiedRef.current) {
      hasNotifiedRef.current = true;
      NotificationService.scheduleDailyReminder().catch(() => {});
    }
  }, [mounted, isLoading, profile.isOnboarded]);

  const showLock = isSecurityEnabled && isLocked;

  // Privacy cover: with a PIN set, hide balances from the app switcher
  // snapshot (taken while the app is inactive / backgrounded).
  const [appHidden, setAppHidden] = useState(AppState.currentState !== 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setAppHidden(state !== 'active'));
    return () => sub.remove();
  }, []);
  const showPrivacyCover = isSecurityEnabled && appHidden && !showLock;

  const screenBg = colorScheme === 'dark' ? APP_DARK_BG : APP_LIGHT_BG;
  const opaqueContent = { contentStyle: { backgroundColor: screenBg } };

  return (
    <ThemeProvider value={colorScheme === 'dark' ? AppDarkTheme : AppLightTheme}>
      {/*
       * Stack is withheld on the very first render (mounted=false).
       * This prevents NativeWind's appearance observer from dispatching state
       * updates into components that haven't finished mounting yet.
       * The opaque overlay covers the gap — users see nothing during this frame.
       *
       * LockScreen is rendered ABOVE the Stack (not in place of it) so that
       * unlocking does not remount the navigator — all screen state, form
       * inputs, and tab positions survive an app re-open / lock cycle.
       */}
      {mounted && (
        // Centred reading column on tablets / landscape (see useContentWidth);
        // the surround uses the app background so the edges never flash white.
        // Hidden from screen readers while the lock screen / privacy cover is up:
        // those overlays only cover it visually.
        <ObscuredContent
          hidden={showLock || showPrivacyCover}
          style={{ flex: 1, backgroundColor: colorScheme === 'dark' ? APP_DARK_BG : APP_LIGHT_BG }}
        >
        <View style={{ flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}>
        <Stack
          screenOptions={{
            headerShown: false,
            // Opaque background — the navigation theme background is the fallback
            // shown during a lazy-imported screen's first mount. Match it here so
            // there's no shadow leak on the first push to any route.
            contentStyle: { backgroundColor: screenBg },
            animation: 'slide_from_right',
            animationDuration: 250,
            gestureEnabled: true,
          }}
        >
          {/* Onboarding has its own LinearGradient — keep transparent so the gradient shows. */}
          <Stack.Screen
            name="onboarding"
            options={{ contentStyle: { backgroundColor: 'transparent' }, animation: 'fade', animationDuration: 300 }}
          />
          <Stack.Screen name="(tabs)" options={{ ...opaqueContent, animation: 'fade', animationDuration: 250 }} />
          <Stack.Screen name="settings" options={opaqueContent} />
          <Stack.Screen name="security-setup" options={opaqueContent} />
          <Stack.Screen name="payment-methods" options={opaqueContent} />
          <Stack.Screen name="categories" options={opaqueContent} />
          <Stack.Screen name="recurring" options={opaqueContent} />
          <Stack.Screen name="household" options={opaqueContent} />
          <Stack.Screen name="household-history" options={opaqueContent} />
          <Stack.Screen name="loans" options={opaqueContent} />
          <Stack.Screen name="terms" options={opaqueContent} />
          <Stack.Screen name="privacy" options={opaqueContent} />
          <Stack.Screen name="+not-found" />
        </Stack>
        </View>
        </ObscuredContent>
      )}

      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />

      {showPrivacyCover && (
        <View
          style={[StyleSheet.absoluteFillObject, { backgroundColor: colorScheme === 'dark' ? APP_DARK_BG : APP_LIGHT_BG, alignItems: 'center', justifyContent: 'center' }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <ThemedText style={{ fontFamily: 'PlayfairDisplay_700Bold_Italic', fontSize: 40, color: colorScheme === 'dark' ? darkColors.accent : lightColors.primary }}>Folio</ThemedText>
        </View>
      )}

      {showLock && (
        <View style={StyleSheet.absoluteFillObject} accessibilityViewIsModal>
          <LockScreen />
        </View>
      )}

      {overlayVisible && (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            overlayStyle,
            {
              // Brand blue — matches the native splash. Using a theme-dependent
              // color here causes a dark/light flash when the device color and
              // the user's saved app theme don't match (e.g. dark phone +
              // saved light theme = the user sees a black flash before light).
              backgroundColor: PRIMARY_COLOR,
              alignItems: 'center',
              justifyContent: 'center',
            },
          ]}
        >
          <ActivityIndicator size="large" color="#FFFFFF" />
        </Animated.View>
      )}
    </ThemeProvider>
  );
}

/**
 * Opens the database and runs migrations. A failed migration is rolled back
 * and reported here with a retry: user data is never wiped automatically.
 */
function DatabaseGate({ children }: { children: React.ReactNode }) {
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);

  // Stable identity: SQLiteProvider re-opens the database whenever onInit changes.
  const onInit = React.useCallback(async (db: SQLiteDatabase) => {
    await initDb(db);
    startupProgress.database = true;
    setReady(true);
  }, []);

  // Watchdog: never leave the user on the splash screen if opening the
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
          setError(null);
          setReady(false);
          setAttempt(a => a + 1);
        }}
      />
    );
  }

  // SQLiteProvider renders nothing until the database is open, which would
  // leave a black screen once the splash hides. Cover that gap.
  return (
    <>
      <SQLiteProvider key={attempt} databaseName="folio.db" onInit={onInit} onError={setError}>
        {children}
      </SQLiteProvider>
      {!ready && <StartupScreen />}
    </>
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
        backgroundColor: colorScheme === 'dark' ? APP_DARK_BG : APP_LIGHT_BG,
      }}
    >
      <ErrorRetry message={message} onRetry={onRetry} />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_700Bold_Italic,
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  // Splash is intentionally NOT hidden here — RootLayoutContent hides it only
  // once the user profile (and therefore the theme) is loaded, to avoid the
  // boot-time light/dark flash.

  // Fonts no longer gate the providers: SecureStore reads (auth, profile),
  // migrations and font loading all run in parallel behind the splash. Only
  // the visible UI waits for fonts. A font failure falls back to system fonts
  // instead of leaving the app blank, and so does a load that never settles.
  const [fontsTimedOut, setFontsTimedOut] = useState(false);
  const fontsReady = fontsLoaded || !!fontError || fontsTimedOut;

  useEffect(() => {
    if (fontError) logger.error('Font loading failed, using system fonts', fontError);
  }, [fontError]);

  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const timer = setTimeout(() => {
      logger.error(`Fonts did not load within ${FONT_LOAD_TIMEOUT_MS} ms, using system fonts`);
      setFontsTimedOut(true);
    }, FONT_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontError]);

  // Failsafe: never leave the user staring at the native splash. If startup
  // hasn't finished after this long, hide it so whatever is underneath (an
  // error screen, a spinner) is visible, and log which step is still pending.
  useEffect(() => {
    const timer = setTimeout(() => {
      logger.error(`Startup still pending after ${SPLASH_FAILSAFE_MS} ms`, startupProgress);
      SplashScreen.hideAsync().catch(() => {});
    }, SPLASH_FAILSAFE_MS);
    return () => clearTimeout(timer);
  }, []);
  startupProgress.fonts = fontsReady;

  // Auth and profile live in SecureStore, not SQLite, so they sit above the
  // database gate and load while migrations run.
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <UserProvider>
            <DatabaseGate>
              <ModalProvider>
                {fontsReady ? <RootLayoutContent /> : <StartupScreen />}
              </ModalProvider>
            </DatabaseGate>
          </UserProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  startup: {
    backgroundColor: PRIMARY_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  startupText: {
    marginTop: 20,
    color: '#FFFFFF',
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
});
