/**
 * Startup regression tests for DatabaseGate.
 *
 * The real SQLiteProvider is React.memo'd with a comparator that ignores
 * `children`. The fake below keeps that behaviour, plus the real "render
 * nothing until opened, then run onInit" sequence, with each open controlled
 * by the test.
 */
import { DatabaseGate, DB_OPEN_TIMEOUT_MS } from '@/components/layouts/database-gate';
import { STARTUP_SLOW_MS } from '@/components/layouts/startup-screen';
import { setDbInstance } from '@/lib/db/db-client';
import { initializeDatabase } from '@/lib/db/migrations';
import { renderWithProviders } from '@/tests/helpers/render-with-providers';
import { act, fireEvent, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

type PendingOpen = { db: { closeAsync: jest.Mock }; resolve: () => void; reject: (e: Error) => void };
const mockOpens: PendingOpen[] = [];

jest.mock('expo-sqlite', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  type MockProps = {
    children: React.ReactNode;
    databaseName: string;
    onInit?: (db: unknown) => Promise<void>;
    onError?: (e: Error) => void;
  };
  function NonSuspense({ children, onInit, onError }: MockProps) {
    const [loading, setLoading] = R.useState(true);
    const [error, setError] = R.useState<Error | null>(null);
    R.useEffect(() => {
      let alive = true;
      const db = { closeAsync: jest.fn(() => Promise.resolve()) };
      new Promise<void>((resolve, reject) => mockOpens.push({ db, resolve, reject }))
        .then(() => onInit?.(db))
        .then(() => alive && setLoading(false))
        .catch((e: Error) => alive && setError(e));
      return () => { alive = false; };
    }, [onInit]);
    if (error) {
      if (!onError) throw error;
      onError(error);
    }
    return loading ? null : R.createElement(R.Fragment, null, children);
  }
  const SQLiteProvider = R.memo(
    NonSuspense,
    (a: MockProps, b: MockProps) =>
      a.databaseName === b.databaseName && a.onInit === b.onInit && a.onError === b.onError,
  );
  return { SQLiteProvider, useSQLiteContext: jest.fn() };
});

jest.mock('@/lib/db/db-client', () => ({ setDbInstance: jest.fn(), isDbReady: jest.fn(() => false) }));

jest.mock('@/lib/db/migrations', () => ({
  ...jest.requireActual('@/lib/db/migrations'),
  initializeDatabase: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-splash-screen', () => ({ hideAsync: jest.fn(() => Promise.resolve()) }));

function App({ label }: { label: string }) {
  return (
    <DatabaseGate>
      <Text>{label}</Text>
    </DatabaseGate>
  );
}

const openDatabase = (index = mockOpens.length - 1) =>
  act(async () => {
    mockOpens[index].resolve();
  });

beforeEach(() => {
  mockOpens.length = 0;
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('DatabaseGate', () => {
  it('shows the startup screen until the database is open', async () => {
    await renderWithProviders(<App label="app ready" />);
    expect(screen.getByTestId('startup-screen')).toBeTruthy();
    expect(screen.queryByText('app ready')).toBeNull();

    await openDatabase();

    expect(screen.getByText('app ready')).toBeTruthy();
    expect(screen.queryByTestId('startup-screen')).toBeNull();
    expect(initializeDatabase).toHaveBeenCalledTimes(1);
    expect(setDbInstance).toHaveBeenCalledWith(mockOpens[0].db);
  });

  // The bug behind "stuck on the startup screen": fonts finished loading
  // before the database opened, but the provider kept the old children.
  it('renders children that changed while the database was opening', async () => {
    const { rerender } = await renderWithProviders(<App label="waiting for fonts" />);
    rerender(<App label="app ready" />);

    await openDatabase();

    expect(screen.getByText('app ready')).toBeTruthy();
    expect(screen.queryByText('waiting for fonts')).toBeNull();
  });

  it('keeps rendering children that change after the database is open', async () => {
    const { rerender } = await renderWithProviders(<App label="first" />);
    await openDatabase();
    rerender(<App label="second" />);

    expect(screen.getByText('second')).toBeTruthy();
  });

  it('names the pending step when the database is slow to open', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    await renderWithProviders(<App label="app ready" />);

    await act(async () => {
      jest.advanceTimersByTime(STARTUP_SLOW_MS);
    });

    expect(screen.getByText(/Waiting for: database$/)).toBeTruthy();
  });

  it('offers a retry when opening stalls, and a late finish of the stalled attempt is ignored', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    await renderWithProviders(<App label="app ready" />);

    await act(async () => {
      jest.advanceTimersByTime(DB_OPEN_TIMEOUT_MS);
    });
    expect(screen.getByText(/Database open timed out/)).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Retry loading'));
    await act(async () => {});
    expect(mockOpens).toHaveLength(2);

    // The stalled first attempt finishes after the retry started.
    await openDatabase(0);
    expect(setDbInstance).not.toHaveBeenCalled();
    expect(mockOpens[0].db.closeAsync).toHaveBeenCalled();

    await openDatabase(1);
    expect(screen.getByText('app ready')).toBeTruthy();
    expect(setDbInstance).toHaveBeenCalledWith(mockOpens[1].db);
  });

  it('shows the error screen when migrations fail, without wiping data', async () => {
    (initializeDatabase as jest.Mock).mockRejectedValueOnce(new Error('migration 12 failed'));
    await renderWithProviders(<App label="app ready" />);

    await openDatabase();
    await act(async () => {});

    expect(screen.getByText(/Nothing has been deleted/)).toBeTruthy();
    expect(screen.getByText(/migration 12 failed/)).toBeTruthy();
    expect(screen.queryByText('app ready')).toBeNull();
  });
});
