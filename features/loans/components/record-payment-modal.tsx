import { parseAmount } from '@/lib/utils/currency';
import { AmountInput, AppButton, BottomSheet, BottomSheetRef, FormScrollView, ThemedText } from '@/components/common';
import { CalendarPicker, toLocalDateStr } from '@/components/common/calendar-picker';
import { SystemLoanCategoryIds } from '@/features/loans/hooks/use-loans';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { createLoanPayment, LoanWithDetails, toCents } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { POPULAR_CURRENCIES, UserService } from '@/features/user/services/user-service';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface RecordPaymentModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  loan: LoanWithDetails | null;
  currencyCode: string;
  categoryIds: SystemLoanCategoryIds;
}

export function RecordPaymentModal({ visible, onClose, onSuccess, loan, currencyCode, categoryIds }: RecordPaymentModalProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const currencySymbol = POPULAR_CURRENCIES.find(c => c.code === currencyCode)?.symbol ?? '$';
  const sheetRef = useRef<BottomSheetRef>(null);

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(toLocalDateStr(new Date()));
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const amountInputRef = useRef<import('react-native').TextInput>(null);

  const isGiven = loan?.type === 'given';

  useEffect(() => {
    if (visible) {
      setAmount('');
      setDate(toLocalDateStr(new Date()));
      setNotes('');
      const t = setTimeout(() => amountInputRef.current?.focus(), 400);
      return () => clearTimeout(t);
    }
  }, [visible]);

  if (!loan) return null;

  const handleClose = () => {
    amountInputRef.current?.blur();
    Keyboard.dismiss();
    setShowDatePicker(false);
    sheetRef.current?.dismiss(onClose);
  };

  const handleSubmit = async () => {
    const parsed = parseAmount(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (toCents(parsed) > toCents(loan.remaining_amount)) {
      toast.error(`Amount exceeds remaining ${UserService.formatCurrency(loan.remaining_amount, currencyCode)}`);
      return;
    }
    setIsSubmitting(true);
    try {
      await createLoanPayment(
        { loan_id: loan.id, amount: parsed, date, notes: notes.trim() || null },
        { id: loan.id, type: loan.type, person_name: loan.person_name, account_id: loan.account_id, amount: loan.amount, settled_amount: loan.settled_amount },
        categoryIds
      );
      const isFullyPaid = toCents(parsed) >= toCents(loan.remaining_amount);
      toast.success(isFullyPaid ? 'Loan fully settled!' : 'Payment recorded');
      handleClose();
      onSuccess();
    } catch (e) {
      logger.error('RecordPaymentModal: failed', e);
      toast.error(e instanceof Error && e.message.startsWith('Payment is more') ? e.message : 'Failed to record payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDisplayDate = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (showDatePicker) {
    return <CalendarPicker selectedDate={date} onSelectDate={(d) => { setDate(d); setShowDatePicker(false); }} onClose={() => setShowDatePicker(false)} />;
  }

  return (
    <BottomSheet
      ref={sheetRef}
      visible={visible}
      onClose={onClose}
      maxHeight="85%"
      paddingHorizontal={28}
      paddingTop={48}
      paddingBottom={insets.bottom + 32}
      gradientColors={[`${colors.success}14`, `${colors.success}05`, 'transparent']}
      keyboardAvoiding
    >
      {/* Header */}
      <View className="flex-row items-center justify-between mb-6">
        <View className="flex-1">
          <ThemedText className="text-xl font-black" style={{ color: colors.textPrimary }}>
            {isGiven ? 'Record Repayment' : 'Record Payment'}
          </ThemedText>
          <ThemedText className="text-sm mt-0.5" style={{ color: colors.textMuted }}>
            {isGiven ? `From ${loan.person_name}` : `To ${loan.person_name}`}
          </ThemedText>
        </View>
        <Pressable onPress={handleClose} className="p-2" hitSlop={4} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* Remaining balance info */}
      <View
        className="flex-row items-center justify-between px-4 py-3.5 rounded-xl mb-6"
        style={{ backgroundColor: colors.successBg, borderWidth: 1, borderColor: colors.successBorder }}
      >
        <View>
          <ThemedText type="kicker" style={{ color: colors.successText }}>
            Remaining
          </ThemedText>
          <ThemedText className="text-lg font-black mt-0.5" style={{ color: colors.success, fontFamily: 'SpaceGrotesk_700Bold' }}>
            {UserService.formatCurrency(loan.remaining_amount, currencyCode)}
          </ThemedText>
        </View>
        <Pressable
          onPress={() => setAmount(String(loan.remaining_amount))}
          className="px-3 py-2 rounded-xl"
          style={{ backgroundColor: `${colors.success}20` }}
        >
          <ThemedText className="text-xs font-black" style={{ color: colors.success }}>
            Full Amount
          </ThemedText>
        </Pressable>
      </View>

      <FormScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
        <AmountInput
          ref={amountInputRef}
          value={amount}
          onChange={setAmount}
          currencySymbol={currencySymbol}
          color={colors.success}
        />

        {/* Date */}
        <View className="mb-4">
          <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
            Date
          </ThemedText>
          <Pressable
            onPress={() => setShowDatePicker(true)}
            className="flex-row items-center px-4 py-3.5 rounded-xl"
            style={{ backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder }}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.success} />
            <ThemedText className="flex-1 ml-3 font-bold" style={{ color: colors.inputText }}>
              {formatDisplayDate(date)}
            </ThemedText>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        </View>

        {/* Notes */}
        <View className="mb-8">
          <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
            Notes (optional)
          </ThemedText>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Add a note..."
            placeholderTextColor={colors.inputPlaceholder}
            multiline
            numberOfLines={2}
            className="px-4 py-3 rounded-xl"
            style={{
              backgroundColor: colors.inputBg,
              color: colors.inputText,
              fontFamily: 'PlusJakartaSans_600SemiBold',
              minHeight: 72,
              textAlignVertical: 'top',
              borderWidth: 1,
              borderColor: colors.inputBorder,
            }}
          />
        </View>

        <AppButton
          label={isGiven ? 'Record Repayment' : 'Record Payment'}
          onPress={handleSubmit}
          loading={isSubmitting}
          disabled={isSubmitting}
          color={colors.success}
        />
      </FormScrollView>
    </BottomSheet>
  );
}
