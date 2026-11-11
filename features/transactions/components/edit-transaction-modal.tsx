import { parseAmount } from '@/lib/utils/currency';
import { AppButton, BottomSheet, BottomSheetRef, CalendarPicker, FormScrollView, SheetHeader, toLocalDateStr } from '@/components/common';
import { AccountPicker } from './account-picker';
import { TransactionFormFields } from './transaction-form-fields';
import { FormPrerequisitesModal } from './form-prerequisites-modal';
import { useUser } from '@/features/user/context/user-context';
import { useAccounts } from '@/features/accounts/hooks/use-accounts';
import { useCategories } from '@/features/categories/hooks/use-categories';
import { Transaction } from '../hooks/use-transactions';
import { createRecurringExpense, getAccountsWithBalance, getActiveRecurringByCategory, updateTransaction } from '@/lib/db/queries';
import { checkSpendable } from '../utils';
import { logger } from '@/lib/logger';
import { toast } from '@/lib/toast';
import { POPULAR_CURRENCIES, UserService } from '@/features/user/services/user-service';
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface EditTransactionModalProps {
    visible: boolean;
    transaction: Transaction | null;
    onClose: () => void;
    onSuccess: () => void;
}

export function EditTransactionModal({ visible, transaction, onClose, onSuccess }: EditTransactionModalProps) {
    const { profile } = useUser();
    const insets = useSafeAreaInsets();
    const { categories, loading: categoriesLoading, refresh: refreshCategories } = useCategories();
    const { accounts, isLoading: accountsLoading } = useAccounts();

    const [transactionType, setTransactionType] = useState<'expense' | 'income'>('expense');
    const [amount, setAmount] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
    const [date, setDate] = useState(toLocalDateStr(new Date()));
    const [notes, setNotes] = useState('');
    const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
    const [showAccountPicker, setShowAccountPicker] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurringFrequency, setRecurringFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
    const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
    const sheetRef = useRef<BottomSheetRef>(null);
    const amountInputRef = useRef<TextInput>(null);

    const currencySymbol = POPULAR_CURRENCIES.find(c => c.code === profile.currency)?.symbol || '$';
    const isIncome = transactionType === 'income';

    useEffect(() => {
        if (visible && transaction) {
            setTransactionType(transaction.type);
            setAmount(transaction.amount.toString());
            setSelectedCategoryId(transaction.category_id);
            setDate(transaction.date || toLocalDateStr(new Date()));
            setNotes(transaction.note || '');
            setSelectedAccountId(transaction.account_id);
            setIsRecurring(false);
            setRecurringFrequency('monthly');
            setDuplicateWarning(null);
            refreshCategories();
        }
    }, [visible, transaction, refreshCategories]);

    // Duplicate recurring check
    useEffect(() => {
        if (!isRecurring || !selectedCategoryId) {
            setDuplicateWarning(null);
            return;
        }
        getActiveRecurringByCategory(selectedCategoryId).then(results => {
            if (results.length > 0) {
                const cat = (categories || []).find(c => c.id === selectedCategoryId);
                setDuplicateWarning(cat?.name ?? 'This category');
            } else {
                setDuplicateWarning(null);
            }
        }).catch(() => setDuplicateWarning(null));
    }, [isRecurring, selectedCategoryId, categories]);

    const filteredCategories = (categories || []).filter(cat => cat?.type === transactionType);

    const handleClose = () => {
        Keyboard.dismiss();
        sheetRef.current?.dismiss(onClose);
    };

    if (!transaction) return null;

    if (!categories || categories.length === 0 || !accounts || accounts.length === 0) {
        return (
            <FormPrerequisitesModal
                visible={visible}
                onClose={onClose}
                loading={categoriesLoading || accountsLoading}
                hasCategories={!!categories?.length}
                hasAccounts={!!accounts?.length}
            />
        );
    }

    const handleSave = async () => {
        const parsedAmount = parseAmount(amount);
        if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) { toast.error('Please enter a valid amount'); return; }
        if (parsedAmount > 999_999_999) { toast.error('Amount is too large'); return; }
        if (!selectedCategoryId) { toast.error('Please select a category'); return; }
        if (!selectedAccountId) { toast.error('Please select a payment method'); return; }

        if (transactionType === 'expense') {
            try {
                const account = (await getAccountsWithBalance()).find(acc => acc.id === selectedAccountId);
                // The balance already reflects this transaction as it was saved;
                // take that out before checking the edited version.
                const original = transaction.account_id === selectedAccountId
                    ? (transaction.type === 'expense' ? transaction.amount : -transaction.amount)
                    : 0;
                const check = checkSpendable(account && { ...account, balance: account.balance + original }, parsedAmount);
                if (!check.ok) {
                    toast.error(`Not enough in ${account?.name ?? 'this account'}. Available: ${UserService.formatCurrency(check.available, profile.currency)}`);
                    return;
                }
            } catch (err) {
                logger.error('Error checking balance:', err);
            }
        }

        setIsSubmitting(true);
        try {
            await updateTransaction(transaction.id, {
                category_id: selectedCategoryId,
                account_id: selectedAccountId,
                amount: parsedAmount,
                type: transactionType,
                date,
                // null (not undefined) so clearing the note is actually saved
                notes: notes.trim() || null,
            });

            if (isRecurring) {
                await createRecurringExpense({
                    category_id: selectedCategoryId,
                    account_id: selectedAccountId,
                    amount: parsedAmount,
                    frequency: recurringFrequency,
                    start_date: date,
                    // this transaction is the first occurrence
                    last_processed: date,
                    notes: notes.trim() || null,
                    is_active: 1,
                });
            }

            toast.success(isRecurring ? 'Transaction updated & recurring created' : 'Transaction updated successfully');
            Keyboard.dismiss();
            onClose();
            onSuccess();
        } catch (error) {
            logger.error('Error updating transaction:', error);
            toast.error('Failed to update transaction');
        } finally {
            setIsSubmitting(false);
        }
    };

    const selectedAccount = accounts.find(a => a.id === selectedAccountId);
    const displayDate = (() => {
        const [y, m, d] = date.split('-');
        const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${parseInt(d)} ${shortMonths[parseInt(m) - 1]} ${y}`;
    })();

    return (
        <>
            <BottomSheet
                ref={sheetRef}
                visible={visible}
                onClose={onClose}
                maxHeight="95%"
                paddingHorizontal={24}
                paddingTop={16}
                paddingBottom={insets.bottom + 32}
                keyboardAvoiding
            >
                <SheetHeader kicker="Edit transaction" title={isIncome ? 'Money in' : 'Money out'} onClose={handleClose} />

                <FormScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
                <TransactionFormFields
                    ref={amountInputRef}
                    transactionType={transactionType}
                    onTypeChange={t => { if (t === 'transfer') return; setTransactionType(t); setSelectedCategoryId(null); setIsRecurring(false); }}
                    amount={amount}
                    onAmountChange={setAmount}
                    currencySymbol={currencySymbol}
                    categories={filteredCategories}
                    selectedCategoryId={selectedCategoryId}
                    onCategorySelect={setSelectedCategoryId}
                    selectedAccount={selectedAccount}
                    onAccountPress={() => setShowAccountPicker(true)}
                    displayDate={displayDate}
                    onDatePress={() => setShowDatePicker(true)}
                    notes={notes}
                    onNotesChange={setNotes}
                    isRecurring={isRecurring}
                    onRecurringChange={setIsRecurring}
                    recurringFrequency={recurringFrequency}
                    onFrequencyChange={setRecurringFrequency}
                    duplicateWarning={duplicateWarning}
                    hideRepeat={!!transaction.recurringId}
                />

                <AppButton label="Save changes" onPress={handleSave} loading={isSubmitting} disabled={isSubmitting} />
            </FormScrollView>
            </BottomSheet>

            {showDatePicker && (
                <CalendarPicker selectedDate={date} onSelectDate={(d) => { setDate(d); setShowDatePicker(false); }} onClose={() => setShowDatePicker(false)} />
            )}
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
