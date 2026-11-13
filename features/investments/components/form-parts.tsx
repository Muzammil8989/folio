import { AppButton, AppModal, StatFigure, ThemedText } from '@/components/common';
import { Pressable } from '@/components/common/pressable';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { ASSET_TYPES, type AssetType } from '@/lib/db/schema';
import { parseLocalDate } from '@/lib/utils/date';
import { fonts } from '@/theme/typography';
import { Ionicons } from '@expo/vector-icons';
import React, { forwardRef } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import Animated, { Easing, FadeInUp, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ASSET_TYPE_ICONS, ASSET_TYPE_LABELS } from '../utils';

/** "12 Mar 2026" */
export function formatDay(date: string): string {
    return parseLocalDate(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "12 Mar" this year, "12 Mar 2025" otherwise. */
export function formatShortDay(date: string, now: Date = new Date()): string {
    const d = parseLocalDate(date);
    return d.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    });
}

interface FieldProps extends Omit<TextInputProps, 'value' | 'onChangeText' | 'onChange'> {
    label: string;
    value: string;
    onChange: (v: string) => void;
    /** Text before the input, e.g. a currency symbol. */
    prefix?: string;
    /** Text after the input, e.g. "shares". */
    suffix?: string;
    /** Line under the field. */
    hint?: string;
    error?: string | null;
    numeric?: boolean;
    containerClassName?: string;
}

/** Labelled input in the app's form style; numeric fields use the figure font. */
export const Field = forwardRef<TextInput, FieldProps>(function Field(
    { label, value, onChange, prefix, suffix, hint, error, numeric, containerClassName = 'mb-5', ...rest },
    ref,
) {
    const colors = useThemeColors();
    return (
        <View className={containerClassName}>
            <ThemedText type="kicker" className="mb-2">{label}</ThemedText>
            <View
                className="flex-row items-center rounded-xl px-4"
                style={{
                    backgroundColor: colors.backgroundAlt,
                    borderWidth: 1,
                    borderColor: error ? colors.expense : 'transparent',
                    minHeight: 52,
                }}
            >
                {!!prefix && (
                    <ThemedText style={{ color: colors.textMuted, fontFamily: fonts.figure, marginRight: 6 }}>{prefix}</ThemedText>
                )}
                <TextInput
                    ref={ref}
                    value={value}
                    onChangeText={onChange}
                    placeholderTextColor={colors.textMuted}
                    keyboardType={numeric ? 'decimal-pad' : rest.keyboardType}
                    accessibilityLabel={label}
                    underlineColorAndroid="transparent"
                    style={{
                        flex: 1,
                        paddingVertical: 14,
                        fontSize: 16,
                        color: colors.textPrimary,
                        fontFamily: numeric ? fonts.figureSemiBold : fonts.sansSemiBold,
                    }}
                    {...rest}
                />
                {!!suffix && <ThemedText type="caption" style={{ marginLeft: 6 }}>{suffix}</ThemedText>}
            </View>
            {!!error && (
                <ThemedText type="caption" className="mt-1.5" style={{ color: colors.expense }} accessibilityLiveRegion="polite">
                    {error}
                </ThemedText>
            )}
            {!error && !!hint && <ThemedText type="caption" className="mt-1.5">{hint}</ThemedText>}
        </View>
    );
});

/** Tappable date row that opens the calendar. */
export function DateRow({ label = 'Date', date, onPress }: { label?: string; date: string; onPress: () => void }) {
    const colors = useThemeColors();
    return (
        <View className="mb-5">
            <ThemedText type="kicker" className="mb-2">{label}</ThemedText>
            <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel={`${label}: ${formatDay(date)}. Change`}
                className="flex-row items-center px-4 rounded-xl"
                style={({ pressed }) => ({ backgroundColor: pressed ? colors.borderSoft : colors.backgroundAlt, minHeight: 52 })}
            >
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
                <ThemedText className="flex-1 ml-3 font-semibold">{formatDay(date)}</ThemedText>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
        </View>
    );
}

