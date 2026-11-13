/**
 * Safe arithmetic for the calculator: a tokenizer plus a recursive-descent
 * parser. Never uses eval / Function, and never throws.
 *
 * Grammar (highest binding last):
 *   expr    := term (('+' | '−') term)*
 *   term    := unary (('×' | '÷') unary)*
 *   unary   := ('−' | '+') unary | postfix
 *   postfix := primary '%'*
 *   primary := number | '(' expr ')'
 *
 * Percent works like a phone calculator:
 *   50%        → 0.5
 *   200 × 10%  → 20
 *   200 + 10%  → 220   (a ± b% means a ± a·b/100)
 *
 * Unclosed brackets are closed at the end, so "2×(3+4" evaluates to 14.
 */

export type EvalResult = { ok: true; value: number } | { ok: false; error: string };

type Token =
    | { kind: 'num'; value: number }
    | { kind: 'op'; value: '+' | '-' | '*' | '/' }
    | { kind: 'lparen' }
    | { kind: 'rparen' }
    | { kind: 'percent' };

/** Display glyphs for the four operators. */
export const OPS = { add: '+', subtract: '−', multiply: '×', divide: '÷' } as const;

const OP_ALIASES: Record<string, '+' | '-' | '*' | '/'> = {
    '+': '+',
    '-': '-',
    '−': '-',
    '*': '*',
    '×': '*',
    'x': '*',
    '/': '/',
    '÷': '/',
};

const NUMBER_RE = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i;

class ParseError extends Error {}

function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const src = input.replace(/,/g, '');
    while (i < src.length) {
        const ch = src[i];
        if (ch === ' ') { i++; continue; }
        const num = NUMBER_RE.exec(src.slice(i));
        if (num) {
            tokens.push({ kind: 'num', value: Number(num[0]) });
            i += num[0].length;
            continue;
        }
        if (ch in OP_ALIASES) { tokens.push({ kind: 'op', value: OP_ALIASES[ch] }); i++; continue; }
        if (ch === '(') { tokens.push({ kind: 'lparen' }); i++; continue; }
        if (ch === ')') { tokens.push({ kind: 'rparen' }); i++; continue; }
        if (ch === '%') { tokens.push({ kind: 'percent' }); i++; continue; }
        throw new ParseError('Invalid expression');
    }
    return tokens;
}

/** A parsed value, and whether it is a bare percentage (for a ± b%). */
type Operand = { value: number; isPercent: boolean };

function parse(tokens: Token[]): number {
    let pos = 0;
    const peek = () => tokens[pos];

    function expr(): number {
        let left = term().value;
        while (peek()?.kind === 'op' && (peek() as { value: string }).value.match(/[+-]/)) {
            const op = (tokens[pos++] as { value: string }).value;
            const right = term();
            const amount = right.isPercent ? left * right.value : right.value;
            left = op === '+' ? left + amount : left - amount;
        }
        return left;
    }

    function term(): Operand {
        let left = unary();
        while (peek()?.kind === 'op' && (peek() as { value: string }).value.match(/[*/]/)) {
            const op = (tokens[pos++] as { value: string }).value;
            const right = unary().value;
            if (op === '/' && right === 0) throw new ParseError("Can't divide by 0");
            left = { value: op === '*' ? left.value * right : left.value / right, isPercent: false };
        }
        return left;
    }

    function unary(): Operand {
        const t = peek();
        if (t?.kind === 'op' && (t.value === '-' || t.value === '+')) {
            pos++;
            const inner = unary();
            return { value: t.value === '-' ? -inner.value : inner.value, isPercent: inner.isPercent };
        }
        return postfix();
    }

    function postfix(): Operand {
        let value = primary();
        let isPercent = false;
        while (peek()?.kind === 'percent') {
            pos++;
            value /= 100;
            isPercent = true;
        }
        return { value, isPercent };
    }

    function primary(): number {
        const t = tokens[pos++];
        if (!t) throw new ParseError('Incomplete expression');
        if (t.kind === 'num') return t.value;
        if (t.kind === 'lparen') {
            const v = expr();
            // Missing ")" at the very end is closed implicitly.
            if (peek()?.kind === 'rparen') pos++;
            else if (pos < tokens.length) throw new ParseError('Invalid expression');
            return v;
        }
        throw new ParseError(t.kind === 'rparen' ? 'Invalid expression' : 'Incomplete expression');
    }

    const result = expr();
    if (pos < tokens.length) throw new ParseError('Invalid expression');
    return result;
}

/** Drop floating-point noise: 0.1 + 0.2 → 0.3, 1.1 × 3 → 3.3. */
export function cleanNumber(n: number): number {
    if (n === 0) return 0; // also turns -0 into 0
    if (!Number.isFinite(n)) return n;
    return Number.parseFloat(n.toPrecision(15));
}

export function evaluateExpression(input: string): EvalResult {
    try {
        const tokens = tokenize(input);
        if (tokens.length === 0) return { ok: false, error: 'Enter a calculation' };
        const value = parse(tokens);
        if (!Number.isFinite(value)) return { ok: false, error: 'Number too large' };
        return { ok: true, value: cleanNumber(value) };
    } catch (e) {
        return { ok: false, error: e instanceof ParseError ? e.message : 'Invalid expression' };
    }
}

/** True when the expression contains an operator or %, i.e. isn't just a number. */
export function hasOperation(input: string): boolean {
    return /[+\-−×÷*/%()]/.test(input.replace(/^[−-]/, '').replace(/e[+-]/gi, ''));
}

/** "1234567.5" → "1,234,567.5"; huge or tiny values use scientific notation. */
export function formatResult(n: number): string {
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toExponential(6).replace(/\.?0+e/, 'e');
    const [int, frac] = String(cleanNumber(abs)).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${n < 0 ? '−' : ''}${grouped}${frac ? '.' + frac : ''}`;
}

/** Group digits in every number of an expression, keeping what was typed: "1234.50+7" → "1,234.50+7". */
export function formatExpression(input: string): string {
    return input.replace(/\d+(\.\d*)?/g, (m) => {
        const [int, frac] = m.split('.');
        const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return frac === undefined ? grouped : `${grouped}.${frac}`;
    });
}
