import { compactMoney, niceMax } from '@/features/reports/chart-theme';
import { buildStandfirst, type PeriodFilter } from '@/features/reports/utils';
import { formatCurrency, getCurrencySymbol } from '@/lib/utils/currency';
import { parseLocalDate } from '@/lib/utils/date';
import tokens from '@/theme/tokens';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { reportFileStem, type ReportData } from './report-data';

export const C = {
    paper: '#FFFFFF',
    ink: tokens.light.textPrimary,
    muted: tokens.light.textMuted,
    rule: tokens.light.divider,
    strong: tokens.light.borderStrong,
    accent: tokens.brand.primary,
    income: tokens.light.income,
    expense: tokens.light.expense,
};

/** Escape text for safe interpolation into HTML (category names and notes are user input). */
export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export const fmtDate = (ymd: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) =>
    parseLocalDate(ymd).toLocaleDateString('en-GB', opts);

/** House style for printed reports, shared by every PDF the app makes. */
export const REPORT_CSS = `
  @page { margin: 18mm 16mm 20mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: ${C.ink}; background: ${C.paper};
         font: 10.5pt/1.5 -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif; }
  .serif, h1, h2 { font-family: "Iowan Old Style", Georgia, "Times New Roman", serif; font-weight: 600; }
  .kicker { font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: ${C.muted}; font-weight: 700; }
  header { border-bottom: 2px solid ${C.ink}; padding-bottom: 10pt; margin-bottom: 14pt; }
  h1 { font-size: 26pt; line-height: 1.1; margin: 4pt 0 2pt; }
  .meta { color: ${C.muted}; font-size: 9pt; }
  .standfirst { font-size: 13pt; line-height: 1.55; margin: 0 0 16pt; font-weight: 400; }
  .figures { display: flex; border-top: 1px solid ${C.rule}; border-bottom: 1px solid ${C.rule}; margin-bottom: 22pt; }
  .fig { flex: 1; padding: 10pt 12pt 10pt 0; }
  .fig + .fig { border-left: 1px solid ${C.rule}; padding-left: 12pt; }
  .fig .v { font-size: 16pt; font-variant-numeric: tabular-nums; margin-top: 2pt; }
  h2 { font-size: 15pt; margin: 0 0 8pt; padding-top: 10pt; border-top: 1px solid ${C.rule}; }
  section { margin-bottom: 20pt; page-break-inside: avoid; }
  section.flow { page-break-inside: auto; }
  .axis { font: 8pt sans-serif; fill: ${C.muted}; }
  .legend { font-size: 8.5pt; color: ${C.muted}; margin: 4pt 0 0; }
  .sw { display: inline-block; width: 8pt; height: 8pt; border-radius: 1.5pt; margin: 0 4pt -1pt 10pt; }
  .sw:first-child { margin-left: 0; }
  .cat { margin-bottom: 7pt; }
  .cat-row { display: flex; justify-content: space-between; font-size: 9.5pt; margin-bottom: 2pt; }
  .pct { color: ${C.muted}; display: inline-block; width: 38pt; text-align: right; }
  .track { height: 5pt; background: ${C.rule}; border-radius: 1pt; }
  .bar { height: 5pt; background: ${C.accent}; border-radius: 1pt; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; color: ${C.muted};
       border-bottom: 1px solid ${C.ink}; padding: 4pt 6pt 4pt 0; }
  td { border-bottom: 1px solid ${C.rule}; padding: 5pt 6pt 5pt 0; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  th.num { text-align: right; }
  .nowrap { white-space: nowrap; }
  .in { color: ${C.income}; }
  .out { color: ${C.expense}; }
  .note { color: ${C.muted}; font-size: 8pt; }
  tfoot td { border-bottom: none; border-top: 1px solid ${C.ink}; font-weight: 600; }
  footer { margin-top: 24pt; padding-top: 6pt; border-top: 1px solid ${C.rule}; color: ${C.muted}; font-size: 8pt; }
`;

