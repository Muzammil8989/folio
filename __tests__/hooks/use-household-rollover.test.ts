import { renderHook, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/db/db-client', () => ({
    getDb: jest.fn(),
    isDbReady: jest.fn(() => true),
}));

jest.mock('@/lib/db/queries', () => ({
    getHouseholdConfig: jest.fn(),
    getHouseholdExpenses: jest.fn(),
    rollOverHouseholdPeriod: jest.fn(),
}));

import { useHousehold } from '@/features/household/hooks/use-household';
import {
    getHouseholdConfig,
    getHouseholdExpenses,
    rollOverHouseholdPeriod,
} from '@/lib/db/queries';

const mockGetConfig = getHouseholdConfig as jest.Mock;
const mockGetExpenses = getHouseholdExpenses as jest.Mock;
// Archive + advance happen together in one DB transaction; the month's
// expenses are kept (see __tests__/integration/household-months.test.ts).
const mockRollOver = rollOverHouseholdPeriod as jest.Mock;

const ORIGINAL_DATE = global.Date;

function freezeDate(iso: string) {
    const fixed = new ORIGINAL_DATE(iso);
    class FrozenDate extends ORIGINAL_DATE {
        constructor(...args: unknown[]) {
            if (args.length === 0) {
                super(fixed.getTime());
            } else {
                super(...(args as [number, number, number]));
            }
        }
        static now() {
            return fixed.getTime();
        }
    }
    // @ts-expect-error replacing global
    global.Date = FrozenDate;
}

function restoreDate() {
    global.Date = ORIGINAL_DATE;
}

function makeConfig(
    period_start_date: string,
    period: 'monthly' | 'weekly' | 'yearly' = 'monthly',
    anchorDay?: number,
) {
    return {
        id: 1,
        income_amount: 1000,
        period,
        period_start_date,
        anchor_day: anchorDay ?? parseInt(period_start_date.slice(8, 10), 10),
        income_confirmed: true,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    mockRollOver.mockResolvedValue(undefined);
});

afterEach(() => {
    restoreDate();
});

describe('useHousehold — auto-archive rollover', () => {
    it('does NOT archive when current cycle is still active', async () => {
        freezeDate('2026-06-25T12:00:00.000Z');
        mockGetConfig.mockResolvedValue(makeConfig('2026-06-18', 'monthly'));
        mockGetExpenses.mockResolvedValue([{ id: 1, amount: 100, date: '2026-06-20' }]);

        const { result } = renderHook(() => useHousehold());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockRollOver).not.toHaveBeenCalled();
        expect(result.current.incomeConfirmed).toBe(true);
        expect(result.current.summary).toEqual({ income: 1000, spent: 100, remaining: 900 });
        expect(result.current.periodRange.start).toBe('2026-06-18');
        expect(result.current.periodRange.end).toBe('2026-07-17');
    });

    it("archives a finished month and rolls forward, asking for the new month's income", async () => {
        // "Today" is well past the cycle end (Jun 18 → Jul 17). User reopens app on Jul 20.
        freezeDate('2026-07-20T12:00:00.000Z');
        mockGetConfig.mockResolvedValue(makeConfig('2026-06-18', 'monthly'));
        // Only the current cycle (Jul 18 – Aug 17) is loaded; the elapsed one is totalled in SQL.
        mockGetExpenses.mockResolvedValueOnce([]);

        const { result } = renderHook(() => useHousehold());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockRollOver).toHaveBeenCalledTimes(1);
        expect(mockRollOver).toHaveBeenCalledWith({
            period: 'monthly',
            start_date: '2026-06-18',
            end_date: '2026-07-17',
            income_amount: 1000,
            next_start_date: '2026-07-18',
        });
        expect(mockGetExpenses).toHaveBeenCalledTimes(1);
        expect(mockGetExpenses).toHaveBeenCalledWith('2026-07-18', '2026-08-17');

        // After rollover the visible period is the new one
        expect(result.current.periodRange.start).toBe('2026-07-18');
        expect(result.current.periodRange.end).toBe('2026-08-17');
        expect(result.current.summary).toEqual({ income: 1000, spent: 0, remaining: 1000 });
        // Last month's income is only a suggestion for the new month.
        expect(result.current.incomeConfirmed).toBe(false);
    });

    it('archives every skipped cycle when the user was away for months', async () => {
        // Start: Mar 18, today: Jun 20 → Mar/Apr/May should all roll, Jun 18 → Jul 17 becomes active.
        freezeDate('2026-06-20T12:00:00.000Z');
        mockGetConfig.mockResolvedValue(makeConfig('2026-03-18', 'monthly'));
        mockGetExpenses.mockResolvedValueOnce([{ id: 3, amount: 75, date: '2026-06-19' }]);  // current Jun cycle

        const { result } = renderHook(() => useHousehold());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockRollOver).toHaveBeenCalledTimes(3);
        expect(mockRollOver.mock.calls.map(c => c[0].start_date)).toEqual([
            '2026-03-18',
            '2026-04-18',
            '2026-05-18',
        ]);
        expect(mockRollOver.mock.calls.at(-1)?.[0].next_start_date).toBe('2026-06-18');
        expect(result.current.periodRange.start).toBe('2026-06-18');
        expect(result.current.periodRange.end).toBe('2026-07-17');
        expect(result.current.summary.spent).toBe(75);
    });

    it('rolls a 31st-anchored budget month-by-month without skipping February', async () => {
        // Start Jan 31, today mid-April. Jan and Feb cycles must both archive (Feb is NOT skipped),
        // and the anchor recovers the 31st each long month: Jan31→Feb27, Feb28→Mar30, active Mar31→Apr29.
        freezeDate('2026-04-15T12:00:00.000Z');
        mockGetConfig.mockResolvedValue(makeConfig('2026-01-31', 'monthly', 31));
        mockGetExpenses.mockResolvedValueOnce([]); // active Mar 31 – Apr 29

        const { result } = renderHook(() => useHousehold());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockRollOver).toHaveBeenCalledTimes(2);
        expect(mockRollOver.mock.calls.map(c => [c[0].start_date, c[0].end_date])).toEqual([
            ['2026-01-31', '2026-02-27'],
            ['2026-02-28', '2026-03-30'],
        ]);
        expect(mockRollOver.mock.calls.at(-1)?.[0].next_start_date).toBe('2026-03-31');
        expect(result.current.periodRange.start).toBe('2026-03-31');
        expect(result.current.periodRange.end).toBe('2026-04-29');
    });

    it('returns empty state when no config exists', async () => {
        mockGetConfig.mockResolvedValue(null);

        const { result } = renderHook(() => useHousehold());

        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.config).toBeNull();
        expect(result.current.expenses).toEqual([]);
        expect(result.current.summary).toEqual({ income: 0, spent: 0, remaining: 0 });
        expect(mockRollOver).not.toHaveBeenCalled();
    });
});
