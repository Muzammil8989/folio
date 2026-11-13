import { getDb } from '@/lib/db/db-client';
import { getActiveRecurringExpenses } from '@/lib/db/queries';
import { categories, recurringExpenses, transactions } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import { addMonthsClamped, parseLocalDate, toISODateString, todayString } from '@/lib/utils/date';
import { and, eq, inArray, isNull } from 'drizzle-orm';

type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

/** Safety cap so a corrupt start date can't create thousands of rows in one run. */
const MAX_OCCURRENCES_PER_RUN = 400;

/**
 * Due date of occurrence #n (0 = start_date). Computed from the start date
 * rather than chained from the previous occurrence, so month-end schedules
 * don't drift (Jan 31 -> Feb 28 -> Mar 31, never Mar 28).
 */
export function occurrenceDate(startDate: string, frequency: Frequency, n: number): string {
    const start = parseLocalDate(startDate);
    switch (frequency) {
        case 'daily':
            return toISODateString(new Date(start.getFullYear(), start.getMonth(), start.getDate() + n));
        case 'weekly':
            return toISODateString(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * n));
        case 'monthly':
            return toISODateString(addMonthsClamped(start, n));
        case 'yearly':
            return toISODateString(addMonthsClamped(start, 12 * n));
    }
}

/**
 * All occurrence dates that are due (<= today, <= end_date) and come after
 * last_processed. Returns them oldest first.
 */
export function dueOccurrences(
    recurring: { start_date: string; frequency: Frequency; last_processed: string | null; end_date: string | null },
    today: string,
): string[] {
    const due: string[] = [];
    for (let n = 0; n < MAX_OCCURRENCES_PER_RUN * 50; n++) {
        const date = occurrenceDate(recurring.start_date, recurring.frequency, n);
        if (date > today) break;
        if (recurring.end_date && date > recurring.end_date) break;
        if (recurring.last_processed && date <= recurring.last_processed) continue;
        due.push(date);
        if (due.length >= MAX_OCCURRENCES_PER_RUN) break;
    }
    return due;
}

/** True once no future occurrence can fall on or before end_date. */
function hasEnded(recurring: { start_date: string; frequency: Frequency; end_date: string | null }, lastDate: string | null) {
    if (!recurring.end_date) return false;
    if (!lastDate) return recurring.start_date > recurring.end_date;
    // Find the occurrence after lastDate.
    for (let n = 0; n < MAX_OCCURRENCES_PER_RUN * 50; n++) {
        const date = occurrenceDate(recurring.start_date, recurring.frequency, n);
        if (date > lastDate) return date > recurring.end_date;
    }
    return true;
}

/**
 * Create transactions for every due occurrence of each active recurring
 * expense (catching up if the app wasn't opened for a while). Each
 * occurrence is written together with its last_processed update in one DB
 * transaction, so a crash can't create duplicates.
 * Call on app startup.
 *
 * Overlapping calls (launch + resume, or the Bills screen) share one run:
 * each run reads last_processed before writing it, so two concurrent runs
 * would both create the same occurrences.
 */
/** An expense the processor booked, for budget alerts. */
export type BookedExpense = { categoryId: number; amount: number; date: string };

type ProcessResult = { success: boolean; created: number; categoryNames?: string[]; bookedExpenses?: BookedExpense[]; error?: unknown };
let inFlight: Promise<ProcessResult> | null = null;

export function processRecurringTransactions(today: string = todayString()): Promise<ProcessResult> {
    if (inFlight) return inFlight;
    inFlight = runProcessor(today).finally(() => { inFlight = null; });
    return inFlight;
}

