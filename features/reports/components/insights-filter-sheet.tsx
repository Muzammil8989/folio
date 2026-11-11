import {
    AppButton,
    BottomSheet,
    CalendarPicker,
    FormScrollView,
    SheetHeader,
    ThemedText,
    type BottomSheetRef,
} from '@/components/common';
import { DateRow, FilterChips } from '@/features/investments/components/form-parts';
import { isTransferCategory } from '@/lib/db/queries';
import { todayString, toISODateString } from '@/lib/utils/date';
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DEFAULT_FILTERS, type InsightsFilters } from '../hooks/use-insights';
import type { InsightsPeriod } from '../utils';

const PERIOD_CHIPS: { key: InsightsPeriod; label: string }[] = [
    { key: 'month', label: 'This month' },
    { key: '3months', label: 'Last 3 months' },
    { key: '6months', label: 'Last 6 months' },
    { key: 'year', label: 'This year' },
    { key: 'custom', label: 'Custom dates' },
];

interface InsightsFilterSheetProps {
    visible: boolean;
    onClose: () => void;
    value: InsightsFilters;
    onApply: (filters: InsightsFilters) => void;
    accounts: { id: number; name: string }[];
    categories: { id: number; name: string }[];
}

function monthStart(): string {
    const now = new Date();
    return toISODateString(new Date(now.getFullYear(), now.getMonth(), 1));
}

/** Choose the period (or exact dates), an account and a category for Insights. */
export function InsightsFilterSheet({ visible, onClose, value, onApply, accounts, categories }: InsightsFilterSheetProps) {
    const insets = useSafeAreaInsets();
    const sheetRef = useRef<BottomSheetRef>(null);
    const [draft, setDraft] = useState<InsightsFilters>(value);
    const [calendarFor, setCalendarFor] = useState<'start' | 'end' | null>(null);

    useEffect(() => {
        if (visible) setDraft(value);
    }, [visible, value]);

    const custom = draft.custom ?? { start: monthStart(), end: todayString() };
    const pickable = categories.filter(c => !isTransferCategory(c.name));

    const apply = () => {
        const next = draft.period === 'custom' ? { ...draft, custom } : { ...draft, custom: null };
        sheetRef.current?.dismiss(() => {
            onClose();
            onApply(next);
        });
    };

    if (calendarFor) {
        return (
            <CalendarPicker
                selectedDate={custom[calendarFor]}
                onSelectDate={d => {
                    setDraft(prev => ({ ...prev, period: 'custom', custom: { ...custom, [calendarFor]: d } }));
                    setCalendarFor(null);
                }}
                onClose={() => setCalendarFor(null)}
                quickActions={[]}
            />
        );
    }

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            maxHeight="90%"
            paddingHorizontal={24}
            paddingTop={16}
            paddingBottom={insets.bottom + 32}
            keyboardAvoiding={false}
        >
            <SheetHeader kicker="Insights" title="Filter" onClose={() => sheetRef.current?.dismiss(onClose)} />

            <FormScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
                <ThemedText type="kicker" className="mb-3">Period</ThemedText>
                <FilterChips options={PERIOD_CHIPS} value={draft.period} onChange={p => setDraft(prev => ({ ...prev, period: p }))} />
                {draft.period === 'custom' && (
                    <View className="flex-row mt-4" style={{ gap: 12 }}>
                        <View className="flex-1">
                            <DateRow label="From" date={custom.start} onPress={() => setCalendarFor('start')} />
                        </View>
                        <View className="flex-1">
                            <DateRow label="To" date={custom.end} onPress={() => setCalendarFor('end')} />
                        </View>
                    </View>
                )}

                {accounts.length > 1 && (
                    <>
                        <ThemedText type="kicker" className="mt-6 mb-3">Account</ThemedText>
                        <FilterChips
                            options={[{ key: 'all', label: 'All accounts' }, ...accounts.map(a => ({ key: String(a.id), label: a.name }))]}
                            value={draft.accountId == null ? 'all' : String(draft.accountId)}
                            onChange={k => setDraft(prev => ({ ...prev, accountId: k === 'all' ? null : Number(k) }))}
                        />
                    </>
                )}

                <ThemedText type="kicker" className="mt-6 mb-3">Category</ThemedText>
                <FilterChips
                    options={[{ key: 'all', label: 'All categories' }, ...pickable.map(c => ({ key: String(c.id), label: c.name }))]}
                    value={draft.categoryId == null ? 'all' : String(draft.categoryId)}
                    onChange={k => setDraft(prev => ({ ...prev, categoryId: k === 'all' ? null : Number(k) }))}
                />

                <View className="flex-row mt-8" style={{ gap: 12 }}>
                    <AppButton label="Reset" variant="secondary" onPress={() => setDraft(DEFAULT_FILTERS)} flex />
                    <AppButton label="Show results" onPress={apply} flex />
                </View>
            </FormScrollView>
        </BottomSheet>
    );
}
