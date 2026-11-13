import { buildInsights, buildStandfirst, pctChange, previousRange, resolveRange } from '@/features/reports/utils';

const NOW = new Date(2026, 10, 11); // 11 Nov 2026
const fmt = (n: number) => `$${n.toFixed(2)}`;

describe('resolveRange', () => {
    it('caps presets at today and counts months and days', () => {
        expect(resolveRange('month', null, NOW)).toEqual({ start: '2026-11-01', end: '2026-11-11', months: 1, days: 11 });
        expect(resolveRange('3months', null, NOW)).toMatchObject({ start: '2026-09-01', end: '2026-11-11', months: 3 });
        expect(resolveRange('year', null, NOW)).toMatchObject({ start: '2026-01-01', months: 11 });
    });

    it('accepts custom dates in either order and caps them at today', () => {
        expect(resolveRange('custom', { start: '2026-10-20', end: '2026-10-05' }, NOW))
            .toEqual({ start: '2026-10-05', end: '2026-10-20', months: 1, days: 16 });
        expect(resolveRange('custom', { start: '2026-11-05', end: '2026-12-31' }, NOW)).toMatchObject({ end: '2026-11-11' });
        expect(resolveRange('custom', { start: '2026-12-01', end: '2026-12-31' }, NOW)).toMatchObject({ start: '2026-11-11', end: '2026-11-11', days: 1 });
    });
});

describe('previousRange', () => {
    it('compares presets with the same days one period earlier', () => {
        expect(previousRange('month', resolveRange('month', null, NOW))).toEqual({ start: '2026-10-01', end: '2026-10-11' });
        expect(previousRange('3months', resolveRange('3months', null, NOW))).toEqual({ start: '2026-06-01', end: '2026-08-11' });
        expect(previousRange('year', resolveRange('year', null, NOW))).toEqual({ start: '2025-01-01', end: '2025-11-11' });
    });

    it('clamps to the end of a shorter month', () => {
        const march = resolveRange('month', null, new Date(2026, 2, 31));
        expect(previousRange('month', march)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    });

    it('uses the equally long stretch before a custom range', () => {
        const range = resolveRange('custom', { start: '2026-10-11', end: '2026-10-20' }, NOW);
        expect(previousRange('custom', range)).toEqual({ start: '2026-10-01', end: '2026-10-10' });
    });
});

describe('pctChange', () => {
    it('is null without a base to compare with', () => {
        expect(pctChange(150, 100)).toBe(50);
        expect(pctChange(50, 100)).toBe(-50);
        expect(pctChange(10, 0)).toBeNull();
    });
});

describe('buildInsights', () => {
    const base = {
        period: 'month' as const,
        range: resolveRange('month', null, NOW),
        expense: 1200,
        prevExpense: 1000,
        categories: [
            { categoryId: 1, categoryName: 'Food', total: 700 },
            { categoryId: 2, categoryName: 'Rent', total: 500 },
        ],
        prevCategories: [
            { categoryId: 1, categoryName: 'Food', total: 400 },
            { categoryId: 2, categoryName: 'Rent', total: 500 },
            { categoryId: 3, categoryName: 'Fuel', total: 100 },
        ],
        weekdays: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, days: 2, average: weekday === 6 ? 300 : 50 })),
        format: fmt,
        now: NOW,
    };

    it('reports the change, the category that moved most, the projection and the busiest weekday', () => {
        const lines = buildInsights(base);
        expect(lines.map(l => l.key)).toEqual(['spend-change', 'category-move', 'projection', 'weekday']);
        expect(lines[0]).toMatchObject({ tone: 'bad', text: expect.stringContaining('up 20%') });
        expect(lines[1].text).toContain('Food moved the most: up 75% (+$300.00)');
        expect(lines[2].text).toContain('$3,272.73'.replace(',', '')); // 1200 / 11 × 30
        expect(lines[3].text).toContain('Saturdays');
    });

    it('notices a category that stopped', () => {
        const lines = buildInsights({
            ...base,
            expense: 900,
            categories: [{ categoryId: 1, categoryName: 'Food', total: 900 }],
            prevCategories: [{ categoryId: 1, categoryName: 'Food', total: 900 }, { categoryId: 4, categoryName: 'Travel', total: 600 }],
            prevExpense: 1500,
        });
        expect(lines.find(l => l.key === 'category-move')?.text).toContain('Travel moved the most: down 100%');
    });

    it('falls back to the daily average when there is little to say', () => {
        const lines = buildInsights({ ...base, period: '6months', range: resolveRange('6months', null, NOW), prevExpense: 0, prevCategories: [], weekdays: [] });
        expect(lines.map(l => l.key)).toEqual(['daily-average']);
    });

    it('says nothing for an empty period', () => {
        expect(buildInsights({ ...base, expense: 0, prevExpense: 0, categories: [], prevCategories: [], weekdays: [] })).toEqual([]);
    });
});

describe('buildStandfirst', () => {
    it('describes custom ranges', () => {
        expect(buildStandfirst({ period: 'custom', income: 0, expense: 0, format: fmt })).toBe('Nothing recorded in these dates yet.');
    });
});
