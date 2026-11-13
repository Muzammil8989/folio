import { getBudgetsWithDetails, getHouseholdConfig, getHouseholdExpenses, getLoans, type LoanWithDetails } from '@/lib/db/queries';
import { loadSpendByRange } from '@/features/budgets/services/budget-spend';
import { advancePeriodStart, computePeriodRange } from '@/features/household/hooks/use-household';
import { getPeriodDateRange, parseLocalDate } from '@/lib/utils/date';
import { logger } from '@/lib/logger';
import { UserService } from '@/features/user/services/user-service';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { SecurityService } from '@/features/auth/services/security-service';
import { Platform } from 'react-native';

const PREF_KEY = 'notifications_enabled';
const DAILY_REMINDER_ID = 'folio-daily-reminder';
// Legacy identifier from when the app was named "WealthFlow". Kept here only so
// upgraded installs can cancel the stale schedule still sitting in the OS queue.
const LEGACY_DAILY_REMINDER_ID = 'wf-daily-reminder';
const LOAN_REMINDER_PREFIX = 'folio-loan-';
const HOUSEHOLD_PERIOD_ID = 'folio-household-new-period';
export const ANDROID_CHANNEL_ID = 'default';

/** Scheduled reminders go off at 9 AM local time. */
const REMINDER_HOUR = 9;
/** Days relative to a loan's due date: 3 days before, the day before, the day, and the day after (overdue). */
export const LOAN_REMINDER_OFFSETS = [-3, -1, 0, 1] as const;
/** iOS keeps at most 64 pending notifications per app; leave room for the other reminders. */
export const MAX_LOAN_REMINDERS = 40;
/** Household spending alerts, as a share of the period's income. */
const HOUSEHOLD_ALERT_LEVELS = [80, 100] as const;

/** Screens a notification may open when tapped. */
export const NOTIFICATION_ROUTES = ['/loans', '/household', '/budget', '/recurring', '/savings'] as const;
export type NotificationRoute = (typeof NOTIFICATION_ROUTES)[number];

/**
 * Notifications show on the phone's lock screen, outside the app's PIN.
 * With app security on, keep names and amounts out of them.
 */
const keepPrivate = () => SecurityService.isSecurityConfigured();

const PERIOD_NOUN: Record<string, string> = { monthly: 'month', weekly: 'week', yearly: 'year' };

/** 9 AM on a "YYYY-MM-DD" day, `offsetDays` later (negative = earlier), in local time. */
function reminderTime(ymd: string, offsetDays = 0): Date {
    const d = parseLocalDate(ymd);
    d.setDate(d.getDate() + offsetDays);
    d.setHours(REMINDER_HOUR, 0, 0, 0);
    return d;
}

function dateTrigger(date: Date): Notifications.NotificationTriggerInput {
    return { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: ANDROID_CHANNEL_ID };
}

/** Cancel every scheduled notification whose identifier starts with `prefix`. */
async function cancelByPrefix(prefix: string): Promise<void> {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
        all
            .filter(n => n.identifier.startsWith(prefix))
            .map(n => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
    );
}

export interface LoanReminder {
    identifier: string;
    loanId: number;
    date: Date;
    title: string;
    body: string;
}

type ReminderLoan = Pick<LoanWithDetails, 'id' | 'type' | 'person_name' | 'due_date' | 'is_settled' | 'remaining_amount'>;

/**
 * The due-date reminders to schedule for these loans: 9 AM three days before,
 * the day before, on the day and the day after, skipping times already past
 * and loans that are settled, fully repaid or have no due date. Soonest first,
 * capped at MAX_LOAN_REMINDERS. Pure, so it can be tested without the OS.
 */
export function loanReminderSchedule(
    loans: ReminderLoan[],
    opts: { now: Date; currency: string; hideDetails: boolean },
): LoanReminder[] {
    const out: LoanReminder[] = [];
    for (const loan of loans) {
        if (!loan.due_date || loan.is_settled || !(loan.remaining_amount > 0)) continue;
        const amount = UserService.formatCurrency(loan.remaining_amount, opts.currency);
        const dueLabel = parseLocalDate(loan.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        const name = loan.person_name;

        for (const offset of LOAN_REMINDER_OFFSETS) {
            const date = reminderTime(loan.due_date, offset);
            if (date.getTime() <= opts.now.getTime()) continue;
            const overdue = offset > 0;
            const when = offset === -3 ? 'in 3 days' : offset === -1 ? 'tomorrow' : 'today';

            let title: string;
            let body: string;
            if (opts.hideDetails) {
                title = 'Loan reminder';
                body = overdue ? 'A loan is overdue. Open Folio to review.' : 'A loan is due soon. Open Folio to review.';
            } else if (loan.type === 'taken') {
                title = overdue ? 'Loan overdue' : `Loan due ${when}`;
                body = overdue
                    ? `Your repayment of ${amount} to ${name} was due on ${dueLabel}.`
                    : `You owe ${name} ${amount}, due ${offset === 0 ? 'today' : `by ${dueLabel}`}.`;
            } else {
                title = overdue ? 'Repayment overdue' : `Repayment due ${when}`;
                body = overdue
                    ? `${name}'s repayment of ${amount} was due on ${dueLabel}.`
                    : `${name} owes you ${amount}, due ${offset === 0 ? 'today' : `by ${dueLabel}`}.`;
            }
            out.push({ identifier: `${LOAN_REMINDER_PREFIX}${loan.id}-${offset}`, loanId: loan.id, date, title, body });
        }
    }
    return out.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, MAX_LOAN_REMINDERS);
}