function cashflowSvg(data: ReportData): string {
    const rows = data.monthly;
    if (!rows.length || rows.every(r => r.income === 0 && r.expense === 0)) return '';
    const W = 640, H = 200, padL = 44, padB = 22, plotH = H - padB;
    const max = niceMax(Math.max(1, ...rows.map(r => Math.max(r.income, r.expense))));
    const sym = escapeHtml(getCurrencySymbol(data.currency));
    const groupW = (W - padL) / rows.length;
    const barW = Math.min(18, groupW * 0.3);
    const y = (v: number) => plotH - (v / max) * (plotH - 8);
    const bars = rows.map((r, i) => {
        const cx = padL + groupW * i + groupW / 2;
        return `
      <rect x="${cx - barW - 1.5}" y="${y(r.income)}" width="${barW}" height="${plotH - y(r.income)}" fill="${C.income}" rx="1.5"/>
      <rect x="${cx + 1.5}" y="${y(r.expense)}" width="${barW}" height="${plotH - y(r.expense)}" fill="${C.expense}" rx="1.5"/>
      <text x="${cx}" y="${H - 6}" text-anchor="middle" class="axis">${escapeHtml(r.month)}${rows.length > 12 ? '' : ` ${String(r.year).slice(2)}`}</text>`;
    }).join('');
    return `
  <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Income versus spending by month">
    ${[max / 2, max].map(v => `
    <line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="${C.rule}" stroke-width="1"/>
    <text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end" class="axis">${compactMoney(v, sym)}</text>`).join('')}
    <line x1="${padL}" x2="${W}" y1="${plotH}" y2="${plotH}" stroke="${C.strong}" stroke-width="1"/>
    <text x="${padL - 6}" y="${plotH + 3}" text-anchor="end" class="axis">${sym}0</text>
    ${bars}
  </svg>
  <p class="legend"><span class="sw" style="background:${C.income}"></span>Income <span class="sw" style="background:${C.expense}"></span>Spending</p>`;
}

function categoryBarsHtml(data: ReportData, money: (n: number) => string): string {
    if (!data.categories.length) return '';
    const top = data.categories[0].total || 1;
    return data.categories.slice(0, 10).map(c => `
    <div class="cat">
      <div class="cat-row"><span>${escapeHtml(c.name)}</span><span class="num">${money(c.total)}<span class="pct">${c.percent.toFixed(1)}%</span></span></div>
      <div class="track"><div class="bar" style="width:${Math.max((c.total / top) * 100, 1)}%"></div></div>
    </div>`).join('');
}

/**
 * The report as a self-contained HTML document, styled like a printed
 * financial brief. Pure function — no I/O — so it can be unit-tested.
 */
export function buildReportHtml(data: ReportData, period?: PeriodFilter): string {
    const money = (n: number) => escapeHtml(formatCurrency(n, data.currency));
    const signed = (n: number) => `${n < 0 ? '−' : '+'}${money(Math.abs(n))}`;
    const top = data.categories[0];
    const standfirst = period
        ? buildStandfirst({
            period,
            income: data.summary.income,
            expense: data.summary.expense,
            topCategory: top ? { name: top.name, percent: Math.round(top.percent) } : null,
            format: n => formatCurrency(n, data.currency),
        })
        : '';

    const txRows = data.transactions.map(t => `
      <tr>
        <td class="nowrap">${escapeHtml(fmtDate(t.date, { day: '2-digit', month: 'short' }))}</td>
        <td>${escapeHtml(t.category)}${t.notes ? `<div class="note">${escapeHtml(t.notes)}</div>` : ''}</td>
        <td>${escapeHtml(t.account)}</td>
        <td class="num ${t.type === 'income' ? 'in' : ''}">${t.type === 'income' ? '+' : '−'}${money(t.amount)}</td>
      </tr>`).join('');

    const budgetRows = data.budgets.map(b => `
      <tr>
        <td>${escapeHtml(b.category)}</td>
        <td>${escapeHtml(b.period)}</td>
        <td class="num">${money(b.spent)}</td>
        <td class="num">${money(b.limit)}</td>
        <td class="num ${b.percentUsed > 100 ? 'out' : ''}">${b.percentUsed}%</td>
      </tr>`).join('');

    const generated = new Date(data.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)} — ${escapeHtml(data.periodLabel)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
  <header>
    <div class="kicker">Folio · ${escapeHtml(data.periodLabel)}</div>
    <h1>${escapeHtml(data.title)}</h1>
    <div class="meta">${escapeHtml(fmtDate(data.start))} – ${escapeHtml(fmtDate(data.end))}${data.ownerName ? ` · Prepared for ${escapeHtml(data.ownerName)}` : ''}</div>
  </header>

  ${standfirst ? `<p class="standfirst serif">${escapeHtml(standfirst)}</p>` : ''}

  <div class="figures">
    <div class="fig"><div class="kicker">Income</div><div class="v in">${money(data.summary.income)}</div></div>
    <div class="fig"><div class="kicker">Spending</div><div class="v">${money(data.summary.expense)}</div></div>
    <div class="fig"><div class="kicker">Net</div><div class="v ${data.summary.net < 0 ? 'out' : ''}">${signed(data.summary.net)}</div></div>
    <div class="fig"><div class="kicker">Savings rate</div><div class="v">${data.summary.savingsRate == null ? '—' : `${data.summary.savingsRate}%`}</div></div>
  </div>

  ${data.monthly.length ? `<section><h2>Income vs spending</h2>${cashflowSvg(data)}</section>` : ''}

  ${data.categories.length ? `<section><h2>Spending by category</h2>${categoryBarsHtml(data, money)}</section>` : ''}

  ${data.budgets.length ? `
  <section>
    <h2>Budgets <span class="kicker" style="margin-left:6pt">current period</span></h2>
    <table>
      <thead><tr><th>Category</th><th>Resets</th><th class="num">Spent</th><th class="num">Limit</th><th class="num">Used</th></tr></thead>
      <tbody>${budgetRows}</tbody>
    </table>
  </section>` : ''}

  ${data.transactions.length ? `
  <section class="flow">
    <h2>Transactions <span class="kicker" style="margin-left:6pt">${data.transactions.length}</span></h2>
    <table>
      <thead><tr><th>Date</th><th>Category</th><th>Account</th><th class="num">Amount</th></tr></thead>
      <tbody>${txRows}</tbody>
      <tfoot><tr><td colspan="3">Net for the period</td><td class="num">${signed(data.summary.net)}</td></tr></tfoot>
    </table>
  </section>` : ''}

  <footer>Generated by Folio on ${escapeHtml(generated)}. Amounts in ${escapeHtml(data.currency)}.</footer>
</body>
</html>`;
}

/** Render HTML to a PDF with a readable file name and open the share sheet. Returns the file URI. */
export async function writeAndSharePdf(html: string, fileStem: string, dialogTitle = 'Share PDF report'): Promise<string> {
    const { uri: tmp } = await Print.printToFileAsync({ html });
    const uri = `${FileSystem.cacheDirectory}${fileStem}.pdf`;
    await FileSystem.deleteAsync(uri, { idempotent: true });
    await FileSystem.moveAsync({ from: tmp, to: uri });
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle });
    }
    return uri;
}

/** Render the report to PDF, give it a readable file name, and open the share sheet. Returns the file URI. */
export async function exportPdf(data: ReportData, period?: PeriodFilter): Promise<string> {
    return writeAndSharePdf(buildReportHtml(data, period), reportFileStem(data));
}
