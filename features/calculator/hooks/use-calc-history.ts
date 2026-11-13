import { isDbReady } from '@/lib/db/db-client';
import {
    addCalcHistory,
    CALC_HISTORY_LIMIT,
    clearCalcHistory,
    deleteCalcHistoryEntry,
    getCalcHistory,
    type CalculatorHistoryEntry,
} from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';

/**
 * Calculator history, newest first. Only the calculator reads it, so it keeps
 * its own state instead of using a global refresh domain. Writes update the
 * list straight away and are saved in the background.
 */
export function useCalcHistory() {
    const [entries, setEntries] = useState<CalculatorHistoryEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const refresh = useCallback(async () => {
        if (!isDbReady()) return;
        try {
            const rows = await getCalcHistory();
            if (mountedRef.current) setEntries(rows);
        } catch (e) {
            logger.error('Failed to load calculator history', e);
        } finally {
            if (mountedRef.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const task = InteractionManager.runAfterInteractions(() => refresh());
        return () => task.cancel();
    }, [refresh]);

    const add = useCallback(async (expression: string, result: number) => {
        try {
            const row = await addCalcHistory(expression, result);
            if (mountedRef.current && row) {
                setEntries(prev => [row, ...prev].slice(0, CALC_HISTORY_LIMIT));
            }
        } catch (e) {
            logger.error('Failed to save calculation', e);
        }
    }, []);

    const remove = useCallback(async (id: number) => {
        setEntries(prev => prev.filter(e => e.id !== id));
        try {
            await deleteCalcHistoryEntry(id);
        } catch (e) {
            logger.error('Failed to delete calculation', e);
            refresh();
        }
    }, [refresh]);

    const clear = useCallback(async () => {
        setEntries([]);
        try {
            await clearCalcHistory();
        } catch (e) {
            logger.error('Failed to clear calculator history', e);
            refresh();
        }
    }, [refresh]);

    return { entries, loading, add, remove, clear };
}
