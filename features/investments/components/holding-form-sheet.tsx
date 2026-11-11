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
import { createHolding, updateHolding, type InvestmentHolding } from '@/lib/db/queries';
import type { AssetType } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { getCurrencySymbol, parseAmount } from '@/lib/utils/currency';
import { todayString } from '@/lib/utils/date';
import { useModalActions } from '@/providers/modal-context';
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { unitLabel } from '../utils';
import { AssetTypeChips, DateRow, Field } from './form-parts';

interface HoldingFormSheetProps {
    visible: boolean;
    onClose: () => void;
    /** Edit this holding; omit to add a new one. */
    editing?: InvestmentHolding | null;
    onSaved?: (holdingId: number) => void;
}

type Errors = Partial<Record<'name' | 'quantity' | 'price' | 'fees' | 'current' | 'date', string>>;

/** Decimal places kept for quantities (fractional coins) and per-unit prices. */
export const QTY_DECIMALS = 8;
export const PRICE_DECIMALS = 6;

/**
 * Add a holding (with an optional first purchase and current price), or edit
 * an existing one's name, symbol, market, type and notes.
 */
export function HoldingFormSheet({ visible, onClose, editing, onSaved }: HoldingFormSheetProps) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const { profile } = useUser();
    const { triggerRefresh } = useModalActions();
    const sheetRef = useRef<BottomSheetRef>(null);
    const symbol = getCurrencySymbol(profile.currency);
    const fmt = (n: number) => UserService.formatCurrency(n, profile.currency);
    const isEditing = !!editing;

    const [name, setName] = useState('');
    const [ticker, setTicker] = useState('');
    const [market, setMarket] = useState('');
    const [type, setType] = useState<AssetType>('stock');
    const [quantity, setQuantity] = useState('');
    const [price, setPrice] = useState('');
    const [fees, setFees] = useState('');
    const [date, setDate] = useState(todayString());
    const [current, setCurrent] = useState('');
    const [notes, setNotes] = useState('');
    const [errors, setErrors] = useState<Errors>({});
    const [saving, setSaving] = useState(false);
    // Blocks a second tap before `saving` has re-rendered the button.
    const busyRef = useRef(false);
    const [showCalendar, setShowCalendar] = useState(false);

    useEffect(() => {
        if (!visible) return;
        setName(editing?.name ?? '');
        setTicker(editing?.symbol ?? '');
        setMarket(editing?.market ?? '');
        setType(editing?.asset_type ?? 'stock');
        setNotes(editing?.notes ?? '');
        setQuantity('');
        setPrice('');
        setFees('');
        setCurrent('');
        setDate(todayString());
        setErrors({});
    }, [visible, editing]);

    const qty = parseAmount(quantity, QTY_DECIMALS);
    const unitPrice = parseAmount(price, PRICE_DECIMALS);
    const feeValue = fees.trim() ? parseAmount(fees) : 0;
    const total = qty > 0 && unitPrice >= 0 && feeValue >= 0 ? qty * unitPrice + feeValue : null;

    const close = () => {
        Keyboard.dismiss();
        sheetRef.current?.dismiss(onClose);
    };

    const handleSave = async () => {
        if (busyRef.current) return;
        const next: Errors = {};
        if (!name.trim()) next.name = 'Give the holding a name';

        const wantsTrade = !isEditing && (quantity.trim() !== '' || price.trim() !== '');
        if (wantsTrade) {
            if (!(qty > 0)) next.quantity = 'Enter how many you bought';
            if (price.trim() === '' || !(unitPrice >= 0)) next.price = 'Enter the price per unit (0 for bonus shares)';
            if (!(feeValue >= 0)) next.fees = 'Enter fees as a number, or leave it empty';
            if (date > todayString()) next.date = "The date can't be in the future";
        }
        const currentPrice = current.trim() ? parseAmount(current, PRICE_DECIMALS) : null;
        if (!isEditing && current.trim() && !(currentPrice! >= 0)) next.current = 'Enter a price, or leave it empty';

        setErrors(next);
        if (Object.keys(next).length) return;

        busyRef.current = true;
        setSaving(true);
        try {
            const fields = { name, symbol: ticker, market, asset_type: type, notes, color: editing?.color ?? null };
            let id: number;
            if (editing) {
                await updateHolding(editing.id, fields);
                id = editing.id;
                toast.success('Holding updated');
            } else {
                const created = await createHolding(
                    fields,
                    wantsTrade
                        ? { type: 'buy', date, quantity: qty, price: unitPrice, fees: feeValue, amount: null, notes: null }
                        : null,
                    currentPrice != null ? { price: currentPrice, date: todayString() } : null,
                );
                id = created.id;
                toast.success('Holding added', name.trim());
            }
            triggerRefresh(['investments']);
            Keyboard.dismiss();
            sheetRef.current?.dismiss(() => {
                onClose();
                onSaved?.(id);
            });
        } catch (e) {
            logger.error('Failed to save holding', e);
            toast.error("Couldn't save the holding");
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

    const units = unitLabel(type);

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
            <SheetHeader kicker="Portfolio" title={isEditing ? 'Edit holding' : 'Add a holding'} onClose={close} />

            <FormScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
            >
                <Field
                    label="Name"
                    value={name}
                    onChange={setName}
                    placeholder="e.g. Engro Corporation"
                    error={errors.name}
                    autoCapitalize="words"
                    returnKeyType="next"
                />

                <View className="flex-row" style={{ gap: 12 }}>
                    <View className="flex-1">
                        <Field
                            label="Symbol (optional)"
                            value={ticker}
                            onChange={setTicker}
                            placeholder="ENGRO"
                            autoCapitalize="characters"
                            autoCorrect={false}
                        />
                    </View>
                    <View className="flex-1">
                        <Field
                            label="Market (optional)"
                            value={market}
                            onChange={setMarket}
                            placeholder="PSX"
                            autoCapitalize="characters"
                            autoCorrect={false}
                        />
                    </View>
                </View>

                <View className="mb-6">
                    <ThemedText type="kicker" className="mb-3">Type</ThemedText>
                    <AssetTypeChips value={type} onChange={setType} />
                </View>

                {!isEditing && (
                    <>
                        <View className="mb-4 pt-5 border-t border-divider dark:border-dark-divider">
                            <ThemedText type="label">First purchase</ThemedText>
                            <ThemedText type="caption">Optional. You can add buys, sells and dividends later.</ThemedText>
                        </View>
                        <View className="flex-row" style={{ gap: 12 }}>
                            <View className="flex-1">
                                <Field
                                    label="Quantity"
                                    value={quantity}
                                    onChange={setQuantity}
                                    placeholder="0"
                                    suffix={units}
                                    numeric
                                    error={errors.quantity}
                                />
                            </View>
                            <View className="flex-1">
                                <Field
                                    label="Price per unit"
                                    value={price}
                                    onChange={setPrice}
                                    placeholder="0.00"
                                    prefix={symbol}
                                    numeric
                                    error={errors.price}
                                />
                            </View>
                        </View>
                        <Field
                            label="Fees (optional)"
                            value={fees}
                            onChange={setFees}
                            placeholder="Brokerage, tax, etc."
                            prefix={symbol}
                            numeric
                            error={errors.fees}
                        />
                        <DateRow label="Bought on" date={date} onPress={() => { Keyboard.dismiss(); setShowCalendar(true); }} />
                        {!!errors.date && (
                            <ThemedText type="caption" className="-mt-3 mb-4" style={{ color: colors.expense }}>{errors.date}</ThemedText>
                        )}
                        {total != null && (
                            <View className="flex-row justify-between mb-5 px-1">
                                <ThemedText type="caption">Total cost</ThemedText>
                                <ThemedText type="figure">{fmt(total)}</ThemedText>
                            </View>
                        )}

                        <Field
                            label="Current price (optional)"
                            value={current}
                            onChange={setCurrent}
                            placeholder="Leave empty to use the purchase price"
                            prefix={symbol}
                            numeric
                            error={errors.current}
                            hint="Prices are typed in by you. Update them any time from the portfolio."
                        />
                    </>
                )}

                <Field
                    label="Notes (optional)"
                    value={notes}
                    onChange={setNotes}
                    placeholder="Anything to remember"
                    multiline
                />

                <AppButton
                    label={isEditing ? 'Save changes' : 'Add holding'}
                    onPress={handleSave}
                    loading={saving}
                    disabled={saving}
                />
            </FormScrollView>
        </BottomSheet>
    );
}