async function runProcessor(today: string): Promise<ProcessResult> {
    try {
        const db = getDb();
        const active = await getActiveRecurringExpenses();
        logger.info(`Processing ${active.length} active recurring expenses`);

        let createdCount = 0;
        const categoryNames: string[] = [];
        const bookedExpenses: BookedExpense[] = [];

        // Every category the active items use, in one query instead of one per item.
        const categoryIds = [...new Set(active.map(r => r.category_id))];
        const categoryRows = categoryIds.length
            ? await db
                .select({ id: categories.id, type: categories.type, name: categories.name })
                .from(categories)
                .where(inArray(categories.id, categoryIds))
            : [];
        const categoryById = new Map(categoryRows.map(c => [c.id, c]));

        for (const recurring of active) {
            try {
                const category = categoryById.get(recurring.category_id);
                if (!category) {
                    logger.error(`Category ${recurring.category_id} not found for recurring ${recurring.id}`);
                    continue;
                }

                const frequency = recurring.frequency as Frequency;
                let due = dueOccurrences({ ...recurring, frequency, last_processed: recurring.last_processed ?? null, end_date: recurring.end_date ?? null }, today);

                // "Make Recurring" used to save the first transaction without
                // marking it processed. Adopt it instead of duplicating it.
                let adoptId: number | null = null;
                if (!recurring.last_processed && due[0] === recurring.start_date) {
                    const [existing] = await db
                        .select({ id: transactions.id })
                        .from(transactions)
                        .where(and(
                            eq(transactions.date, recurring.start_date),
                            eq(transactions.category_id, recurring.category_id),
                            eq(transactions.account_id, recurring.account_id),
                            eq(transactions.amount, recurring.amount),
                            isNull(transactions.recurring_id),
                        ))
                        .limit(1);
                    if (existing) {
                        adoptId = existing.id;
                        due = due.slice(1);
                    }
                }
                const lastDate = due.length
                    ? due[due.length - 1]
                    : adoptId !== null ? recurring.start_date : recurring.last_processed ?? null;
                const advanced = due.length > 0 || adoptId !== null;
                const ended = hasEnded({ ...recurring, frequency, end_date: recurring.end_date ?? null }, lastDate);

                db.transaction((t) => {
                    if (adoptId !== null) {
                        t.update(transactions).set({ recurring_id: recurring.id }).where(eq(transactions.id, adoptId)).run();
                    }
                    for (const date of due) {
                        t.insert(transactions).values({
                            category_id: recurring.category_id,
                            account_id: recurring.account_id,
                            amount: recurring.amount,
                            type: category.type,
                            date,
                            notes: recurring.notes || `Auto-generated from recurring ${recurring.frequency} transaction`,
                            recurring_id: recurring.id,
                        }).run();
                    }
                    if (advanced || ended) {
                        t.update(recurringExpenses)
                            .set({
                                ...(advanced ? { last_processed: lastDate } : {}),
                                ...(ended ? { is_active: 0 } : {}),
                                updated_at: new Date().toISOString(),
                            })
                            .where(eq(recurringExpenses.id, recurring.id))
                            .run();
                    }
                });

                if (due.length) {
                    createdCount += due.length;
                    categoryNames.push(category.name || `Bill #${recurring.id}`);
                    if (category.type === 'expense') {
                        for (const date of due) bookedExpenses.push({ categoryId: recurring.category_id, amount: recurring.amount, date });
                    }
                }
            } catch (error) {
                logger.error(`Error processing recurring ${recurring.id}:`, error);
            }
        }

        logger.info(`Processed recurring transactions: ${createdCount} created`);
        return { success: true, created: createdCount, categoryNames, bookedExpenses };
    } catch (error) {
        logger.error('Error in processRecurringTransactions:', error);
        return { success: false, created: 0, error };
    }
}

/**
 * Latest occurrence strictly before `today`, or null if none. Used on resume
 * so periods that passed while paused are skipped, not back-filled; an
 * occurrence due today is still charged.
 */
export function lastOccurrenceBefore(
    recurring: { start_date: string; frequency: Frequency },
    today: string,
): string | null {
    let last: string | null = null;
    for (let n = 0; n < MAX_OCCURRENCES_PER_RUN * 50; n++) {
        const date = occurrenceDate(recurring.start_date, recurring.frequency, n);
        if (date >= today) break;
        last = date;
    }
    return last;
}

/**
 * Resume a paused recurring item without charging for the time it was paused.
 */
export async function resumeRecurring(id: number, today: string = todayString()): Promise<void> {
    const db = getDb();
    const [item] = await db.select().from(recurringExpenses).where(eq(recurringExpenses.id, id)).limit(1);
    if (!item) throw new Error(`Recurring item ${id} not found`);
    const skipTo = lastOccurrenceBefore({ start_date: item.start_date, frequency: item.frequency as Frequency }, today);
    const lastProcessed = [item.last_processed, skipTo].filter(Boolean).sort().pop() ?? null;
    await db.update(recurringExpenses)
        .set({ is_active: 1, last_processed: lastProcessed, updated_at: new Date().toISOString() })
        .where(eq(recurringExpenses.id, id));
}
