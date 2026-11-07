import { isDbReady } from '@/lib/db/db-client';
import {
    getHouseholdConfig,
    getHouseholdExpenses,
    rollOverHouseholdPeriod,
    type HouseholdConfig,
    type HouseholdExpenseWithCategory,
} from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface HouseholdSummary {
    income: number;
    spent: number;
    remaining: number;
}

export interface HouseholdPeriodRange {
    start: string;
    end: string;
    label: string;
}

function pad(n: number) {
    return String(n).padStart(2, '0');
}

function toISO(d: Date) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "Jun 18 – Jul 17, 2026" for a period's inclusive "YYYY-MM-DD" bounds. */
export function formatPeriodRange(startISO: string, endISO: string): string {
    const [, sm, sd] = startISO.split('-').map(Number);
    const [ey, em, ed] = endISO.split('-').map(Number);
    return `${MONTH_NAMES[sm - 1]} ${sd} – ${MONTH_NAMES[em - 1]} ${ed}, ${ey}`;
}

/** Parse an ISO-ish "YYYY-MM-DD" string as a local-time Date (no UTC shift) */
function parseLocalDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/** Build a local Date for (year, monthIndex) using `day`, clamped to that month's last day.
 *  e.g. clampToMonth(2026, 1 /* Feb *​/, 31) → Feb 28, 2026 — never overflows into March. */
function clampToMonth(year: number, monthIndex: number, day: number): Date {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return new Date(year, monthIndex, Math.min(day, lastDay));
}

/** Step a date forward by one full cycle (monthly = +1 month, yearly = +1 year, weekly = +7 days).
 *  `anchorDay` is the original day-of-month the cycle should land on; when the target month is
 *  shorter it is clamped to the last day, but the anchor is preserved so it recovers next month
 *  (31 → Feb 28 → Mar 31). Falls back to the start's own day when not provided. */
export function advancePeriodStart(
    startISO: string,
    period: HouseholdConfig['period'],
    anchorDay?: number,
): string {
    const start = parseLocalDate(startISO);
    const anchor = anchorDay ?? start.getDate();
    if (period === 'monthly') {
        return toISO(clampToMonth(start.getFullYear(), start.getMonth() + 1, anchor));
    }
    if (period === 'yearly') {
        return toISO(clampToMonth(start.getFullYear() + 1, start.getMonth(), anchor));
    }
    // weekly — anchor does not apply
    const next = new Date(start);
    next.setDate(start.getDate() + 7);
    return toISO(next);
}

/** Compute the period end date (inclusive) and human-readable label from config.
 *  End = (next cycle start) − 1 day, so the cycle is a full month/week/year from the chosen day.
 */
export function computePeriodRange(config: HouseholdConfig): HouseholdPeriodRange {
    const start = parseLocalDate(config.period_start_date);
    const nextStartISO = advancePeriodStart(config.period_start_date, config.period, config.anchor_day);
    const nextStart = parseLocalDate(nextStartISO);
    const end = new Date(nextStart);
    end.setDate(nextStart.getDate() - 1);

    const startStr = toISO(start);
    const endStr = toISO(end);

    const label =
        `${MONTH_NAMES[start.getMonth()]} ${start.getDate()} – ` +
        `${MONTH_NAMES[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;

    return { start: startStr, end: endStr, label };
}

export function useHousehold() {
    const [config, setConfig] = useState<HouseholdConfig | null>(null);
    const [expenses, setExpenses] = useState<HouseholdExpenseWithCategory[]>([]);
    const [summary, setSummary] = useState<HouseholdSummary>({ income: 0, spent: 0, remaining: 0 });
    const [periodRange, setPeriodRange] = useState<HouseholdPeriodRange>({ start: '', end: '', label: '' });
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const refresh = useCallback(async () => {
        if (!isDbReady()) return;
        setLoading(true);
        try {
            let cfg = await getHouseholdConfig();
            if (!mountedRef.current) return;

            if (!cfg) {
                setConfig(null);
                setExpenses([]);
                setSummary({ income: 0, spent: 0, remaining: 0 });
                setPeriodRange({ start: '', end: '', label: '' });
                return;
            }

            // Roll forward any elapsed months: archive each one to history (its
            // expenses stay, listed under that month) and advance period_start_date.
            // Each month (total in SQL, archive, advance) is one DB transaction.
            // Bounded loop so an unlucky clock skew can never spin forever.
            const todayISO = toISO(new Date());
            for (let i = 0; i < 240; i++) {
                const range = computePeriodRange(cfg);
                if (range.end >= todayISO) break;

                const nextStart = advancePeriodStart(cfg.period_start_date, cfg.period, cfg.anchor_day);
                await rollOverHouseholdPeriod({
                    period: cfg.period,
                    start_date: range.start,
                    end_date: range.end,
                    income_amount: cfg.income_amount,
                    next_start_date: nextStart,
                });
                // The new month starts with last month's income as a suggestion.
                cfg = { ...cfg, period_start_date: nextStart, income_confirmed: false };
            }

            const range = computePeriodRange(cfg);
            const exps = await getHouseholdExpenses(range.start, range.end);
            if (!mountedRef.current) return;

            const spent = exps.reduce((acc, e) => acc + e.amount, 0);
            setConfig(cfg);
            setExpenses(exps);
            setPeriodRange(range);
            setSummary({
                income: cfg.income_amount,
                spent,
                remaining: cfg.income_amount - spent,
            });
        } catch (e) {
            logger.error('useHousehold: failed to refresh', e);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // False right after a new month starts: its income is last month's amount
    // carried over until the user keeps or changes it.
    const incomeConfirmed = config?.income_confirmed ?? true;

    return { config, expenses, summary, periodRange, loading, refresh, incomeConfirmed };
}
