import {
    allocation,
    computePosition,
    effectivePrice,
    formatPct,
    formatPrice,
    formatQuantity,
    formatSigned,
    NEW_TRADE_ID,
    portfolioSeries,
    priceHistory,
    replayTrades,
    sortSummaries,
    summarizeHolding,
    summarizePortfolio,
    unitLabel,
    validateTradeChange,
    type HoldingLike,
    type TradeLike,
} from '@/features/investments/utils';

let nextId = 1;
const buy = (date: string, quantity: number, price: number, fees = 0): TradeLike =>
    ({ id: nextId++, type: 'buy', date, quantity, price, fees, amount: null });
const sell = (date: string, quantity: number, price: number, fees = 0): TradeLike =>
    ({ id: nextId++, type: 'sell', date, quantity, price, fees, amount: null });
const dividend = (date: string, amount: number): TradeLike =>
    ({ id: nextId++, type: 'dividend', date, quantity: null, price: null, fees: 0, amount });

const holding = (over: Partial<HoldingLike> = {}): HoldingLike => ({
    id: 1, name: 'Engro', symbol: 'ENGRO', asset_type: 'stock',
    current_price: null, price_updated_at: null, is_archived: 0, color: null, ...over,
});

describe('average-cost positions', () => {
    it('averages the cost of several buys, fees included', () => {
        const p = computePosition([buy('2026-01-01', 100, 10, 5), buy('2026-02-01', 100, 20, 5)]);
        expect(p.quantity).toBe(200);
        expect(p.costBasis).toBe(3010);
        expect(p.avgCost).toBeCloseTo(15.05);
        expect(p.fees).toBe(10);
        expect(p.totalBought).toBe(3010);
    });

    it('sells at the average cost and books realised P/L after fees', () => {
        const p = computePosition([
            buy('2026-01-01', 100, 10),
            buy('2026-02-01', 100, 20),
            sell('2026-03-01', 50, 25, 10),
        ]);
        // avg 15; 50 sold → proceeds 1250 − 10 = 1240; cost 750 → +490
        expect(p.quantity).toBe(150);
        expect(p.costBasis).toBe(2250);
        expect(p.avgCost).toBe(15);
        expect(p.realized).toBe(490);
        expect(p.totalSold).toBe(1240);
    });

    it('keeps the average unchanged after a partial sell, then rebuys', () => {
        const p = computePosition([
            buy('2026-01-01', 10, 100),
            sell('2026-01-10', 4, 150),
            buy('2026-01-20', 6, 200),
        ]);
        // 6 left at 100 → 600; + 1200 → 1800 / 12
        expect(p.quantity).toBe(12);
        expect(p.avgCost).toBe(150);
        expect(p.realized).toBe(200);
    });

    it('closes the position cleanly despite float dust', () => {
        const p = computePosition([
            buy('2026-01-01', 0.1, 30000),
            buy('2026-01-02', 0.2, 31000),
            sell('2026-01-03', 0.3, 32000),
        ]);
        expect(p.quantity).toBe(0);
        expect(p.costBasis).toBe(0);
        expect(p.realized).toBeCloseTo(0.3 * 32000 - (3000 + 6200), 6);
    });

    it('counts dividends separately and treats a zero-price buy as bonus shares', () => {
        const p = computePosition([buy('2026-01-01', 100, 10), buy('2026-02-01', 10, 0), dividend('2026-03-01', 75)]);
        expect(p.quantity).toBe(110);
        expect(p.costBasis).toBe(1000);
        expect(p.dividends).toBe(75);
    });

    it('replays by date, not by entry order', () => {
        const late = buy('2026-03-01', 10, 30);
        const early = buy('2026-01-01', 10, 10);
        const s = sell('2026-02-01', 10, 20);
        const p = computePosition([late, s, early]);
        expect(p.realized).toBe(100); // sold the Jan shares at cost 10
        expect(p.avgCost).toBe(30);
    });
});

