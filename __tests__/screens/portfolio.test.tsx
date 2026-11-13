jest.unmock('@/lib/db/db-client');
jest.mock('expo-router', () => ({
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() })),
    useLocalSearchParams: jest.fn(() => ({})),
}));
import HoldingScreen from '@/app/holding';
import InvestmentsScreen from '@/app/investments';
import * as q from '@/lib/db/queries';
import { renderWithProviders, runInteractionsImmediately } from '@/tests/helpers/render-with-providers';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';

let db: TestDb;
beforeEach(async () => {
    db = await createTestDb();
    runInteractionsImmediately();
    (router.push as jest.Mock).mockClear();
    (router.back as jest.Mock).mockClear();
});
afterEach(() => {
    db.close();
    jest.restoreAllMocks();
});

const base = { symbol: 'ENGRO', asset_type: 'stock' as const, market: 'PSX', notes: null, color: null };
const buy = (date: string, quantity: number, price: number): q.TradeInput =>
    ({ type: 'buy', date, quantity, price, fees: 0, amount: null, notes: null });

async function press(el: Parameters<typeof fireEvent.press>[0]) {
    await act(async () => { fireEvent.press(el); });
}

describe('Portfolio screen', () => {
    it('invites you to add a first holding, and saves one from the sheet', async () => {
        await renderWithProviders(<InvestmentsScreen />);
        expect(await screen.findByText('Track your investments')).toBeTruthy();

        await press(screen.getAllByLabelText('Add a holding')[0]);
        fireEvent.changeText(await screen.findByLabelText('Name'), 'Engro Corporation');
        fireEvent.changeText(screen.getByLabelText('Quantity'), '100');
        fireEvent.changeText(screen.getByLabelText('Price per unit'), '250');
        fireEvent.changeText(screen.getByLabelText('Fees (optional)'), '50');
        expect(screen.getByText('$25,050.00')).toBeTruthy(); // total cost preview
        await press(screen.getByText('Add holding'));

        await waitFor(async () => {
            const { holdings, trades } = await q.getPortfolioData();
            expect(holdings[0]).toMatchObject({ name: 'Engro Corporation', asset_type: 'stock' });
            expect(trades[0]).toMatchObject({ quantity: 100, price: 250, fees: 50 });
        });
    });

    it('asks for a name before saving', async () => {
        await renderWithProviders(<InvestmentsScreen />);
        await press(await screen.findByText('Add a holding'));
        await press(await screen.findByText('Add holding'));
        expect(screen.getByText('Give the holding a name')).toBeTruthy();
        expect((await q.getPortfolioData()).holdings).toHaveLength(0);
    });

    it('shows value, return, charts and holdings', async () => {
        const h = await q.createHolding({ ...base, name: 'Engro' }, buy('2026-01-05', 10, 100), { price: 150, date: '2026-02-01' });
        await q.createTrade(h.id, { type: 'dividend', date: '2026-03-01', quantity: null, price: null, fees: 0, amount: 20, notes: null });
        await q.createHolding({ ...base, name: 'Bitcoin', symbol: 'BTC', asset_type: 'crypto' }, buy('2026-01-05', 0.5, 1000));

        await renderWithProviders(<InvestmentsScreen />);
        expect(await screen.findByText('$2,000.00')).toBeTruthy(); // 1500 + 500
        expect(screen.getByText('Allocation')).toBeTruthy();
        expect(screen.getByText('Return by holding')).toBeTruthy();
        expect(screen.getByLabelText(/^Engro\./)).toBeTruthy();
        expect(screen.getByLabelText(/^Bitcoin\./)).toBeTruthy();

        // Filter by type
        await press(screen.getByText('Crypto'));
        expect(screen.queryByLabelText(/^Engro\./)).toBeNull();

        // Open a holding
        await press(screen.getByLabelText(/^Bitcoin\./));
        expect(router.push).toHaveBeenCalledWith({ pathname: '/holding', params: { id: expect.any(String) } });
    });
});

describe('Holding screen', () => {
    async function openHolding(trades: q.TradeInput[], price?: { price: number; date: string }) {
        const [first, ...rest] = trades;
        const h = await q.createHolding({ ...base, name: 'Engro' }, first, price);
        for (const t of rest) await q.createTrade(h.id, t);
        (useLocalSearchParams as jest.Mock).mockReturnValue({ id: String(h.id) });
        await renderWithProviders(<HoldingScreen />);
        await screen.findByText('Value now');
        return h;
    }

    it('shows the position and blocks selling more than is held', async () => {
        const h = await openHolding([buy('2026-01-05', 10, 100)], { price: 120, date: '2026-02-01' });
        expect(screen.getByText('$1,200.00')).toBeTruthy();

        await press(screen.getByText('Sell'));
        fireEvent.changeText(await screen.findByLabelText('Quantity'), '20');
        fireEvent.changeText(screen.getByLabelText('Price per unit'), '130');
        await press(screen.getByText('Save'));
        expect(screen.getByText(/but this sells 20/)).toBeTruthy();
        expect((await q.getHoldingData(h.id))!.trades).toHaveLength(1);

        fireEvent.changeText(screen.getByLabelText('Quantity'), '4');
        expect(screen.getByText('+$120.00')).toBeTruthy(); // (130 − 100) × 4
        await press(screen.getByText('Save'));
        await waitFor(async () => {
            expect((await q.getHoldingData(h.id))!.trades.map(t => t.type)).toEqual(['buy', 'sell']);
        });
    });

    it("won't delete a buy that a later sale depends on", async () => {
        const h = await openHolding([buy('2026-01-05', 10, 100), { type: 'sell', date: '2026-02-01', quantity: 5, price: 120, fees: 0, amount: null, notes: null }]);
        await press(screen.getByLabelText(/^Buy · 10 shares/));
        await press(await screen.findByText('Delete this entry'));
        await press(screen.getByText('Delete entry'));
        expect(screen.getByText(/Can't delete this/)).toBeTruthy();
        expect((await q.getHoldingData(h.id))!.trades).toHaveLength(2);
    });

    it('updates the price from its own sheet', async () => {
        const h = await openHolding([buy('2026-01-05', 10, 100)]);
        await press(screen.getByText('Update'));
        fireEvent.changeText(await screen.findByLabelText('ENGRO · Engro'), '111');
        await press(screen.getByText('Save'));
        await waitFor(async () => {
            expect((await q.getHoldingData(h.id))!.holdings[0].current_price).toBe(111);
        });
    });

    it('deletes the holding after confirming', async () => {
        const h = await openHolding([buy('2026-01-05', 10, 100)]);
        await press(screen.getByText('Delete holding'));
        await press(screen.getByText('Delete'));
        await waitFor(async () => expect(await q.getHoldingData(h.id)).toBeNull());
        expect(router.back).toHaveBeenCalled();
    });
});
