/**
 * Portfolio maths. Pure functions, so they're unit-tested without a database.
 *
 * Positions use the AVERAGE-COST method (the one brokers report):
 *   buy       cost basis += qty × price + fees; quantity += qty
 *   sell      the shares sold leave at the average cost; realised P/L is
 *             (qty × price − fees) − qty × average cost
 *   dividend  added to dividends received (the amount actually received)
 *
 * Prices come from two places: prices the user typed in, and the price of
 * each buy or sell. The newest of these values the position; when both fall
 * on the same day, the typed price wins.
 */
import type { AssetType, InvestmentHolding, InvestmentPrice, InvestmentTrade } from '@/lib/db/schema';
import { deviceDecimalMark, parseAmount } from '@/lib/utils/currency';
import { parseLocalDate, toISODateString } from '@/lib/utils/date';
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

export type TradeType = InvestmentTrade['type'];
export type TradeLike = Pick<InvestmentTrade, 'id' | 'type' | 'date' | 'quantity' | 'price' | 'fees' | 'amount'>;
export type PriceLike = Pick<InvestmentPrice, 'date' | 'price'>;
export type HoldingLike = Pick<
    InvestmentHolding,
    'id' | 'name' | 'symbol' | 'asset_type' | 'current_price' | 'price_updated_at' | 'is_archived' | 'color'
>;

/** Decimal places kept for quantities (fractional coins) and per-unit prices. */
export const QTY_DECIMALS = 8;
export const PRICE_DECIMALS = 6;

/**
 * Read a number typed into a portfolio form, using the phone's decimal mark,
 * so "1,125" is 1.125 where decimals are written with a comma. NaN if invalid.
 */
export function parseFormNumber(input: string, decimals: number = 2): number {
    return parseAmount(input, decimals, deviceDecimalMark());
}

/** Below this, a quantity counts as zero (float dust from partial sells). */
const EPS = 1e-9;

// ── Labels ───────────────────────────────────────────────────────────────────

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
    stock: 'Stock',
    mutual_fund: 'Mutual fund',
    etf: 'ETF',
    crypto: 'Crypto',
    gold: 'Gold',
    bond: 'Bond',
    other: 'Other',
};

export const ASSET_TYPE_ICONS: Record<AssetType, IoniconsName> = {
    stock: 'trending-up-outline',
    mutual_fund: 'pie-chart-outline',
    etf: 'layers-outline',
    crypto: 'logo-bitcoin',
    gold: 'diamond-outline',
    bond: 'document-text-outline',
    other: 'cube-outline',
};

/** What one unit of a holding is called: "12 shares", "3.5 units". */
export function unitLabel(type: AssetType, quantity = 2): string {
    const one = Math.abs(quantity - 1) < EPS;
    switch (type) {
        case 'stock':
        case 'etf':
            return one ? 'share' : 'shares';
        case 'crypto':
            return one ? 'coin' : 'coins';
        default:
            return one ? 'unit' : 'units';
    }
}

/**
 * What the per-unit price is called: "NAV" (net asset value) for mutual
 * funds, as fund statements call it; "Price" for everything else.
 */
export function priceTerm(type: AssetType): 'NAV' | 'Price' {
    return type === 'mutual_fund' ? 'NAV' : 'Price';
}

export const TRADE_LABELS: Record<TradeType, string> = { buy: 'Buy', sell: 'Sell', dividend: 'Dividend' };

// ── Trades and positions ─────────────────────────────────────────────────────

/** Oldest first; same-day trades in the order they were entered. */
export function sortTrades<T extends Pick<TradeLike, 'date' | 'id'>>(trades: readonly T[]): T[] {
    return [...trades].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
}

export interface Position {
    /** Units held now. */
    quantity: number;
    /** What the units held now cost, fees included. */
    costBasis: number;
    /** costBasis ÷ quantity (0 when nothing is held). */
    avgCost: number;
    /** Profit or loss already locked in by sells. */
    realized: number;
    /** Dividends received. */
    dividends: number;
    /** Every fee paid on buys and sells. */
    fees: number;
    /** Everything ever spent on buys, fees included. */
    totalBought: number;
    /** Everything received from sells, after fees. */
    totalSold: number;
    firstDate: string | null;
    tradeCount: number;
}

/** A sell that would take the quantity below zero. */
export interface OversellError {
    tradeId: number;
    date: string;
    held: number;
    selling: number;
}

const emptyPosition = (): Position => ({
    quantity: 0,
    costBasis: 0,
    avgCost: 0,
    realized: 0,
    dividends: 0,
    fees: 0,
    totalBought: 0,
    totalSold: 0,
    firstDate: null,
    tradeCount: 0,
});

