import { parseAmount } from '@/lib/utils/currency';
import { AmountInput, BottomSheet, BottomSheetRef, FormScrollView, SheetHeader, ThemedText } from '@/components/common';
import { CalendarPicker, toLocalDateStr } from '@/components/common/calendar-picker';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { HouseholdConfig, HouseholdPeriodOverlapError, upsertHouseholdConfig } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { POPULAR_CURRENCIES } from '@/features/user/services/user-service';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Keyboard,
    Pressable,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Period = 'monthly' | 'weekly' | 'yearly';
const PERIODS: Period[] = ['monthly', 'weekly', 'yearly'];
const PERIOD_NOUN: Record<Period, string> = { monthly: 'month', weekly: 'week', yearly: 'year' };

function formatDay(iso: string) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface IncomeSetupModalProps {
    visible: boolean;
    onClose: () => void;
    onSuccess: () => void;
    existingConfig: HouseholdConfig | null;
    currencyCode: string;
}

export function IncomeSetupModal({ visible, onClose, onSuccess, existingConfig, currencyCode }: IncomeSetupModalProps) {
    const insets = useSafeAreaInsets();
    const colors = useThemeColors();
    const currencySymbol = POPULAR_CURRENCIES.find(c => c.code === currencyCode)?.symbol ?? '$';

    const [amount, setAmount] = useState('');
    const [period, setPeriod] = useState<Period>('monthly');
    const [periodStartDate, setPeriodStartDate] = useState(toLocalDateStr(new Date()));
    const [showCalendar, setShowCalendar] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const amountInputRef = useRef<TextInput>(null);
    const sheetRef = useRef<BottomSheetRef>(null);

    useEffect(() => {
        if (!visible || !!existingConfig) return;
        const t = setTimeout(() => amountInputRef.current?.focus(), 400);
        return () => clearTimeout(t);
    }, [visible, existingConfig]);

    useEffect(() => {
        if (visible) {
            if (existingConfig) {
                setAmount(String(existingConfig.income_amount));
                setPeriod(existingConfig.period as Period);
                setPeriodStartDate(existingConfig.period_start_date);
            } else {
                setAmount('');
                setPeriod('monthly');
                setPeriodStartDate(toLocalDateStr(new Date()));
            }
        }
    }, [visible, existingConfig]);

    const handleClose = () => {
        amountInputRef.current?.blur();
        Keyboard.dismiss();
        setShowCalendar(false);
        sheetRef.current?.dismiss(onClose);
    };

    const handleSubmit = async () => {
        const parsed = parseAmount(amount);
        if (!amount || isNaN(parsed) || parsed <= 0) {
            toast.error('Please enter a valid income amount');
            return;
        }
        setIsSubmitting(true);
        try {
            await upsertHouseholdConfig({
                income_amount: parsed,
                period,
                period_start_date: periodStartDate,
            });
            toast.success(existingConfig ? 'Household income updated' : 'Household income set up');
            handleClose();
            onSuccess();
        } catch (e) {
            if (e instanceof HouseholdPeriodOverlapError) {
                // Starting earlier would pull a month that is already in History back in.
                toast.error(`Start date must be after ${formatDay(e.lastArchivedEnd)}: earlier months are already in History.`);
                return;
            }
            logger.error('IncomeSetupModal: failed to save', e);
            toast.error('Failed to save household income');
        } finally {
            setIsSubmitting(false);
        }
    };

    const formattedStartDate = formatDay(periodStartDate);
    const periodNoun = PERIOD_NOUN[period];

    if (showCalendar) {
        return (
            <CalendarPicker
                selectedDate={periodStartDate}
                onSelectDate={(d) => { setPeriodStartDate(d); setShowCalendar(false); }}
                onClose={() => setShowCalendar(false)}
                quickActions={[
                    { label: 'Today', date: toLocalDateStr(new Date()) },
                    { label: '1st of month', date: (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`; })() },
                ]}
            />
        );
    }

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            maxHeight="90%"
            paddingHorizontal={32}
            paddingTop={48}
            paddingBottom={insets.bottom + 32}
            keyboardAvoiding
        >
            <SheetHeader
                title={existingConfig ? `This ${periodNoun}'s income` : 'Set Up Household Income'}
                onClose={handleClose}
            />

            <FormScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
            >
                <AmountInput
                    ref={amountInputRef}
                    value={amount}
                    onChange={setAmount}
                    currencySymbol={currencySymbol}
                />
                <ThemedText className="text-xs mb-6 -mt-2 text-textMuted dark:text-dark-textMuted">
                    {`Applies to this ${periodNoun} only. Each ${periodNoun} keeps its own income and expenses in History.`}
                </ThemedText>

                {/* Period */}
                <View className="mb-6">
                    <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
                        Resets Every
                    </ThemedText>
                    <View className="flex-row gap-2">
                        {PERIODS.map(p => (
                            <Pressable
                                key={p}
                                onPress={() => setPeriod(p)}
                                className="flex-1 py-3 rounded-xl items-center"
                                style={{
                                    backgroundColor: period === p
                                        ? colors.primary
                                        : colors.scheme === 'dark' ? colors.gray800 : colors.gray100,
                                }}
                            >
                                <ThemedText
                                    className="text-xs font-black"
                                    style={{ color: period === p ? '#fff' : colors.textSecondary }}
                                >
                                    {p.charAt(0).toUpperCase() + p.slice(1)}
                                </ThemedText>
                            </Pressable>
                        ))}
                    </View>
                </View>

                {/* Period Start Date */}
                <View className="mb-8">
                    <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
                        Period Starts On
                    </ThemedText>
                    <Pressable
                        onPress={() => setShowCalendar(true)}
                        className="flex-row items-center px-4 py-3.5 rounded-xl"
                        style={{ backgroundColor: colors.scheme === 'dark' ? colors.gray800 : colors.gray100 }}
                    >
                        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                        <ThemedText className="flex-1 ml-3 font-bold" style={{ color: colors.textPrimary }}>
                            {formattedStartDate}
                        </ThemedText>
                        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </Pressable>
                </View>

                {/* Submit */}
                <Pressable
                    onPress={handleSubmit}
                    disabled={isSubmitting}
                    className="w-full py-4 rounded-xl items-center bg-primary shadow-lg shadow-primary/20"
                >
                    {isSubmitting
                        ? <ActivityIndicator color="#fff" />
                        : <ThemedText className="font-black text-base text-white">
                            {existingConfig ? 'Update Income' : 'Save & Start Tracking'}
                        </ThemedText>
                    }
                </Pressable>
            </FormScrollView>
        </BottomSheet>
    );
}
