import { isDbReady } from '@/lib/db/db-client';
import { getHoldingData, getPortfolioData, type PortfolioData } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { useRefreshSignal, type RefreshDomain } from '@/providers/modal-context';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { groupByHolding, summarizeHolding, summarizePortfolio } from '../utils';

const DOMAINS: readonly RefreshDomain[] = ['investments'];

/** Load portfolio rows (all holdings, or one) and reload when investments change. */
function usePortfolioRows(load: () => Promise<PortfolioData | null>) {
    const [data, setData] = useState<PortfolioData | null>(null);
    const [loading, setLoading] = useState(true);
    const [missing, setMissing] = useState(false);
    const mountedRef = useRef(true);
    const refreshSignal = useRefreshSignal(DOMAINS);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const refresh = useCallback(async () => {
        if (!isDbReady()) return;
        try {
            const rows = await load();
            if (!mountedRef.current) return;
            setData(rows);
            setMissing(rows === null);
        } catch (e) {
            logger.error('Failed to load portfolio', e);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, [load]);

    useEffect(() => {
        const task = InteractionManager.runAfterInteractions(() => refresh());
        return () => task.cancel();
    }, [refresh, refreshSignal]);

    const derived = useMemo(() => {
        const holdings = data?.holdings ?? [];
        const tradesByHolding = groupByHolding(data?.trades ?? []);
        const pricesByHolding = groupByHolding(data?.prices ?? []);
        const summaries = holdings.map(h => summarizeHolding(h, tradesByHolding.get(h.id) ?? []));
        return { holdings, tradesByHolding, pricesByHolding, summaries, summary: summarizePortfolio(summaries) };
    }, [data]);

    return { ...derived, loading, missing, refresh };
}

/** Every holding, with positions, gains and portfolio totals. */
export function usePortfolio() {
    return usePortfolioRows(getPortfolioData);
}

/** One holding with its trades and prices; `missing` once it's been deleted. */
export function useHolding(id: number) {
    const load = useCallback(() => getHoldingData(id), [id]);
    const rows = usePortfolioRows(load);
    const summary = rows.summaries[0] ?? null;
    return {
        holding: rows.holdings[0] ?? null,
        trades: rows.tradesByHolding.get(id) ?? [],
        prices: rows.pricesByHolding.get(id) ?? [],
        summary,
        loading: rows.loading,
        missing: rows.missing,
        refresh: rows.refresh,
    };
}
