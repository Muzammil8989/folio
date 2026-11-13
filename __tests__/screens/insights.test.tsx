jest.unmock('@/lib/db/db-client');
jest.mock('expo-router', () => ({
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() })),
    useLocalSearchParams: jest.fn(() => ({})),
}));
import ReportsScreen from '@/app/(tabs)/reports';
import * as q from '@/lib/db/queries';
import { toISODateString } from '@/lib/utils/date';
import { renderWithProviders, runInteractionsImmediately } from '@/tests/helpers/render-with-providers';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

let db: TestDb;
beforeEach(async () => {
    db = await createTestDb();
    runInteractionsImmediately();
});
afterEach(() => {
    db.close();
    jest.restoreAllMocks();
});

/** A date this month, `back` days before today (never before the 1st). */
function thisMonth(back: number): string {
    const now = new Date();
    return toISODateString(new Date(now.getFullYear(), now.getMonth(), Math.max(1, now.getDate() - back)));
}

async function press(el: Parameters<typeof fireEvent.press>[0]) {
    await act(async () => { fireEvent.press(el); });
}

async function seed() {
    const [cash] = await q.getAccounts();
    const bank = await q.createAccount({ name: 'Bank', type: 'checking', balance: 0, currency: 'USD' } as any);
    const [food, rent] = await q.getCategories('expense');
    const [salary] = await q.getCategories('income');
    const add = (type: 'income' | 'expense', amount: number, account: number, category: number) =>
        q.createTransaction({ amount, type, date: thisMonth(0), account_id: account, category_id: category } as any);
    await add('income', 2000, bank.id, salary.id);
    await add('expense', 300, cash.id, food.id);
    await add('expense', 700, bank.id, rent.id);
    return { food, rent, bank };
}

describe('Insights screen', () => {
    it('shows key figures, the category breakdown and net worth', async () => {
        await seed();
        await renderWithProviders(<ReportsScreen />);
        expect((await screen.findAllByText('$1,000.00')).length).toBeGreaterThan(0); // spending
        expect(screen.getByText('By category')).toBeTruthy();
        expect(screen.getByText('Largest expenses')).toBeTruthy();
        expect(screen.getByText('Net worth')).toBeTruthy();
    });

    it('drills into a category from its bar, and clears it from the chip', async () => {
        const { rent } = await seed();
        await renderWithProviders(<ReportsScreen />);
        await press(await screen.findByLabelText(new RegExp(`^${rent.name}: \\$700\\.00`)));

        expect(await screen.findByLabelText(`Remove filter: ${rent.name}`)).toBeTruthy();
        expect(await screen.findByText(`${rent.name} by month`)).toBeTruthy();
        await waitFor(() => expect(screen.queryByText('By category')).toBeNull());

        await press(screen.getByLabelText(`Remove filter: ${rent.name}`));
        expect(await screen.findByText('By category')).toBeTruthy();
    });

    it('filters by account from the filter sheet', async () => {
        await seed();
        await renderWithProviders(<ReportsScreen />);
        await press(await screen.findByLabelText('Filter'));
        await press(await screen.findByText('Bank'));
        await press(screen.getByText('Show results'));

        expect(await screen.findByLabelText('Remove filter: Bank')).toBeTruthy();
        expect(screen.getByLabelText('Filter, 1 active')).toBeTruthy();
        // Only the bank's spending (rent) is left.
        expect((await screen.findAllByText('$700.00')).length).toBeGreaterThan(0);
    });

    it('offers to clear filters when nothing matches', async () => {
        const { food } = await seed();
        await renderWithProviders(<ReportsScreen />);
        await press(await screen.findByLabelText('Filter'));
        await press(await screen.findByText('Bank'));
        await press(screen.getByText(food.name));
        await press(screen.getByText('Show results'));

        expect(await screen.findByText('Nothing matches')).toBeTruthy();
        await press(screen.getByText('Clear filters'));
        expect(await screen.findByText('By category')).toBeTruthy();
    });
});
