import { AppButton, BottomSheet, BottomSheetRef, PeriodSelector, SheetHeader, ThemedText } from '@/components/common';
import { PERIOD_OPTIONS, PeriodFilter, getDateRange } from '@/features/reports/utils';
import { useUser } from '@/features/user/context/user-context';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { parseLocalDate } from '@/lib/utils/date';
import { IoniconsName } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { Pressable } from '@/components/common/pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ALL_SECTIONS, buildReportData, type ReportSections } from '../services/report-data';

type Format = 'pdf' | 'xlsx';

const FORMATS: { key: Format; icon: IoniconsName; title: string; body: string }[] = [
    { key: 'pdf', icon: 'document-text-outline', title: 'PDF report', body: 'A formatted summary with charts, ready to read or print.' },
    { key: 'xlsx', icon: 'grid-outline', title: 'Excel workbook', body: 'Every transaction as rows you can sort, filter and sum.' },
];

const SECTIONS: { key: keyof ReportSections; label: string }[] = [
    { key: 'transactions', label: 'Transaction list' },
    { key: 'categories', label: 'Spending by category' },
    { key: 'budgets', label: 'Budget standing' },
    { key: 'investments', label: 'Portfolio' },
];

interface ExportSheetProps {
    visible: boolean;
    onClose: () => void;
}

export function ExportSheet({ visible, onClose }: ExportSheetProps) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const { profile } = useUser();
    const sheetRef = useRef<BottomSheetRef>(null);

    const [period, setPeriod] = useState<PeriodFilter>('month');
    const [format, setFormat] = useState<Format>('pdf');
    const [sections, setSections] = useState<ReportSections>(ALL_SECTIONS);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (visible) setBusy(false);
    }, [visible]);

    const range = getDateRange(period);
    const rangeText = `${parseLocalDate(range.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${parseLocalDate(range.end).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;

    const handleClose = () => sheetRef.current?.dismiss(onClose);

    const handleExport = async () => {
        setBusy(true);
        try {
            const data = await buildReportData({
                start: range.start,
                end: range.end,
                periodLabel: PERIOD_OPTIONS.find(p => p.key === period)?.label ?? '',
                currency: profile.currency,
                ownerName: profile.name,
                sections,
            });
            if (data.summary.transactionCount === 0 && data.budgets.length === 0 && data.holdings.length === 0) {
                toast.error('Nothing recorded in this period to export');
                return;
            }
            // Loaded on demand so SheetJS (~1 MB) and expo-print aren't evaluated at app start.
            if (format === 'pdf') {
                const { exportPdf } = await import('../services/pdf-export');
                await exportPdf(data, period);
            } else {
                const { exportExcel } = await import('../services/excel-export');
                await exportExcel(data);
            }
            toast.success(format === 'pdf' ? 'PDF report ready' : 'Excel workbook ready');
            handleClose();
        } catch (e) {
            logger.error('Export failed', e);
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
            maxHeight="92%"
            paddingHorizontal={24}
            paddingTop={16}
            paddingBottom={insets.bottom + 28}
        >
            <SheetHeader kicker="Export" title="Download a report" onClose={handleClose} />

            <ThemedText type="kicker" className="mb-1">Period</ThemedText>
            <PeriodSelector value={period} onChange={setPeriod} />
            <ThemedText type="caption" className="mt-2 mb-6">{rangeText}</ThemedText>

            <ThemedText type="kicker" className="mb-2">Format</ThemedText>
            <View className="gap-2 mb-6" accessibilityRole="radiogroup">
                {FORMATS.map(f => {
                    const selected = f.key === format;
                    return (
                        <Pressable
                            key={f.key}
                            onPress={() => setFormat(f.key)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected }}
                            accessibilityLabel={`${f.title}. ${f.body}`}
                            className="flex-row items-center rounded-xl px-4 py-3.5"
                            style={({ pressed }) => ({
                                borderWidth: selected ? 1.5 : 1,
                                borderColor: selected ? colors.textPrimary : colors.borderStrong,
                                backgroundColor: selected ? colors.surface : pressed ? colors.backgroundAlt : 'transparent',
                            })}
                        >
                            <Ionicons name={f.icon} size={22} color={selected ? colors.primary : colors.textSecondary} />
                            <View className="flex-1 mx-3">
                                <ThemedText type="defaultSemiBold" className="text-[15px]">{f.title}</ThemedText>
                                <ThemedText type="caption">{f.body}</ThemedText>
                            </View>
                            <Ionicons
                                name={selected ? 'radio-button-on' : 'radio-button-off'}
                                size={20}
                                color={selected ? colors.textPrimary : colors.borderStrong}
                            />
                        </Pressable>
                    );
                })}
            </View>

            <ThemedText type="kicker" className="mb-1">Include</ThemedText>
            <View className="mb-7 border-t border-divider dark:border-dark-divider">
                {SECTIONS.map(s => (
                    <View key={s.key} className="flex-row items-center justify-between min-h-[48px] border-b border-divider dark:border-dark-divider">
                        <ThemedText className="text-[15px]">{s.label}</ThemedText>
                        <Switch
                            value={sections[s.key]}
                            onValueChange={v => setSections(prev => ({ ...prev, [s.key]: v }))}
                            trackColor={{ false: colors.borderStrong, true: colors.primary }}
                            thumbColor="#FFFFFF"
                            accessibilityLabel={s.label}
                        />
                    </View>
                ))}
            </View>

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
