import { AppButton, BottomSheet, BottomSheetRef, SheetHeader, ThemedText } from '@/components/common';
import { FormatPicker, type ExportFormat } from '@/features/export/components/format-picker';
import { useUser } from '@/features/user/context/user-context';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import React, { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    buildHouseholdReport,
    loadAllMonths,
    loadCurrentMonth,
    loadHistoryMonth,
    type HouseholdCycle,
    type HouseholdMonthReport,
} from '../services/household-report';

/** What to export: the running period, one past period, or all of them. */
export type HouseholdExportScope =
    | { kind: 'current' }
    | { kind: 'history'; id: number }
    | { kind: 'all'; filter?: HouseholdCycle | 'all' };

const COPY: Record<HouseholdExportScope['kind'], { title: string; scopeLabel: string; pdf: string; xlsx: string }> = {
    current: {
        title: 'This period',
        scopeLabel: 'Current period',
        pdf: 'Income, spending, categories and every expense on a printable page.',
        xlsx: 'This period as a sheet: every expense with live totals.',
    },
    history: {
        title: 'This period',
        scopeLabel: 'Past period',
        pdf: 'Income, spending, categories and every expense on a printable page.',
        xlsx: 'This period as a sheet: every expense with live totals.',
    },
    all: {
        title: 'All periods',
        scopeLabel: 'All periods',
        pdf: 'An overview page, then each period on its own page.',
        xlsx: 'An Overview tab plus one tab for every period.',
    },
};

interface HouseholdExportSheetProps {
    visible: boolean;
    scope: HouseholdExportScope;
    onClose: () => void;
}

async function loadMonths(scope: HouseholdExportScope): Promise<HouseholdMonthReport[]> {
    if (scope.kind === 'current') {
        const current = await loadCurrentMonth();
        return current ? [current] : [];
    }
    if (scope.kind === 'history') {
        const month = await loadHistoryMonth(scope.id);
        return month ? [month] : [];
    }
    return loadAllMonths(scope.filter);
}

export function HouseholdExportSheet({ visible, scope, onClose }: HouseholdExportSheetProps) {
    const insets = useSafeAreaInsets();
    const { profile } = useUser();
    const sheetRef = useRef<BottomSheetRef>(null);
    const [format, setFormat] = useState<ExportFormat>('pdf');
    const [busy, setBusy] = useState(false);
    const copy = COPY[scope.kind];

    useEffect(() => {
        if (visible) setBusy(false);
    }, [visible]);

    const handleClose = () => sheetRef.current?.dismiss(onClose);

    const handleExport = async () => {
        setBusy(true);
        try {
            const months = await loadMonths(scope);
            if (months.length === 0) {
                toast.error('Nothing recorded to export');
                return;
            }
            const report = buildHouseholdReport(months, {
                scopeLabel: copy.scopeLabel,
                currency: profile.currency,
                ownerName: profile.name,
            });
            // Loaded on demand so SheetJS and expo-print aren't evaluated at app start.
            if (format === 'pdf') {
                const { exportHouseholdPdf } = await import('../services/household-pdf');
                await exportHouseholdPdf(report);
            } else {
                const { exportHouseholdExcel } = await import('../services/household-excel');
                await exportHouseholdExcel(report);
            }
            toast.success(format === 'pdf' ? 'PDF report ready' : 'Excel workbook ready');
            handleClose();
        } catch (e) {
            logger.error('Household export failed', e);
            toast.error('Could not create the report. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            paddingHorizontal={24}
            paddingTop={16}
            paddingBottom={insets.bottom + 28}
        >
            <SheetHeader kicker="Export household" title={copy.title} onClose={handleClose} />

            <ThemedText type="kicker" className="mb-2">Format</ThemedText>
            <FormatPicker value={format} onChange={setFormat} descriptions={{ pdf: copy.pdf, xlsx: copy.xlsx }} />

            <AppButton
                label={format === 'pdf' ? 'Create PDF' : 'Create Excel file'}
                icon="share-outline"
                onPress={handleExport}
                loading={busy}
                disabled={busy}
            />
        </BottomSheet>
    );
}
