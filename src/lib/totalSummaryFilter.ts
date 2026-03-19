/**
 * Client-safe filter for total/summary transaction descriptions.
 * Kept separate from pdfParser so client code (e.g. useTransactions) does not pull in pdf-parse/fs.
 */

const SKIP_DESC_TERMS = [
  "opening balance", "closing balance", "previous balance", "new balance", "total balance", "account balance",
  "opening", "closing", "previous", "beginning", "ending", "statement", "payment due", "due date",
  "minimum payment", "credit limit", "available credit",
  "interest charge", "annual fee", "rewards", "points earned",
  "summary", "sub-total", "closing totals", "opening totals",
  "total debits", "total credits", "total withdrawals", "total deposits",
  "debits total", "credits total", "withdrawals total", "deposits total",
  "total amount", "grand total", "total fees", "total interest",
  "number of debits", "number of credits", "number of transactions",
];

const TOTAL_SUMMARY_REGEX = /^(total\s+(debits|credits|withdrawals|deposits|amount|balance|fees|interest)|debits\s+total|credits\s+total|withdrawals\s+total|deposits\s+total|sub[- ]?total|grand\s+total|number\s+of\s+(debits|credits|transactions)|closing\s+balance|opening\s+balance|new\s+balance)\b/;

/** True if a transaction description is a total/summary row (e.g. "Total Debits"). Use to hide from UI. */
export function isTotalOrSummaryDescription(description: string): boolean {
  const t = description.trim().toLowerCase();
  if (!t) return true;
  if (TOTAL_SUMMARY_REGEX.test(t)) return true;
  return SKIP_DESC_TERMS.some((term) => t === term || t.startsWith(term + " "));
}
