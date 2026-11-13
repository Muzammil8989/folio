jest.unmock('@/lib/db/db-client');
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
import CalculatorScreen from '@/app/calculator';
import * as q from '@/lib/db/queries';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';
import { renderWithProviders, runInteractionsImmediately } from '@/tests/helpers/render-with-providers';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
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

const LABELS: Record<string, string> = { '+': 'Plus', '−': 'Minus', '×': 'Multiply', '÷': 'Divide', '=': 'Equals', '%': 'Percent', '.': 'Decimal point' };

async function tap(keys: string) {
    for (const k of keys) {
        await act(async () => {
            fireEvent.press(screen.getByLabelText(LABELS[k] ?? k));
        });
    }
}

describe('Calculator screen', () => {
    it('shows a live preview, saves the result on =, and lists it in history', async () => {
        await renderWithProviders(<CalculatorScreen />);
        await tap('1200×3+450');
        expect(screen.getByText('1,200×3+450')).toBeTruthy();
        expect(screen.getByText('= 4,050')).toBeTruthy();

        await tap('=');
        expect(screen.getByText('4,050')).toBeTruthy();
        expect(screen.getByText('1,200×3+450 =')).toBeTruthy();
        expect(screen.getByText('Four Thousand Fifty')).toBeTruthy();

        await waitFor(async () => {
            expect((await q.getCalcHistory())[0]).toMatchObject({ expression: '1200×3+450', result: 4050 });
        });

        await act(async () => {
            fireEvent.press(screen.getByLabelText('Calculation history'));
        });
        expect(await screen.findByText('= 4,050')).toBeTruthy();
        expect(screen.getByText('Today')).toBeTruthy();
    });

    it('shows an error for division by zero without saving it', async () => {
        await renderWithProviders(<CalculatorScreen />);
        await tap('5÷0=');
        expect(screen.getByText("Can't divide by 0")).toBeTruthy();
        expect(await q.getCalcHistory()).toHaveLength(0);
    });

    it('loads past history and copies a result on long press', async () => {
        await q.addCalcHistory('7×6', 42);
        await renderWithProviders(<CalculatorScreen />);
        await act(async () => {
            fireEvent.press(screen.getByLabelText('Calculation history'));
        });
        const row = await screen.findByLabelText('7×6 equals 42');
        await act(async () => {
            fireEvent(row, 'longPress');
        });
        expect(Clipboard.setStringAsync).toHaveBeenCalledWith('42');
    });

    it('clears history after confirming', async () => {
        await q.addCalcHistory('1+1', 2);
        await renderWithProviders(<CalculatorScreen />);
        await act(async () => {
            fireEvent.press(screen.getByLabelText('Calculation history'));
        });
        await act(async () => {
            fireEvent.press(await screen.findByText('Clear history'));
        });
        await act(async () => {
            fireEvent.press(screen.getByText('Clear all'));
        });
        await waitFor(async () => expect(await q.getCalcHistory()).toHaveLength(0));
        expect(screen.getByText('No calculations yet')).toBeTruthy();
    });
});
