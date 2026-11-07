import { parseAmount } from '@/lib/utils/currency';
import { AppButton, BottomSheet, BottomSheetRef, CalendarPicker, FormScrollView, SheetHeader, toLocalDateStr } from '@/components/common';
import { AccountPicker } from './account-picker';
import { TransactionFormFields, type TxType } from './transaction-form-fields';
import { useUser } from '@/features/user/context/user-context';
import { useAccounts } from '@/features/accounts/hooks/use-accounts';
import { useCategories } from '@/features/categories/hooks/use-categories';
import { createAccountTransfer, createTransaction, createTransactionWithRecurring, getAccountsWithBalance, getActiveRecurringByCategory } from '@/lib/db/queries';
import { checkSpendable } from '../utils';
import { logger } from '@/lib/logger';
import { NotificationService } from '@/features/notifications/services/notification-service';
import { FormPrerequisitesModal } from './form-prerequisites-modal';
import { NewTransaction } from '@/lib/db/schema';
import { toast } from '@/lib/toast';
import { POPULAR_CURRENCIES, UserService } from '@/features/user/services/user-service';
import React, { useRef, useState } from 'react';
import { Keyboard, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AddTransactionModalProps {
    visible: boolean;
    onClose: () => void;
    onSuccess: () => void;
    initialType?: 'expense' | 'income';
}

export function AddTransactionModal({ visible, onClose, onSuccess, initialType = 'expense' }: AddTransactionModalProps) {
    const { profile } = useUser();
    const insets = useSafeAreaInsets();
    const { categories, loading: categoriesLoading, refresh: refreshCategories } = useCategories();

    const [transactionType, setTransactionType] = useState<TxType>(initialType);
    const [amount, setAmount] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
    const [date, setDate] = useState(toLocalDateStr(new Date()));
    const [notes, setNotes] = useState('');
    const [isRecurring, setIsRecurring] = useState(false);
    const [recurringFrequency, setRecurringFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
    const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
    const [showAccountPicker, setShowAccountPicker] = useState(false);
    const [toAccountId, setToAccountId] = useState<number | null>(null);
    const [pickerTarget, setPickerTarget] = useState<'from' | 'to'>('from');
    const amountInputRef = useRef<TextInput>(null);
    const sheetRef = useRef<BottomSheetRef>(null);

    const { accounts, isLoading: accountsLoading } = useAccounts();

    const currencySymbol = POPULAR_CURRENCIES.find(c => c.code === profile.currency)?.symbol || '$';
    const isIncome = transactionType === 'income';

    React.useEffect(() => {
        if (visible) {
            setTransactionType(initialType);
            setSelectedCategoryId(null);
            setIsRecurring(false);
            // The modal stays mounted in the tab layout; refresh "today" on
            // every open so it isn't stuck on the day the app was launched.
            setDate(toLocalDateStr(new Date()));
        }
    }, [visible, initialType]);

    React.useEffect(() => {
        if (visible) refreshCategories();
    }, [visible, refreshCategories]);

    React.useEffect(() => {
        if (visible) {
            const t = setTimeout(() => amountInputRef.current?.focus(), 400);
            return () => clearTimeout(t);
        }
    }, [visible]);

    React.useEffect(() => {
        if (accounts.length > 0 && !selectedAccountId) {
            setSelectedAccountId(accounts[0].id);
        }
    }, [accounts, selectedAccountId]);

    // Duplicate recurring check
    React.useEffect(() => {
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

    const resetForm = () => {
        setTransactionType(initialType);
        setAmount('');
        setSelectedCategoryId(null);
        setDate(toLocalDateStr(new Date()));
        setNotes('');
        setIsRecurring(false);
        setRecurringFrequency('monthly');
        setDuplicateWarning(null);
        setShowDatePicker(false);
        setShowAccountPicker(false);
        setToAccountId(null);
        if (accounts.length > 0) setSelectedAccountId(accounts[0].id);
    };

    const handleClose = () => {
        amountInputRef.current?.blur();
        Keyboard.dismiss();
        sheetRef.current?.dismiss(() => { resetForm(); onClose(); });
    };

    const handleSubmit = async () => {
        const parsedAmount = parseAmount(amount);
        if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
            toast.error('Please enter a valid amount');
            return;
        }
        if (parsedAmount > 999_999_999) { toast.error('Amount is too large'); return; }
        if (transactionType === 'transfer') {
            await handleTransfer(parsedAmount);
            return;
        }
        if (!selectedCategoryId) { toast.error('Please select a category'); return; }
        if (!selectedAccountId) { toast.error('Please select a payment method'); return; }

        if (transactionType === 'expense') {
            try {
                const account = (await getAccountsWithBalance()).find(acc => acc.id === selectedAccountId);
                const check = checkSpendable(account, parsedAmount);
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
            const newTransaction: NewTransaction = {
                category_id: selectedCategoryId,
                account_id: selectedAccountId,
                amount: parsedAmount,
                type: transactionType,
                date,
                notes: notes.trim() || undefined,
            };
            if (isRecurring) {
                await createTransactionWithRecurring({ ...newTransaction, date }, recurringFrequency);
            } else {
                await createTransaction(newTransaction);
            }
            if (transactionType === 'expense') {
                // Fire-and-forget: a notification failure must not fail the save.
                NotificationService.checkAndSendBudgetAlert(selectedCategoryId, parsedAmount, date).catch(() => {});
            }

            toast.success(`${isIncome ? 'Income' : 'Expense'} added${isRecurring ? ' & recurring set' : ''}`);
            handleClose();
            onSuccess();
        } catch (error) {
            logger.error('Error creating transaction:', error);
            toast.error('Failed to create transaction');
        } finally {
            setIsSubmitting(false);
        }
    };

    async function handleTransfer(parsedAmount: number) {
        if (!selectedAccountId || !toAccountId) { toast.error('Choose both accounts'); return; }
        if (selectedAccountId === toAccountId) { toast.error('Choose two different accounts'); return; }
        const from = (await getAccountsWithBalance()).find(acc => acc.id === selectedAccountId);
        const check = checkSpendable(from, parsedAmount);
        if (!check.ok) {
            toast.error(`Not enough in ${from?.name ?? 'this account'}. Available: ${UserService.formatCurrency(check.available, profile.currency)}`);
            return;
        }
        setIsSubmitting(true);
        try {
            await createAccountTransfer({ fromAccountId: selectedAccountId, toAccountId, amount: parsedAmount, date, notes: notes.trim() || null });
            toast.success('Transfer saved');
            handleClose();
            onSuccess();
        } catch (error) {
            logger.error('Error creating transfer:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to save transfer');
        } finally {
            setIsSubmitting(false);
        }
    }

    const selectedAccount = accounts.find(a => a.id === selectedAccountId);
    const toAccount = accounts.find(a => a.id === toAccountId);
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
            <SheetHeader kicker="New transaction" title={transactionType === 'transfer' ? 'Move money' : isIncome ? 'Money in' : 'Money out'} onClose={handleClose} />

            <FormScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
                <TransactionFormFields
                    ref={amountInputRef}
                    transactionType={transactionType}
                    onTypeChange={t => {
                        setTransactionType(t);
                        setSelectedCategoryId(null);
                        setIsRecurring(false);
                        if (t === 'transfer' && !toAccountId) {
                            setToAccountId(accounts.find(a => a.id !== selectedAccountId)?.id ?? null);
                        }
                    }}
                    allowTransfer={accounts.length > 1}
                    toAccount={toAccount}
                    onToAccountPress={() => { setPickerTarget('to'); setShowAccountPicker(true); }}
                    amount={amount}
                    onAmountChange={setAmount}
                    currencySymbol={currencySymbol}
                    categories={filteredCategories}
                    selectedCategoryId={selectedCategoryId}
                    onCategorySelect={setSelectedCategoryId}
                    selectedAccount={selectedAccount}
                    onAccountPress={() => { setPickerTarget('from'); setShowAccountPicker(true); }}
                    displayDate={displayDate}
                    onDatePress={() => setShowDatePicker(true)}
                    notes={notes}
                    onNotesChange={setNotes}
                    isRecurring={isRecurring}
                    onRecurringChange={setIsRecurring}
                    recurringFrequency={recurringFrequency}
                    onFrequencyChange={setRecurringFrequency}
                    duplicateWarning={duplicateWarning}
                />

                <AppButton label={transactionType === 'transfer' ? 'Save Transfer' : 'Save Transaction'} onPress={handleSubmit} loading={isSubmitting} disabled={isSubmitting} />
            </FormScrollView>
        </BottomSheet>

        {showDatePicker && <CalendarPicker selectedDate={date} onSelectDate={(d) => { setDate(d); setShowDatePicker(false); }} onClose={() => setShowDatePicker(false)} />}
        <AccountPicker
            visible={showAccountPicker}
            accounts={accounts}
            selectedAccountId={pickerTarget === 'to' ? toAccountId : selectedAccountId}
            onSelect={(id) => {
                if (pickerTarget === 'to') setToAccountId(id); else setSelectedAccountId(id);
                setShowAccountPicker(false);
            }}
            onClose={() => setShowAccountPicker(false)}
        />
    </>
    );
}