describe('sell validation', () => {
    const trades = [buy('2026-01-01', 100, 10), sell('2026-02-01', 60, 12)];

    it('rejects selling more than is held', () => {
        const err = validateTradeChange(trades, { add: { ...sell('2026-03-01', 50, 12), id: NEW_TRADE_ID } });
        expect(err).toMatchObject({ date: '2026-03-01', held: 40, selling: 50 });
    });

    it('rejects a back-dated sell before the shares were bought', () => {
        const err = validateTradeChange(trades, { add: { ...sell('2025-12-01', 1, 10), id: NEW_TRADE_ID } });
        expect(err).toMatchObject({ held: 0, selling: 1 });
    });

    it('rejects deleting a buy that a later sell depends on', () => {
        expect(validateTradeChange(trades, { removeId: trades[0].id })).toMatchObject({ selling: 60 });
    });

    it('rejects editing a buy down below what was later sold', () => {
        const edited = { ...trades[0], quantity: 50 };
        expect(validateTradeChange(trades, { add: edited, replaceId: edited.id })).not.toBeNull();
        expect(validateTradeChange(trades, { add: { ...trades[0], quantity: 60 }, replaceId: trades[0].id })).toBeNull();
    });

    it('accepts selling exactly what is held', () => {
        expect(validateTradeChange(trades, { add: { ...sell('2026-03-01', 40, 12), id: NEW_TRADE_ID } })).toBeNull();
        expect(replayTrades(trades).error).toBeNull();
    });
});

describe('prices', () => {
    const trades = [buy('2026-01-01', 10, 100), sell('2026-03-01', 2, 130)];

    it('uses the newer of the typed price and the last trade price', () => {
        expect(effectivePrice(holding({ current_price: 120, price_updated_at: '2026-02-01' }), trades))
            .toMatchObject({ price: 130, source: 'trade' });
        expect(effectivePrice(holding({ current_price: 140, price_updated_at: '2026-03-01' }), trades))
            .toMatchObject({ price: 140, source: 'manual' });
        expect(effectivePrice(holding(), trades)).toMatchObject({ price: 130 });
        expect(effectivePrice(holding(), [])).toBeNull();
    });

    it('ignores bonus-share and dividend prices', () => {
        expect(effectivePrice(holding(), [buy('2026-01-01', 10, 50), buy('2026-02-01', 1, 0), dividend('2026-03-01', 5)]))
            .toMatchObject({ price: 50, date: '2026-01-01' });
    });

    it('merges trade and typed prices, one per day, typed winning', () => {
        const history = priceHistory(trades, [{ date: '2026-03-01', price: 128 }, { date: '2026-02-01', price: 115 }]);
        expect(history).toEqual([
            { date: '2026-01-01', price: 100, source: 'trade' },
            { date: '2026-02-01', price: 115, source: 'manual' },
            { date: '2026-03-01', price: 128, source: 'manual' },
        ]);
    });
});

describe('summaries', () => {
    it('values a holding and its total return', () => {
        const s = summarizeHolding(
            holding({ current_price: 20, price_updated_at: '2026-04-01' }),
            [buy('2026-01-01', 100, 10), sell('2026-02-01', 50, 15), dividend('2026-03-01', 30)],
        );
        expect(s.marketValue).toBe(1000);
        expect(s.unrealized).toBe(500);
        expect(s.unrealizedPct).toBe(100);
        expect(s.totalReturn).toBe(500 + 250 + 30);
        expect(s.totalReturnPct).toBeCloseTo(78);
        expect(s.isOpen).toBe(true);
    });

    it('values at cost when no price is known', () => {
        const s = summarizeHolding(holding(), [buy('2026-01-01', 5, 0)]);
        expect(s.marketValue).toBe(0);
        expect(s.unrealized).toBe(0);
        expect(s.unrealizedPct).toBeNull();
    });

    it('adds up the portfolio, closed holdings included in realised P/L', () => {
        const open = summarizeHolding(holding({ id: 1, current_price: 12, price_updated_at: '2026-05-01' }), [buy('2026-01-01', 10, 10)]);
        const closed = summarizeHolding(holding({ id: 2 }), [buy('2026-01-01', 10, 10), sell('2026-02-01', 10, 8)]);
        const p = summarizePortfolio([open, closed]);
        expect(p).toMatchObject({ value: 120, invested: 100, unrealized: 20, realized: -20, totalReturn: 0, openCount: 1 });
        expect(p.unrealizedPct).toBe(20);
        expect(p.totalReturnPct).toBe(0);
    });

    it('sorts by value, gain, gain % and name', () => {
        const a = summarizeHolding(holding({ id: 1, name: 'B', current_price: 30, price_updated_at: '2026-05-01' }), [buy('2026-01-01', 10, 10)]);
        const b = summarizeHolding(holding({ id: 2, name: 'A', current_price: 5, price_updated_at: '2026-05-01' }), [buy('2026-01-01', 100, 4)]);
        expect(sortSummaries([b, a], 'value').map(s => s.holding.id)).toEqual([b.holding.id, a.holding.id]);
        expect(sortSummaries([b, a], 'gain').map(s => s.holding.id)).toEqual([1, 2]);
        expect(sortSummaries([a, b], 'gainPct').map(s => s.holding.id)).toEqual([1, 2]);
        expect(sortSummaries([a, b], 'name').map(s => s.holding.name)).toEqual(['A', 'B']);
    });

    it('builds allocation slices with an Other bucket', () => {
        const list = [1, 2, 3].map(id =>
            summarizeHolding(holding({ id, name: `H${id}`, symbol: null, asset_type: id === 3 ? 'crypto' : 'stock', current_price: id * 10, price_updated_at: '2026-05-01' }),
                [buy('2026-01-01', 1, 1)]));
        const byHolding = allocation(list, 'holding', ['#a', '#b'], '#o', 2);
        expect(byHolding.map(s => [s.label, Math.round(s.percent)])).toEqual([['H3', 50], ['Other', 50]]);
        expect(byHolding[1].color).toBe('#o');
        const byType = allocation(list, 'type', ['#a', '#b'], '#o');
        expect(byType.map(s => s.label)).toEqual(['Stock', 'Crypto']);
    });
});

