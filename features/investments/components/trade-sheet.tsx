import {
    AppButton,
    BottomSheet,
    CalendarPicker,
    FormScrollView,
    SegmentedControl,
    SheetHeader,
    ThemedText,
    type BottomSheetRef,
    type SegmentOption,
} from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { useUser } from '@/features/user/context/user-context';
import { UserService } from '@/features/user/services/user-service';
import { useThemeColors } from '@/hooks/use-theme-colors';
import {
    createTrade,
    deleteTrade,
    updateTrade,
    type InvestmentHolding,
    type InvestmentTrade,
    type TradeInput,
} from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { getCurrencySymbol } from '@/lib/utils/currency';
import { todayString } from '@/lib/utils/date';
import { useModalActions } from '@/providers/modal-context';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    computePosition,
    formatQuantity,
    formatSigned,
    NEW_TRADE_ID,
    parseFormNumber,
    PRICE_DECIMALS,
    QTY_DECIMALS,
    toInputNumber,
    unitLabel,
    validateTradeChange,
    type OversellError,
    type TradeType,
} from '../utils';
import { DateRow, Field, formatDay } from './form-parts';

const TYPE_OPTIONS: readonly SegmentOption<TradeType>[] = [
    { key: 'buy', label: 'Buy' },
    { key: 'sell', label: 'Sell' },
    { key: 'dividend', label: 'Dividend' },
];

interface TradeSheetProps {
    visible: boolean;
    onClose: () => void;
    holding: InvestmentHolding;
    /** The holding's saved trades, to check sells against what's held. */
    trades: InvestmentTrade[];
    /** Edit this trade; omit to add one. */
    editing?: InvestmentTrade | null;
    initialType?: TradeType;
}

type Errors = Partial<Record<'quantity' | 'price' | 'fees' | 'amount' | 'date' | 'form', string>>;

/** "You'd hold 40 shares on 12 Mar 2026, but this sells 50." */
export function describeOversell(err: OversellError, unit: (q: number) => string): string {
    if (err.held <= 0) return `You don't hold any ${unit(2)} on ${formatDay(err.date)}.`;
    return `You'd hold ${formatQuantity(err.held)} ${unit(err.held)} on ${formatDay(err.date)}, but this sells ${formatQuantity(err.selling)}.`;
}