/** Pick an asset type: wrapping chips with an icon each. */
export function AssetTypeChips({ value, onChange }: { value: AssetType; onChange: (t: AssetType) => void }) {
    const colors = useThemeColors();
    return (
        <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup">
            {ASSET_TYPES.map(type => {
                const on = type === value;
                return (
                    <Pressable
                        key={type}
                        onPress={() => onChange(type)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={ASSET_TYPE_LABELS[type]}
                        className="flex-row items-center rounded-full px-3.5"
                        style={({ pressed }) => ({
                            minHeight: 40,
                            borderWidth: on ? 1.5 : 1,
                            borderColor: on ? colors.textPrimary : colors.divider,
                            backgroundColor: on ? colors.surface : pressed ? colors.backgroundAlt : 'transparent',
                        })}
                    >
                        <Ionicons name={ASSET_TYPE_ICONS[type]} size={15} color={on ? colors.primary : colors.textMuted} />
                        <ThemedText type="label" className="ml-1.5" style={{ color: on ? colors.textPrimary : colors.textSecondary }}>
                            {ASSET_TYPE_LABELS[type]}
                        </ThemedText>
                    </Pressable>
                );
            })}
        </View>
    );
}

/** Horizontal filter chips, e.g. All · Stocks · Crypto. */
export function FilterChips<K extends string>({
    options,
    value,
    onChange,
}: {
    options: { key: K; label: string }[];
    value: K;
    onChange: (k: K) => void;
}) {
    const colors = useThemeColors();
    return (
        <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="tablist">
            {options.map(o => {
                const on = o.key === value;
                return (
                    <Pressable
                        key={o.key}
                        onPress={() => onChange(o.key)}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: on }}
                        className="rounded-full px-3.5 justify-center"
                        style={({ pressed }) => ({
                            minHeight: 36,
                            backgroundColor: on ? colors.textPrimary : pressed ? colors.backgroundAlt : 'transparent',
                            borderWidth: 1,
                            borderColor: on ? colors.textPrimary : colors.divider,
                        })}
                    >
                        <ThemedText type="label" style={{ color: on ? colors.background : colors.textSecondary }}>{o.label}</ThemedText>
                    </Pressable>
                );
            })}
        </View>
    );
}

/** One key figure in a surface tile; two tiles per row. */
export function FigureTile({
    label,
    value,
    valueColor,
    detail,
    definition,
}: {
    label: string;
    value: string;
    valueColor?: string;
    /** A short figure under the value, e.g. a percentage. */
    detail?: string;
    /** One short line saying what this figure means. */
    definition?: string;
}) {
    return (
        <View
            className="rounded-2xl border border-divider dark:border-dark-divider bg-surface dark:bg-dark-surface px-4 py-3"
            style={{ flexBasis: '46%', flexGrow: 1 }}
        >
            <StatFigure label={label} value={value} valueColor={valueColor} size="sm" />
            {!!detail && <ThemedText type="caption" className="mt-0.5" numberOfLines={1}>{detail}</ThemedText>}
            {!!definition && (
                <ThemedText type="caption" className="mt-1.5 text-[11px] leading-[15px]" style={{ opacity: 0.8 }} numberOfLines={2}>
                    {definition}
                </ThemedText>
            )}
        </View>
    );
}

/** One-line definitions shown under the portfolio figures. */
export const FIGURE_DEFINITIONS = {
    invested: 'What you paid for the units you still hold.',
    unrealised: 'Profit or loss on paper: not sold yet.',
    realised: 'Profit or loss locked in by selling.',
    dividends: 'Cash paid out to you.',
    avgCost: 'Invested ÷ quantity, fees included.',
    totalReturn: 'Unrealised + realised + dividends.',
} as const;

/** Confirmation sheet for destructive actions. */
export function ConfirmDialog({
    title,
    message,
    confirmLabel,
    onConfirm,
    onCancel,
    busy,
}: {
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
    busy?: boolean;
}) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    return (
        <AppModal visible animationType="fade" transparent onRequestClose={onCancel}>
            <View className="flex-1 justify-end bg-black/50">
                <Animated.View
                    entering={FadeInUp.duration(300).easing(Easing.out(Easing.cubic))}
                    exiting={FadeOutDown.duration(200).easing(Easing.in(Easing.cubic))}
                    style={{
                        backgroundColor: colors.surface,
                        borderTopLeftRadius: 24,
                        borderTopRightRadius: 24,
                        paddingHorizontal: 24,
                        paddingTop: 16,
                        paddingBottom: insets.bottom + 32,
                        borderTopWidth: 1,
                        borderColor: colors.divider,
                    }}
                >
                    <View className="w-9 h-1 bg-borderStrong dark:bg-dark-borderStrong rounded-full mx-auto mb-5" />
                    <View className="w-16 h-16 items-center justify-center mx-auto mb-4">
                        <Ionicons name="trash-outline" size={32} color={colors.expense} />
                    </View>
                    <ThemedText type="headline" className="text-center mb-2" accessibilityRole="header">{title}</ThemedText>
                    <ThemedText className="text-[15px] text-center leading-6 mb-7 px-2" style={{ color: colors.textSecondary }}>
                        {message}
                    </ThemedText>
                    <View className="flex-row gap-3">
                        <AppButton label="Cancel" onPress={onCancel} variant="secondary" flex />
                        <AppButton label={confirmLabel} onPress={onConfirm} variant="destructive" loading={busy} disabled={busy} flex />
                    </View>
                </Animated.View>
            </View>
        </AppModal>
    );
}
