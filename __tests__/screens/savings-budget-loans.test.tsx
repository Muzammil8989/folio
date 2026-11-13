jest.unmock('@/lib/db/db-client');
jest.mock('@/features/notifications/services/notification-service', () => ({
  NotificationService: {
    sendSavingsMilestone: jest.fn().mockResolvedValue(undefined),
    syncLoanReminders: jest.fn().mockResolvedValue(undefined),
  },
}));

import { DatePickerModal } from '@/features/transactions/components/date-picker-modal';
import { BudgetHeader } from '@/features/budgets/components/budget-header';
import { LoanItem } from '@/features/loans/components/loan-item';
import { ContributeSheet } from '@/features/savings/components/contribute-sheet';
import { GoalCard } from '@/features/savings/components/goal-card';
import * as q from '@/lib/db/queries';
import { toast } from '@/lib/toast';
import { toISODateString } from '@/lib/utils/date';
import { renderWithProviders } from '@/tests/helpers/render-with-providers';
import { createTestDb, TestDb } from '@/tests/helpers/test-db';
import { act, fireEvent, screen } from '@testing-library/react-native';
import React from 'react';

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
  jest.clearAllMocks();
});
afterEach(() => {
  db.close();
  jest.useRealTimers();
});

const daysFromToday = (n: number) => {
  const d = new Date();
  return toISODateString(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};

describe('Savings: contribute sheet', () => {
  async function setup(saved: number, target: number) {
    const goal = await q.createSavingsGoal({ name: 'Bike', target_amount: target, saved_amount: saved } as any);
    // Deposits now come out of a real account, so give it money.
    const accountId = (await q.getAccounts())[0].id;
    const incomeCat = (await q.getCategories('income'))[0].id;
    await q.createTransaction({ amount: 500, type: 'income', date: daysFromToday(0), account_id: accountId, category_id: incomeCat } as any);
    const onSuccess = jest.fn();
    await renderWithProviders(<ContributeSheet goal={goal as any} currency="USD" onClose={jest.fn()} onSuccess={onSuccess} />);
    return { goal, onSuccess };
  }
  const contribute = async (amount: string) => {
    fireEvent.changeText(screen.getByPlaceholderText('0'), amount);
    await act(async () => {
      fireEvent.press(screen.getByText('Save to goal'));
    });
  };
  const savedAmount = (id: number) =>
    (db.raw.prepare('select saved_amount, is_completed from savings_goals where id = ?').get(id) as { saved_amount: number; is_completed: number });

  it('rejects a contribution above what is left, instead of silently dropping the extra', async () => {
    const { goal, onSuccess } = await setup(80, 100);
    await contribute('50');
    expect(toast.error).toHaveBeenCalledWith('Only $20.00 left to reach this goal');
    expect(savedAmount(goal.id).saved_amount).toBe(80);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('completes the goal with an exact contribution, even with cents', async () => {
    const { goal, onSuccess } = await setup(0.7, 1.1);
    await contribute('0,4');
    expect(savedAmount(goal.id)).toEqual({ saved_amount: 1.1, is_completed: 1 });
    expect(onSuccess).toHaveBeenCalled();
  });

  it('takes the deposit out of the chosen account', async () => {
    await setup(0, 100);
    await contribute('40');
    expect(await q.getCurrentBalance()).toBe(460);
  });

  it('blocks a deposit larger than the account holds', async () => {
    const { goal, onSuccess } = await setup(0, 5000);
    await contribute('900');
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Not enough in /));
    expect(savedAmount(goal.id).saved_amount).toBe(0);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

describe('Savings: goal card deadline', () => {
  const renderCard = (deadline: string) =>
    renderWithProviders(
      <GoalCard
        goal={{ id: 1, name: 'Trip', target_amount: 100, saved_amount: 10, deadline, is_completed: 0, icon: null, color: null } as any}
        currency="USD"
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onContribute={jest.fn()}
      />
    );

  it('shows "Due today!" on the deadline day', async () => {
    await renderCard(daysFromToday(0));
    expect(screen.getByText('Due today')).toBeTruthy();
  });

  it('counts calendar days left', async () => {
    await renderCard(daysFromToday(3));
    expect(screen.getByText(/^3d left/)).toBeTruthy();
  });

  it('shows overdue goals', async () => {
    await renderCard(daysFromToday(-2));
    expect(screen.getByText('Overdue by 2d')).toBeTruthy();
  });
});

describe('Budgets header', () => {
  const header = (props: Partial<React.ComponentProps<typeof BudgetHeader>>) =>
    renderWithProviders(
      <BudgetHeader
        insets={{ top: 0 }}
        periodFilter="all"
        onPeriodChange={jest.fn()}
        totalSpent={130}
        totalBudgeted={100}
        overallPercent={130}
        currency="USD"
        showSummary
        {...props}
      />
    );

  it('shows when spending is over budget', async () => {
    await header({});
    expect(screen.getByText('130% of total budget used')).toBeTruthy();
    expect(screen.getByText('$30.00 over')).toBeTruthy();
  });

  it('labels mixed-period totals as monthly amounts', async () => {
    await header({ isMonthlyEquivalent: true });
    expect(screen.getByText('Budget / month')).toBeTruthy();
  });
});

describe('Activity: date picker', () => {
  const march10 = new Date(2026, 2, 10);

  it('Cancel keeps the previous date', async () => {
    const onDateChange = jest.fn();
    await renderWithProviders(
      <DatePickerModal visible mode="start" selectedDate={march10} onDateChange={onDateChange}
        viewDate={march10} onViewDateChange={jest.fn()} onClose={jest.fn()} />
    );
    fireEvent.press(screen.getByLabelText('March 20, 2026'));
    fireEvent.press(screen.getByLabelText('Cancel'));
    expect(onDateChange).not.toHaveBeenCalled();
  });

  it('Done applies the picked date', async () => {
    const onDateChange = jest.fn();
    await renderWithProviders(
      <DatePickerModal visible mode="start" selectedDate={march10} onDateChange={onDateChange}
        viewDate={march10} onViewDateChange={jest.fn()} onClose={jest.fn()} />
    );
    fireEvent.press(screen.getByLabelText('March 20, 2026'));
    fireEvent.press(screen.getByLabelText('Confirm date selection'));
    expect(onDateChange).toHaveBeenCalledWith(new Date(2026, 2, 20));
  });

  it('disables end dates before the start date', async () => {
    await renderWithProviders(
      <DatePickerModal visible mode="end" selectedDate={march10} onDateChange={jest.fn()}
        viewDate={march10} onViewDateChange={jest.fn()} onClose={jest.fn()} minDate={march10} />
    );
    expect(screen.getByLabelText('March 9, 2026')).toBeDisabled();
    expect(screen.getByLabelText('March 10, 2026')).not.toBeDisabled();
  });
});

describe('Loans: due date label', () => {
  const renderLoan = (due_date: string) =>
    renderWithProviders(
      <LoanItem
        loan={{
          id: 1, type: 'given', person_name: 'Ali', amount: 100, account_id: 1, transaction_id: null,
          origin_transaction_id: null, date: '2026-01-01', due_date, notes: null, is_settled: 0,
          created_at: '', updated_at: '', accountName: 'Cash', accountIcon: null, accountColor: null,
          payments: [], settled_amount: 0, remaining_amount: 100,
        }}
        currencyCode="USD"
        onEdit={jest.fn()} onDelete={jest.fn()} onRecordPayment={jest.fn()} onTransfer={jest.fn()}
      />
    );

  it('says "Due Today" and "Due Tomorrow" by calendar day', async () => {
    await renderLoan(daysFromToday(0));
    expect(screen.getByText('Due Today')).toBeTruthy();
  });

  it('counts whole days', async () => {
    await renderLoan(daysFromToday(1));
    expect(screen.getByText('Due Tomorrow')).toBeTruthy();
  });
});
