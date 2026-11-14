/**
 * Date Utility Functions
 * Single source of truth for all date formatting and manipulation.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Format a Date object to YYYY-MM-DD string (no timezone shift) */
export function toISODateString(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Alias kept for compatibility */
export const getISODateString = toISODateString;

/** Get today's date as YYYY-MM-DD */
export function todayString(): string {
    return toISODateString(new Date());
}

/**
 * Parse a date string as a LOCAL date.
 * `new Date('2025-03-10')` is parsed as UTC midnight, which is the previous
 * day for anyone west of UTC. Date-only strings must be built from parts.
 * Strings with a time component are passed through to the Date constructor.
 */
export function parseLocalDate(dateStr: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(dateStr);
}

/** Whole calendar days from `from` to `to` (DST-safe; ignores time of day). */
export function diffCalendarDays(from: Date, to: Date): number {
    const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
    const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((b - a) / 86_400_000);
}

/**
 * Add months, clamping to the last day of the target month
 * (Jan 31 + 1 month = Feb 28/29, not Mar 3).
 * `anchorDay` keeps the original day for later steps (Feb 28 -> Mar 31).
 */
export function addMonthsClamped(date: Date, months: number, anchorDay: number = date.getDate()): Date {
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(anchorDay, lastDay));
    return target;
}

/**
 * Monday of the week containing `date` (local time). The whole app uses
 * Monday-start weeks: Budgets, budget alerts and the Activity "Week" filter
 * previously disagreed (Sunday vs Monday).
 */
export function startOfWeek(date: Date = new Date()): Date {
    const daysFromMonday = (date.getDay() + 6) % 7; // Sun→6, Mon→0
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysFromMonday);
}

/**
 * Full date for chart tooltips, with the weekday: "Wed, 5 Nov 2026"
 * (order follows the device locale). Accepts YYYY-MM-DD or a Date.
 */
export function formatTooltipDate(date: string | Date): string {
    const d = typeof date === 'string' ? parseLocalDate(date) : date;
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Format a YYYY-MM-DD string to human-readable "Jan 1, 2025" */
export function formatDateDisplay(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[m - 1]} ${d}, ${y}`;
}

/** Format a date string to a readable locale-aware format (e.g., "Jan 1, 2025") */
export function formatDate(dateString: string, locale: string = 'en-US'): string {
    const date = parseLocalDate(dateString);
    return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Format a date to a short format (e.g., "Jan 1") */
export function formatDateShort(dateString: string, locale: string = 'en-US'): string {
    const date = parseLocalDate(dateString);
    return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** Format a date to show time (e.g., "3:45 PM") */
export function formatTime(dateString: string, locale: string = 'en-US'): string {
    const date = new Date(dateString);
    return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** Format a date to show both date and time */
export function formatDateTime(dateString: string, locale: string = 'en-US'): string {
    const date = new Date(dateString);
    return date.toLocaleString(locale, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
    });
}

/** Get relative time description (e.g., "2 days ago", "in 3 hours") */
export function getRelativeTime(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMs = now.getTime() - date.getTime();
    const diffInSeconds = Math.floor(diffInMs / 1000);
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    const diffInHours = Math.floor(diffInMinutes / 60);
    const diffInDays = Math.floor(diffInHours / 24);

    if (diffInDays > 0) return diffInDays === 1 ? '1 day ago' : `${diffInDays} days ago`;
    if (diffInHours > 0) return diffInHours === 1 ? '1 hour ago' : `${diffInHours} hours ago`;
    if (diffInMinutes > 0) return diffInMinutes === 1 ? '1 minute ago' : `${diffInMinutes} minutes ago`;
    return 'Just now';
}

/** Get start of day */
export function getStartOfDay(date: Date = new Date()): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

/** Get end of day */
export function getEndOfDay(date: Date = new Date()): Date {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
}

/** Get start of month */
export function getStartOfMonth(date: Date = new Date()): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Get end of month */
export function getEndOfMonth(date: Date = new Date()): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

/** Check if a date string is today */
export function isToday(dateString: string): boolean {
    return parseLocalDate(dateString).toDateString() === new Date().toDateString();
}

/** Check if a date string is in the current month */
export function isCurrentMonth(dateString: string): boolean {
    const date = parseLocalDate(dateString);
    const today = new Date();
    return date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
}

/** Get date range for a given budget/recurring period relative to now */
export function getPeriodDateRange(period: string): { startDate: string; endDate: string } {
    const now = new Date();

    if (period === 'daily') {
        const today = toISODateString(now);
        return { startDate: today, endDate: today };
    } else if (period === 'weekly') {
        const start = startOfWeek(now);
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
        return { startDate: toISODateString(start), endDate: toISODateString(end) };
    } else if (period === 'monthly') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return { startDate: toISODateString(start), endDate: toISODateString(end) };
    } else {
        const start = new Date(now.getFullYear(), 0, 1);
        const end = new Date(now.getFullYear(), 11, 31);
        return { startDate: toISODateString(start), endDate: toISODateString(end) };
    }
}