describe('value over time', () => {
    it('values each month end with the newest known price', () => {
        const h = holding({ id: 7 });
        const trades = new Map([[7, [buy('2026-07-15', 10, 100), sell('2026-09-10', 5, 150)]]]);
        const prices = new Map([[7, [{ date: '2026-08-20', price: 120 }, { date: '2026-11-05', price: 200 }]]]);
        const series = portfolioSeries([h], trades, prices, '6m', new Date(2026, 10, 11));
        expect(series.map(p => p.label)).toEqual(['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
        expect(series.map(p => p.value)).toEqual([0, 1000, 1200, 750, 750, 1000]);
        expect(series.map(p => p.invested)).toEqual([0, 1000, 1000, 500, 500, 500]);
        expect(series[5].date).toBe('2026-11-11');
    });

    it('starts "All" at the first trade and labels years when it spans them', () => {
        const trades = new Map([[1, [buy('2025-10-03', 1, 10)]]]);
        const series = portfolioSeries([holding()], trades, new Map(), 'all', new Date(2026, 1, 1));
        expect(series.map(p => p.label)).toEqual(['Oct 25', 'Nov 25', 'Dec 25', 'Jan 26', 'Feb 26']);
        expect(series.every(p => p.value === 10)).toBe(true);
    });

    it('is empty without trades', () => {
        expect(portfolioSeries([holding()], new Map(), new Map(), '1y')).toEqual([]);
    });
});

describe('formatting', () => {
    const fmt = (n: number) => `Rs ${n.toFixed(2)}`;
    it('formats quantities, signs, percents and small prices', () => {
        expect(formatQuantity(1250)).toBe('1,250');
        expect(formatQuantity(0.04250000)).toBe('0.0425');
        expect(formatQuantity(0.1 + 0.2)).toBe('0.3');
        expect(formatSigned(12.5, fmt)).toBe('+Rs 12.50');
        expect(formatSigned(-3, fmt)).toBe('−Rs 3.00');
        expect(formatSigned(0.001, fmt)).toBe('Rs 0.00');
        expect(formatPct(12.44)).toBe('+12.4%');
        expect(formatPct(-3)).toBe('−3.0%');
        expect(formatPct(null)).toBe('—');
        expect(formatPrice(0.000123456, fmt, 'Rs ')).toBe('Rs 0.0001235');
        expect(formatPrice(250, fmt, 'Rs ')).toBe('Rs 250.00');
    });

    it('names units by asset type', () => {
        expect(unitLabel('stock', 1)).toBe('share');
        expect(unitLabel('stock', 3)).toBe('shares');
        expect(unitLabel('mutual_fund')).toBe('units');
        expect(unitLabel('crypto', 0.5)).toBe('coins');
    });
});
