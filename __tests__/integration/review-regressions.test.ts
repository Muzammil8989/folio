/**
 * Regressions found while reviewing the calculator, portfolio and Insights work.
 */
jest.unmock('@/lib/db/db-client');
import { toInputNumber } from '@/features/investments/utils';
import * as q from '@/lib/db/queries';
import { parseAmount } from '@/lib/utils/currency';
import { toISODateString } from '@/lib/utils/date';
import { evaluateExpression, formatResult } from '@/lib/utils/expression';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';

let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });
afterEach(() => db.close());

describe('net worth with loans', () => {
    it('keeps a repaid loan counted until it is transferred back to an account', async () => {
        const [acct] = await q.getAccounts();
        const opening = await q.getCurrentBalance();
        const cats = await q.ensureSystemLoanCategories();
        const loan = await q.createLoan({ type: 'given', person_name: 'Ali', amount: 1000, account_id: acct.id, date: '2026-04-01', due_date: null, notes: null, is_settled: 0 }, cats);
        const worth = async () => {
            const p = await q.getNetWorthParts();
            return p.accounts + p.savings + p.lent - p.borrowed;
        };
        expect(await worth()).toBe(opening);

        await q.createLoanPayment({ loan_id: loan.id, amount: 400, date: '2026-04-05', notes: null }, loan, cats);
        expect(await worth()).toBe(opening);

        await q.createLoanPayment({ loan_id: loan.id, amount: 600, date: '2026-04-06', notes: null }, { ...loan, settled_amount: 400 }, cats);
        expect(await worth()).toBe(opening); // settled, not yet transferred

        await q.transferLoanToAccount(loan.id, cats);
        expect(await worth()).toBe(opening); // now back in the account
        expect((await q.getNetWorthParts()).lent).toBe(0);
    });
});

describe('monthly totals', () => {
    it('leave out entries scheduled later this month', async () => {
        const [acct] = await q.getAccounts();
        const [cat] = await q.getCategories('expense');
        const now = new Date(2026, 3, 20);
        await q.createTransaction({ amount: 10, type: 'expense', date: '2026-04-19', account_id: acct.id, category_id: cat.id } as any);
        await q.createTransaction({ amount: 99, type: 'expense', date: '2026-04-25', account_id: acct.id, category_id: cat.id } as any);
        const [april] = (await q.getMonthlyTotals(1, now));
        expect(april.expense).toBe(10);
        expect(toISODateString(now)).toBe('2026-04-20');
    });
});

describe('number input edge cases', () => {
    it('reads a leading "0," as a decimal in precise fields only', () => {
        expect(parseAmount('0,125', 8)).toBe(0.125);
        expect(parseAmount('0.125', 8)).toBe(0.125);
        expect(parseAmount('1,125', 8)).toBe(1125); // still thousands: ambiguous without a leading 0
        expect(parseAmount('0,125')).toBe(125); // money (2 decimals): existing behaviour unchanged
    });

    it('turns tiny or long numbers into plain input text', () => {
        expect(toInputNumber(1e-7)).toBe('0.0000001');
        expect(toInputNumber(2.5)).toBe('2.5');
        expect(toInputNumber(100)).toBe('100');
        expect(toInputNumber(0)).toBe('0');
        expect(parseAmount(toInputNumber(1e-7), 8)).toBe(1e-7);
    });

    it('keeps up to 15 significant digits in calculator results', () => {
        const v = (s: string) => {
            const r = evaluateExpression(s);
            return r.ok ? r.value : NaN;
        };
        expect(v('99999999999.99×1')).toBe(99999999999.99);
        expect(v('1234567890123+1')).toBe(1234567890124);
        expect(v('0.1+0.2')).toBe(0.3);
        expect(formatResult(v('12345678901.23'))).toBe('12,345,678,901.23');
    });
});
