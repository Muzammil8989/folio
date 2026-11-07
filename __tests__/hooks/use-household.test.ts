import { advancePeriodStart, computePeriodRange } from '@/features/household/hooks/use-household';
import type { HouseholdConfig } from '@/lib/db/queries';

function cfg(period: 'monthly' | 'weekly' | 'yearly', start: string, anchorDay?: number): HouseholdConfig {
    return {
        id: 1,
        income_amount: 1000,
        period,
        period_start_date: start,
        anchor_day: anchorDay ?? parseInt(start.slice(8, 10), 10),
        income_confirmed: true,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
    };
}

describe('computePeriodRange', () => {
    describe('monthly', () => {
        it('reproduces the reported bug fix: day 18 + monthly = Jun 18 → Jul 17 (not Jun 18 → Jun 30)', () => {
            const r = computePeriodRange(cfg('monthly', '2026-06-18'));
            expect(r.start).toBe('2026-06-18');
            expect(r.end).toBe('2026-07-17');
        });

        it('day 1 + monthly = Jun 1 → Jun 30', () => {
            const r = computePeriodRange(cfg('monthly', '2026-06-01'));
            expect(r.start).toBe('2026-06-01');
            expect(r.end).toBe('2026-06-30');
        });

        it('day 15 + monthly = Mar 15 → Apr 14', () => {
            const r = computePeriodRange(cfg('monthly', '2026-03-15'));
            expect(r.start).toBe('2026-03-15');
            expect(r.end).toBe('2026-04-14');
        });

        it('crosses year boundary: Dec 18 → Jan 17 next year', () => {
            const r = computePeriodRange(cfg('monthly', '2026-12-18'));
            expect(r.start).toBe('2026-12-18');
            expect(r.end).toBe('2027-01-17');
        });

        describe('month-end anchors (no skipped or overflowed months)', () => {
            it('day 31 in Jan → ends the day before the clamped Feb reset (Feb 28), never spilling into March', () => {
                const r = computePeriodRange(cfg('monthly', '2026-01-31'));
                expect(r.start).toBe('2026-01-31');
                expect(r.end).toBe('2026-02-27'); // next reset clamps to Feb 28
            });

            it('day 31 anchored from a clamped Feb 28 start recovers the 31st in March', () => {
                // After Jan 31 rolls over, the stored start is Feb 28 but the anchor is still 31.
                const r = computePeriodRange(cfg('monthly', '2026-02-28', 31));
                expect(r.start).toBe('2026-02-28');
                expect(r.end).toBe('2026-03-30'); // next reset = Mar 31, so cycle ends Mar 30
            });

            it('day 30 in Jan clamps to Feb 28 without overflowing into March', () => {
                const r = computePeriodRange(cfg('monthly', '2026-01-30'));
                expect(r.start).toBe('2026-01-30');
                expect(r.end).toBe('2026-02-27');
            });
        });

        it('builds a human label like "Jun 18 – Jul 17, 2026"', () => {
            const r = computePeriodRange(cfg('monthly', '2026-06-18'));
            expect(r.label).toBe('Jun 18 – Jul 17, 2026');
        });
    });

    describe('weekly', () => {
        it('start + 6 days, inclusive', () => {
            const r = computePeriodRange(cfg('weekly', '2026-06-18'));
            expect(r.start).toBe('2026-06-18');
            expect(r.end).toBe('2026-06-24');
        });

        it('crosses month boundary', () => {
            const r = computePeriodRange(cfg('weekly', '2026-06-28'));
            expect(r.start).toBe('2026-06-28');
            expect(r.end).toBe('2026-07-04');
        });
    });

    describe('yearly', () => {
        it('start → same day next year minus 1', () => {
            const r = computePeriodRange(cfg('yearly', '2026-06-18'));
            expect(r.start).toBe('2026-06-18');
            expect(r.end).toBe('2027-06-17');
        });

        it('leap day Feb 29 clamps to Feb 28 the next (non-leap) year, no overflow to March', () => {
            const r = computePeriodRange(cfg('yearly', '2024-02-29'));
            expect(r.start).toBe('2024-02-29');
            expect(r.end).toBe('2025-02-27'); // next reset clamps to Feb 28, 2025
        });
    });
});

describe('advancePeriodStart', () => {
    it('monthly: +1 month preserving day', () => {
        expect(advancePeriodStart('2026-06-18', 'monthly')).toBe('2026-07-18');
    });

    it('monthly: crosses year boundary', () => {
        expect(advancePeriodStart('2026-12-18', 'monthly')).toBe('2027-01-18');
    });

    it('weekly: +7 days', () => {
        expect(advancePeriodStart('2026-06-18', 'weekly')).toBe('2026-06-25');
    });

    it('yearly: +1 year preserving month+day', () => {
        expect(advancePeriodStart('2026-06-18', 'yearly')).toBe('2027-06-18');
    });

    describe('anchored month-end advancement', () => {
        it('monthly: 31 → Feb clamps to 28 (no March overflow)', () => {
            expect(advancePeriodStart('2026-01-31', 'monthly', 31)).toBe('2026-02-28');
        });

        it('monthly: anchor 31 recovers the 31st from a clamped Feb 28', () => {
            expect(advancePeriodStart('2026-02-28', 'monthly', 31)).toBe('2026-03-31');
        });

        it('monthly: anchor 31 → Apr clamps to 30', () => {
            expect(advancePeriodStart('2026-03-31', 'monthly', 31)).toBe('2026-04-30');
        });

        it('yearly: leap-day anchor 29 clamps to Feb 28 in a non-leap year', () => {
            expect(advancePeriodStart('2024-02-29', 'yearly', 29)).toBe('2025-02-28');
        });

        it('yearly: anchor 29 recovers Feb 29 in the next leap year', () => {
            expect(advancePeriodStart('2027-02-28', 'yearly', 29)).toBe('2028-02-29');
        });
    });
});
