import { parseAmount } from '@/lib/utils/currency';
import { AmountInput, AppButton, BottomSheet, BottomSheetRef, FormScrollView, SheetHeader, ThemedText } from '@/components/common';
import { CalendarPicker, toLocalDateStr } from '@/components/common/calendar-picker';
import { AccountPicker } from '@/features/transactions/components/account-picker';
import { useAccounts } from '@/features/accounts/hooks/use-accounts';
import { SystemLoanCategoryIds } from '@/features/loans/hooks/use-loans';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { createLoan, LoanWithDetails, updateLoan } from '@/lib/db/queries';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { POPULAR_CURRENCIES } from '@/features/user/services/user-service';
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Pressable,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AddLoanModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingLoan?: LoanWithDetails | null;
  currencyCode: string;
  categoryIds: SystemLoanCategoryIds;
}

export function AddLoanModal({ visible, onClose, onSuccess, editingLoan, currencyCode, categoryIds }: AddLoanModalProps) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { accounts } = useAccounts();
  const currencySymbol = POPULAR_CURRENCIES.find(c => c.code === currencyCode)?.symbol ?? '$';
  const sheetRef = useRef<BottomSheetRef>(null);

  const isEditing = !!editingLoan;

  const [loanType, setLoanType] = useState<'given' | 'taken'>('given');
  const [personName, setPersonName] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [date, setDate] = useState(toLocalDateStr(new Date()));
  const [showDueDate, setShowDueDate] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showDueDatePicker, setShowDueDatePicker] = useState(false);
  const [showAccountPicker, setShowAccountPicker] = useState(false);

  const accentColor = loanType === 'given' ? colors.warning : colors.info;

  useEffect(() => {
    if (visible) {
      if (editingLoan) {
        setLoanType(editingLoan.type);
        setPersonName(editingLoan.person_name);
        setAmount(String(editingLoan.amount));
        setSelectedAccountId(editingLoan.account_id);
        setDate(editingLoan.date);
        if (editingLoan.due_date) { setShowDueDate(true); setDueDate(editingLoan.due_date); }
        else { setShowDueDate(false); setDueDate(''); }
        setNotes(editingLoan.notes ?? '');
      } else {
        setLoanType('given');
        setPersonName('');
        setAmount('');
        setSelectedAccountId(accounts.length > 0 ? accounts[0].id : null);
        setDate(toLocalDateStr(new Date()));
        setShowDueDate(false);
        setDueDate('');
        setNotes('');
      }
    }
    // Only reset when the sheet opens or switches loan, not when the accounts
    // list refreshes mid-entry (that wiped what the user had typed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, editingLoan]);

  useEffect(() => {
    if (accounts.length > 0 && !selectedAccountId && !isEditing) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId, isEditing]);

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  const handleClose = () => {
    Keyboard.dismiss();
    setShowDatePicker(false);
    setShowDueDatePicker(false);
    setShowAccountPicker(false);
    sheetRef.current?.dismiss(onClose);
  };

  const handleSubmit = async () => {
    if (!personName.trim()) { toast.error('Please enter person name'); return; }
    const parsed = parseAmount(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) { toast.error('Please enter a valid amount'); return; }
    if (!selectedAccountId) { toast.error('Please select an account'); return; }

    setIsSubmitting(true);
    try {
      if (isEditing && editingLoan) {
        await updateLoan(editingLoan.id, {
          person_name: personName.trim(),
          due_date: showDueDate && dueDate ? dueDate : null,
          notes: notes.trim() || null,
        });
        toast.success('Loan updated');
      } else {
        await createLoan(
          { type: loanType, person_name: personName.trim(), amount: parsed, account_id: selectedAccountId, date, due_date: showDueDate && dueDate ? dueDate : null, notes: notes.trim() || null, is_settled: 0 },
          categoryIds
        );
        toast.success(loanType === 'given' ? 'Loan given recorded' : 'Loan taken recorded');
      }
      handleClose();
      onSuccess();
    } catch (e) {
      logger.error('AddLoanModal: failed to save', e);
      toast.error('Failed to save loan');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDisplayDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = d.split('-').map(Number);
    return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (showDatePicker) {
    return <CalendarPicker selectedDate={date} onSelectDate={(d) => { setDate(d); setShowDatePicker(false); }} onClose={() => setShowDatePicker(false)} />;
  }
  if (showDueDatePicker) {
    return <CalendarPicker selectedDate={dueDate || toLocalDateStr(new Date())} onSelectDate={(d) => { setDueDate(d); setShowDueDatePicker(false); }} onClose={() => setShowDueDatePicker(false)} />;
  }

  return (
    <>
      <BottomSheet
        ref={sheetRef}
        visible={visible}
        onClose={onClose}
        maxHeight="92%"
        paddingHorizontal={28}
        paddingTop={48}
        paddingBottom={insets.bottom + 32}
        gradientColors={[`${accentColor}18`, `${accentColor}06`, 'transparent']}
        keyboardAvoiding
      >
        <SheetHeader title={isEditing ? 'Edit Loan' : 'Add Loan'} onClose={handleClose} />

        <FormScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          {/* Type Toggle (new loans only) */}
          {!isEditing && (
            <View
              className="flex-row mb-6 rounded-xl overflow-hidden"
              style={{ backgroundColor: colors.tagDefaultBg }}
            >
              {(['given', 'taken'] as const).map((t) => {
                const isActive = loanType === t;
                const btnColor = t === 'given' ? colors.warning : colors.info;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setLoanType(t)}
                    className="flex-1 py-3 items-center rounded-xl"
                    style={isActive ? { backgroundColor: btnColor } : undefined}
                  >
                    <Ionicons
                      name={t === 'given' ? 'arrow-up-outline' : 'arrow-down-outline'}
                      size={14}
                      color={isActive ? colors.textOnPrimary : colors.textMuted}
                    />
                    <ThemedText
                      className="text-sm font-bold mt-0.5"
                      style={{ color: isActive ? colors.textOnPrimary : colors.textMuted }}
                    >
                      {t === 'given' ? 'Given (I lent)' : 'Taken (I borrowed)'}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          )}

          {/* Person name */}
          <View className="mb-5">
            <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
              {loanType === 'given' ? 'Given To' : 'Taken From'}
            </ThemedText>
            <TextInput
              value={personName}
              onChangeText={setPersonName}
              placeholder={loanType === 'given' ? "Person's name..." : "Who gave you..."}
              placeholderTextColor={colors.inputPlaceholder}
              editable={!isEditing}
              className="px-4 py-3.5 rounded-xl font-semibold"
              style={{
                backgroundColor: colors.inputBg,
                color: isEditing ? colors.textMuted : colors.inputText,
                fontSize: 16,
                fontFamily: 'PlusJakartaSans_600SemiBold',
                borderWidth: 1,
                borderColor: colors.inputBorder,
              }}
            />
          </View>

          {/* Amount */}
          {!isEditing && (
            <AmountInput
              value={amount}
              onChange={setAmount}
              currencySymbol={currencySymbol}
              color={accentColor}
            />
          )}

          {/* Account */}
          {!isEditing && (
            <View className="mb-5">
              <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
                Account
              </ThemedText>
              <Pressable
                onPress={() => setShowAccountPicker(true)}
                className="flex-row items-center px-4 py-3.5 rounded-xl"
                style={{ backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder }}
              >
                <Ionicons name={(selectedAccount?.icon ?? 'card-outline') as never} size={18} color={selectedAccount?.color ?? accentColor} />
                <ThemedText className="flex-1 ml-3 font-bold" style={{ color: colors.inputText }}>
                  {selectedAccount?.name ?? 'Select account'}
                </ThemedText>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          )}

          {/* Date */}
          {!isEditing && (
            <View className="mb-4">
              <ThemedText type="kicker" className="mb-3" style={{ color: colors.textMuted }}>
                Date
              </ThemedText>
              <Pressable
                onPress={() => setShowDatePicker(true)}
                className="flex-row items-center px-4 py-3.5 rounded-xl"
                style={{ backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder }}
              >
                <Ionicons name="calendar-outline" size={18} color={accentColor} />
                <ThemedText className="flex-1 ml-3 font-bold" style={{ color: colors.inputText }}>
                  {formatDisplayDate(date)}
                </ThemedText>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>
            </View>
          )}

          {/* Due date toggle */}
          <View className="mb-4">
            <Pressable
              onPress={() => setShowDueDate(v => !v)}
              className="flex-row items-center px-4 py-3.5 rounded-xl"
              style={{ backgroundColor: colors.inputBg, borderWidth: 1, borderColor: colors.inputBorder }}
            >
              <Ionicons name="time-outline" size={18} color={showDueDate ? accentColor : colors.textMuted} />
              <ThemedText className="flex-1 ml-3 font-bold" style={{ color: showDueDate ? colors.inputText : colors.textMuted }}>
                {showDueDate && dueDate ? `Due: ${formatDisplayDate(dueDate)}` : 'Add due date (optional)'}
              </ThemedText>
              <Ionicons name={showDueDate ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </Pressable>
            {showDueDate && (
              <Pressable
                onPress={() => setShowDueDatePicker(true)}
                className="flex-row items-center px-4 py-3.5 rounded-xl mt-2"
                style={{ backgroundColor: `${accentColor}12`, borderWidth: 1, borderColor: `${accentColor}30` }}
              >
                <Ionicons name="calendar-outline" size={18} color={accentColor} />
                <ThemedText className="flex-1 ml-3 font-bold" style={{ color: accentColor }}>
                  {dueDate ? formatDisplayDate(dueDate) : 'Pick due date...'}
                </ThemedText>
                <Ionicons name="chevron-forward" size={16} color={accentColor} />
              </Pressable>
            )}
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
                fontWeight: '600',
                minHeight: 72,
                textAlignVertical: 'top',
                borderWidth: 1,
                borderColor: colors.inputBorder,
              }}
            />
          </View>

          <AppButton
            label={isEditing ? 'Update Loan' : loanType === 'given' ? 'Record Loan Given' : 'Record Loan Taken'}
            onPress={handleSubmit}
            loading={isSubmitting}
            disabled={isSubmitting}
            color={accentColor}
          />
        </FormScrollView>
      </BottomSheet>

      <AccountPicker
        visible={showAccountPicker}
        accounts={accounts}
        selectedAccountId={selectedAccountId}
        onSelect={(id) => { setSelectedAccountId(id); setShowAccountPicker(false); }}
        onClose={() => setShowAccountPicker(false)}
      />
    </>
  );
}
