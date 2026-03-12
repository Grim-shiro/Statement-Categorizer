import Papa from "papaparse";
import { RawTransaction } from "@/types";
import { maskSensitiveData } from "./maskSensitive";

const DATE_COLUMNS = [
  "date",
  "transaction date",
  "posting date",
  "posted date",
  "trans date",
  "effective date",
];

const DESC_COLUMNS = [
  "description",
  "memo",
  "payee",
  "merchant",
  "name",
  "transaction description",
  "details",
  "narrative",
];

const AMOUNT_COLUMNS = ["amount", "transaction amount", "total"];
const DEBIT_COLUMNS = ["debit", "withdrawals", "withdrawal", "charges"];
const CREDIT_COLUMNS = ["credit", "deposits", "deposit", "payments"];

// Columns to ignore — these contain metadata, not transactions
const IGNORED_COLUMNS = [
  "account",
  "account number",
  "account #",
  "card number",
  "card #",
  "card no",
  "due date",
  "payment due",
  "statement date",
  "closing date",
  "customer name",
  "name on account",
  "cardholder",
  "address",
  "city",
  "state",
  "zip",
  "phone",
  "email",
  "ssn",
  "routing",
  "reference",
  "confirmation",
  "check number",
  "check #",
  "balance",
  "available balance",
  "credit limit",
  "minimum payment",
  "min payment",
  "previous balance",
  "new balance",
  "rewards",
  "points",
  "apr",
  "interest rate",
];

// Descriptions that indicate non-transaction rows (summaries, metadata)
const SKIP_DESCRIPTIONS = [
  /^balance/i,
  /^total/i,
  /^opening balance/i,
  /^closing balance/i,
  /^previous balance/i,
  /^new balance/i,
  /^beginning balance/i,
  /^ending balance/i,
  /^statement period/i,
  /^account (number|summary|holder)/i,
  /^customer name/i,
  /^payment due/i,
  /^due date/i,
  /^minimum payment/i,
  /^credit limit/i,
  /^available credit/i,
  /^interest charged/i,
  /^fees charged/i,
  /^rewards earned/i,
  /^annual percentage/i,
  /^apr /i,
  /^page \d/i,
  /^continued/i,
];

function isTransactionDescription(description: string): boolean {
  return !SKIP_DESCRIPTIONS.some((pattern) => pattern.test(description.trim()));
}

function findColumn(headers: string[], candidates: string[]): string | null {
  const normalized = headers.map((h) => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx !== -1) return headers[idx];
  }
  // Partial match
  for (const candidate of candidates) {
    const idx = normalized.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function parseAmount(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[$,()]/g, "").trim();
  if (!cleaned || cleaned === "-") return null;
  const isNegative = value.includes("(") || cleaned.startsWith("-");
  const num = parseFloat(cleaned.replace("-", ""));
  return isNaN(num) ? null : isNegative ? -num : num;
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();

  // MM/DD/YYYY or MM-DD-YYYY
  const match1 = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (match1) {
    const year =
      match1[3].length === 2 ? `20${match1[3]}` : match1[3];
    return `${year}-${match1[1].padStart(2, "0")}-${match1[2].padStart(2, "0")}`;
  }

  // YYYY-MM-DD
  const match2 = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match2) return trimmed;

  // Try native Date parse as fallback
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }

  return null;
}

export function parseCSV(content: string): RawTransaction[] {
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  });

  if (!result.data || result.data.length === 0) return [];

  // Filter out metadata columns so they're never used as data
  const headers = (result.meta.fields || []).filter(
    (h) => !IGNORED_COLUMNS.includes(h.toLowerCase().trim())
  );

  const allHeaders = result.meta.fields || [];
  const dateCol = findColumn(allHeaders, DATE_COLUMNS);
  const descCol = findColumn(allHeaders, DESC_COLUMNS);
  const amountCol = findColumn(headers, AMOUNT_COLUMNS);
  const debitCol = findColumn(headers, DEBIT_COLUMNS);
  const creditCol = findColumn(headers, CREDIT_COLUMNS);

  if (!dateCol || !descCol) return [];
  if (!amountCol && !debitCol && !creditCol) return [];

  const transactions: RawTransaction[] = [];

  for (const row of result.data as Record<string, string>[]) {
    const date = parseDate(row[dateCol]);
    const description = row[descCol]?.trim();

    if (!date || !description) continue;

    // Skip non-transaction rows (balances, summaries, metadata)
    if (!isTransactionDescription(description)) continue;

    let amount: number | null = null;

    if (amountCol) {
      amount = parseAmount(row[amountCol]);
    } else {
      const debit = parseAmount(row[debitCol!]) ?? 0;
      const credit = parseAmount(row[creditCol!]) ?? 0;
      amount = credit - debit;
    }

    if (amount === null || amount === 0) continue;

    transactions.push({ date, description: maskSensitiveData(description), amount });
  }

  return transactions;
}