/**
 * One expense to check against the budgets. Without a date it counts for every
 * budget's current period. A negative amount removes spend (an edit's old value).
 */
export interface BudgetAlertEntry {
    categoryId: number;
    amount: number;
    date?: string;
}

/** The highest level crossed going from `prev` to `now` percent, or null. */
function crossedLevel(levels: readonly number[], prev: number, now: number): number | null {
    let hit: number | null = null;
    for (const level of levels) if (prev < level && now >= level) hit = level;
    return hit;
}

export const NotificationService = {
    async requestPermissions(): Promise<boolean> {
        try {
            if (Platform.OS === 'web') return false;
            const { status: existing } = await Notifications.getPermissionsAsync();
            if (existing === 'granted') return true;
            const { status } = await Notifications.requestPermissionsAsync();
            return status === 'granted';
        } catch (e) {
            logger.error('Failed to request notification permissions', e);
            return false;
        }
    },

    async isEnabled(): Promise<boolean> {
        try {
            return (await SecureStore.getItemAsync(PREF_KEY)) === 'true';
        } catch {
            return false;
        }
    },

    async setEnabled(val: boolean): Promise<void> {
        try {
            await SecureStore.setItemAsync(PREF_KEY, val ? 'true' : 'false');
        } catch (e) {
            logger.error('Failed to save notification preference', e);
        }
    },

    /** Android: a high-importance channel so reminders show as heads-up banners. */
    async ensureAndroidChannel(): Promise<void> {
        if (Platform.OS !== 'android') return;
        try {
            await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
                name: 'Reminders & alerts',
                importance: Notifications.AndroidImportance.HIGH,
            });
        } catch (e) {
            logger.error('Failed to create notification channel', e);
        }
    },

    async scheduleDailyReminder(): Promise<void> {
        try {
            if (!(await this.isEnabled())) return;
            await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID).catch(() => {});
            await Notifications.cancelScheduledNotificationAsync(LEGACY_DAILY_REMINDER_ID).catch(() => {});
            await Notifications.scheduleNotificationAsync({
                identifier: DAILY_REMINDER_ID,
                content: {
                    title: 'Folio Daily Reminder',
                    body: "Don't forget to log today's expenses & income!",
                    sound: true,
                },
                trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 21, minute: 0 },
            });
            logger.info('Daily reminder scheduled for 9 PM');
        } catch (e) {
            logger.error('Failed to schedule daily reminder', e);
        }
    },

    async cancelDailyReminder(): Promise<void> {
        try {
            await Notifications.cancelScheduledNotificationAsync(DAILY_REMINDER_ID).catch(() => {});
            await Notifications.cancelScheduledNotificationAsync(LEGACY_DAILY_REMINDER_ID).catch(() => {});
            logger.info('Daily reminder cancelled');
        } catch (e) {
            logger.error('Failed to cancel daily reminder', e);
        }
    },

    /** Schedule every date-based reminder: daily log, loan due dates, household new period. */
    async syncScheduledReminders(): Promise<void> {
        await this.scheduleDailyReminder();
        await this.syncLoanReminders();
        await this.scheduleHouseholdPeriodReminder();
    },

    /** Cancel every reminder this app has scheduled (notifications switched off). */
    async cancelScheduledReminders(): Promise<void> {
        try {
            await Notifications.cancelAllScheduledNotificationsAsync();
        } catch (e) {
            logger.error('Failed to cancel scheduled reminders', e);
        }
    },

    /**
     * Re-plan loan due-date reminders from the database. Safe to call after any
     * loan change: it clears the old schedule first, so settled, edited and
     * deleted loans never leave a stale reminder behind.
     */
    async syncLoanReminders(): Promise<void> {
        try {
            await cancelByPrefix(LOAN_REMINDER_PREFIX);
            if (!(await this.isEnabled())) return;
            const [loans, profile, hideDetails] = await Promise.all([
                getLoans({ isSettled: false }),
                UserService.getProfile(),
                keepPrivate(),
            ]);
            const reminders = loanReminderSchedule(loans, { now: new Date(), currency: profile.currency, hideDetails });
            for (const r of reminders) {
                await Notifications.scheduleNotificationAsync({
                    identifier: r.identifier,
                    content: { title: r.title, body: r.body, sound: true, data: { url: '/loans' } },
                    trigger: dateTrigger(r.date),
                });
            }
            logger.info(`Loan reminders scheduled: ${reminders.length}`);
        } catch (e) {
            logger.error('Failed to schedule loan reminders', e);
        }
    },

    /** Remind the user at 9 AM on the day the next household period starts, to confirm its income. */
    async scheduleHouseholdPeriodReminder(): Promise<void> {
        try {
            await Notifications.cancelScheduledNotificationAsync(HOUSEHOLD_PERIOD_ID).catch(() => {});
            if (!(await this.isEnabled())) return;
            const config = await getHouseholdConfig();
            if (!config) return;
            // The stored period may be stale (it only rolls over when Household
            // opens), so step forward to the first period start still ahead.
            const now = Date.now();
            let nextStart = advancePeriodStart(config.period_start_date, config.period, config.anchor_day);
            for (let i = 0; i < 240 && reminderTime(nextStart).getTime() <= now; i++) {
                nextStart = advancePeriodStart(nextStart, config.period, config.anchor_day);
            }
            const date = reminderTime(nextStart);
            if (date.getTime() <= now) return;
            const noun = PERIOD_NOUN[config.period] ?? 'period';
            await Notifications.scheduleNotificationAsync({
                identifier: HOUSEHOLD_PERIOD_ID,
                content: {
                    title: `New household ${noun}`,
                    body: `A new ${noun} has started. Open Household to confirm this ${noun}'s income.`,
                    sound: true,
                    data: { url: '/household' },
                },
                trigger: dateTrigger(date),
            });
        } catch (e) {
            logger.error('Failed to schedule household period reminder', e);
        }
    },

    /**
     * Alert once when a household expense pushes the current period's spending
     * past 80% of its income, and again when it goes over 100%.
     * `addedAmount` is how much this change added (the full amount for a new
     * expense, the increase for an edit).
     */
    async checkHouseholdBudgetAlert(addedAmount: number, date: string): Promise<void> {
        try {
            if (!(addedAmount > 0) || !(await this.isEnabled())) return;
            const config = await getHouseholdConfig();
            if (!config || !(config.income_amount > 0)) return;
            const range = computePeriodRange(config);
            if (date < range.start || date > range.end) return;

            const spent = (await getHouseholdExpenses(range.start, range.end)).reduce((s, e) => s + e.amount, 0);
            const income = config.income_amount;
            const level = crossedLevel(HOUSEHOLD_ALERT_LEVELS, ((spent - addedAmount) / income) * 100, (spent / income) * 100);
            if (level === null) return;

            const [profile, hideDetails] = await Promise.all([UserService.getProfile(), keepPrivate()]);
            const noun = PERIOD_NOUN[config.period] ?? 'period';
            const remaining = income - spent;
            const money = UserService.formatCurrency(Math.abs(remaining), profile.currency);
            let title: string;
            let body: string;
            if (level >= 100) {
                title = remaining < 0 ? 'Household budget exceeded' : 'Household budget used up';
                body = hideDetails
                    ? `This ${noun}'s household budget is used up. Open Folio to review.`
                    : remaining < 0
                        ? `You're ${money} over this ${noun}'s household income.`
                        : `All of this ${noun}'s household income has been spent.`;
            } else {
                title = 'Household budget alert';
                body = hideDetails
                    ? `${level}% of this ${noun}'s household budget is used. Open Folio to review.`
                    : `${Math.round((spent / income) * 100)}% of this ${noun}'s household income used — ${money} left.`;
            }
            await Notifications.scheduleNotificationAsync({
                content: { title, body, sound: true, data: { url: '/household' } },
                trigger: null,
            });
            logger.info(`Household budget alert sent at ${level}%`);
        } catch (e) {
            logger.error('Failed to check household budget alert', e);
        }
    },

    async sendRecurringAlert(count: number, names: string[]): Promise<void> {
        try {
            if (!(await this.isEnabled())) return;
            const nameList = names.slice(0, 3).join(', ');
            const more = names.length > 3 ? ` +${names.length - 3} more` : '';
            const summary = `${count} bill${count > 1 ? 's' : ''} auto-processed`;
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: 'Recurring Bills Processed',
                    body: (await keepPrivate()) ? `${summary}. Open Folio to review.` : `${summary}: ${nameList}${more}`,
                    sound: true,
                    data: { url: '/recurring' },
                },
                trigger: null,
            });
        } catch (e) {
            logger.error('Failed to send recurring alert', e);
        }
    },

    /**
     * Alert once when an expense pushes a budget across its threshold.
     * `date` is the expense's date: an expense outside a budget's current
     * period doesn't change that period's spend, so it can't trigger it.
     */
    async checkAndSendBudgetAlert(categoryId: number, newAmount: number, date?: string): Promise<void> {
        await this.checkBudgetAlerts([{ categoryId, amount: newAmount, date }]);
    },

    /**
     * Alert once per budget when these expenses push it across its alert
     * threshold, and again when they push it past 100%. Several expenses at
     * once (e.g. recurring bills booked on launch) are checked together, so a
     * budget gets one alert for the whole batch, not one per expense.
     */
    async checkBudgetAlerts(entries: BudgetAlertEntry[]): Promise<void> {
        try {
            // Negative entries take out what an edited expense used to count,
            // so each budget is judged on its net change.
            const added = entries.filter(e => e.amount !== 0);
            if (!added.some(e => e.amount > 0) || !(await this.isEnabled())) return;
            const budgetsRaw = await getBudgetsWithDetails();
            // An expense outside a budget's current period can't trigger it.
            const relevant = budgetsRaw
                .map(budget => {
                    const range = getPeriodDateRange(budget.period);
                    const addedAmount = added
                        .filter(e => budget.category_id === null || budget.category_id === e.categoryId)
                        .filter(e => !e.date || (e.date >= range.startDate && e.date <= range.endDate))
                        .reduce((sum, e) => sum + e.amount, 0);
                    return { budget, range, addedAmount };
                })
                .filter(r => r.addedAmount > 0 && r.budget.amount > 0);
            if (relevant.length === 0) return;
            const [spentIn, profile, hideDetails] = await Promise.all([
                loadSpendByRange(relevant.map(r => r.range)),
                UserService.getProfile(),
                keepPrivate(),
            ]);

            for (const { budget, range, addedAmount } of relevant) {
                const spent = spentIn(range, budget.category_id);
                const threshold = budget.alert_threshold ?? 80;
                const percentUsed = (spent / budget.amount) * 100;
                const prevPercent = ((spent - addedAmount) / budget.amount) * 100;
                const levels = threshold < 100 ? [threshold, 100] : [threshold];
                const level = crossedLevel(levels, prevPercent, percentUsed);
                if (level === null) continue;

                const name = budget.categoryName || 'Overall';
                const remaining = budget.amount - spent;
                const formatted = UserService.formatCurrency(Math.abs(remaining), profile.currency);
                const tail = remaining < 0 ? `over by ${formatted}` : `${formatted} left`;
                const over = level >= 100 && percentUsed >= 100;
                await Notifications.scheduleNotificationAsync({
                    content: {
                        title: over ? (remaining < 0 ? 'Budget Exceeded' : 'Budget Used Up') : 'Budget Alert',
                        body: hideDetails
                            ? over
                                ? 'A budget is used up. Open Folio to review.'
                                : 'A budget has reached its alert limit. Open Folio to review.'
                            : over && remaining < 0
                                ? `${name} budget exceeded — ${tail}`
                                : `${name} budget is ${Math.round(percentUsed)}% used — ${tail}`,
                        sound: true,
                        data: { url: '/budget' },
                    },
                    trigger: null,
                });
                logger.info(`Budget alert sent for ${name} at ${level}%`);
            }
        } catch (e) {
            logger.error('Failed to check budget alert', e);
        }
    },

    async sendBackupComplete(fileName: string): Promise<void> {
        try {
            if (!(await this.isEnabled())) return;
            await Notifications.scheduleNotificationAsync({
                content: {
                    title: 'Auto-Backup Complete',
                    body: `Your data was backed up to "${fileName}".`,
                    sound: true,
                },
                trigger: null,
            });
            logger.info('Backup-complete notification sent');
        } catch (e) {
            logger.error('Failed to send backup-complete notification', e);
        }
    },

    async sendSavingsMilestone(goalName: string, milestone: number): Promise<void> {
        try {
            if (!(await this.isEnabled())) return;
            let body = milestone >= 100
                ? `${goalName} goal is complete! Congratulations!`
                : `${goalName} is ${milestone}% complete — keep going!`;
            if (await keepPrivate()) body = 'A savings goal reached a milestone. Open Folio to see it.';
            await Notifications.scheduleNotificationAsync({
                content: { title: 'Savings Milestone!', body, sound: true, data: { url: '/savings' } },
                trigger: null,
            });
        } catch (e) {
            logger.error('Failed to send savings milestone notification', e);
        }
    },
};

/** The in-app route a tapped notification should open, if it names an allowed one. */
export function notificationRoute(data: unknown): NotificationRoute | null {
    const url = (data as { url?: unknown } | null | undefined)?.url;
    return typeof url === 'string' && (NOTIFICATION_ROUTES as readonly string[]).includes(url)
        ? (url as NotificationRoute)
        : null;
}
