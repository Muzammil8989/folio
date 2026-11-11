/**
 * Calculator keypad logic, kept pure so it can be unit-tested.
 * `pressKey(state, key)` returns the next state, plus the finished
 * calculation when "=" produced a result worth saving to history.
 */
import { evaluateExpression, hasOperation } from '@/lib/utils/expression';

export type CalcKey =
    | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
    | '.' | '+' | '−' | '×' | '÷' | '%' | '()' | 'back' | 'clear' | '=';

export interface CalcState {
    /** What the user is typing, or the result after "=". Operators use + − × ÷. */
    expr: string;
    /** The calculation behind the result on screen; null while typing. */
    lastExpression: string | null;
    /** Why the last "=" failed; cleared by the next key. */
    error: string | null;
}

export interface PressResult {
    state: CalcState;
    evaluated?: { expression: string; result: number };
}

export const INITIAL_STATE: CalcState = { expr: '', lastExpression: null, error: null };

export const MAX_EXPRESSION_LENGTH = 120;

const OPERATORS = ['+', '−', '×', '÷'];
const isOperator = (c: string | undefined) => !!c && OPERATORS.includes(c);
const isDigit = (c: string | undefined) => !!c && c >= '0' && c <= '9';
/** Characters a value can end with (so a ")" , "%" or operator may follow). */
const endsValue = (c: string | undefined) => isDigit(c) || c === ')' || c === '%' || c === '.';

/** Typed form of a result: "-12.5" → "−12.5". */
export function toInputString(value: number): string {
    return String(value).replace(/^-/, '−');
}

/** Close any brackets left open: "2×(3+4" → "2×(3+4)". */
export function closeBrackets(expr: string): string {
    let open = 0;
    for (const c of expr) {
        if (c === '(') open++;
        else if (c === ')' && open > 0) open--;
    }
    return expr + ')'.repeat(open);
}

/** Drop a dangling operator or "(" so a half-typed expression still evaluates. */
export function trimIncomplete(expr: string): string {
    return expr.replace(/[+−×÷(]+$/, '');
}

/** Live result while typing, or null when there's nothing worth previewing. */
export function previewValue(state: CalcState): number | null {
    if (state.lastExpression !== null) return null;
    const trimmed = trimIncomplete(state.expr);
    if (!trimmed || !hasOperation(trimmed)) return null;
    const res = evaluateExpression(trimmed);
    return res.ok ? res.value : null;
}

function next(state: CalcState, expr: string): PressResult {
    if (expr.length > MAX_EXPRESSION_LENGTH) return { state };
    return { state: { expr, lastExpression: null, error: null } };
}

export function pressKey(state: CalcState, key: CalcKey): PressResult {
    const justEvaluated = state.lastExpression !== null;
    const expr = state.expr;

    switch (key) {
        case 'clear':
            return { state: INITIAL_STATE };

        case 'back':
            // After "=", backspace clears; while typing it removes one character.
            if (justEvaluated) return { state: INITIAL_STATE };
            return next(state, expr.slice(0, -1));

        case '=': {
            if (justEvaluated) return { state };
            const trimmed = trimIncomplete(expr);
            if (!trimmed) return { state };
            if (!hasOperation(trimmed)) return next(state, trimmed);
            const expression = closeBrackets(trimmed);
            const res = evaluateExpression(expression);
            if (!res.ok) return { state: { ...state, error: res.error } };
            return {
                state: { expr: toInputString(res.value), lastExpression: expression, error: null },
                evaluated: { expression, result: res.value },
            };
        }

        case '.': {
            const base = justEvaluated ? '' : expr;
            const last = base.at(-1);
            if (last === ')' || last === '%') return next(state, base + '×0.');
            const segment = /[\d.]*$/.exec(base)?.[0] ?? '';
            if (segment.includes('.')) return { state };
            return next(state, base + (segment === '' ? '0.' : '.'));
        }

        case '%': {
            const last = expr.at(-1);
            if (!endsValue(last) || last === '%') return { state };
            return next(state, expr + '%');
        }

        case '()': {
            const base = justEvaluated ? '' : expr;
            const last = base.at(-1);
            const open = (base.match(/\(/g)?.length ?? 0) - (base.match(/\)/g)?.length ?? 0);
            if (open > 0 && endsValue(last)) return next(state, base + ')');
            if (endsValue(last)) return next(state, base + '×(');
            return next(state, base + '(');
        }

        case '+':
        case '−':
        case '×':
        case '÷': {
            // After "=", keep calculating with the result.
            const last = expr.at(-1);
            if (expr === '' || last === '(') return key === '−' ? next(state, expr + '−') : { state };
            if (isOperator(last)) {
                // "5×" then "−" → "5×−" (a negative number); otherwise swap the operator.
                if (key === '−' && (last === '×' || last === '÷')) return next(state, expr + '−');
                const stripped = expr.replace(/[+−×÷]+$/, '');
                if (stripped === '' || stripped.endsWith('(')) return { state };
                return next(state, stripped + key);
            }
            return next(state, expr + key);
        }

        default: {
            // Digits
            const base = justEvaluated ? '' : expr;
            const last = base.at(-1);
            const prefix = last === ')' || last === '%' ? base + '×' : base;
            const segment = /[\d.]*$/.exec(prefix)?.[0] ?? '';
            // No leading zeros: "0" then "5" → "5"; "0" then "0" → "0".
            if (segment === '0') {
                if (key === '0') return { state: justEvaluated ? { ...INITIAL_STATE, expr: '0' } : state };
                return next(state, prefix.slice(0, -1) + key);
            }
            return next(state, prefix + key);
        }
    }
}
