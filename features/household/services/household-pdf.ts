import { C, escapeHtml, fmtDate, REPORT_CSS, writeAndSharePdf } from '@/features/export/services/pdf-export';
import { formatCurrency } from '@/lib/utils/currency';
import { householdFileStem, type HouseholdMonthReport, type HouseholdReport } from './household-report';

const NOUN: Record<HouseholdMonthReport['period'], string> = { monthly: 'Month', weekly: 'Week', yearly: 'Year' };

/** Extra styles for the household report, layered on the shared report CSS. */
const HOUSEHOLD_CSS = `
  .month { page-break-before: always; }
  .month.first { page-break-before: auto; }
  .month-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid ${C.ink};
                padding-bottom: 6pt; margin-bottom: 12pt; }
  .month-head h2 { border: 0; padding: 0; margin: 0; font-size: 18pt; }
  .badge { font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; font-weight: 700;
           border: 1px solid ${C.strong}; border-radius: 3pt; padding: 1.5pt 5pt; color: ${C.muted}; }
  .badge.over { color: ${C.expense}; border-color: ${C.expense}; }
  .usage { margin: -12pt 0 20pt; }
  .usage .track { height: 7pt; }
  .usage .bar { height: 7pt; }
  .usage .bar.over { background: ${C.expense}; }
  .usage-caption { display: flex; justify-content: space-between; font-size: 8.5pt; color: ${C.muted}; margin-top: 3pt; }
  h3 { font-size: 11pt; margin: 0 0 6pt; font-family: "Iowan Old Style", Georgia, serif; }
  .empty { color: ${C.muted}; font-style: italic; font-size: 9.5pt; }
  tr.over td { color: ${C.expense}; }
`;

function figures(items: { label: string; value: string; cls?: string }[]): string {
    return `<div class="figures">${items
        .map(f => `<div class="fig"><div class="kicker">${escapeHtml(f.label)}</div><div class="v ${f.cls ?? ''}">${f.value}</div></div>`)
        .join('')}</div>`;
}

function overviewHtml(report: HouseholdReport, money: (n: number) => string): string {
    const { totals, months } = report;
    const avgUsed = totals.income > 0 ? Math.round((totals.spent / totals.income) * 1000) / 10 : 0;
    const rows = months.map(m => `
      <tr class="${m.remaining < 0 ? 'over' : ''}">
        <td>${escapeHtml(m.label)}${m.isCurrent ? ' <span class="badge">Current</span>' : ''}</td>
        <td class="num">${money(m.income)}</td>
        <td class="num">${money(m.spent)}</td>
        <td class="num">${m.remaining < 0 ? '−' : ''}${money(Math.abs(m.remaining))}</td>
        <td class="num">${m.percentUsed}%</td>
        <td class="num">${m.detailsKept ? m.expenses.length : '—'}</td>
      </tr>`).join('');
    return `
  ${figures([
        { label: 'Total income', value: money(totals.income), cls: 'in' },
        { label: 'Total spent', value: money(totals.spent) },
        { label: totals.remaining < 0 ? 'Over' : 'Left', value: money(Math.abs(totals.remaining)), cls: totals.remaining < 0 ? 'out' : '' },
        { label: 'Average used', value: `${avgUsed}%` },
    ])}
  <section class="flow">
    <h2>Overview <span class="kicker" style="margin-left:6pt">${months.length} periods</span></h2>
    <table>
      <thead><tr><th>Period</th><th class="num">Income</th><th class="num">Spent</th><th class="num">Left</th><th class="num">Used</th><th class="num">Items</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td>Total</td>
        <td class="num">${money(totals.income)}</td>
        <td class="num">${money(totals.spent)}</td>
        <td class="num">${totals.remaining < 0 ? '−' : ''}${money(Math.abs(totals.remaining))}</td>
        <td class="num">${avgUsed}%</td>
        <td class="num">${totals.expenseCount}</td>
      </tr></tfoot>
    </table>
  </section>`;
}

