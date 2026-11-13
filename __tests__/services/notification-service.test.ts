import * as Notifications from 'expo-notifications';
import {
    LOAN_REMINDER_OFFSETS,
    loanReminderSchedule,
    MAX_LOAN_REMINDERS,
    NotificationService,
    notificationRoute,
} from '@/features/notifications/services/notification-service';
import { SecurityService } from '@/features/auth/services/security-service';
import * as budgetSpend from '@/features/budgets/services/budget-spend';
import * as q from '@/lib/db/queries';
import { installInMemorySecureStore } from '@/tests/helpers/secure-store';

const scheduledCalls = () => (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(([req]) => req);
const scheduled = () => scheduledCalls().map(req => req.content.body as string);

beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    installInMemorySecureStore({ notifications_enabled: 'true' });
});

describe('Notifications stay private when the app is locked with a PIN', () => {
    it('shows bill names when no app security is set', async () => {
        await NotificationService.sendRecurringAlert(1, ['Rent']);
        expect(scheduled()[0]).toContain('Rent');
    });

    it('leaves bill names out when a PIN is set', async () => {
        await SecurityService.setPin('1234');
        await NotificationService.sendRecurringAlert(2, ['Rent', 'Gym']);
        expect(scheduled()[0]).toBe('2 bills auto-processed. Open Folio to review.');
    });

    it('leaves goal names out when a PIN is set', async () => {
        await SecurityService.setPin('1234');
        await NotificationService.sendSavingsMilestone('Secret trip', 50);
        expect(scheduled()[0]).not.toContain('Secret trip');
    });

    it('shows goal names when no app security is set', async () => {
        await NotificationService.sendSavingsMilestone('Holiday', 100);
        expect(scheduled()[0]).toContain('Holiday');
    });
});

type ReminderLoan = Parameters<typeof loanReminderSchedule>[0][number];
const loan = (over: Partial<ReminderLoan> = {}): ReminderLoan => ({
    id: 1,
    type: 'taken',
    person_name: 'Ali',
    due_date: '2026-11-12',
    is_settled: 0,
    remaining_amount: 5000,
    ...over,
});
// 8 AM on 9 Nov 2026, local time.
const NOW = new Date(2026, 10, 9, 8, 0, 0);
const plan = (loans: ReminderLoan[], hideDetails = false) =>
    loanReminderSchedule(loans, { now: NOW, currency: 'USD', hideDetails });

describe('loanReminderSchedule', () => {
    it('plans 9 AM reminders 3 days before, the day before, on the day and the day after', () => {
        const r = plan([loan()]);
        expect(r.map(x => [x.date.getDate(), x.date.getHours()])).toEqual([[9, 9], [11, 9], [12, 9], [13, 9]]);
        expect(r.map(x => x.identifier)).toEqual(LOAN_REMINDER_OFFSETS.map(o => `folio-loan-1-${o}`));
        expect(r.map(x => x.title)).toEqual(['Loan due in 3 days', 'Loan due tomorrow', 'Loan due today', 'Loan overdue']);
        expect(r[0].body).toContain('You owe Ali');
        expect(r[0].body).toContain('5,000');
        expect(r[3].body).toContain('was due on 12 Nov');
    });

    it('drops reminder times that have already passed', () => {
        const r = plan([loan({ due_date: '2026-11-10' })]);
        expect(r.map(x => x.title)).toEqual(['Loan due tomorrow', 'Loan due today', 'Loan overdue']);
    });

    it('words reminders for money lent out from the lender side', () => {
        const r = plan([loan({ type: 'given' })]);
        expect(r[0].title).toBe('Repayment due in 3 days');
        expect(r[0].body).toContain('Ali owes you');
    });

    it('skips settled, fully repaid and undated loans', () => {
        expect(plan([
            loan({ is_settled: 1 }),
            loan({ id: 2, remaining_amount: 0 }),
            loan({ id: 3, due_date: null }),
        ])).toEqual([]);
    });

    it('keeps only the soonest reminders, within the OS limit', () => {
        const many = Array.from({ length: 20 }, (_, i) => loan({ id: i + 1, due_date: `2026-12-${String(i + 1).padStart(2, '0')}` }));
        const r = plan(many);
        expect(r).toHaveLength(MAX_LOAN_REMINDERS);
        expect(r.every((x, i) => i === 0 || x.date >= r[i - 1].date)).toBe(true);
    });

    it('leaves names and amounts out when the app is private', () => {
        const r = plan([loan()], true);
        expect(r[0].body).toBe('A loan is due soon. Open Folio to review.');
        expect(r[3].body).toBe('A loan is overdue. Open Folio to review.');
        expect(r.some(x => x.body.includes('Ali'))).toBe(false);
    });
});

