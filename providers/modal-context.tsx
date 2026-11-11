import type { BudgetWithSpend } from '@/features/budgets/hooks/use-budgets';
import React, { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';

export type ModalType = 'transaction' | 'budget' | 'savings' | 'export' | null;
type TransactionInitialType = 'income' | 'expense';

/**
 * Data domains a mutation can invalidate. Hooks subscribe only to the domains
 * they read, so e.g. editing a budget doesn't refetch every transaction list.
 */
export type RefreshDomain = 'transactions' | 'accounts' | 'budgets' | 'savings' | 'loans' | 'household' | 'categories' | 'investments';
const ALL_DOMAINS: readonly RefreshDomain[] = ['transactions', 'accounts', 'budgets', 'savings', 'loans', 'household', 'categories', 'investments'];

export interface OpenModalOptions {
    /** 'transaction' only — which side of the Expense/Income toggle to start on. */
    transactionType?: TransactionInitialType;
    /** 'budget' only — open the budget sheet in edit mode for this budget. */
    budget?: BudgetWithSpend | null;
}

interface ModalStateContextType {
    activeModal: ModalType;
    transactionInitialType: TransactionInitialType;
    editingBudget: BudgetWithSpend | null;
}

interface ModalActionsContextType {
    openModal: (type: ModalType, options?: OpenModalOptions) => void;
    closeModal: () => void;
    /** Invalidate the given domains (all of them when omitted). */
    triggerRefresh: (domains?: RefreshDomain | readonly RefreshDomain[]) => void;
}

/**
 * Per-domain refresh counters kept outside React state: bumping one only
 * re-renders the components subscribed to that domain (useSyncExternalStore),
 * instead of every consumer of a shared context value.
 */
function createRefreshStore() {
    const counters = Object.fromEntries(ALL_DOMAINS.map(d => [d, 0])) as Record<RefreshDomain, number>;
    const listeners = new Set<() => void>();
    return {
        bump(domains: readonly RefreshDomain[]) {
            domains.forEach(d => { counters[d] += 1; });
            listeners.forEach(l => l());
        },
        get(domains: readonly RefreshDomain[]) {
            let total = 0;
            for (const d of domains) total += counters[d];
            return total;
        },
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}
type RefreshStore = ReturnType<typeof createRefreshStore>;

const ModalStateContext = createContext<ModalStateContextType | undefined>(undefined);
const ModalActionsContext = createContext<ModalActionsContextType | undefined>(undefined);
const RefreshStoreContext = createContext<RefreshStore | undefined>(undefined);

export function ModalProvider({ children }: { children: React.ReactNode }) {
    const [activeModal, setActiveModal] = useState<ModalType>(null);
    const [transactionInitialType, setTransactionInitialType] = useState<TransactionInitialType>('expense');
    const [editingBudget, setEditingBudget] = useState<BudgetWithSpend | null>(null);
    const [store] = useState(createRefreshStore);

    const actions = useMemo<ModalActionsContextType>(() => ({
        openModal: (type: ModalType, options?: OpenModalOptions) => {
            // Reset to the defaults so a previous 'income' or edit target doesn't leak.
            if (type === 'transaction') setTransactionInitialType(options?.transactionType ?? 'expense');
            if (type === 'budget') setEditingBudget(options?.budget ?? null);
            setActiveModal(type);
        },
        closeModal: () => {
            setActiveModal(null);
            setEditingBudget(null);
        },
        triggerRefresh: (domains) => {
            store.bump(domains === undefined ? ALL_DOMAINS : typeof domains === 'string' ? [domains] : domains);
        },
    }), [store]);

    const state = useMemo(() => ({
        activeModal,
        transactionInitialType,
        editingBudget,
    }), [activeModal, transactionInitialType, editingBudget]);

    return (
        <RefreshStoreContext.Provider value={store}>
            <ModalActionsContext.Provider value={actions}>
                <ModalStateContext.Provider value={state}>
                    {children}
                </ModalStateContext.Provider>
            </ModalActionsContext.Provider>
        </RefreshStoreContext.Provider>
    );
}

/**
 * Modal UI state + actions. Re-renders on every modal open/close — screens
 * that only open modals or refresh data should use useModalActions().
 */
export function useModals() {
    const state = useContext(ModalStateContext);
    const actions = useContext(ModalActionsContext);
    if (state === undefined || actions === undefined) {
        throw new Error('useModals must be used within a ModalProvider');
    }
    return { ...state, ...actions };
}

export function useModalActions() {
    const actions = useContext(ModalActionsContext);
    if (actions === undefined) {
        throw new Error('useModalActions must be used within a ModalProvider');
    }
    return actions;
}

/**
 * A number that changes whenever any of `domains` is refreshed — use it as an
 * effect dependency to refetch. Defaults to every domain.
 */
export function useRefreshSignal(domains: readonly RefreshDomain[] = ALL_DOMAINS): number {
    const store = useContext(RefreshStoreContext);
    if (store === undefined) {
        throw new Error('useRefreshSignal must be used within a ModalProvider');
    }
    return useSyncExternalStore(store.subscribe, () => store.get(domains));
}