function monthHtml(m: HouseholdMonthReport, first: boolean, money: (n: number) => string): string {
    const over = m.remaining < 0;
    const noun = NOUN[m.period];
    const top = m.byCategory[0]?.total || 1;
    const cats = m.byCategory.map(c => `
      <div class="cat">
        <div class="cat-row"><span>${escapeHtml(c.name)}</span><span class="num">${money(c.total)}<span class="pct">${c.percent.toFixed(1)}%</span></span></div>
        <div class="track"><div class="bar" style="width:${Math.max((c.total / top) * 100, 1)}%"></div></div>
      </div>`).join('');
    const rows = m.expenses.map(e => `
      <tr>
        <td class="nowrap">${escapeHtml(fmtDate(e.date, { day: '2-digit', month: 'short' }))}</td>
        <td>${escapeHtml(e.category)}${e.notes ? `<div class="note">${escapeHtml(e.notes)}</div>` : ''}</td>
        <td class="num">${money(e.amount)}</td>
      </tr>`).join('');

    const list = !m.detailsKept
        ? `<p class="empty">Individual expenses weren't kept for periods closed before this was added. The totals above are what was recorded at the time.</p>`
        : m.expenses.length === 0
            ? `<p class="empty">Nothing was logged this ${noun.toLowerCase()}.</p>`
            : `<table>
        <thead><tr><th>Date</th><th>Category</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2">Total spent</td><td class="num">${money(m.spent)}</td></tr></tfoot>
      </table>`;

    return `
  <div class="month${first ? ' first' : ''}">
    <div class="month-head">
      <h2>${escapeHtml(m.label)}</h2>
      <span class="badge${over ? ' over' : ''}">${m.isCurrent ? `Current ${noun.toLowerCase()}` : `${noun} closed`}${over ? ' · Over budget' : ''}</span>
    </div>
    ${figures([
        { label: 'Income', value: money(m.income), cls: 'in' },
        { label: 'Spent', value: money(m.spent) },
        { label: over ? 'Over by' : 'Left', value: money(Math.abs(m.remaining)), cls: over ? 'out' : '' },
        { label: 'Used', value: `${m.percentUsed}%`, cls: over ? 'out' : '' },
    ])}
    ${m.income > 0 ? `
    <div class="usage">
      <div class="track"><div class="bar${over ? ' over' : ''}" style="width:${Math.min(Math.max(m.percentUsed, 0.5), 100)}%"></div></div>
      <div class="usage-caption"><span>${escapeHtml(fmtDate(m.start))} – ${escapeHtml(fmtDate(m.end))}</span><span>${m.percentUsed}% of income used</span></div>
    </div>` : ''}
    ${cats ? `<section><h3>Spending by category</h3>${cats}</section>` : ''}
    <section class="flow">
      <h3>Expenses <span class="kicker" style="margin-left:4pt">${m.detailsKept ? m.expenses.length : '—'}</span></h3>
      ${list}
    </section>
  </div>`;
}

/**
 * The household report as a self-contained HTML document. Several periods get
 * an overview page first, then each period starts on its own page. Pure.
 */
export function buildHouseholdHtml(report: HouseholdReport): string {
    const money = (n: number) => escapeHtml(formatCurrency(n, report.currency));
    const { months } = report;
    const multi = months.length > 1;
    const span = months.length
        ? `${fmtDate(months[0].start)} – ${fmtDate(months[months.length - 1].end)}`
        : '';
    const generated = new Date(report.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(report.title)} — ${escapeHtml(report.scopeLabel)}</title>
<style>${REPORT_CSS}${HOUSEHOLD_CSS}</style>
</head>
<body>
  <header>
    <div class="kicker">Folio · ${escapeHtml(report.scopeLabel)}</div>
    <h1>${escapeHtml(report.title)}</h1>
    <div class="meta">${escapeHtml(span)}${report.ownerName ? ` · Prepared for ${escapeHtml(report.ownerName)}` : ''}</div>
  </header>
  ${multi ? overviewHtml(report, money) : ''}
  ${months.map((m, i) => monthHtml(m, !multi && i === 0, money)).join('')}
  <footer>Generated by Folio on ${escapeHtml(generated)}. Amounts in ${escapeHtml(report.currency)}.</footer>
</body>
</html>`;
}

/** Render the household report to PDF and open the share sheet. Returns the file URI. */
export async function exportHouseholdPdf(report: HouseholdReport): Promise<string> {
    return writeAndSharePdf(buildHouseholdHtml(report), householdFileStem(report), 'Share household report');
}
