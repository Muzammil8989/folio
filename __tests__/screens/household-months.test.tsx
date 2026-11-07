/**
 * Household screens against a real (in-memory) SQLite database: every month
 * has its own income and expenses, kept in History.
 */
jest.unmock('@/lib/db/db-client');
import HouseholdScreen from '@/app/household';
import HouseholdHistoryScreen from '@/app/household-history';
import HouseholdPeriodScreen from '@/app/household-period';
import * as q from '@/lib/db/queries';
import { toISODateString } from '@/lib/utils/date';
import { renderWithProviders, runInteractionsImmediately } from '@/tests/helpers/render-with-providers';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { Alert } from 'react-native';

jest.mock('expo-router', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() })),
    useLocalSearchParams: jest.fn(() => ({})),
    useFocusEffect: (effect: () => void) => R.useEffect(effect, [effect]),
  };
});

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  runInteractionsImmediately();
  jest.clearAllMocks();
});
afterEach(() => {
  db.close();
  jest.restoreAllMocks();
});

const expense = (amount: number, date: string) =>
  q.createHouseholdExpense({ amount, date, category_id: null, notes: null } as any);

/** June (income 1000, two expenses) closed; the current month is July. */
async function seedClosedJune() {
  await q.upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: '2026-06-01' });
  await expense(300, '2026-06-05');
  await expense(150, '2026-06-20');
  await q.rollOverHouseholdPeriod({
    period: 'monthly', start_date: '2026-06-01', end_date: '2026-06-30', income_amount: 1000, next_start_date: '2026-07-01',
  });
  const [june] = await q.listHouseholdHistory();
  return june;
}

describe('Household History', () => {
  it('lists each past month and opens it on tap', async () => {
    const june = await seedClosedJune();
    await renderWithProviders(<HouseholdHistoryScreen />);

    const row = await screen.findByLabelText('Jun 1 – Jun 30, 2026: open this period\'s expenses');
    expect(screen.getByText('$450.00')).toBeTruthy(); // spent
    fireEvent.press(row);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/household-period', params: { id: String(june.id) } });
  });

  it('asks before deleting a month, and deletes its expenses with it', async () => {
    await seedClosedJune();
    const alert = jest.spyOn(Alert, 'alert');
    await renderWithProviders(<HouseholdHistoryScreen />);

    fireEvent.press(await screen.findByLabelText('Delete this period from history'));
    expect(alert).toHaveBeenCalledWith(
      'Delete from History?',
      'Jun 1 – Jun 30, 2026 will be removed. Its 2 expenses will be deleted too.',
      expect.any(Array),
    );
    expect(await q.listHouseholdHistory()).toHaveLength(1); // nothing deleted yet

    const buttons = alert.mock.calls[0][2]!;
    await buttons.find(b => b.style === 'destructive')!.onPress!();
    await waitFor(async () => expect(await q.listHouseholdHistory()).toHaveLength(0));
    expect(await q.getHouseholdExpenses('2026-06-01', '2026-06-30')).toHaveLength(0);
  });
});

describe('Household month detail', () => {
  it('shows the month\'s own income, totals and every expense', async () => {
    const june = await seedClosedJune();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: String(june.id) });
    await renderWithProviders(<HouseholdPeriodScreen />);

    expect(await screen.findByText('Jun 1 – Jun 30, 2026')).toBeTruthy();
    expect(screen.getByText('-$300.00')).toBeTruthy();
    expect(screen.getByText('-$150.00')).toBeTruthy();
    expect(screen.getByText('2 items')).toBeTruthy();
  });

  it('edits that month\'s income only', async () => {
    const june = await seedClosedJune();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: String(june.id) });
    await renderWithProviders(<HouseholdPeriodScreen />);

    fireEvent.press(await screen.findByLabelText("Edit this month's income"));
    fireEvent.changeText(screen.getByDisplayValue('1000'), '1200');
    fireEvent.press(screen.getByText('Save Income'));

    await waitFor(async () => expect((await q.getHouseholdHistoryEntry(june.id))!.income_amount).toBe(1200));
    // The current month keeps its own income.
    expect((await q.getHouseholdConfig())!.income_amount).toBe(1000);
  });

  it('explains months closed before this update, which have no entries', async () => {
    db.raw.prepare(
      `insert into household_periods_history
         (period, start_date, end_date, income_amount, spent_amount, remaining_amount, expense_count, entries_kept)
       values ('monthly', '2026-01-01', '2026-01-31', 900, 400, 500, 3, 0)`,
    ).run();
    const [legacy] = await q.listHouseholdHistory();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: String(legacy.id) });
    await renderWithProviders(<HouseholdPeriodScreen />);

    expect(await screen.findByText(/weren't kept for months that closed before this update/)).toBeTruthy();
  });
});

describe('Household: a new month', () => {
  it('asks to confirm the carried-over income, and Keep confirms it', async () => {
    await q.upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: toISODateString(new Date()) });
    // Simulate the start of a new month: income carried over, not yet confirmed.
    db.raw.prepare('update household_config set income_confirmed = 0').run();
    await renderWithProviders(<HouseholdScreen />);

    expect(await screen.findByText('New month started')).toBeTruthy();
    fireEvent.press(screen.getByText('Keep $1,000.00'));
    // Saving and reloading take a few ticks (the banner is gone well within this).
    await act(() => new Promise<void>(resolve => setTimeout(resolve, 150)));

    expect(screen.queryByText('New month started')).toBeNull();
    expect((await q.getHouseholdConfig())!.income_confirmed).toBe(true);
  });

  it('shows no banner once the month\'s income is set', async () => {
    // A month that started today (an older start would roll over to a new month).
    await q.upsertHouseholdConfig({ income_amount: 1000, period: 'monthly', period_start_date: toISODateString(new Date()) });
    await renderWithProviders(<HouseholdScreen />);
    expect(await screen.findByText("This month's household income")).toBeTruthy();
    expect(screen.queryByText('New month started')).toBeNull();
  });
});
