/**
 * Currency & Amount Utility Functions
 * Single source of truth for all currency formatting and number helpers.
 */

// ── Number-to-words helpers ──────────────────────────────────────────────────

const ONES = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function chunk(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
    return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + chunk(n % 100) : '');
}

/** Convert a number to English words (e.g., 1234 → "One Thousand Two Hundred Thirty Four") */
export function numberToWords(n: number): string {
    const int = Math.floor(Math.abs(n));
    if (int === 0) return 'Zero';
    if (int >= 1_000_000_000) {
        const b = Math.floor(int / 1_000_000_000);
        const rem = int % 1_000_000_000;
        return chunk(b) + ' Billion' + (rem ? ' ' + numberToWords(rem) : '');
    }
    if (int >= 1_000_000) {
        const m = Math.floor(int / 1_000_000);
        const rem = int % 1_000_000;
        return chunk(m) + ' Million' + (rem ? ' ' + numberToWords(rem) : '');
    }
    if (int >= 1_000) {
        const k = Math.floor(int / 1_000);
        const rem = int % 1_000;
        return chunk(k) + ' Thousand' + (rem ? ' ' + numberToWords(rem) : '');
    }
    return chunk(int);
}

/** Well-formed thousands grouping for each separator, e.g. 1,234,567 or 1.234.567. */
const GROUPED: Record<',' | '.', RegExp> = {
    ',': /^\d{1,3}(,\d{3})+$/,
    '.': /^\d{1,3}(\.\d{3})+$/,
};

/**
 * Parse what the user typed or pasted into an amount field.
 *
 *   "12.5" / "12,5"          → 12.5      (dot or comma decimal mark)
 *   "1,234" / "1,234,567"    → 1234 / 1234567   (grouped thousands)
 *   "1,234.56" / "1.234,56"  → 1234.56   (both present: the last is the decimal)
 *   "10.999"                 → 11        (rounded to whole cents)
 *
 * Grouping must be well-formed, so "1,2,3" is rejected rather than guessed.
 * Returns NaN for anything that isn't a number. A leading minus is allowed
 * (e.g. a credit card's opening balance); amount forms reject values <= 0.
 * `decimals` sets the rounding: 2 for money, more for share quantities.
 */
export function parseAmount(input: string | null | undefined, decimals = 2): number {
    const s = (input ?? '').replace(/\s/g, '');
    const m = s.match(/^(-?)([\d.,]+)$/);
    if (!m || !/\d/.test(m[2])) return NaN;
    const sign = m[1] ? -1 : 1;
    const body = m[2];

    const lastDot = body.lastIndexOf('.');
    const lastComma = body.lastIndexOf(',');
    let intPart = body;
    let fracPart = '';

    if (lastDot >= 0 && lastComma >= 0) {
        // Both marks: the later one is the decimal, the other groups thousands.
        const decAt = Math.max(lastDot, lastComma);
        const groupMark = lastDot > lastComma ? ',' : '.';
        intPart = body.slice(0, decAt);
        fracPart = body.slice(decAt + 1);
        if (!GROUPED[groupMark].test(intPart) && !/^\d+$/.test(intPart)) return NaN;
        intPart = intPart.split(groupMark).join('');
    } else if (lastDot >= 0 || lastComma >= 0) {
        const mark = lastComma >= 0 ? ',' : '.';
        const count = body.split(mark).length - 1;
        // "1,234" and "1,234,567" are thousands; so is "1.234.567" (repeated dots).
        // A single dot stays a decimal point ("1.234" → 1.23 after rounding).
        // Exception: with extra precision (share quantities, prices) "0,125"
        // can only be a decimal, as no grouped number starts with 0.
        const leadingZeroDecimal = decimals > 2 && count === 1 && /^0[.,]/.test(body);
        if (!leadingZeroDecimal && GROUPED[mark].test(body) && (mark === ',' || count > 1)) {
            intPart = body.split(mark).join('');
        } else if (count === 1) {
            [intPart, fracPart] = body.split(mark);
        } else {
            return NaN;
        }
    }

    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return NaN;
    const value = Number(`${intPart || '0'}.${fracPart || '0'}`);
    const scale = Math.pow(10, decimals);
    return (sign * Math.round(value * scale)) / scale;
}

/** Format a raw number string with locale commas (e.g., "1234.56" → "1,234.56") */
export function formatWithCommas(value: string): string {
    const num = parseAmount(value);
    if (isNaN(num) || num <= 0) return '';
    return num.toLocaleString('en-US');
}

// ── Intl-based formatters ────────────────────────────────────────────────────

/** Format a number as a full currency string (e.g., 1234.5 → "$1,234.50") */
export function formatCurrency(
    amount: number,
    currencyCode: string = 'USD',
    locale: string = 'en-US'
): string {
    try {
        return new Intl.NumberFormat(locale, {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch {
        // An unknown/garbled code (e.g. from a damaged backup) must not crash
        // every screen that shows money: show the number with the code instead.
        const n = Math.abs(amount).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `${amount < 0 ? '-' : ''}${n} ${String(currencyCode).slice(0, 5)}`;
    }
}

/** Format a number as compact currency (e.g., 1500000 → "$1.5M") */
export function formatCurrencyCompact(
    amount: number,
    currencyCode: string = 'USD',
    locale: string = 'en-US'
): string {
    const abs = Math.abs(amount);
    if (abs < 1_000) return formatCurrency(amount, currencyCode, locale);
    const sign = amount < 0 ? '-' : '';
    const symbol = getCurrencySymbol(currencyCode, locale);
    // One decimal at most, dropped when it's .0; round first so 999,999 → 1M, not 1000K.
    const short = (n: number) => {
        const r = Math.round(n * 10) / 10;
        return Number.isInteger(r) ? String(r) : r.toFixed(1);
    };
    if (abs >= 999_950) return `${sign}${symbol}${short(abs / 1_000_000)}M`;
    return `${sign}${symbol}${short(abs / 1_000)}K`;
}

/** Parse a currency string back to a number */
export function parseCurrency(currencyString: string): number {
    return parseFloat(currencyString.replace(/[^0-9.-]/g, '')) || 0;
}

/** Get the currency symbol from a currency code (e.g., "USD" → "$") */
export function getCurrencySymbol(currencyCode: string, locale: string = 'en-US'): string {
    try {
        return (0).toLocaleString(locale, {
            style: 'currency',
            currency: currencyCode,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).replace(/\d/g, '').trim();
    } catch {
        return String(currencyCode).slice(0, 5); // unknown code: don't crash charts/exports
    }
}

/** Format a value as a percentage string (e.g., 0.75 → "75.0%") */
export function formatPercentage(value: number, decimals: number = 1): string {
    return `${value.toFixed(decimals)}%`;
}

/** Calculate what percentage `value` is of `total` */
export function calculatePercentage(value: number, total: number): number {
    if (total === 0) return 0;
    return (value / total) * 100;
}

/** Round a number to 2 decimal places */
export function roundToTwo(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Format a large number with locale thousands separators */
export function formatNumber(value: number, locale: string = 'en-US'): string {
    return new Intl.NumberFormat(locale).format(value);
}