/** Apply one trade to a position in place. Returns an error for an oversell (and sells what is held). */
function applyTrade(p: Position, t: TradeLike): OversellError | null {
    p.tradeCount++;
    if (p.firstDate === null || t.date < p.firstDate) p.firstDate = t.date;
    const fees = t.fees ?? 0;

    if (t.type === 'dividend') {
        p.dividends += t.amount ?? 0;
        return null;
    }

    const qty = t.quantity ?? 0;
    const price = t.price ?? 0;
    p.fees += fees;

    if (t.type === 'buy') {
        const cost = qty * price + fees;
        p.costBasis += cost;
        p.totalBought += cost;
        p.quantity += qty;
    } else {
        let error: OversellError | null = null;
        let sold = qty;
        if (qty > p.quantity + EPS) {
            error = { tradeId: t.id, date: t.date, held: p.quantity, selling: qty };
            sold = p.quantity;
        }
        const avg = p.quantity > EPS ? p.costBasis / p.quantity : 0;
        const proceeds = sold * price - fees;
        p.realized += proceeds - sold * avg;
        p.totalSold += proceeds;
        p.costBasis -= sold * avg;
        p.quantity -= sold;
        if (p.quantity <= EPS) {
            p.quantity = 0;
            p.costBasis = 0;
        }
        p.avgCost = p.quantity > 0 ? p.costBasis / p.quantity : 0;
        return error;
    }
    p.avgCost = p.quantity > 0 ? p.costBasis / p.quantity : 0;
    return null;
}

/** Replay trades in date order; reports the first oversell, if any. */
export function replayTrades(trades: readonly TradeLike[]): { position: Position; error: OversellError | null } {
    const p = emptyPosition();
    let error: OversellError | null = null;
    for (const t of sortTrades(trades)) {
        const e = applyTrade(p, t);
        if (e && !error) error = e;
    }
    return { position: p, error };
}

export function computePosition(trades: readonly TradeLike[]): Position {
    return replayTrades(trades).position;
}

/** Id given to a trade that hasn't been saved yet, so it sorts last on its day. */
export const NEW_TRADE_ID = Number.MAX_SAFE_INTEGER;

/**
 * Check a new or edited trade against the holding's other trades. Replays them
 * in date order, so a back-dated sell can't sell shares that weren't held then.
 */
export function validateTradeChange(
    existing: readonly TradeLike[],
    change: { add?: TradeLike; replaceId?: number; removeId?: number },
): OversellError | null {
    let next = existing.filter(t => t.id !== change.replaceId && t.id !== change.removeId);
    if (change.add) next = [...next, change.add];
    return replayTrades(next).error;
}

// ── Prices ───────────────────────────────────────────────────────────────────

export interface PricePoint {
    date: string;
    price: number;
    source: 'manual' | 'trade';
}