export function TradeSheet({ visible, onClose, holding, trades, editing, initialType = 'buy' }: TradeSheetProps) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const { profile } = useUser();
    const { triggerRefresh } = useModalActions();
    const sheetRef = useRef<BottomSheetRef>(null);
    const symbol = getCurrencySymbol(profile.currency);
    const fmt = (n: number) => UserService.formatCurrency(n, profile.currency);
    const unit = (q: number) => unitLabel(holding.asset_type, q);

    const [type, setType] = useState<TradeType>(initialType);
    const [quantity, setQuantity] = useState('');
    const [price, setPrice] = useState('');
    const [fees, setFees] = useState('');
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(todayString());
    const [notes, setNotes] = useState('');
    const [errors, setErrors] = useState<Errors>({});
    const [saving, setSaving] = useState(false);
    // Blocks a second tap before `saving` has re-rendered the button.
    const busyRef = useRef(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [showCalendar, setShowCalendar] = useState(false);

    useEffect(() => {
        if (!visible) return;
        setType(editing?.type ?? initialType);
        setQuantity(editing?.quantity != null ? toInputNumber(editing.quantity, QTY_DECIMALS) : '');
        setPrice(editing?.price != null ? toInputNumber(editing.price, PRICE_DECIMALS) : '');
        setFees(editing?.fees ? toInputNumber(editing.fees, 2) : '');
        setAmount(editing?.amount != null ? toInputNumber(editing.amount, 2) : '');
        setDate(editing?.date ?? todayString());
        setNotes(editing?.notes ?? '');
        setErrors({});
        setConfirmDelete(false);
    }, [visible, editing, initialType]);

    // What's held on the chosen date, without the trade being edited.
    const others = useMemo(() => trades.filter(t => t.id !== editing?.id), [trades, editing]);
    const heldOnDate = useMemo(() => computePosition(others.filter(t => t.date <= date)), [others, date]);

    const qty = parseFormNumber(quantity, QTY_DECIMALS);
    const unitPrice = parseFormNumber(price, PRICE_DECIMALS);
    const feeValue = fees.trim() ? parseFormNumber(fees) : 0;
    const gross = qty > 0 && unitPrice >= 0 ? qty * unitPrice : null;
    const isEditing = !!editing;

    const close = () => {
        Keyboard.dismiss();
        sheetRef.current?.dismiss(onClose);
    };

    const finish = (message: string) => {
        triggerRefresh(['investments']);
        toast.success(message);
        Keyboard.dismiss();
        sheetRef.current?.dismiss(onClose);
    };

    const handleSave = async () => {
        if (busyRef.current) return;
        const next: Errors = {};
        let input: TradeInput;
        if (type === 'dividend') {
            const value = parseFormNumber(amount);
            if (!(value > 0)) next.amount = 'Enter the amount you received';
            input = { type, date, quantity: null, price: null, fees: 0, amount: value, notes };
        } else {
            if (!(qty > 0)) next.quantity = `Enter how many ${unit(2)}`;
            if (price.trim() === '' || !(unitPrice >= 0)) {
                next.price = type === 'buy' ? 'Enter the price per unit (0 for bonus shares)' : 'Enter the price per unit';
            }
            if (!(feeValue >= 0)) next.fees = 'Enter fees as a number, or leave it empty';
            input = { type, date, quantity: qty, price: unitPrice, fees: feeValue, amount: null, notes };
        }
        if (date > todayString()) next.date = "The date can't be in the future";

        if (!Object.keys(next).length) {
            const err = validateTradeChange(trades, {
                add: { ...input, id: editing?.id ?? NEW_TRADE_ID, fees: input.fees ?? 0 } as InvestmentTrade,
                replaceId: editing?.id,
            });
            if (err) next.form = describeOversell(err, unit);
        }
        setErrors(next);
        if (Object.keys(next).length) return;

        busyRef.current = true;
        setSaving(true);
        try {
            if (editing) await updateTrade(editing.id, input);
            else await createTrade(holding.id, input);
            finish(isEditing ? 'Entry updated' : type === 'dividend' ? 'Dividend added' : type === 'buy' ? 'Purchase added' : 'Sale added');
        } catch (e) {
            logger.error('Failed to save trade', e);
            toast.error("Couldn't save this entry");
        } finally {
            busyRef.current = false;
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!editing || busyRef.current) return;
        const err = validateTradeChange(trades, { removeId: editing.id });
        if (err) {
            setConfirmDelete(false);
            setErrors({ form: `Can't delete this: a later sale needs these ${unit(2)}. ${describeOversell(err, unit)}` });
            return;
        }
        busyRef.current = true;
        setSaving(true);
        try {
            await deleteTrade(editing.id);
            finish('Entry deleted');
        } catch (e) {
            logger.error('Failed to delete trade', e);
            toast.error("Couldn't delete this entry");
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

    const title = isEditing ? 'Edit entry' : type === 'buy' ? 'Record a purchase' : type === 'sell' ? 'Record a sale' : 'Record a dividend';
    const avg = heldOnDate.avgCost;
    const sellResult = type === 'sell' && gross != null && heldOnDate.quantity > 0
        ? gross - feeValue - Math.min(qty, heldOnDate.quantity) * avg
        : null;

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
            <SheetHeader kicker={holding.symbol || holding.name} title={title} onClose={close} />

            <FormScrollView
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
            >
                <SegmentedControl options={TYPE_OPTIONS} value={type} onChange={t => { setType(t); setErrors({}); }} className="mb-6" />

                {type === 'dividend' ? (
                    <Field
                        label="Amount received"
                        value={amount}
                        onChange={setAmount}
                        placeholder="0.00"
                        prefix={symbol}
                        numeric
                        error={errors.amount}
                        hint="What reached you, after any tax withheld."
                    />
                ) : (
                    <>
                        <View className="flex-row" style={{ gap: 12 }}>
                            <View className="flex-1">
                                <Field
                                    label="Quantity"
                                    value={quantity}
                                    onChange={setQuantity}
                                    placeholder="0"
                                    suffix={unit(qty || 2)}
                                    numeric
                                    error={errors.quantity}
                                    hint={quantity.includes(',') && qty > 0 ? `Read as ${formatQuantity(qty)}` : undefined}
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
                        {type === 'sell' && (
                            <View className="flex-row items-center justify-between -mt-2 mb-4">
                                <ThemedText type="caption">
                                    {heldOnDate.quantity > 0
                                        ? `Held on this date: ${formatQuantity(heldOnDate.quantity)} ${unit(heldOnDate.quantity)}`
                                        : `Nothing held on this date`}
                                </ThemedText>
                                {heldOnDate.quantity > 0 && (
                                    <Pressable
                                        onPress={() => setQuantity(toInputNumber(heldOnDate.quantity, QTY_DECIMALS))}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Sell all ${formatQuantity(heldOnDate.quantity)}`}
                                        hitSlop={8}
                                        className="min-h-[36px] justify-center pl-3"
                                    >
                                        <ThemedText type="label" style={{ color: colors.primary }}>Sell all</ThemedText>
                                    </Pressable>
                                )}
                            </View>
                        )}
                        <Field
                            label="Fees (optional)"
                            value={fees}
                            onChange={setFees}
                            placeholder="Brokerage, tax, etc."
                            prefix={symbol}
                            numeric
                            error={errors.fees}
                        />
                    </>
                )}

                <DateRow date={date} onPress={() => { Keyboard.dismiss(); setShowCalendar(true); }} />
                {!!errors.date && (
                    <ThemedText type="caption" className="-mt-3 mb-4" style={{ color: colors.expense }}>{errors.date}</ThemedText>
                )}

                {type !== 'dividend' && gross != null && (
                    <View className="rounded-xl px-4 py-3 mb-5" style={{ backgroundColor: colors.backgroundAlt }}>
                        <View className="flex-row justify-between">
                            <ThemedText type="caption" className="flex-1 mr-3">{type === 'buy' ? 'Total cost' : 'You receive'}</ThemedText>
                            <ThemedText type="figure">
                                {fmt(type === 'buy' ? gross + Math.max(0, feeValue || 0) : gross - Math.max(0, feeValue || 0))}
                            </ThemedText>
                        </View>
                        {sellResult != null && (
                            <View className="flex-row justify-between items-start mt-1">
                                <ThemedText type="caption" className="flex-1 mr-3">Profit / loss (vs average cost {fmt(avg)})</ThemedText>
                                <ThemedText type="figure" style={{ color: sellResult >= 0 ? colors.income : colors.expense }}>
                                    {formatSigned(sellResult, fmt)}
                                </ThemedText>
                            </View>
                        )}
                    </View>
                )}

                <Field label="Notes (optional)" value={notes} onChange={setNotes} placeholder="Anything to remember" multiline />

                {!!errors.form && (
                    <View className="rounded-xl px-4 py-3 mb-4" style={{ borderWidth: 1, borderColor: colors.expense }} accessibilityLiveRegion="polite">
                        <ThemedText style={{ color: colors.expense }}>{errors.form}</ThemedText>
                    </View>
                )}

                <AppButton
                    label={isEditing ? 'Save changes' : 'Save'}
                    onPress={handleSave}
                    loading={saving && !confirmDelete}
                    disabled={saving}
                />

                {isEditing && (
                    <View className="mt-4">
                        {confirmDelete ? (
                            <View className="flex-row gap-3">
                                <AppButton label="Keep it" variant="secondary" onPress={() => setConfirmDelete(false)} flex />
                                <AppButton label="Delete entry" variant="destructive" onPress={handleDelete} loading={saving} disabled={saving} flex />
                            </View>
                        ) : (
                            <AppButton label="Delete this entry" variant="secondary" icon="trash-outline" onPress={() => setConfirmDelete(true)} />
                        )}
                    </View>
                )}
            </FormScrollView>
        </BottomSheet>
    );
}
