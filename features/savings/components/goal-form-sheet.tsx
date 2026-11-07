import { AppButton, BottomSheet, BottomSheetRef, CalendarPicker, FormScrollView, SheetHeader, ThemedText, toLocalDateStr } from '@/components/common';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { createSavingsGoal, updateSavingsGoal } from '@/lib/db/queries';
import type { SavingsGoal } from '@/lib/db/schema';
import { formatWithCommas, numberToWords, parseAmount } from '@/lib/utils/currency';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { IoniconsName } from '@/types';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GOAL_COLORS, GOAL_ICONS, defaultDeadline, formatDeadlineDisplay } from '../utils';

interface GoalFormSheetProps {
    goal: SavingsGoal | null;
    onClose: () => void;
    onSuccess: () => void;
    /** Edit mode only: shows a Delete link that hands off to the caller's confirm sheet. */
    onDelete?: () => void;
}

export function GoalFormSheet({ goal, onClose, onSuccess, onDelete }: GoalFormSheetProps) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const sheetRef = useRef<BottomSheetRef>(null);

    const [name, setName] = useState(goal?.name ?? '');
    const [target, setTarget] = useState(goal ? String(goal.target_amount) : '');
    const [alreadySaved, setAlreadySaved] = useState('');
    const [selectedColor, setSelectedColor] = useState(goal?.color ?? GOAL_COLORS[0]);
    const [selectedIcon, setSelectedIcon] = useState(goal?.icon ?? GOAL_ICONS[0]);
    const [deadline, setDeadline] = useState<string>(goal?.deadline ?? defaultDeadline());
    const [showCalendar, setShowCalendar] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        // Open animation handled by BottomSheet on mount
    }, []);

    const handleClose = () => {
        Keyboard.dismiss();
        sheetRef.current?.dismiss(onClose);
    };

    const todayStr = toLocalDateStr(new Date());
    const wordDisplay = !!target && !isNaN(parseAmount(target)) && parseAmount(target) > 0;

    const handleSave = async () => {
        if (!name.trim()) { toast.error('Enter a goal name'); return; }
        const amount = parseAmount(target);
        if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid target amount'); return; }
        // An overdue goal can still be edited without moving its deadline.
        const deadlineChanged = !goal || deadline !== goal.deadline;
        if (deadlineChanged && deadline <= todayStr) { toast.error('Deadline must be in the future'); return; }
        const savedSoFar = parseAmount(alreadySaved) || 0;
        if (savedSoFar < 0) { toast.error('Already saved amount cannot be negative'); return; }
        if (!goal && savedSoFar > amount) { toast.error('Already saved cannot exceed the target'); return; }
        setSaving(true);
        try {
            const payload = { name: name.trim(), target_amount: amount, color: selectedColor, icon: selectedIcon, deadline };
            if (goal) {
                // Keep the flag in sync both ways: lowering the target to (or below)
                // the saved amount completes the goal; raising it reopens it.
                await updateSavingsGoal(goal.id, {
                    ...payload,
                    is_completed: Math.round(goal.saved_amount * 100) >= Math.round(amount * 100) ? 1 : 0,
                });
                toast.success('Goal updated!');
            } else {
                const created = await createSavingsGoal({ ...payload, saved_amount: savedSoFar });
                if (savedSoFar >= amount && created?.id) {
                    await updateSavingsGoal(created.id, { is_completed: 1 });
                }
                toast.success('Goal created!');
            }
            onSuccess();
        } catch (e) {
            logger.error('Failed to save goal', e);
            toast.error('Failed to save goal');
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <BottomSheet
                ref={sheetRef}
                visible
                onClose={onClose}
                maxHeight="95%"
                paddingHorizontal={24}
                paddingTop={16}
                paddingBottom={insets.bottom + 40}
                keyboardAvoiding
            >
                <SheetHeader kicker={goal ? 'Savings goal' : 'New goal'} title={goal ? goal.name : 'What are you saving for?'} onClose={handleClose} />

                <FormScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
                    {/* Goal Name */}
                    <ThemedText type="kicker" className="mb-2">
                        Goal Name
                    </ThemedText>
                    <TextInput
                        value={name}
                        onChangeText={setName}
                        placeholder="e.g. New Car, Vacation..."
                        placeholderTextColor={colors.textMuted}
                        className="w-full rounded-xl py-3 px-4 text-sm font-semibold mb-6 border border-borderSoft dark:border-dark-borderSoft"
                        style={{ color: colors.textPrimary, backgroundColor: colors.backgroundAlt, fontFamily: 'PlusJakartaSans_600SemiBold' }}
                    />

                    {/* Target Amount */}
                    <ThemedText type="kicker" className="mb-2">
                        Target Amount
                    </ThemedText>
                    <TextInput
                        value={target}
                        onChangeText={setTarget}
                        placeholder="0"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="decimal-pad"
                        className="w-full rounded-xl px-4 mb-2 border border-borderSoft dark:border-dark-borderSoft"
                        style={{ color: colors.textPrimary, fontSize: 32, fontFamily: 'SpaceGrotesk_700Bold', paddingVertical: 12, backgroundColor: colors.backgroundAlt }}
                    />
                    {wordDisplay ? (
                        <View className="items-center mb-6 gap-0.5">
                            <ThemedText className="text-sm font-bold" style={{ color: colors.primary }}>{formatWithCommas(target)}</ThemedText>
                            <ThemedText className="text-[11px]" style={{ color: colors.textMuted }}>{numberToWords(parseAmount(target))}</ThemedText>
                        </View>
                    ) : (
                        <View className="mb-6" />
                    )}

                    {/* Already Saved — only on create */}
                    {!goal && (
                        <>
                            <ThemedText type="kicker" className="mb-2">
                                Already Saved (Optional)
                            </ThemedText>
                            <TextInput
                                value={alreadySaved}
                                onChangeText={setAlreadySaved}
                                placeholder="0"
                                placeholderTextColor={colors.textMuted}
                                keyboardType="decimal-pad"
                                className="w-full rounded-xl px-4 mb-2 border border-borderSoft dark:border-dark-borderSoft"
                                style={{ color: colors.textPrimary, fontSize: 28, fontFamily: 'SpaceGrotesk_700Bold', paddingVertical: 10, backgroundColor: colors.backgroundAlt }}
                            />
                            {!!alreadySaved && !isNaN(parseAmount(alreadySaved)) && parseAmount(alreadySaved) > 0 ? (
                                <View className="items-center mb-6 gap-0.5">
                                    <ThemedText className="text-sm font-bold" style={{ color: colors.primary }}>{formatWithCommas(alreadySaved)}</ThemedText>
                                    <ThemedText className="text-[11px]" style={{ color: colors.textMuted }}>{numberToWords(parseAmount(alreadySaved))}</ThemedText>
                                </View>
                            ) : (
                                <View className="mb-6" />
                            )}
                        </>
                    )}

                    {/* Deadline */}
                    <ThemedText type="kicker" className="mb-2">
                        Deadline
                    </ThemedText>
                    <Pressable
                        onPress={() => setShowCalendar(v => !v)}
                        className="h-12 rounded-xl px-4 flex-row items-center justify-between mb-8 border border-borderSoft dark:border-dark-borderSoft"
                        style={{ backgroundColor: colors.backgroundAlt }}
                    >
                        <View className="flex-row items-center gap-2">
                            <Ionicons name="calendar-outline" size={16} color={colors.primary} />
                            <ThemedText className="text-sm font-semibold" style={{ color: colors.primary }}>
                                {formatDeadlineDisplay(deadline)}
                            </ThemedText>
                        </View>
                        <Ionicons name={showCalendar ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
                    </Pressable>

                    {/* Color */}
                    <ThemedText type="kicker" className="mb-3">
                        Color
                    </ThemedText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-6">
                        <View className="flex-row gap-2 pb-1">
                            {GOAL_COLORS.map(c => (
                                <Pressable
                                    key={c}
                                    onPress={() => setSelectedColor(c)}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: selectedColor === c }}
                                    accessibilityLabel={`Colour ${GOAL_COLORS.indexOf(c) + 1}`}
                                    style={{
                                        width: 44, height: 44, borderRadius: 22,
                                        alignItems: 'center', justifyContent: 'center',
                                        borderWidth: 2,
                                        borderColor: selectedColor === c ? colors.textPrimary : 'transparent',
                                    }}
                                >
                                    <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c }} />
                                </Pressable>
                            ))}
                        </View>
                    </ScrollView>

                    {/* Icon */}
                    <ThemedText type="kicker" className="mb-3">
                        Icon
                    </ThemedText>
                    <View className="flex-row flex-wrap gap-2 mb-8">
                        {GOAL_ICONS.map(ic => (
                            <Pressable
                                key={ic}
                                onPress={() => setSelectedIcon(ic)}
                                accessibilityRole="radio"
                                accessibilityState={{ selected: selectedIcon === ic }}
                                accessibilityLabel={ic.replace(/-/g, ' ')}
                                style={{
                                    width: 44, height: 44, borderRadius: 12,
                                    alignItems: 'center', justifyContent: 'center',
                                    backgroundColor: selectedIcon === ic ? `${selectedColor}25` : `${selectedColor}10`,
                                    borderWidth: selectedIcon === ic ? 2 : 1,
                                    borderColor: selectedIcon === ic ? selectedColor : `${selectedColor}30`,
                                }}
                            >
                                <Ionicons
                                    name={ic as IoniconsName}
                                    size={20}
                                    color={selectedIcon === ic ? selectedColor : `${selectedColor}80`}
                                />
                            </Pressable>
                        ))}
                    </View>

                    <AppButton
                        label={goal ? 'Save changes' : 'Create goal'}
                        onPress={handleSave}
                        loading={saving}
                        disabled={saving}
                    />

                    {!!goal && !!onDelete && (
                        <Pressable
                            onPress={() => sheetRef.current?.dismiss(onDelete)}
                            accessibilityRole="button"
                            className="mt-4 min-h-[44px] items-center justify-center"
                        >
                            <ThemedText type="label" style={{ color: colors.expense }}>Delete goal</ThemedText>
                        </Pressable>
                    )}
                </FormScrollView>
            </BottomSheet>

            {showCalendar && (
                <CalendarPicker
                    selectedDate={deadline}
                    onSelectDate={d => { setDeadline(d); setShowCalendar(false); }}
                    onClose={() => setShowCalendar(false)}
                    minimumDate={defaultDeadline()}
                    quickActions={[]}
                />
            )}
        </>
    );
}