/** Every known price for a holding, oldest first, one per day (typed prices win). */
export function priceHistory(trades: readonly TradeLike[], prices: readonly PriceLike[]): PricePoint[] {
    const byDate = new Map<string, PricePoint>();
    for (const t of sortTrades(trades)) {
        if (t.type === 'dividend' || !t.price || t.price <= 0) continue;
        byDate.set(t.date, { date: t.date, price: t.price, source: 'trade' });
    }
    for (const p of prices) byDate.set(p.date, { date: p.date, price: p.price, source: 'manual' });
    return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The price that values a holding today: the newer of the typed price and the
 * last buy/sell price (typed wins on the same day). null when neither exists.
 */
export function effectivePrice(
    holding: Pick<HoldingLike, 'current_price' | 'price_updated_at'>,
    trades: readonly TradeLike[],
): PricePoint | null {
    let lastTrade: TradeLike | null = null;
    for (const t of sortTrades(trades)) {
        if (t.type !== 'dividend' && t.price != null && t.price > 0) lastTrade = t;
    }
    const manual = holding.current_price != null && holding.price_updated_at
        ? { date: holding.price_updated_at, price: holding.current_price, source: 'manual' as const }
        : null;
    if (manual && (!lastTrade || manual.date >= lastTrade.date)) return manual;
    if (lastTrade) return { date: lastTrade.date, price: lastTrade.price!, source: 'trade' };
    return manual;
}

// ── Summaries ────────────────────────────────────────────────────────────────

export interface HoldingSummary {
    holding: HoldingLike;
    position: Position;
    price: PricePoint | null;
    marketValue: number;
    /** Gain on the units still held: market value − cost basis. */
    unrealized: number;
    unrealizedPct: number | null;
    /** Unrealised + realised + dividends. */
    totalReturn: number;
    /** totalReturn as a share of everything ever spent on buys. */
    totalReturnPct: number | null;
    isOpen: boolean;
}

export function summarizeHolding(holding: HoldingLike, trades: readonly TradeLike[]): HoldingSummary {
    const position = computePosition(trades);
    const price = effectivePrice(holding, trades);
    // Without any price, value the units at what they cost (no gain or loss shown).
    const marketValue = price ? position.quantity * price.price : position.costBasis;
    const unrealized = position.quantity > 0 ? marketValue - position.costBasis : 0;
    const totalReturn = unrealized + position.realized + position.dividends;
    return {
        holding,
        position,
        price,
        marketValue,
        unrealized,
        unrealizedPct: position.costBasis > 0 ? (unrealized / position.costBasis) * 100 : null,
        totalReturn,
        totalReturnPct: position.totalBought > 0 ? (totalReturn / position.totalBought) * 100 : null,
        isOpen: position.quantity > 0,
    };
}

export interface PortfolioSummary {
    /** Market value of everything held now. */
    value: number;
    /** What the units held now cost. */
    invested: number;
    unrealized: number;
    unrealizedPct: number | null;
    realized: number;
    dividends: number;
    totalReturn: number;
    totalReturnPct: number | null;
    /** Everything ever spent on buys, fees included (the base of totalReturnPct). */
    totalBought: number;
    /** Holdings with units still held. */
    openCount: number;
}

export function summarizePortfolio(summaries: readonly HoldingSummary[]): PortfolioSummary {
    let value = 0, invested = 0, realized = 0, dividends = 0, totalBought = 0, openCount = 0;
    for (const s of summaries) {
        value += s.marketValue;
        invested += s.position.costBasis;
        realized += s.position.realized;
        dividends += s.position.dividends;
        totalBought += s.position.totalBought;
        if (s.isOpen) openCount++;
    }
    const unrealized = value - invested;
    const totalReturn = unrealized + realized + dividends;
    return {
        value,
        invested,
        unrealized,
        unrealizedPct: invested > 0 ? (unrealized / invested) * 100 : null,
        realized,
        dividends,
        totalReturn,
        totalReturnPct: totalBought > 0 ? (totalReturn / totalBought) * 100 : null,
        totalBought,
        openCount,
    };
}

/** Group a list by holding id. */
export function groupByHolding<T extends { holding_id: number }>(rows: readonly T[]): Map<number, T[]> {
    const map = new Map<number, T[]>();
    for (const r of rows) {
        const list = map.get(r.holding_id);
        if (list) list.push(r);
        else map.set(r.holding_id, [r]);
    }
    return map;
}

// ── Value over time ──────────────────────────────────────────────────────────

export type SeriesRange = '6m' | '1y' | 'all';

export interface SeriesPoint {
    /** Month end (or today for the current month). */
    date: string;
    /** "Jan", or "Jan 25" when the series spans more than a year. */
    label: string;
    value: number;
    invested: number;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_POINTS = 120;

/**
 * Month-end market value and money invested (cost basis of units held) for
 * the whole portfolio. Each holding is valued with the newest price known on
 * that date; before any price is known it's valued at cost.
 */
export function portfolioSeries(
    holdings: readonly HoldingLike[],
    tradesByHolding: ReadonlyMap<number, readonly TradeLike[]>,
    pricesByHolding: ReadonlyMap<number, readonly PriceLike[]>,
    range: SeriesRange,
    now: Date = new Date(),
): SeriesPoint[] {
    let first: string | null = null;
    for (const list of tradesByHolding.values()) {
        for (const t of list) if (first === null || t.date < first) first = t.date;
    }
    if (first === null) return [];

    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    let months: number;
    if (range === '6m') months = 6;
    else if (range === '1y') months = 12;
    else {
        const f = parseLocalDate(first);
        months = (thisMonth.getFullYear() - f.getFullYear()) * 12 + (thisMonth.getMonth() - f.getMonth()) + 1;
        months = Math.min(MAX_POINTS, Math.max(2, months));
    }

    const today = toISODateString(now);
    const dates: string[] = [];
    for (let i = months - 1; i >= 0; i--) {
        const end = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - i + 1, 0);
        dates.push(i === 0 ? today : toISODateString(end));
    }
    const multiYear = parseLocalDate(dates[0]).getFullYear() !== now.getFullYear();
    const points: SeriesPoint[] = dates.map(date => {
        const d = parseLocalDate(date);
        const label = SHORT_MONTHS[d.getMonth()] + (multiYear ? ` ${String(d.getFullYear()).slice(2)}` : '');
        return { date, label, value: 0, invested: 0 };
    });

    for (const h of holdings) {
        const trades = sortTrades(tradesByHolding.get(h.id) ?? []);
        if (!trades.length) continue;
        const observed = priceHistory(trades, pricesByHolding.get(h.id) ?? []);
        const p = emptyPosition();
        let ti = 0;
        let pi = 0;
        let price: number | null = null;
        for (const point of points) {
            while (ti < trades.length && trades[ti].date <= point.date) applyTrade(p, trades[ti++]);
            while (pi < observed.length && observed[pi].date <= point.date) price = observed[pi++].price;
            if (p.quantity <= 0) continue;
            point.value += price != null ? p.quantity * price : p.costBasis;
            point.invested += p.costBasis;
        }
    }
    return points;
}

// ── Allocation ───────────────────────────────────────────────────────────────

/** A holding's colour: its own, or one from the palette that stays put as values change. */
export function holdingColor(holding: Pick<HoldingLike, 'id' | 'color'>, palette: readonly string[]): string {
    return holding.color || palette[(Math.max(1, holding.id) - 1) % palette.length];
}

export interface AllocationSlice {
    key: string;
    label: string;
    value: number;
    percent: number;
    color: string;
}

/**
 * Share of market value by holding or by asset type, largest first. At most
 * `maxSlices` slices; the rest are grouped as "Other".
 */
export function allocation(
    summaries: readonly HoldingSummary[],
    by: 'holding' | 'type',
    palette: readonly string[],
    otherColor: string,
    maxSlices = 6,
): AllocationSlice[] {
    const groups = new Map<string, { label: string; value: number; color?: string | null }>();
    for (const s of summaries) {
        if (!s.isOpen || s.marketValue <= 0) continue;
        const key = by === 'holding' ? String(s.holding.id) : s.holding.asset_type;
        const label = by === 'holding' ? (s.holding.symbol || s.holding.name) : ASSET_TYPE_LABELS[s.holding.asset_type];
        const g = groups.get(key);
        if (g) g.value += s.marketValue;
        else groups.set(key, { label, value: s.marketValue, color: by === 'holding' ? holdingColor(s.holding, palette) : null });
    }
    const sorted = [...groups.entries()].sort((a, b) => b[1].value - a[1].value);
    const total = sorted.reduce((sum, [, g]) => sum + g.value, 0);
    const top = sorted.length > maxSlices ? sorted.slice(0, maxSlices - 1) : sorted;
    const rest = sorted.slice(top.length);
    const slices: AllocationSlice[] = top.map(([key, g], i) => ({
        key,
        label: g.label,
        value: g.value,
        percent: 0,
        color: g.color || palette[i % palette.length],
    }));
    if (rest.length) {
        slices.push({ key: 'other', label: 'Other', value: rest.reduce((s, [, g]) => s + g.value, 0), percent: 0, color: otherColor });
    }
    for (const s of slices) s.percent = total > 0 ? (s.value / total) * 100 : 0;
    return slices;
}

// ── Sorting and formatting ───────────────────────────────────────────────────

export type HoldingSort = 'value' | 'gain' | 'gainPct' | 'name';

export function sortSummaries(list: readonly HoldingSummary[], by: HoldingSort): HoldingSummary[] {
    const out = [...list];
    switch (by) {
        case 'value':
            return out.sort((a, b) => b.marketValue - a.marketValue);
        case 'gain':
            return out.sort((a, b) => b.totalReturn - a.totalReturn);
        case 'gainPct':
            return out.sort((a, b) => (b.totalReturnPct ?? -Infinity) - (a.totalReturnPct ?? -Infinity));
        case 'name':
            return out.sort((a, b) => a.holding.name.localeCompare(b.holding.name));
    }
}

/** A number as plain digits for an input field: 1e-7 → "0.0000001", 2.50 → "2.5". */
export function toInputNumber(n: number, decimals = 8): string {
    if (!Number.isFinite(n)) return '';
    const fixed = n.toFixed(decimals);
    return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** "1,250" / "0.0425" — up to 8 decimals, trailing zeros dropped. */
export function formatQuantity(n: number): string {
    if (!Number.isFinite(n)) return '—';
    const rounded = Number.parseFloat(n.toFixed(8));
    const [int, frac] = String(Math.abs(rounded)).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${rounded < 0 ? '−' : ''}${grouped}${frac ? '.' + frac : ''}`;
}

/** Money with its sign: "+Rs 1,200.00" / "−Rs 80.00". */
export function formatSigned(n: number, fmt: (n: number) => string): string {
    if (Math.abs(n) < 0.005) return fmt(0);
    return `${n < 0 ? '−' : '+'}${fmt(Math.abs(n))}`;
}

/** "+12.4%" / "−3.0%" / "—". */
export function formatPct(pct: number | null): string {
    if (pct == null || !Number.isFinite(pct)) return '—';
    if (Math.abs(pct) < 0.05) return '0.0%';
    return `${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(1)}%`;
}

/**
 * A per-unit price. Prices under 1 (some coins, penny stocks) keep four
 * significant digits instead of rounding to 0.00.
 */
export function formatPrice(price: number, fmt: (n: number) => string, symbol: string): string {
    if (price === 0 || Math.abs(price) >= 1) return fmt(price);
    return `${symbol}${Number.parseFloat(price.toPrecision(4))}`;
}
