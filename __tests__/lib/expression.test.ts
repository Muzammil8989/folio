import {
    cleanNumber,
    evaluateExpression,
    formatExpression,
    formatResult,
    hasOperation,
} from '@/lib/utils/expression';

const value = (s: string) => {
    const r = evaluateExpression(s);
    if (!r.ok) throw new Error(`expected ${s} to evaluate, got: ${r.error}`);
    return r.value;
};
const error = (s: string) => {
    const r = evaluateExpression(s);
    if (r.ok) throw new Error(`expected ${s} to fail, got ${r.value}`);
    return r.error;
};

describe('evaluateExpression', () => {
    it('respects operator precedence and brackets', () => {
        expect(value('2+3×4')).toBe(14);
        expect(value('(2+3)×4')).toBe(20);
        expect(value('10−4−3')).toBe(3);
        expect(value('100÷10÷2')).toBe(5);
        expect(value('2×(3+(4−1))')).toBe(12);
    });

    it('accepts ASCII operators and grouped numbers', () => {
        expect(value('6*7')).toBe(42);
        expect(value('9/3-1')).toBe(2);
        expect(value('1,200×3+450')).toBe(4050);
    });

    it('handles unary minus', () => {
        expect(value('−5+3')).toBe(-2);
        expect(value('5×−2')).toBe(-10);
        expect(value('−(2+3)')).toBe(-5);
        expect(value('−−4')).toBe(4);
    });

    it('treats percent like a phone calculator', () => {
        expect(value('50%')).toBe(0.5);
        expect(value('200×10%')).toBe(20);
        expect(value('200+10%')).toBe(220);
        expect(value('200−10%')).toBe(180);
        expect(value('200÷10%')).toBe(2000);
        expect(value('(100+100)+50%')).toBe(300);
    });

    it('removes floating-point noise', () => {
        expect(value('0.1+0.2')).toBe(0.3);
        expect(value('1.1×3')).toBe(3.3);
        expect(value('1÷3')).toBeCloseTo(0.333333333333, 12);
    });

    it('closes brackets left open at the end', () => {
        expect(value('2×(3+4')).toBe(14);
        expect(value('((1+1')).toBe(2);
    });

    it('accepts decimals with a trailing or leading point', () => {
        expect(value('5.+1')).toBe(6);
        expect(value('.5×4')).toBe(2);
    });

    it('reports errors instead of throwing', () => {
        expect(error('5÷0')).toBe("Can't divide by 0");
        expect(error('5÷(2−2)')).toBe("Can't divide by 0");
        expect(error('')).toBe('Enter a calculation');
        expect(error('5+')).toBe('Incomplete expression');
        expect(error('5)')).toBe('Invalid expression');
        expect(error('2(3)')).toBe('Invalid expression');
        expect(error('abc')).toBe('Invalid expression');
        expect(error('9'.repeat(400) + '×9')).toBe('Number too large');
    });
});

describe('formatting', () => {
    it('formats results with grouping and a real minus sign', () => {
        expect(formatResult(1234567.5)).toBe('1,234,567.5');
        expect(formatResult(-42)).toBe('−42');
        expect(formatResult(0)).toBe('0');
        expect(formatResult(0.30000000000000004)).toBe('0.3');
        expect(formatResult(1e21)).toBe('1e+21');
    });

    it('groups numbers inside an expression and keeps what was typed', () => {
        expect(formatExpression('1234.50+7')).toBe('1,234.50+7');
        expect(formatExpression('1000000×2.')).toBe('1,000,000×2.');
        expect(formatExpression('(12345')).toBe('(12,345');
    });

    it('knows when an expression is just a number', () => {
        expect(hasOperation('1234')).toBe(false);
        expect(hasOperation('−12')).toBe(false);
        expect(hasOperation('1e+21')).toBe(false);
        expect(hasOperation('1+2')).toBe(true);
        expect(hasOperation('50%')).toBe(true);
    });

    it('cleanNumber turns -0 into 0', () => {
        expect(Object.is(cleanNumber(-0), 0)).toBe(true);
    });
});
