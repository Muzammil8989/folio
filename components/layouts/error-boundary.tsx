/**
 * ErrorBoundary — catches render errors and shows a fallback UI.
 *
 * Architecture:
 *   ErrorBoundary  (class component — required for getDerivedStateFromError)
 *   └── ErrorFallback (functional component — uses hooks, NativeWind tokens, ThemedText)
 *
 * Design tokens used in ErrorFallback:
 *   background   → bg-background / dark:bg-dark-background
 *   icon surface → bg-errorBg / dark:bg-dark-errorBg        (M3 error-container)
 *   icon color   → text-errorText / dark:text-dark-errorText (M3 on-error-container)
 *   headline     → text-textPrimary / dark:text-dark-textPrimary
 *   body         → text-textMuted / dark:text-dark-textMuted
 *   CTA bg       → bg-primary                               (M3 primary)
 *   CTA text     → text-white                               (M3 on-primary)
 *   CTA shape    → rounded-xl = Shape.Large (16dp)
 */

import React, { Component, ErrorInfo, useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton, ThemedText } from '@/components/common';
import { logger } from '@/lib/logger';

const firstLines = (text: string, n = 12) => text.split('\n').slice(0, n).join('\n');

// ─── ErrorFallback ────────────────────────────────────────────────────────────
// Functional component — can use NativeWind + ThemedText for full token coverage
// and dark mode support.

interface ErrorFallbackProps {
  onReset: () => void;
  error: Error | null;
  componentStack: string | null;
}

function ErrorFallback({ onReset, error, componentStack }: ErrorFallbackProps) {
  // A crash during startup happens while the native splash is still up;
  // without this the fallback renders hidden behind it and the app looks frozen.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const message = error?.message ?? 'Unknown error';
  const stack = error?.stack ?? '';

  return (
    <SafeAreaView className="flex-1 bg-background dark:bg-dark-background">
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingVertical: 24, justifyContent: 'center' }}>
        <ThemedText type="kicker" className="mb-1.5">Something went wrong</ThemedText>
        <ThemedText type="display" className="mb-3" accessibilityRole="header">Folio hit a snag</ThemedText>
        <ThemedText className="text-[15px] leading-6 mb-6 text-textSecondary dark:text-dark-textSecondary">
          Your data is safe on this phone. Try again, and if this keeps happening, restart the app.
        </ThemedText>

        {/* The message alone in release builds, so a crash can be reported; full traces in development only */}
        {!__DEV__ && (
          <ThemedText className="text-xs mb-6 text-textMuted dark:text-dark-textMuted" selectable>
            Details: {message}
          </ThemedText>
        )}
        {__DEV__ && (
          <View className="mb-6 border-t border-divider dark:border-dark-divider pt-4">
            <ThemedText type="kicker" className="mb-1">Error message</ThemedText>
            <ThemedText className="text-sm mb-4 text-errorText dark:text-dark-errorText" selectable>{message}</ThemedText>
            {stack ? (
              <>
                <ThemedText type="kicker" className="mb-1">Stack trace</ThemedText>
                <ThemedText className="text-xs mb-4" selectable>{firstLines(stack)}</ThemedText>
              </>
            ) : null}
            {componentStack ? (
              <>
                <ThemedText type="kicker" className="mb-1">Component stack</ThemedText>
                <ThemedText className="text-xs" selectable>{firstLines(componentStack)}</ThemedText>
              </>
            ) : null}
          </View>
        )}

        <AppButton label="Try again" icon="refresh" onPress={onReset} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── ErrorBoundary ────────────────────────────────────────────────────────────
// Class component is required — getDerivedStateFromError cannot be used in
// functional components. All UI is delegated to ErrorFallback.

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, componentStack: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error('ErrorBoundary caught an error:', error, errorInfo.componentStack);
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <ErrorFallback
          onReset={this.handleReset}
          error={this.state.error}
          componentStack={this.state.componentStack}
        />
      );
    }
    return this.props.children;
  }
}