describe('syncLoanReminders', () => {
    it('replaces only loan reminders and schedules them as dated notifications that open Loans', async () => {
        (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValueOnce([
            { identifier: 'folio-loan-7--1' },
            { identifier: 'folio-daily-reminder' },
        ]);
        const due = new Date();
        due.setDate(due.getDate() + 5);
        const ymd = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
        jest.spyOn(q, 'getLoans').mockResolvedValue([loan({ due_date: ymd })] as never);

        await NotificationService.syncLoanReminders();

        const cancelled = (Notifications.cancelScheduledNotificationAsync as jest.Mock).mock.calls.map(([id]) => id);
        expect(cancelled).toEqual(['folio-loan-7--1']);
        const reqs = scheduledCalls();
        expect(reqs).toHaveLength(4);
        expect(reqs[0].trigger).toMatchObject({ type: 'date' });
        expect(reqs[0].content.data).toEqual({ url: '/loans' });
    });

    it('only clears the old schedule when notifications are off', async () => {
        installInMemorySecureStore({ notifications_enabled: 'false' });
        const getLoans = jest.spyOn(q, 'getLoans');
        await NotificationService.syncLoanReminders();
        expect(getLoans).not.toHaveBeenCalled();
        expect(scheduledCalls()).toHaveLength(0);
    });
});

describe('checkHouseholdBudgetAlert', () => {
    const config = {
        id: 1, income_amount: 1000, period: 'monthly', period_start_date: '2026-11-01', anchor_day: 1,
        income_confirmed: true, created_at: '', updated_at: '',
    };
    const spentSoFar = (total: number) =>
        jest.spyOn(q, 'getHouseholdExpenses').mockResolvedValue([{ amount: total }] as never);

    beforeEach(() => {
        jest.spyOn(q, 'getHouseholdConfig').mockResolvedValue(config as never);
    });

    it('alerts when spending crosses 80% of the period income', async () => {
        spentSoFar(850);
        await NotificationService.checkHouseholdBudgetAlert(100, '2026-11-09');
        const [req] = scheduledCalls();
        expect(req.content.title).toBe('Household budget alert');
        expect(req.content.body).toContain('85%');
        expect(req.content.data).toEqual({ url: '/household' });
    });

    it('alerts once more when spending goes over the income', async () => {
        spentSoFar(1050);
        await NotificationService.checkHouseholdBudgetAlert(250, '2026-11-20');
        const [req] = scheduledCalls();
        expect(req.content.title).toBe('Household budget exceeded');
        expect(req.content.body).toContain('50');
    });

    it('stays quiet when no level is crossed or the expense is outside this period', async () => {
        spentSoFar(500);
        await NotificationService.checkHouseholdBudgetAlert(100, '2026-11-09');
        spentSoFar(900);
        await NotificationService.checkHouseholdBudgetAlert(50, '2026-11-09'); // 85% → 90%: already past 80%
        await NotificationService.checkHouseholdBudgetAlert(500, '2026-10-30');
        expect(scheduledCalls()).toHaveLength(0);
    });
});

describe('checkBudgetAlerts', () => {
    const food = {
        id: 1, category_id: 5, amount: 100, period: 'monthly', alert_threshold: 80, categoryName: 'Food',
    };
    const spend = (total: number) =>
        jest.spyOn(budgetSpend, 'loadSpendByRange').mockResolvedValue((() => total) as never);

    beforeEach(() => {
        jest.spyOn(q, 'getBudgetsWithDetails').mockResolvedValue([food] as never);
    });

    it('sends one alert for a batch, at the highest level crossed', async () => {
        spend(105);
        await NotificationService.checkBudgetAlerts([
            { categoryId: 5, amount: 20 },
            { categoryId: 5, amount: 20 },
        ]);
        const reqs = scheduledCalls();
        expect(reqs).toHaveLength(1);
        expect(reqs[0].content.title).toBe('Budget Exceeded');
        expect(reqs[0].content.body).toContain('Food budget exceeded');
        expect(reqs[0].content.data).toEqual({ url: '/budget' });
    });

    it('judges an edit on its net change', async () => {
        spend(82);
        await NotificationService.checkBudgetAlerts([
            { categoryId: 5, amount: 50 },
            { categoryId: 5, amount: -45 },
        ]);
        const [req] = scheduledCalls();
        expect(req.content.title).toBe('Budget Alert');
        expect(req.content.body).toContain('82% used');
    });

    it('ignores expenses in other categories and edits that lower spending', async () => {
        spend(90);
        await NotificationService.checkBudgetAlerts([{ categoryId: 9, amount: 50 }]);
        await NotificationService.checkBudgetAlerts([{ categoryId: 5, amount: 10 }, { categoryId: 5, amount: -30 }]);
        expect(scheduledCalls()).toHaveLength(0);
    });

    it('sends nothing while notifications are off', async () => {
        installInMemorySecureStore({ notifications_enabled: 'false' });
        spend(200);
        await NotificationService.checkAndSendBudgetAlert(5, 150);
        expect(scheduledCalls()).toHaveLength(0);
    });
});

describe('notificationRoute', () => {
    it('opens only known in-app screens', () => {
        expect(notificationRoute({ url: '/loans' })).toBe('/loans');
        expect(notificationRoute({ url: 'https://evil.example' })).toBeNull();
        expect(notificationRoute(undefined)).toBeNull();
    });
});
