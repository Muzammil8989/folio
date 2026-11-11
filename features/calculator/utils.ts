import { toISODateString } from '@/lib/utils/date';

/**
 * History timestamps are saved as ISO strings; rows written by the column
 * default are SQLite's UTC "YYYY-MM-DD HH:MM:SS".
 */
export function parseTimestamp(value: string): Date {
    if (value.includes('T')) return new Date(value);
    return new Date(value.replace(' ', 'T') + 'Z');
}

/** "Today", "Yesterday", or e.g. "Mon, 9 Nov" (with the year when it isn't this year). */
export function historyDayLabel(date: Date, now: Date = new Date()): string {
    const key = toISODateString(date);
    if (key === toISODateString(now)) return 'Today';
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (key === toISODateString(yesterday)) return 'Yesterday';
    return date.toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    });
}

export function formatTime(date: Date): string {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Group newest-first entries into day sections, keeping their order. */
export function groupByDay<T extends { created_at: string }>(
    entries: T[],
    now: Date = new Date(),
): { label: string; items: T[] }[] {
    const groups: { label: string; items: T[] }[] = [];
    for (const entry of entries) {
        const label = historyDayLabel(parseTimestamp(entry.created_at), now);
        const last = groups[groups.length - 1];
        if (last && last.label === label) last.items.push(entry);
        else groups.push({ label, items: [entry] });
    }
    return groups;
}

/** Spoken / written form of a whole-number result, or null when it isn't one. */
export function resultInWords(value: number | null, toWords: (n: number) => string): string | null {
    if (value == null || !Number.isInteger(value)) return null;
    const abs = Math.abs(value);
    if (abs < 1 || abs >= 1e12) return null;
    return (value < 0 ? 'Minus ' : '') + toWords(abs);
}
