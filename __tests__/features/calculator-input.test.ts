import {
    closeBrackets,
    INITIAL_STATE,
    MAX_EXPRESSION_LENGTH,
    previewValue,
    pressKey,
    type CalcKey,
    type CalcState,
} from '@/features/calculator/input';
import { groupByDay, historyDayLabel, parseTimestamp, resultInWords } from '@/features/calculator/utils';

/** Press keys in order; "()" and words like "back" are single keys. */
function press(keys: (CalcKey | string)[], from: CalcState = INITIAL_STATE) {
    let state = from;
    const saved: { expression: string; result: number }[] = [];
    for (const k of keys) {
        const r = pressKey(state, k as CalcKey);
        state = r.state;
        if (r.evaluated) saved.push(r.evaluated);
    }
    return { state, saved };
}
const typed = (s: string) => [...s] as CalcKey[];

describe('calculator keypad', () => {
    it('evaluates on = and reports the calculation to save', () => {
        const { state, saved } = press([...typed('12×3+4'), '=']);
        expect(state.expr).toBe('40');
        expect(state.lastExpression).toBe('12×3+4');
        expect(saved).toEqual([{ expression: '12×3+4', result: 40 }]);
    });

    it('does not save a bare number', () => {
        const { state, saved } = press([...typed('42'), '=']);
        expect(saved).toEqual([]);
        expect(state.expr).toBe('42');
    });

    it('keeps calculating with the result after an operator', () => {
        const { state } = press([...typed('6×7'), '=', '+', '8']);
        expect(state.expr).toBe('42+8');
        expect(state.lastExpression).toBeNull();
    });

    it('starts fresh when a digit follows a result', () => {
        const { state } = press([...typed('6×7'), '=', '5']);
        expect(state.expr).toBe('5');
    });

    it('swaps a repeated operator but allows a negative after × or ÷', () => {
        expect(press(typed('5+×')).state.expr).toBe('5×');
        expect(press(typed('5×−')).state.expr).toBe('5×−');
        expect(press(typed('5×−+')).state.expr).toBe('5+');
    });

    it('only allows minus at the start or after a bracket', () => {
        expect(press(typed('×')).state.expr).toBe('');
        expect(press(typed('−3')).state.expr).toBe('−3');
        expect(press(['()', '+']).state.expr).toBe('(');
        expect(press(['()', '−', '2']).state.expr).toBe('(−2');
    });

    it('stops leading zeros and double decimal points', () => {
        expect(press(typed('007')).state.expr).toBe('7');
        expect(press(typed('1.2.3')).state.expr).toBe('1.23');
        expect(press(typed('.5')).state.expr).toBe('0.5');
        expect(press(typed('3+.')).state.expr).toBe('3+0.');
    });

    it('opens and closes brackets from one key', () => {
        expect(press(['()', ...typed('2+3'), '()', '×', '4']).state.expr).toBe('(2+3)×4');
        // A bracket after a number multiplies.
        expect(press([...typed('2'), '()', '3']).state.expr).toBe('2×(3');
        // A digit after ")" or "%" multiplies too.
        expect(press(['()', '2', '()', '3']).state.expr).toBe('(2)×3');
    });

    it('adds percent only after a value', () => {
        expect(press(['%']).state.expr).toBe('');
        expect(press(typed('200+10%%')).state.expr).toBe('200+10%');
        expect(press([...typed('200+10%'), '=']).state.expr).toBe('220');
    });

    it('closes open brackets and drops a dangling operator on =', () => {
        const { state, saved } = press([...typed('2×'), '()', ...typed('3+4+'), '=']);
        expect(state.expr).toBe('14');
        expect(saved[0].expression).toBe('2×(3+4)');
    });

    it('shows an error on = and clears it on the next key', () => {
        const err = press([...typed('5÷0'), '=']).state;
        expect(err.error).toBe("Can't divide by 0");
        expect(err.expr).toBe('5÷0');
        const fixed = press(['back', '2'], err).state;
        expect(fixed.error).toBeNull();
        expect(fixed.expr).toBe('5÷2');
    });

    it('backspace removes one character, or clears a result', () => {
        expect(press([...typed('123'), 'back']).state.expr).toBe('12');
        expect(press([...typed('1+2'), '=', 'back']).state).toEqual(INITIAL_STATE);
        expect(press(['back']).state).toEqual(INITIAL_STATE);
    });

    it('caps the expression length', () => {
        const { state } = press(typed('1'.repeat(MAX_EXPRESSION_LENGTH + 10)));
        expect(state.expr.length).toBe(MAX_EXPRESSION_LENGTH);
    });

    it('handles a negative result followed by more input', () => {
        const { state } = press([...typed('2−5'), '=', '×', '3', '=']);
        expect(state.expr).toBe('−9');
    });

    it('previews while typing, ignoring a trailing operator', () => {
        expect(previewValue(press(typed('2+3×')).state)).toBe(5);
        expect(previewValue(press(typed('25')).state)).toBeNull();
        expect(previewValue(press([...typed('2+3'), '=']).state)).toBeNull();
        expect(previewValue(press(typed('5÷0')).state)).toBeNull();
    });

    it('closeBrackets ignores stray closers', () => {
        expect(closeBrackets('((1')).toBe('((1))');
        expect(closeBrackets('1)')).toBe('1)');
    });
});

describe('calculator history helpers', () => {
    const now = new Date(2026, 10, 11, 15, 0);

    it('labels days relative to today', () => {
        expect(historyDayLabel(new Date(2026, 10, 11, 9), now)).toBe('Today');
        expect(historyDayLabel(new Date(2026, 10, 10, 23), now)).toBe('Yesterday');
        expect(historyDayLabel(new Date(2026, 10, 1), now)).not.toMatch(/Today|Yesterday|2026/);
        expect(historyDayLabel(new Date(2025, 10, 1), now)).toMatch(/2025/);
    });

    it('parses ISO and SQLite timestamps as the same instant', () => {
        expect(parseTimestamp('2026-11-11T10:00:00.000Z').getTime())
            .toBe(parseTimestamp('2026-11-11 10:00:00').getTime());
    });

    it('groups newest-first entries by day', () => {
        const at = (d: Date) => ({ created_at: d.toISOString() });
        const groups = groupByDay([
            at(new Date(2026, 10, 11, 14)),
            at(new Date(2026, 10, 11, 8)),
            at(new Date(2026, 10, 10, 20)),
        ], now);
        expect(groups.map(g => [g.label, g.items.length])).toEqual([['Today', 2], ['Yesterday', 1]]);
    });

    it('writes whole results in words', () => {
        const words = (n: number) => `w${n}`;
        expect(resultInWords(1200, words)).toBe('w1200');
        expect(resultInWords(-5, words)).toBe('Minus w5');
        expect(resultInWords(2.5, words)).toBeNull();
        expect(resultInWords(0, words)).toBeNull();
        expect(resultInWords(null, words)).toBeNull();
    });
});
