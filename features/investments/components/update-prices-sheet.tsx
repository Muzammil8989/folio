import {
    AppButton,
    BottomSheet,
    CalendarPicker,
    FormScrollView,
    SheetHeader,
    ThemedText,
    type BottomSheetRef,
} from '@/components/common';
import { useUser } from '@/features/user/context/user-context';
import { UserService } from '@/features/user/services/user-service';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { setHoldingPrices } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { getCurrencySymbol, parseAmount } from '@/lib/utils/currency';
import { todayString } from '@/lib/utils/date';
import { useModalActions } from '@/providers/modal-context';
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPrice, type HoldingSummary } from '../utils';
import { DateRow, Field, formatShortDay } from './form-parts';
import { PRICE_DECIMALS } from './holding-form-sheet';

interface UpdatePricesSheetProps {
    visible: boolean;
    onClose: () => void;
    /** Holdings to price; usually every open one, or just one from its own page. */
    holdings: HoldingSummary[];
}

/**
 * Type in today's prices for several holdings at once. Empty fields are
 * skipped, so it's fine to update only a few.
 */
export function UpdatePricesSheet({ visible, onClose, holdings }: UpdatePricesSheetProps) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const { profile } = useUser();
    const { triggerRefresh } = useModalActions();
    const sheetRef = useRef<BottomSheetRef>(null);
    const symbol = getCurrencySymbol(profile.currency);
    const fmt = (n: number) => UserService.formatCurrency(n, profile.currency);

    const [values, setValues] = useState<Record<number, string>>({});
    const [errors, setErrors] = useState<Record<number, string>>({});
    const [date, setDate] = useState(todayString());
    const [saving, setSaving] = useState(false);
    // Blocks a second tap before `saving` has re-rendered the button.
    const busyRef = useRef(false);
    const [dateError, setDateError] = useState<string | null>(null);
    const [showCalendar, setShowCalendar] = useState(false);

    useEffect(() => {
        if (!visible) return;
        setValues({});
        setErrors({});
        setDateError(null);
        setDate(todayString());
    }, [visible]);

    const close = () => {
        Keyboard.dismiss();
        sheetRef.current?.dismiss(onClose);
    };

    const filled = holdings.filter(s => (values[s.holding.id] ?? '').trim() !== '');

    const handleSave = async () => {
        if (busyRef.current) return;
        const nextErrors: Record<number, string> = {};
        const entries: { holdingId: number; price: number }[] = [];
        for (const s of filled) {
            const price = parseAmount(values[s.holding.id], PRICE_DECIMALS);
            if (!(price >= 0)) nextErrors[s.holding.id] = 'Enter a price';
            else entries.push({ holdingId: s.holding.id, price });
        }
        setErrors(nextErrors);
        const badDate = date > todayString() ? "The date can't be in the future" : null;
        setDateError(badDate);
        if (badDate || Object.keys(nextErrors).length || !entries.length) return;

        busyRef.current = true;
        setSaving(true);
        try {
            await setHoldingPrices(entries, date);
            triggerRefresh(['investments']);
            toast.success(entries.length === 1 ? 'Price updated' : `${entries.length} prices updated`);
            Keyboard.dismiss();
            sheetRef.current?.dismiss(onClose);
        } catch (e) {
            logger.error('Failed to update prices', e);
            toast.error("Couldn't save the prices");
        } finally {
            busyRef.current = false;
            setSaving(false);
        }
    };

    if (showCalendar) {
        return (
            <CalendarPicker
                selectedDate={date}
                onSelectDate={d => { setDate(d); setShowCalendar(false); }}
                onClose={() => setShowCalendar(false)}
            />
        );
    }

    return (
        <BottomSheet
            ref={sheetRef}
            visible={visible}
            onClose={onClose}
            maxHeight="92%"
            paddingHorizontal={24}
            paddingTop={16}
            paddingBottom={insets.bottom + 32}
            keyboardAvoiding
        >
            <SheetHeader
                kicker="Portfolio"
                title={holdings.length === 1 ? `Update ${holdings[0].holding.symbol || holdings[0].holding.name}` : 'Update prices'}
                onClose={close}
            />

            <FormScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
            >
                <ThemedText type="caption" className="mb-4">
                    Type the latest price per unit. Leave a field empty to keep its current price.
                </ThemedText>

                {holdings.map(s => {
                    const h = s.holding;
                    const last = s.price
                        ? `Now ${formatPrice(s.price.price, fmt, symbol)} · ${formatShortDay(s.price.date)}`
                        : 'No price yet';
                    return (
                        <Field
                            key={h.id}
                            label={h.symbol ? `${h.symbol} · ${h.name}` : h.name}
                            value={values[h.id] ?? ''}
                            onChange={v => setValues(prev => ({ ...prev, [h.id]: v }))}
                            placeholder={s.price ? String(s.price.price) : '0.00'}
                            prefix={symbol}
                            numeric
                            hint={last}
                            error={errors[h.id]}
                        />
                    );
                })}

                <DateRow label="Prices as of" date={date} onPress={() => { Keyboard.dismiss(); setShowCalendar(true); }} />
                {!!dateError && (
                    <ThemedText type="caption" className="-mt-3 mb-4" style={{ color: colors.expense }}>{dateError}</ThemedText>
                )}

                <AppButton
                    label={filled.length > 1 ? `Save ${filled.length} prices` : 'Save'}
                    onPress={handleSave}
                    loading={saving}
                    disabled={saving || filled.length === 0}
                />
                {filled.length === 0 && (
                    <ThemedText type="caption" className="text-center mt-2" style={{ color: colors.textMuted }}>
                        Enter at least one price
                    </ThemedText>
                )}
            </FormScrollView>
        </BottomSheet>
    );
}
