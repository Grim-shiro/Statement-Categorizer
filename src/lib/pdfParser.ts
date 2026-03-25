import { RawTransaction } from "@/types";
import { maskSensitiveData } from "./maskSensitive";

// ─── Server-side OCR fallback ─────────────────────────────────────
// Server-side OCR disabled — too heavy for serverless (causes stack overflow).
// The client-side PDF Visualizer handles OCR via Tesseract.js in the browser.
async function serverOCR(_buffer: Buffer): Promise<string> {
  return "";
}

// ─── Bank Detection ───────────────────────────────────────────────
type BankType = "cibc-credit" | "cibc-bank" | "bmo" | "bmo-credit" | "eq" | "rbc-credit" | "rbc-chequing" | "chase" | "scotiabank" | "scotiabank-bank" | "td-credit" | "td-bank" | "unknown";

function detectBank(text: string): BankType {
  // Normalize: collapse multiple spaces (pdfjs-dist can produce "TD   CASH   BACK   CARD")
  const lower = text.toLowerCase().replace(/\s+/g, " ");

  // TD: check for credit card statements (TD Cash Back, TD Visa, etc.)
  // PDF text extraction may compress spaces: "tdcashback", "tdcanadatrust"
  if ((lower.includes("td cash back") || lower.includes("tdcashback") ||
       lower.includes("td visa") || lower.includes("td first class") || lower.includes("tdfirstclass") ||
       lower.includes("td aeroplan") || lower.includes("tdaeroplan") ||
       lower.includes("td rewards") || lower.includes("td platinum")) &&
      (lower.includes("td canada trust") || lower.includes("tdcanadatrust") || lower.includes("toronto-dominion")))
    return "td-credit";

  // TD bank account (chequing/savings): "Statement of Account" + "Toronto-Dominion"
  if ((lower.includes("statement of account") || lower.includes("statementofaccount")) &&
      (lower.includes("toronto-dominion") || lower.includes("td canada trust") || lower.includes("tdcanadatrust")))
    return "td-bank";

  // Scotiabank: differentiate credit card vs bank account
  // Check bank account first (has compressed "Here'swhathappened" format)
  if ((lower.includes("scotiabank") || lower.includes("scotia")) &&
      (lower.includes("here'swhathappened") || lower.includes("here\u2019swhathappened")))
    return "scotiabank-bank";
  if (lower.includes("scotiabank") && (lower.includes("scene+") || lower.includes("visa")))
    return "scotiabank";

  // Check EQ Bank BEFORE CIBC (EQ statements may mention CIBC in transaction descriptions)
  if (lower.includes("eq bank") || lower.includes("equitable bank") || lower.includes("eqbank")) return "eq";

  if (lower.includes("cibc account statement")) return "cibc-bank";
  if (lower.includes("cibc") && lower.includes("credit")) return "cibc-credit";
  if (lower.includes("cibc")) return "cibc-bank";

  // Check RBC BEFORE BMO (RBC statements may contain "bmo" in unrelated text)
  if (lower.includes("royal bank") || lower.includes("rbc")) {
    if (lower.includes("personal banking") || lower.includes("details of your account activity"))
      return "rbc-chequing";
    return "rbc-credit";
  }

  // BMO: differentiate credit card vs chequing
  // Check for chequing indicators FIRST (these keywords only appear in chequing statements)
  if (lower.includes("bmo") || lower.includes("bank of montreal")) {
    if (lower.includes("everydaybanking") || lower.includes("everyday banking") ||
        lower.includes("performanceplan") || lower.includes("performance plan") ||
        lower.includes("here's what happened") || lower.includes("here\u2019s what happened") ||
        lower.includes("here\u2019swhathappened") || lower.includes("hereswhathappened") ||
        lower.includes("statement of your account") || lower.includes("chequing"))
      return "bmo";
    if (lower.includes("mastercard") || lower.includes("cashback") || lower.includes("credit card") ||
        lower.includes("cash back") || lower.includes("amount ($)") || /\d+\.\d{2}\s+cr\b/i.test(lower))
      return "bmo-credit";
    return "bmo";
  }

  if (lower.includes("chase") || lower.includes("jpmorgan")) return "chase";

  return "unknown";
}

// ─── Table Header Detection ───────────────────────────────────────
const TABLE_HEADER_KEYWORDS = [/date/i, /description|details|transaction|particulars/i, /amount|withdrawal|debit|credit|deposit/i];

function isTableHeader(line: string): boolean {
  let matches = 0;
  for (const kw of TABLE_HEADER_KEYWORDS) {
    if (kw.test(line)) matches++;
  }
  return matches >= 2;
}

// ─── Common Helpers ───────────────────────────────────────────────
// Terms that indicate a line is a total/summary/header, not a transaction. All parsers use this
// so total, debit, and credit summary rows are never parsed as transactions.
// Skip only when description is clearly a total/summary row — not when it merely contains a word (e.g. "Payroll Total" is valid).
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

function isSkipDescription(desc: string): boolean {
  const lower = desc.toLowerCase().trim();
  if (!lower) return true;
  return SKIP_DESC_TERMS.some((term) => lower.includes(term));
}

/** True if line looks like a total/summary row (e.g. "Total Debits", "Closing Balance"). Use to skip, not parse as txn. */
function isTotalOrSummaryLine(line: string): boolean {
  const t = line.trim().toLowerCase();
  return /^(total\s+(debits|credits|withdrawals|deposits|amount|balance|fees|interest)|debits\s+total|credits\s+total|withdrawals\s+total|deposits\s+total|sub[- ]?total|grand\s+total|number\s+of\s+(debits|credits|transactions)|closing\s+balance|opening\s+balance|new\s+balance)\b/.test(
    t
  );
}

function parseAmountStr(s: string): number {
  return parseFloat(s.replace(/[$,\s]/g, ""));
}

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseMonthDayDate(dateStr: string, year: number): string | null {
  const m = dateStr.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*(\d{1,2})$/i);
  if (!m) return null;
  const month = MONTH_MAP[m[1].toLowerCase()];
  if (!month) return null;
  return `${year}-${month}-${m[2].padStart(2, "0")}`;
}

function parseNumericDate(dateStr: string): string | null {
  const cleaned = dateStr.replace(/-/g, "/");
  const parts = cleaned.split("/");
  if (parts.length === 2) {
    return `${new Date().getFullYear()}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  }
  if (parts.length === 3) {
    const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
    return `${year}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  }
  return null;
}

function parseAnyDate(dateStr: string, year: number): string | null {
  return parseMonthDayDate(dateStr, year) || parseNumericDate(dateStr);
}

function extractYear(text: string): number {
  // Look for year in date-like contexts: "2026", "January 12, 2026", "FEB 9, 2026"
  const yearPatterns = [
    /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+(20\d{2})/i,
    /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2},?\s+(20\d{2})/i,
    /\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*,?\s+(20\d{2})/i,
    /(?:from|to|through|period|statement)\s+.*?(20\d{2})/i,
    /\b(20(?:2[0-9]|3[0-9]))\b/, // Years 2020-2039 as whole words
  ];
  for (const pattern of yearPatterns) {
    const m = text.match(pattern);
    if (m) return parseInt(m[1]);
  }
  return new Date().getFullYear();
}

// ─── Scotiabank Parser ────────────────────────────────────────────
// Format: "002Jan 30Jan 31Jump+  Scarborough  ON33.89"
// "001Jan 13Jan 13PAYMENT FROM - *****05*982179.12-"
// The amount is always the LAST number with .XX format before optional trailing "-"

function parseScotiabank(lines: string[], year: number): RawTransaction[] {
  const txns: RawTransaction[] = [];

  for (const line of lines) {
    if (isTotalOrSummaryLine(line)) continue;
    // Must start with 3-digit ref number
    if (!/^\d{3}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(line)) continue;

    // Extract the transaction date (first month+day after the ref#)
    const dateMatch = line.match(/^\d{3}((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2})/i);
    if (!dateMatch) continue;

    const date = parseMonthDayDate(dateMatch[1].trim(), year);
    if (!date) continue;

    // The amount is the last decimal number (X.XX) before optional trailing "-"
    // Use conservative match: max 3 digits without commas, or proper comma format
    // This avoids grabbing masked card numbers like *9821 as part of the amount
    const amountMatch = line.match(/(\d{1,3}(?:,\d{3})*\.\d{2})([-]?)$/);
    if (!amountMatch) continue;

    let amount = parseAmountStr(amountMatch[1]);
    if (isNaN(amount) || amount === 0) continue;
    // Debit (charge) = negative, Credit (payment/refund) = positive. Trailing "-" on statement = credit.
    if (amountMatch[2] !== "-") amount = -amount; // Debit/charge: store as negative

    // Description: everything between the second date and the amount
    // Format: "001Jan 13Jan 13PAYMENT FROM..." — skip ref(3) + date1 + date2
    const twoDateMatch = line.match(/^(\d{3}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2})/i);
    if (!twoDateMatch) continue;

    const descStart = twoDateMatch[1].length;
    const descEnd = line.lastIndexOf(amountMatch[1]);
    const description = line.substring(descStart, descEnd).trim();

    if (!description || isSkipDescription(description)) continue;
    if (/^[\d\s*X]+$/.test(description)) continue;

    txns.push({ date, description, amount });
  }

  return txns;
}

// ─── TD Compressed Description Splitter ──────────────────────────
// TD PDF text extraction concatenates words: "RELIANCEHOMECOMFORTTORONTO"
// This function tries to restore reasonable spacing using common word patterns.
// If the text already has spaces, it returns as-is.

function splitCompressedTDDesc(text: string): string {
  // If there are already spaces, just return trimmed
  if (/\s/.test(text)) return text.trim();

  // Insert space before known city names that appear at end of descriptions
  const CITIES = /(?=(?:TORONTO|MONTREAL|VANCOUVER|OTTAWA|CALGARY|EDMONTON|WINNIPEG|HALIFAX|VICTORIA|MISSISSAUGA|BRAMPTON|MARKHAM|RICHMOND|BURNABY|SURREY|LONDON|HAMILTON|KITCHENER|WINDSOR|SASKATOON|REGINA|QUEBEC|GATINEAU|BARRIE|OSHAWA|GUELPH))/gi;
  let result = text.replace(CITIES, " ");

  // Insert space before common words/tokens
  const WORDS = /(?=(?:HOME|COMFORT|GENERAL|INSURANCE|INTEREST|PAYMENT|CREDIT|DEBIT|TRANSFER|ONLINE|PURCHASE|RETAIL|SERVICE|CHARGE|ANNUAL|MONTHLY|REFUND|RETURN|DEPOSIT|WITHDRAWAL|FROM|THANK|AUTO|PAY|BILL|GAS|HYDRO|ELECTRIC|WATER|PHONE|MOBILE|WIRELESS|INTERNET|CABLE|GROCERY|MARKET|STORE|SHOP|BANK|TRUST|CANADA|FINANCIAL))/gi;
  result = result.replace(WORDS, " ");

  // Clean up multiple spaces
  return result.replace(/\s+/g, " ").trim();
}

// ─── TD Credit Card Parser ───────────────────────────────────────
// PDF text extraction gives compressed format:
// "DEC19DEC22$51.98RELIANCEHOMECOMFORTTORONTO"
// Two dates (txn+posting), $amount, then description (no spaces)
// Also handles spaced format: "DEC 19 DEC 22 RELIANCE HOME COMFORT TORONTO $51.98"

function parseTDCredit(lines: string[], year: number): RawTransaction[] {
  const txns: RawTransaction[] = [];
  let inSection = false;

  const MONTH = "(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)";

  // Compressed format: "DEC19DEC22$51.98RELIANCEHOMECOMFORTTORONTO"
  const COMPRESSED_RE = new RegExp(
    `^(${MONTH})\\s*(\\d{1,2})\\s*${MONTH}\\s*\\d{1,2}\\s*\\$([\\d,]+\\.\\d{2})(.+)$`,
    "i"
  );

  // Spaced format: "DEC 19 DEC 22 RELIANCE HOME COMFORT TORONTO $51.98"
  const SPACED_RE = new RegExp(
    `^(${MONTH})\\s+(\\d{1,2})\\s+${MONTH}\\s+\\d{1,2}\\s+(.+?)\\s+\\$([\\d,]+\\.\\d{2})\\s*$`,
    "i"
  );

  for (let line of lines) {
    // Start parsing after common header patterns
    if (/ACTIVITY\s*DESCRIPTION\s*AMOUNT/i.test(line) ||
        /TRANSACTION\s*POSTING/i.test(line) ||
        /PREVIOUS\s*STATEMENT\s*BALANCE/i.test(line)) {
      inSection = true;
      // PREVIOUS STATEMENT BALANCE is also a skip line, so just mark inSection and continue
      if (/PREVIOUS\s*STATEMENT/i.test(line)) continue;
      continue;
    }
    if (!inSection) continue;
    if (isTotalOrSummaryLine(line)) continue;

    // Stop markers
    if (/TD\s*MESSAGE\s*CENTRE/i.test(line)) break;
    if (/What\s*is\s*the\s*minimum/i.test(line)) break;
    if (/SPECIAL\s*OFFERS/i.test(line)) break;

    // Skip summary lines
    if (/TOTAL\s*NEW\s*BALANCE/i.test(line)) continue;
    if (/NEW\s*BALANCE/i.test(line) && !new RegExp(MONTH, "i").test(line)) continue;
    if (/CALCULATING/i.test(line)) { inSection = false; continue; }
    // "PAYMENT INFORMATION" may share a line with a transaction (same Y-coord in PDF)
    // e.g. "PAYMENT   INFORMATION  JAN 5   JAN 5   $4.11 RETAIL INTEREST"
    if (/PAYMENT\s*INFORMATION/i.test(line)) {
      const txnPart = line.match(new RegExp(`(${MONTH}\\s*\\d{1,2}\\s*${MONTH}\\s*\\d{1,2}\\s*\\$.+)$`, "i"));
      if (!txnPart) { inSection = false; continue; }
      line = txnPart[1]; // Strip prefix, keep parsing the transaction part
    }

    let monthStr: string | undefined;
    let dayStr: string | undefined;
    let description: string | undefined;
    let amountStr: string | undefined;

    // Try compressed format first (most common from pdf-parse)
    const cm = line.match(COMPRESSED_RE);
    if (cm) {
      monthStr = cm[1];
      dayStr = cm[2];
      amountStr = cm[3];
      // Description is compressed — try to restore spaces
      // TD compressed text is all-caps with no spaces: "RELIANCEHOMECOMFORTTORONTO"
      // Use known word boundaries from common merchant names
      description = splitCompressedTDDesc(cm[4].trim());
    } else {
      // Try spaced format
      const sm = line.match(SPACED_RE);
      if (sm) {
        monthStr = sm[1];
        dayStr = sm[2];
        description = sm[3].trim();
        amountStr = sm[4];
      }
    }

    if (!monthStr || !dayStr || !description || !amountStr) continue;
    if (isSkipDescription(description)) continue;

    const date = parseMonthDayDate(`${monthStr} ${dayStr}`, year);
    if (!date) continue;

    const amount = parseAmountStr(amountStr);
    if (isNaN(amount) || amount === 0) continue;

    // Credit card: positive amounts are charges (expenses = negative)
    // Payments/credits typically show with CR or negative
    txns.push({ date, description, amount: -amount });
  }

  return txns;
}

// ─── TD Bank Account Parser ──────────────────────────────────────
// Compressed: "ELEXICONU3H4Z9377.23SEP02" or "TDMORTGAGE2,280.17SEP023,059.82"
// Strategy: find date (MMMDD) as anchor, extract ALL amount candidates before it.
// Then use known balance anchors (starting balance + explicit balance columns)
// to solve for the correct (candidate, sign) combination per transaction.
// This handles reference number digit bleed (e.g. "K992.08" where K9 is ref, amount=92.08).

function parseTDBank(lines: string[], year: number): RawTransaction[] {
  const DEBUG = false; // TD parser debug logging
  const MONTH_RE = /(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}/i;

  interface TDParsed {
    date: string;
    beforeDate: string; // raw text before date, used to derive description from chosen candidate
    candidates: { value: number; start: number; prefixDigits: number }[];
    balance: number | null;
  }
  const parsed: TDParsed[] = [];
  let inSection = false;
  let startingBalance: number | null = null;

  for (const line of lines) {
    if (/description\s*withdrawal/i.test(line) || /description\s*debit/i.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/account\/transaction\s*type/i.test(line) || /account\s*issued/i.test(line)) break;
    if (isTotalOrSummaryLine(line)) continue;
    if (/closing\s*balance/i.test(line)) continue;

    // Starting balance: "STARTINGBALANCEAUG292,768.02"
    if (/starting\s*balance/i.test(line)) {
      const m = line.match(/([\d,]+\.\d{2})\s*$/);
      if (m) startingBalance = parseFloat(m[1].replace(/,/g, ""));
      continue;
    }

    // Pure total/summary line (two amounts concatenated, no description)
    if (/^[\d,]+\.\d{2}[\d,]+\.\d{2}\s*$/.test(line)) continue;

    // Find date position (MMMDD) in line
    const dateMatch = line.match(MONTH_RE);
    if (!dateMatch) continue;

    const datePos = line.indexOf(dateMatch[0]);
    const monthStr = dateMatch[0].substring(0, 3);
    const dayStr = dateMatch[0].substring(3);

    const date = parseMonthDayDate(`${monthStr} ${dayStr}`, year);
    if (!date) continue;

    const beforeDate = line.substring(0, datePos);
    const afterDate = line.substring(datePos + dateMatch[0].length).trim();

    // Extract balance from after-date portion
    // TD statements may concatenate amounts after the date: e.g. "5,000.003,010.77"
    // where the first number is a deposit/withdrawal amount and the LAST is the running balance.
    // Always use the LAST number as the balance (rightmost column).
    let balance: number | null = null;
    if (afterDate) {
      const allNums = afterDate.match(/[\d,]+\.\d{2}/g);
      if (allNums && allNums.length > 0) {
        balance = parseFloat(allNums[allNums.length - 1].replace(/,/g, ""));
      }
    }

    // Extract ALL amount candidates — we'll pick the right one using balance anchors
    const candidates = extractBMOAmountCandidates(beforeDate).filter(c => c.value > 0);
    if (candidates.length === 0) continue;

    parsed.push({ date, beforeDate, candidates, balance });
  }

  if (DEBUG) {
    console.log("=== TD PARSER DEBUG ===");
    console.log("Starting balance:", startingBalance);
    console.log("Total parsed transactions:", parsed.length);
    for (let i = 0; i < parsed.length; i++) {
      const tx = parsed[i];
      console.log(`  [${i}] date=${tx.date} beforeDate="${tx.beforeDate}" balance=${tx.balance} candidates=${JSON.stringify(tx.candidates.map(c => ({ val: c.value, prefDig: c.prefixDigits })))}`);
    }
  }

  if (parsed.length === 0) return [];

  // ── Helper: derive description from beforeDate and chosen candidate ──
  function descFromCandidate(beforeDate: string, start: number): string {
    return beforeDate.substring(0, start)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .trim();
  }

  // ── Anchor-based solving ──
  // Anchors: known balance points (starting balance + explicit balance columns)
  const anchors: { idx: number; bal: number }[] = [];
  if (startingBalance !== null) anchors.push({ idx: -1, bal: startingBalance });
  for (let i = 0; i < parsed.length; i++) {
    if (parsed[i].balance !== null) anchors.push({ idx: i, bal: parsed[i].balance! });
  }

  // For each transaction: chosen amount and sign. Default: largest clean candidate, withdrawal.
  const chosen: { amount: number; candidateIdx: number }[] = parsed.map(tx => {
    const clean = tx.candidates.filter(c => c.prefixDigits < 5);
    const pool = clean.length > 0 ? clean : tx.candidates;
    const best = pool[pool.length - 1];
    return { amount: best.value, candidateIdx: tx.candidates.indexOf(best) };
  });
  // Heuristic sign: +1 for likely deposits, -1 for likely withdrawals
  function heuristicSign(tx: TDParsed): number {
    const desc = descFromCandidate(tx.beforeDate, tx.candidates[0].start).toLowerCase();
    if (/e-?transfer|deposit|received|credit|refund|rebate|payroll|salary|income|interest|cashback|cash\s*back|reversal|reimbursement|dividend|transfer\s*in|tfr\s*in/i.test(desc)) return 1;
    return -1;
  }
  const signs: number[] = parsed.map(tx => heuristicSign(tx));

  if (DEBUG) {
    console.log("Anchors:", JSON.stringify(anchors));
    console.log("Heuristic signs:", signs.join(", "));
  }

  // Solve each segment between consecutive anchors:
  // Try all (candidate, sign) combinations to find one matching the balance delta
  for (let a = 0; a < anchors.length - 1; a++) {
    const startIdx = anchors[a].idx + 1;
    const endIdx = anchors[a + 1].idx;
    const prevBal = anchors[a].bal;
    const nextBal = anchors[a + 1].bal;
    const requiredDelta = Math.round((nextBal - prevBal) * 100) / 100;

    const segTxns: TDParsed[] = [];
    for (let i = startIdx; i <= endIdx; i++) segTxns.push(parsed[i]);
    const n = segTxns.length;
    if (n === 0) continue;

    // Check if total search space is feasible (each tx: candidates × 2 signs)
    let totalCombos = 1;
    for (const tx of segTxns) totalCombos *= tx.candidates.length * 2;

    if (DEBUG) {
      console.log(`  Segment a=${a}: indices ${startIdx}..${endIdx}, prevBal=${prevBal}, nextBal=${nextBal}, delta=${requiredDelta}, n=${n}, combos=${totalCombos}`);
    }

    if (totalCombos <= 200000 && n <= 25) {
      // Iterative stack-based search: try all (candidate, sign) combinations
      const bestResult: { candidateIdx: number; sign: number }[] = new Array(n);
      let solved = false;

      // Pre-compute heuristic signs for each tx in the segment
      const segHeuristics: number[] = segTxns.map(tx => heuristicSign(tx));

      // Build options for each transaction: array of {candidateIdx, sign, delta}
      // Ordered so heuristic-expected sign comes first
      const options: { ci: number; sign: number; delta: number }[][] = [];
      for (let i = 0; i < n; i++) {
        const tx = segTxns[i];
        const expected = segHeuristics[i];
        const txOptions: { ci: number; sign: number; delta: number }[] = [];
        for (let ci = 0; ci < tx.candidates.length; ci++) {
          const val = tx.candidates[ci].value;
          txOptions.push({ ci, sign: expected, delta: expected * val });
          txOptions.push({ ci, sign: -expected, delta: -expected * val });
        }
        options.push(txOptions);
      }

      // Iterative DFS using an explicit stack (avoids call stack overflow)
      const optionIdx = new Int32Array(n); // which option we're trying at each level
      const sums = new Float64Array(n + 1); // cumulative sums; sums[0] = 0
      sums[0] = 0;
      let level = 0;

      outer:
      while (level >= 0) {
        if (level === n) {
          // Check solution
          if (Math.abs(Math.round(sums[n] * 100) / 100 - requiredDelta) < 0.10) {
            solved = true;
            break outer;
          }
          // Solution didn't match, backtrack: move to next option at previous level
          level--;
          if (level >= 0) optionIdx[level]++;
          continue;
        }

        const oi = optionIdx[level];
        if (oi >= options[level].length) {
          // Exhausted all options at this level, backtrack
          optionIdx[level] = 0;
          level--;
          if (level >= 0) optionIdx[level]++;
          continue;
        }

        // Try this option and descend
        const opt = options[level][oi];
        bestResult[level] = { candidateIdx: opt.ci, sign: opt.sign };
        sums[level + 1] = sums[level] + opt.delta;
        level++;
      }

      if (DEBUG) console.log(`    Solved: ${solved}`);
      if (solved) {
        for (let i = 0; i < n; i++) {
          const txIdx = startIdx + i;
          const ci = bestResult[i].candidateIdx;
          chosen[txIdx] = { amount: segTxns[i].candidates[ci].value, candidateIdx: ci };
          signs[txIdx] = bestResult[i].sign;
          if (DEBUG) console.log(`    [${txIdx}] candidate=${segTxns[i].candidates[ci].value} sign=${bestResult[i].sign}`);
        }
      }
    } else {
      if (DEBUG) console.log(`    SKIPPED (too many combos or too many txns)`);
    }
  }

  if (DEBUG) {
    console.log("=== AFTER SOLVING ===");
    for (let i = 0; i < parsed.length; i++) {
      const tx = parsed[i];
      const desc = descFromCandidate(tx.beforeDate, tx.candidates[chosen[i].candidateIdx].start);
      console.log(`  [${i}] desc="${desc}" amount=${chosen[i].amount} sign=${signs[i]} final=${Math.round(signs[i] * chosen[i].amount * 100) / 100}`);
    }
  }

  // Build final result
  const result: RawTransaction[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const tx = parsed[i];
    const desc = descFromCandidate(tx.beforeDate, tx.candidates[chosen[i].candidateIdx].start);
    if (!desc || isSkipDescription(desc)) continue;
    result.push({
      date: tx.date,
      description: desc,
      amount: Math.round(signs[i] * chosen[i].amount * 100) / 100,
    });
  }

  return result;
}

// ─── CIBC Bank Parser ─────────────────────────────────────────────
// Multi-line format:
// Line 1: "Jan 15INTERNET BILL PAY 000000105840"
// Line 2: "EBOX" (continuation of description)
// Line 3: "45.20330.47" (amounts: withdrawal/deposit + balance)
// OR: "Jan 30SERVICE CHARGE\nCAPPED MONTHLY FEE$16.95\n..."

// ─── CIBC Credit Card Parser ──────────────────────────────────────
// CIBC credit card format (Adapta, Visa, etc.):
//   "Jan 13Jan 14PAY WITH POINTS/PAIEMENT  PAR POINTS20.00"
//   "JAN 19JAN 19APPLE.COM/BILL           TORONTO      ON45.19"
// Trans date + Post date concatenated + Description + Amount (no spaces)
// Payments section: amounts are credits (positive)
// Charges section: amounts are debits (negative), unless prefixed with "-" (refund)

function parseCIBCCredit(lines: string[], year: number): RawTransaction[] {
  const txns: RawTransaction[] = [];
  let inPayments = false;
  let inCharges = false;

  // Match: MonDDMonDD or Mon DDMon DD (trans date + post date at start)
  const CIBC_CC_LINE = /^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2})\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2})(.*?)(-?[\d,]+\.\d{2})\s*$/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect sections
    if (/your\s*payments/i.test(line)) { inPayments = true; inCharges = false; continue; }
    if (/your\s*new\s*charges/i.test(line) || /charges\s*and\s*credits/i.test(line)) { inCharges = true; inPayments = false; continue; }
    if (/^total\s*(payments|for)/i.test(line) || /^total\s*for/i.test(line)) continue;
    if (/^card\s*number/i.test(line)) continue;

    if (!inPayments && !inCharges) continue;

    const m = line.match(CIBC_CC_LINE);
    if (!m) continue;

    const transDateStr = m[1].trim();
    const description = m[3].trim();
    const amountStr = m[4].replace(/,/g, "");
    const amount = parseFloat(amountStr);

    if (isNaN(amount) || amount === 0) continue;
    if (!description || isSkipDescription(description)) continue;

    const date = parseMonthDayDate(transDateStr, year);
    if (!date) continue;

    // In payments section: amounts are credits (positive)
    // In charges section: positive amounts are purchases (negative), negative amounts are refunds (positive)
    let signedAmount: number;
    if (inPayments) {
      signedAmount = Math.abs(amount); // payments are credits
    } else {
      // charges section: if the original text had "-" prefix it's a refund
      signedAmount = amountStr.startsWith("-") ? Math.abs(amount) : -Math.abs(amount);
    }

    txns.push({ date, description, amount: signedAmount });
  }

  return txns;
}

function parseCIBCBank(lines: string[], year: number): RawTransaction[] {
  interface CIBCParsedTxn { date: string; description: string; amount: number; balance: number | null }
  const parsed: CIBCParsedTxn[] = [];
  let inSection = false;
  let lastDate: string | null = null;
  let currentDesc: string[] = [];
  let prevBalance: number | null = null;

  // Sub-detail lines that are NOT separate transactions (fee breakdowns, etc.)
  const SUB_DETAIL = /^(capped|record-?keeping|monthly fee|annual fee|plan fee|rebate|discount)/i;

  function flushTransaction(amountLine: string) {
    if (!lastDate || currentDesc.length === 0) {
      currentDesc = [];
      return;
    }

    const description = currentDesc.join(" ").trim();
    currentDesc = [];

    if (isSkipDescription(description)) return;

    // Extract amounts: first is usually withdrawal/deposit, last is balance (description digits can add extra matches)
    const amountStrs = amountLine.match(/\$?[\d,]+\.\d{2}/g);
    if (!amountStrs || amountStrs.length === 0) return;

    const balance = amountStrs.length >= 2 ? parseAmountStr(amountStrs[amountStrs.length - 1]) : null;
    // When we have balance + prevBalance, pick the amount that matches the balance change (avoids description-embedded numbers)
    let amount = parseAmountStr(amountStrs[0]);
    if (prevBalance !== null && balance !== null && amountStrs.length >= 2) {
      const expectedAmount = Math.abs(prevBalance - balance);
      const match = amountStrs.slice(0, -1).find((s) => Math.abs(parseAmountStr(s) - expectedAmount) < 0.02);
      if (match !== undefined) amount = parseAmountStr(match);
    }
    if (isNaN(amount) || amount === 0) return;

    // Determine credit vs debit from balance change
    if (prevBalance !== null && balance !== null) {
      if (balance < prevBalance) {
        amount = -amount; // Withdrawal/debit
      }
    }
    if (balance !== null) prevBalance = balance;

    parsed.push({ date: lastDate!, description, amount, balance });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/transaction\s*details/i.test(line) || isTableHeader(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^important:/i.test(line) || /this statement/i.test(line)) break;
    if (isTotalOrSummaryLine(line)) continue; // Skip total debits/credits/balance rows
    if (/^\d{5}[A-Z]/.test(line) || /^page/i.test(line)) continue;

    // Skip sub-detail lines (fee breakdowns like CAPPED MONTHLY FEE$16.95)
    if (SUB_DETAIL.test(line)) continue;

    // Capture opening balance for debit/credit detection
    if (/opening\s*balance/i.test(line)) {
      const balMatch = line.match(/\$?([\d,]+\.\d{2})/);
      if (balMatch) prevBalance = parseAmountStr(balMatch[1]);
      continue;
    }

    // Line starts with date
    const dateMatch = line.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2})/i);
    if (dateMatch) {
      const date = parseMonthDayDate(dateMatch[1].trim(), year);
      if (date) lastDate = date;

      const afterDate = line.substring(dateMatch[0].length).replace(/\$?[\d,]+\.\d{2}/g, "").trim();
      currentDesc = afterDate ? [afterDate] : [];
      continue;
    }

    // Pure amount line (e.g., "45.20330.47" or "16.95140.13")
    if (/^[\d,.$\s]+$/.test(line) && /\d+\.\d{2}/.test(line)) {
      flushTransaction(line);
      continue;
    }

    // Line with amounts at end (e.g., "SERVICE CHARGE DISCOUNT16.95157.08")
    const amountsAtEnd = line.match(/^(.*?)(\$?[\d,]+\.\d{2}.*)$/);
    if (amountsAtEnd && amountsAtEnd[1].trim()) {
      // New transaction with inline amounts
      currentDesc = [amountsAtEnd[1].trim()];
      flushTransaction(amountsAtEnd[2]);
      continue;
    }

    // Description continuation (e.g., "EBOX", "ENBRIDGE GAS INC.")
    if (lastDate && line && !/^(account|card|miss|mr|mrs)/i.test(line)) {
      currentDesc.push(line);
    }
  }

  // ── Second pass: recompute amounts from balance differences ──
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].balance !== null && parsed[i - 1].balance !== null) {
      const balanceDiff = Math.abs(parsed[i - 1].balance! - parsed[i].balance!);
      if (balanceDiff >= 0.01) {
        const sign = parsed[i].balance! < parsed[i - 1].balance! ? -1 : 1;
        parsed[i].amount = Math.round(sign * balanceDiff * 100) / 100;
      }
    }
  }

  return parsed.map(({ date, description, amount }) => ({ date, description, amount }));
}

// ─── BMO Credit Card Parser ──────────────────────────────────────
// BMO credit card format (CashBack Mastercard, etc.):
//   "Dec. 27 Dec. 29   HOPP/O/2512271836   Toronto   ON   4.40"
//   "Dec. 31 Dec. 31   DISPUTE CREDIT   50.00   CR"
//   "Jan. 11 Jan. 12   TRSF FROM/DE ACCT/CPT   3993-XXXX-214   21.00 CR"
// Trans date + Post date + Description + Amount (+ optional "CR" for credits)
// From pdfjs-dist, spaces are preserved. "CR" = credit (positive), no CR = purchase (negative).

function parseBMOCredit(lines: string[], year: number): RawTransaction[] {
  const txns: RawTransaction[] = [];
  let inSection = false;

  // Match: "Dec. 27 Dec. 29" or "Jan. 3 Jan. 5" (with period after month abbreviation)
  // Also match "Dec.27Dec.29" compressed form
  const BMO_CC_DATE = /^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s*\d{1,2})\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s*\d{1,2})\s+/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Detect transaction section
    if (/transactions\s+since/i.test(line) || /trans\s*date/i.test(line)) {
      inSection = true;
      continue;
    }
    // Stop at totals/footer
    if (/^subtotal\s+for/i.test(line) || /^total\s+for\s+(card|XXXX)/i.test(line)) continue;
    if (/trade-?marks/i.test(line) || /^\*.*registered/i.test(line)) { inSection = false; continue; }
    if (/^card\s*number/i.test(line)) continue;

    if (!inSection) continue;

    const dateMatch = line.match(BMO_CC_DATE);
    if (!dateMatch) continue;

    const transDateStr = dateMatch[1].replace(".", "").trim();
    const rest = line.substring(dateMatch[0].length);

    // Extract amount at end: "description text   123.45" or "description text   123.45 CR"
    // Also handle cashback icon markers (🏠 or similar unicode)
    const amountMatch = rest.match(/^(.*?)\s+([\d,]+\.\d{2})\s*(CR)?\s*$/i);
    if (!amountMatch) continue;

    let description = amountMatch[1].trim();
    const amountVal = parseFloat(amountMatch[2].replace(/,/g, ""));
    const isCR = !!amountMatch[3];

    if (isNaN(amountVal) || amountVal === 0) continue;
    // Remove leading cashback category icons (🏠 🔄 etc.)
    description = description.replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}]\s*/u, "").trim();
    if (!description || isSkipDescription(description)) continue;

    const date = parseMonthDayDate(transDateStr, year);
    if (!date) continue;

    // CR = credit/payment (positive), no CR = purchase (negative)
    const signedAmount = isCR ? Math.abs(amountVal) : -Math.abs(amountVal);

    txns.push({ date, description, amount: signedAmount });
  }

  return txns;
}

// ─── BMO Chequing/Savings Parser ─────────────────────────────────
// No-space format: "Jan31INTERACe-TransferReceived600.00638.05"
// Amounts concatenated at end with no spaces. Uses .XX boundary detection.

function isValidCommaAmount(s: string): boolean {
  return /^\d{1,3}(,\d{3})*\.\d{2}$/.test(s);
}

function extractBMOAmountCandidates(segText: string): { value: number; start: number; prefixDigits: number }[] {
  const dotPos = segText.lastIndexOf(".");
  if (dotPos < 1 || dotPos + 3 > segText.length) return [];

  const candidates: { value: number; start: number; prefixDigits: number }[] = [];
  for (let start = dotPos - 1; start >= Math.max(0, dotPos - 10); start--) {
    const candidate = segText.substring(start, dotPos + 3);
    if (/^\d{1,3}\.\d{2}$/.test(candidate) || isValidCommaAmount(candidate)) {
      // Count how many consecutive digits precede this candidate (reference number bleed)
      let prefixDigits = 0;
      for (let p = start - 1; p >= 0; p--) {
        if (/\d/.test(segText[p])) prefixDigits++;
        else break;
      }
      candidates.push({ value: parseFloat(candidate.replace(/,/g, "")), start, prefixDigits });
    }
    if (start > 0 && !/[\d,]/.test(segText[start - 1])) break;
  }
  return candidates;
}

function pickBMOAmount(
  candidates: { value: number; start: number; prefixDigits?: number }[],
  balance: number,
  prevBalance: number | null
): { value: number; start: number } | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Use balance column to validate: |prevBalance ± amount| = balance (debit: prev - amount = balance; credit: prev + amount = balance)
  if (prevBalance !== null) {
    const expectedAmount = Math.abs(prevBalance - balance);
    const balanceMatch = candidates.find(
      (c) => Math.abs(c.value - expectedAmount) < 0.02
    );
    if (balanceMatch) return balanceMatch;
  }

  // Fallback: prefer candidates that aren't bleeding into a reference number.
  // If a candidate has 5+ prefix digits, it's likely consuming part of a reference
  // number (e.g., "05748108" Moneris merchant ID) — prefer candidates with fewer prefix digits.
  const reasonable = candidates.filter((c) => c.value <= 50000);
  if (reasonable.length === 0) return candidates[0];

  // Find the candidate where prefix digits drop below 5 (clean boundary)
  const clean = reasonable.filter((c) => (c.prefixDigits ?? 0) < 5);
  if (clean.length > 0) return clean[clean.length - 1]; // largest clean candidate

  return reasonable[reasonable.length - 1];
}

/** Returns single amount from segment (rightmost candidate). Use pickBMOAmount with balance for BMO. */
function extractBMOAmountFromSegment(segText: string): { value: number; start: number } | null {
  const c = extractBMOAmountCandidates(segText);
  return c.length ? c[0] : null;
}

/** Strip trailing amount-like number from description (e.g. ",1,005.03" or "1,005.03") so it isn't shown as text. */
function stripTrailingAmountFromDescription(desc: string): string {
  return desc.replace(/,?\s*\d{1,3}(,\d{3})*\.\d{2}\s*$/, "").trim();
}

interface BMOParsedTxn {
  date: string;
  description: string;
  amount: number;
  balance: number;
}

function parseBMO(lines: string[], year: number): RawTransaction[] {
  const parsed: BMOParsedTxn[] = [];
  let inSection = false;
  let prevBalance: number | null = null;
  let pendingDate: string | null = null;
  let pendingAfterDate = "";

  function processOneLine(
    dateStr: string,
    afterDate: string,
    yearNum: number,
    descriptionOverride?: string
  ): boolean {
    const dotPositions: number[] = [];
    for (let i = 0; i < afterDate.length - 2; i++) {
      if (afterDate[i] === "." && /\d/.test(afterDate[i + 1]) && /\d/.test(afterDate[i + 2])) {
        dotPositions.push(i);
      }
    }
    if (dotPositions.length === 1 && /opening|closing|balance/i.test(afterDate)) {
      const m = afterDate.match(/(\d[\d,]*\.\d{2})/);
      if (m) prevBalance = parseFloat(m[1].replace(/,/g, ""));
      return true;
    }
    if (dotPositions.length < 2) return false;

    const segments: { text: string; start: number; end: number }[] = [];
    for (let i = 0; i < dotPositions.length; i++) {
      const segStart = i === 0 ? 0 : dotPositions[i - 1] + 3;
      const segEnd = dotPositions[i] + 3;
      segments.push({ text: afterDate.substring(segStart, segEnd), start: segStart, end: segEnd });
    }
    const lastSeg = segments[segments.length - 1];
    const txSeg = segments[segments.length - 2];

    function parseSegmentValue(seg: { text: string }, allowNegative = false): number | null {
      const trimmed = seg.text.trim();
      const re = allowNegative ? /^(-?\d[\d,]*\.\d{2})$/ : /^(\d[\d,]*\.\d{2})$/;
      const m = trimmed.match(re);
      if (m) {
        const s = m[1].replace(/,/g, "");
        if (isValidCommaAmount(m[1].replace("-", "")) || /^-?\d{1,3}\.\d{2}$/.test(m[1]) || /^\d{1,3}\.\d{2}$/.test(m[1]))
          return parseFloat(s);
      }
      const cands = extractBMOAmountCandidates(trimmed);
      return cands.length > 0 ? cands[cands.length - 1].value : null;
    }

    const lastVal = parseSegmentValue(lastSeg, true);
    const txSegValClean = txSeg.text.trim().match(/^(\d[\d,]*\.\d{2})$/);
    const txSegSingle =
      txSegValClean && (isValidCommaAmount(txSegValClean[1]) || /^\d{1,3}\.\d{2}$/.test(txSegValClean[1]))
        ? parseFloat(txSegValClean[1].replace(/,/g, ""))
        : null;
    const txCandidates = txSegSingle != null ? [] : extractBMOAmountCandidates(txSeg.text.trim());

    let balanceValue: number;
    let txAmountValue: number;
    let txAmountStart: number;
    let txAmountEnd: number;
    let descriptionEnd: number;

    if (lastVal == null) return false;

    const tryOrder = (balance: number, amount: number) =>
      prevBalance == null || Math.abs(Math.abs(prevBalance - balance) - amount) < 0.02;

    const amountFromTxSeg =
      txSegSingle ?? (pickBMOAmount(txCandidates, lastVal, prevBalance)?.value ?? null);
    if (amountFromTxSeg != null && tryOrder(lastVal, amountFromTxSeg)) {
      balanceValue = lastVal;
      txAmountValue = amountFromTxSeg;
      if (txSegSingle != null) {
        txAmountStart = txSeg.start;
        txAmountEnd = txSeg.end;
      } else {
        const picked = pickBMOAmount(txCandidates, lastVal, prevBalance);
        if (!picked) return false;
        txAmountStart = txSeg.start + picked.start;
        txAmountEnd = txSeg.end;
      }
      descriptionEnd = txAmountStart;
    } else {
      const secondVal = parseSegmentValue(txSeg);
      if (secondVal != null && tryOrder(secondVal, lastVal)) {
        balanceValue = secondVal;
        txAmountValue = lastVal;
        txAmountStart = lastSeg.start;
        txAmountEnd = lastSeg.end;
        descriptionEnd = lastSeg.start;
      } else {
        balanceValue = lastVal;
        const picked =
          txSegSingle != null
            ? { value: txSegSingle, start: 0 }
            : pickBMOAmount(txCandidates, lastVal, prevBalance);
        if (picked == null) return false;
        txAmountValue = picked.value;
        txAmountStart = txSeg.start + picked.start;
        txAmountEnd = txSeg.end;
        descriptionEnd = txAmountStart;
      }
    }

    // If we still don't have a previous balance (first transaction), make sure
    // we are not accidentally using the running balance as the amount. When
    // balanceValue === txAmountValue with multiple segments, prefer a value
    // from the transaction segment rather than the balance segment.
    if (prevBalance === null && Math.abs(balanceValue - txAmountValue) < 0.02 && segments.length >= 2) {
      const alt = extractBMOAmountCandidates(txSeg.text);
      if (alt.length > 0) {
        txAmountValue = alt[alt.length - 1].value;
      }
    }

    const balance = balanceValue;
    let description =
      descriptionOverride !== undefined
        ? descriptionOverride.trim()
        : afterDate.substring(0, descriptionEnd)
            .replace(/([a-z])([A-Z])/g, "$1 $2")
            .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
            .trim();
    description = stripTrailingAmountFromDescription(description);

    if (!description || isSkipDescription(description)) {
      prevBalance = balance;
      return true;
    }
    // When we have a previous balance, amount must be the balance change (never the running balance)
    const amountFromBalanceChange =
      prevBalance !== null ? Math.abs(prevBalance - balance) : null;
    const amountToUse =
      amountFromBalanceChange !== null && amountFromBalanceChange >= 0.01
        ? amountFromBalanceChange
        : txAmountValue;
    if (isNaN(amountToUse) || amountToUse === 0) return true;

    let signedAmount = amountToUse;
    if (prevBalance !== null && balance < prevBalance) signedAmount = -amountToUse;
    prevBalance = balance;
    parsed.push({ date: dateStr, description, amount: signedAmount, balance });
    return true;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (
      /here.?s\s*what\s*happened/i.test(line) ||
      /amounts?\s*deduct(ed|ions)/i.test(line) ||
      /amounts?\s*debit(ed)?/i.test(line) ||
      /(?:opening|closing)\s*balance/i.test(line) ||
      /^date\s*description\s*(from|amount)/i.test(line) ||
      /transaction\s*details/i.test(line)
    ) {
      inSection = true;
    }
    if (!inSection) continue;
    if (/please\s*report/i.test(line) || /trade-?marks/i.test(line)) break;
    if (/^page/i.test(line) || /owners?:/i.test(line) || /^miss/i.test(line) || /primary/i.test(line) || /continued/i.test(line)) continue;
    if (isTotalOrSummaryLine(line)) continue;

    // Standalone opening/previous balance line (no date) so first transaction can use balance-change amount
    if (/^(opening|previous|beginning)\s*balance/i.test(line)) {
      const m = line.match(/(\d[\d,]*\.\d{2})/);
      if (m) prevBalance = parseFloat(m[1].replace(/,/g, ""));
      continue;
    }

    const dateMatch = line.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\s*(\d{1,2})/i);
    if (dateMatch) {
      // Process any pending multi-line transaction before starting a new one
      if (pendingDate !== null && pendingAfterDate !== "") {
        processOneLine(pendingDate, pendingAfterDate, year);
        pendingDate = null;
        pendingAfterDate = "";
      }

      if (!inSection) inSection = true;
      const date = parseMonthDayDate(`${dateMatch[1]} ${dateMatch[2]}`, year);
      if (!date) continue;

      const afterDate = line.substring(dateMatch[0].length);
      const dotPositions: number[] = [];
      for (let j = 0; j < afterDate.length - 2; j++) {
        if (afterDate[j] === "." && /\d/.test(afterDate[j + 1]) && /\d/.test(afterDate[j + 2])) dotPositions.push(j);
      }

      if (dotPositions.length === 1 && /opening|closing|balance/i.test(afterDate)) {
        const m = afterDate.match(/(\d[\d,]*\.\d{2})/);
        if (m) prevBalance = parseFloat(m[1].replace(/,/g, ""));
        continue;
      }
      if (dotPositions.length >= 2) {
        processOneLine(date, afterDate, year);
        continue;
      }
      pendingDate = date;
      pendingAfterDate = afterDate.trim();
      continue;
    }

    if (pendingDate !== null && pendingAfterDate !== "") {
      const isAmountLine = /^-?[\d,\s.]+$/.test(line.trim()) && /\d+\.\d{2}/.test(line);
      if (isAmountLine) {
        const amountLine = line.trim();
        const d = pendingDate;
        const descOnly = pendingAfterDate;
        pendingDate = null;
        pendingAfterDate = "";
        processOneLine(d, amountLine, year, descOnly);
      } else if (!/^\d{5,}$/.test(line.trim())) {
        pendingAfterDate = (pendingAfterDate + " " + line.trim()).trim();
      }
    }
  }

  // Process any remaining pending transaction at end of loop
  if (pendingDate !== null && pendingAfterDate !== "") {
    processOneLine(pendingDate, pendingAfterDate, year);
  }

  // ── Second pass: recompute amounts from balance differences ──
  // Balance differences are always accurate since the balance column is unambiguous.
  for (let i = 1; i < parsed.length; i++) {
    const balanceDiff = Math.abs(parsed[i - 1].balance - parsed[i].balance);
    if (balanceDiff >= 0.01) {
      const sign = parsed[i].balance < parsed[i - 1].balance ? -1 : 1;
      parsed[i].amount = Math.round(sign * balanceDiff * 100) / 100;
    }
  }

  return parsed.map(({ date, description, amount }) => ({ date, description, amount }));
}

// ─── EQ Bank Parser ──────────────────────────────────────────────
// Multi-line format:
// Line 1: "Jan 14Card Load" (date + description)
// Line 2: "-$100.00$420.00" (amounts: withdrawal/deposit + balance)

function parseEQBank(lines: string[], year: number): RawTransaction[] {
  interface EQParsedTxn { date: string; description: string; amount: number; balance: number | null }
  const parsed: EQParsedTxn[] = [];
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/activity\s*details/i.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (isTotalOrSummaryLine(line)) continue;
    if (/^january|^february|^march|^april|^may|^june|^july|^august|^september|^october|^november|^december/i.test(line) && /statement/i.test(line)) continue;
    if (/bills\s*account/i.test(line)) continue;

    // Check if line starts with a month abbreviation + day (transaction date + description)
    const dateMatch = line.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2})/i);
    if (!dateMatch) continue;

    const date = parseMonthDayDate(dateMatch[1].trim(), year);
    if (!date) continue;

    const description = line.substring(dateMatch[0].length).trim();
    if (!description || isSkipDescription(description)) continue;

    // Next line should have amounts
    if (i + 1 >= lines.length) continue;
    const amountLine = lines[i + 1];

    // EQ format: "-$100.00$420.00" or "$148.00$520.00"
    const amountMatches = amountLine.match(/-?\$[\d,]+\.\d{2}/g);
    if (!amountMatches || amountMatches.length === 0) continue;

    // First amount is transaction, last is balance
    const amount = parseAmountStr(amountMatches[0]);
    if (isNaN(amount) || amount === 0) continue;

    const balance = amountMatches.length >= 2 ? parseAmountStr(amountMatches[amountMatches.length - 1]) : null;

    parsed.push({ date, description, amount, balance });
    i++; // Skip the amount line
  }

  // ── Second pass: verify/recompute amounts from balance differences ──
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].balance !== null && parsed[i - 1].balance !== null) {
      const balanceDiff = Math.round((parsed[i].balance! - parsed[i - 1].balance!) * 100) / 100;
      // If sign from PDF matches balance diff direction, amount is correct
      // Otherwise, recompute from balance diff
      if (Math.abs(balanceDiff) >= 0.01 && Math.abs(Math.abs(balanceDiff) - Math.abs(parsed[i].amount)) < 0.02) {
        // Amount matches, just ensure sign is correct
        const sign = balanceDiff > 0 ? 1 : -1;
        parsed[i].amount = Math.round(sign * Math.abs(parsed[i].amount) * 100) / 100;
      }
    }
  }

  return parsed.map(({ date, description, amount }) => ({ date, description, amount }));
}

// ─── RBC Credit Card Parser ──────────────────────────────────────
// Format:
// Line 1: "JAN 07JAN 09*RFBT-YONGE SHEPPARD C NORTH YORK ON" (txDate + postDate + desc)
// Line 2: "74529006007920416119606" (reference number — skip)
// Line 3: "$7.90" or "-$1,728.55" (amount)

function parseRBCCredit(lines: string[], year: number): RawTransaction[] {
  const txns: RawTransaction[] = [];
  let inSection = false;

  const MONTH_RE = "(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)";
  const DATE_RE = new RegExp(`^(${MONTH_RE}\\s*\\d{1,2})\\s*${MONTH_RE}\\s*\\d{1,2}`, "i");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Start after header
    if (/ACTIVITY\s*DESCRIPTION\s*AMOUNT/i.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (isTotalOrSummaryLine(line)) continue;
    if (/TOTAL\s*ACCOUNT\s*BALANCE/i.test(line)) { inSection = false; continue; }
    if (/^\d+\s*OF\s*\d+$/i.test(line)) continue; // Page number
    if (/continued/i.test(line) || /STATEMENT FROM/i.test(line)) continue;

    // Match transaction line: TXN_DATE POST_DATE DESCRIPTION
    const dateMatch = line.match(DATE_RE);
    if (!dateMatch) continue;

    const date = parseMonthDayDate(dateMatch[1].trim(), year);
    if (!date) continue;

    // Extract description (everything after both dates)
    const fullDateMatch = line.match(new RegExp(`^${MONTH_RE}\\s*\\d{1,2}\\s*${MONTH_RE}\\s*\\d{1,2}`, "i"));
    if (!fullDateMatch) continue;

    let description = line.substring(fullDateMatch[0].length).trim();

    // Check for inline amount (e.g., "AUTOMATIC PAYMENT -THANK YOU-$1,728.55")
    let amount: number | null = null;
    const inlineAmt = description.match(/-?\$[\d,]+\.\d{2}$/);
    if (inlineAmt) {
      amount = parseAmountStr(inlineAmt[0]);
      description = description.substring(0, description.length - inlineAmt[0].length).trim();
    } else {
      // Look ahead for amount — may be 1-2 lines after (skip reference numbers)
      for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
        const nextLine = lines[j];

        // Skip pure reference number lines (long digit sequences)
        if (/^\d{10,}$/.test(nextLine)) continue;

        // Skip continuation of description (place name that wraps)
        if (/^[A-Z]{2}$/.test(nextLine)) {
          description += " " + nextLine;
          continue;
        }

        // Amount line: "$X.XX" or "-$X.XX"
        const amtMatch = nextLine.match(/^-?\$[\d,]+\.\d{2}$/);
        if (amtMatch) {
          amount = parseAmountStr(amtMatch[0]);
          i = j; // Skip processed lines
          break;
        }

        // Multi-line description continuation (contains letters, not just numbers)
        if (/[a-zA-Z]/.test(nextLine) && !/^\$/.test(nextLine) && !/^\d{10,}$/.test(nextLine)) {
          continue;
        }
      }
    }

    if (amount === null || isNaN(amount) || amount === 0) continue;
    if (!description || isSkipDescription(description)) continue;

    // For credit cards: positive amounts are charges (expenses = negative)
    // Negative amounts are payments/credits (= positive in our system)
    txns.push({ date, description, amount: -amount });
  }

  return txns;
}

// ─── RBC Chequing Parser ────────────────────────────────────────
// Format:
// "15 JanMortgage TD BANK637.612,438.89"
// Multi-line entries, amounts concatenated at end (like BMO)
// Date format: "DD Mon" (day before month)

function parseRBCChequing(lines: string[], year: number): RawTransaction[] {
  interface RBCParsedTxn { date: string; description: string; amount: number; balance: number | null }
  const parsed: RBCParsedTxn[] = [];
  let inSection = false;
  let prevBalance: number | null = null;
  let lastDate: string | null = null;
  let pendingDesc = "";

  // Process a single transaction entry (description + amounts concatenated)
  // Uses balance-based amount picking (like BMO) so description-embedded numbers (e.g. Moneris refs) are not used as amounts.
  function processEntry(text: string) {
    if (!lastDate) return;

    // Find amounts at end using .XX boundary detection
    const dotPositions: number[] = [];
    for (let ci = 0; ci < text.length - 2; ci++) {
      if (text[ci] === "." && /\d/.test(text[ci + 1]) && /\d/.test(text[ci + 2])) {
        dotPositions.push(ci);
      }
    }
    if (dotPositions.length === 0) return;

    // Segments between .XX boundaries
    const segments: { text: string; start: number; end: number }[] = [];
    for (let si = 0; si < dotPositions.length; si++) {
      const segStart = si === 0 ? 0 : dotPositions[si - 1] + 3;
      const segEnd = dotPositions[si] + 3;
      segments.push({ text: text.substring(segStart, segEnd), start: segStart, end: segEnd });
    }

    const amounts: { value: number; start: number; end: number }[] = [];
    let balanceValue: number | null = null;

    // 1) Balance from last segment
    const lastSeg = segments[segments.length - 1];
    const lastClean = lastSeg.text.match(/^(\d[\d,]*\.\d{2})$/);
    if (lastClean && (isValidCommaAmount(lastClean[1]) || /^\d{1,3}\.\d{2}$/.test(lastClean[1]))) {
      balanceValue = parseFloat(lastClean[1].replace(/,/g, ""));
      amounts.push({ value: balanceValue, start: lastSeg.start, end: lastSeg.end });
    } else {
      const lastCandidates = extractBMOAmountCandidates(lastSeg.text);
      if (lastCandidates.length === 0) return;
      const balanceCand = lastCandidates[lastCandidates.length - 1];
      balanceValue = balanceCand.value;
      amounts.push({ value: balanceValue, start: lastSeg.start + balanceCand.start, end: lastSeg.end });
    }

    // 2) Tx amount from second-to-last segment (balance-validated)
    if (segments.length >= 2 && balanceValue !== null) {
      const txSeg = segments[segments.length - 2];
      const txClean = txSeg.text.match(/^(\d[\d,]*\.\d{2})$/);
      if (txClean && (isValidCommaAmount(txClean[1]) || /^\d{1,3}\.\d{2}$/.test(txClean[1]))) {
        amounts.unshift({ value: parseFloat(txClean[1].replace(/,/g, "")), start: txSeg.start, end: txSeg.end });
      } else {
        const txCandidates = extractBMOAmountCandidates(txSeg.text);
        const picked = pickBMOAmount(txCandidates, balanceValue, prevBalance);
        if (picked) {
          amounts.unshift({ value: picked.value, start: txSeg.start + picked.start, end: txSeg.end });
        }
      }
    }

    // 3) Optional third-to-last segment
    if (segments.length >= 3) {
      const seg = segments[segments.length - 3];
      const m = seg.text.match(/^(\d[\d,]*\.\d{2})$/);
      if (m && (isValidCommaAmount(m[1]) || /^\d{1,3}\.\d{2}$/.test(m[1]))) {
        amounts.unshift({ value: parseFloat(m[1].replace(/,/g, "")), start: seg.start, end: seg.end });
      } else {
        const match = extractBMOAmountFromSegment(seg.text);
        if (match) amounts.unshift({ value: match.value, start: seg.start + match.start, end: seg.end });
      }
    }

    if (amounts.length === 0) return;

    // If 2+ amounts: second-to-last = tx amount, last = balance
    // If 1 amount: it's the tx amount (no balance visible — intermediate line)
    let txAmount: number;
    let balance: number | null = null;
    let descEnd: number;

    if (amounts.length >= 2) {
      txAmount = amounts[amounts.length - 2].value;
      balance = amounts[amounts.length - 1].value;
      descEnd = amounts[amounts.length - 2].start;
    } else {
      txAmount = amounts[0].value;
      descEnd = amounts[0].start;
    }

    const description = text.substring(0, descEnd).trim();
    if (!description || isSkipDescription(description)) {
      if (balance !== null) prevBalance = balance;
      return;
    }

    // Determine sign from balance change
    let signedAmount = txAmount;
    if (balance !== null && prevBalance !== null) {
      if (balance < prevBalance) signedAmount = -txAmount;
    } else {
      // No balance — use keyword heuristics
      const lower = description.toLowerCase();
      if (lower.includes("mortgage") || lower.includes("payment") || lower.includes("fee")) {
        signedAmount = -txAmount; // Likely a withdrawal
      } else if (lower.includes("rebate") || lower.includes("refund") || lower.includes("deposit") ||
                 lower.includes("received") || lower.includes("transfer")) {
        signedAmount = txAmount; // Likely a deposit
      }
    }

    if (balance !== null) prevBalance = balance;
    if (signedAmount !== 0) {
      parsed.push({ date: lastDate!, description, amount: signedAmount, balance });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/Details of your account activity/i.test(line)) { inSection = true; continue; }
    if (!inSection) continue;
    if (isTotalOrSummaryLine(line)) continue;
    if (/Please check this/i.test(line) || /^Closing Balance/i.test(line)) break;
    if (/continued/i.test(line) || /^\d+ of \d+$/i.test(line)) continue;
    if (/^Date\s*Description/i.test(line)) continue;

    // Opening balance
    if (/Opening Balance/i.test(line)) {
      const m = line.match(/([\d,]+\.\d{2})/);
      if (m) prevBalance = parseFloat(m[1].replace(/,/g, ""));
      continue;
    }

    // Skip service charge lines without dates
    if (/^(Monthly fee|MultiProduct|rebate)/i.test(line)) {
      // These have amounts that affect balance
      processEntry(line);
      continue;
    }

    // Date line: "15 Jan" or "2 Feb" (day before month)
    const dateMatch = line.match(/^(\d{1,2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*/i);
    if (dateMatch) {
      pendingDesc = "";
      const date = parseMonthDayDate(`${dateMatch[2]} ${dateMatch[1]}`, year);
      if (date) lastDate = date;

      const afterDate = line.substring(dateMatch[0].length);
      if (afterDate.trim()) {
        if (/\d+\.\d{2}/.test(afterDate)) {
          processEntry(afterDate);
        } else {
          // Description start without amounts — set as pending
          pendingDesc = afterDate.trim();
        }
      }
      continue;
    }

    // Continuation line without a date
    if (lastDate && line.trim()) {
      if (/\d+\.\d{2}/.test(line)) {
        // Has amounts — combine with any pending description prefix
        const combined = pendingDesc ? pendingDesc + " " + line : line;
        processEntry(combined);
        pendingDesc = "";
      } else {
        // No amounts — accumulate as description prefix for next line
        pendingDesc = pendingDesc ? pendingDesc + " " + line : line;
      }
    }
  }

  // ── Second pass: recompute amounts from balance differences ──
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].balance !== null && parsed[i - 1].balance !== null) {
      const balanceDiff = Math.abs(parsed[i - 1].balance! - parsed[i].balance!);
      if (balanceDiff >= 0.01) {
        const sign = parsed[i].balance! < parsed[i - 1].balance! ? -1 : 1;
        parsed[i].amount = Math.round(sign * balanceDiff * 100) / 100;
      }
    }
  }

  return parsed.map(({ date, description, amount }) => ({ date, description, amount }));
}

// ─── Generic Fallback Parser ──────────────────────────────────────

function parseGeneric(lines: string[], year: number): RawTransaction[] {
  const txns: RawTransaction[] = [];
  let inTransactionSection = false;
  let headerFound = false;

  const datePatterns = [
    /^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2})/i,
    /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/,
    /^(\d{1,2}-\d{1,2}(?:-\d{2,4})?)/,
    /^(\d{4}-\d{2}-\d{2})/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isTotalOrSummaryLine(line)) continue; // Skip total debits/credits/balance rows

    if (isTableHeader(line)) {
      inTransactionSection = true;
      headerFound = true;
      continue;
    }

    if (!headerFound && /transactions?\s*(since|details|list|history)/i.test(line)) {
      inTransactionSection = true;
      headerFound = true;
      continue;
    }

    if (!inTransactionSection && headerFound) continue;
    if (/^important:/i.test(line)) break;
    if (/please\s*report/i.test(line)) break;

    // Try to match a date at the start
    let dateStr: string | null = null;
    let rest = line;

    for (const dp of datePatterns) {
      const dm = line.match(dp);
      if (dm) {
        const parsed = parseAnyDate(dm[1].trim(), year);
        if (parsed) {
          dateStr = parsed;
          rest = line.substring(dm[0].length).trim();
          break;
        }
      }
    }

    if (!dateStr) continue;
    if (!inTransactionSection) inTransactionSection = true;

    // Check if amounts are on this line or next line
    let amountSource = rest;
    const hasAmounts = /-?\$?[\d,]+\.\d{2}/.test(rest);

    if (!hasAmounts && i + 1 < lines.length) {
      // Check next line for amounts
      const nextLine = lines[i + 1];
      if (/-?\$?[\d,]+\.\d{2}/.test(nextLine) && !/^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(nextLine)) {
        amountSource = rest + " " + nextLine;
        i++; // Skip next line
      }
    }

    const amountMatches = amountSource.match(/-?\$?[\d,]+\.\d{2}/g);
    if (!amountMatches || amountMatches.length === 0) continue;

    // Prefer last amount (most statements put amount at end); avoids description-embedded numbers (e.g. Moneris refs)
    const chosenMatch = amountMatches[amountMatches.length - 1];
    const lastAmountIdx = amountSource.lastIndexOf(chosenMatch);
    const description = amountSource.substring(0, lastAmountIdx).trim();

    if (!description || isSkipDescription(description)) continue;
    if (/^\d{6,}$/.test(description.replace(/\s/g, ""))) continue;

    const amount = parseAmountStr(chosenMatch);
    if (isNaN(amount) || amount === 0) continue;
    // Reject amounts that look like reference/account numbers (e.g. 05748108.00)
    if (Math.abs(amount) > 999_999) continue;

    txns.push({ date: dateStr, description, amount });
  }

  return txns;
}

// ─── Main Parser ──────────────────────────────────────────────────

export interface PDFParseResult {
  transactions: RawTransaction[];
  bankDetected: string;
  rawText: string;
  rawLines: string[];
}

export async function parsePDF(buffer: Buffer): Promise<RawTransaction[]> {
  const result = await parsePDFWithDetails(buffer);
  return result.transactions;
}

export async function parsePDFWithDetails(buffer: Buffer): Promise<PDFParseResult> {
  // Check for encrypted PDFs before calling pdf-parse (which hangs on them)
  // /Encrypt can appear anywhere in the PDF (often near the end in the xref/trailer)
  const pdfRaw = buffer.toString("binary");
  const isEncrypted = pdfRaw.includes("/Encrypt");

  let data: { text: string };

  if (isEncrypted) {
    console.log("[pdfParser] PDF appears encrypted — using pdfjs-dist instead of pdf-parse");
    // pdfjs-dist handles many encrypted PDFs that pdf-parse cannot
    try {
      // Use legacy build which works in Node.js without web worker setup
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs") as any;
      const uint8 = new Uint8Array(buffer);
      const pdf = await pdfjsLib.getDocument({ data: uint8 }).promise;
      let allText = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        // Group items by Y-position to reconstruct lines
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = content.items as any[];
        const lineMap = new Map<number, string[]>();
        for (const item of items) {
          const y = item.transform ? Math.round(item.transform[5]) : 0;
          if (!lineMap.has(y)) lineMap.set(y, []);
          lineMap.get(y)!.push(item.str);
        }
        // Sort by Y descending (top of page first)
        const sortedLines = [...lineMap.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([, strs]) => strs.join(" ").trim())
          .filter(Boolean);
        allText += sortedLines.join("\n") + "\n";
      }
      console.log(`[pdfParser] pdfjs-dist extracted ${allText.length} chars from encrypted PDF`);

      // Check if pdfjs-dist produced fragmented text (e.g., "S t a t e m e n t")
      // by measuring average word length — fragmented text has very short "words"
      const words = allText.split(/\s+/).filter(w => w.length > 0);
      const avgWordLen = words.length > 0 ? words.reduce((s, w) => s + w.length, 0) / words.length : 0;
      const isFragmented = avgWordLen < 3 && words.length > 20;

      if (isFragmented) {
        console.log(`[pdfParser] pdfjs-dist text appears fragmented (avg word length: ${avgWordLen.toFixed(1)}), trying pdf-parse as fallback...`);
        // Try pdf-parse with a short timeout — some encrypted PDFs work with pdf-parse
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParseModule = require("pdf-parse");
          const pdfParse = (typeof pdfParseModule === "function" ? pdfParseModule : pdfParseModule.default) as (buf: Buffer) => Promise<{ text: string }>;
          const fallbackData = await Promise.race([
            pdfParse(buffer),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("PDF parsing timed out")), 8000)
            ),
          ]);
          if (fallbackData.text.trim().length > allText.trim().length * 0.3) {
            console.log(`[pdfParser] pdf-parse fallback succeeded (${fallbackData.text.length} chars)`);
            data = fallbackData;
          } else {
            data = { text: allText };
          }
        } catch {
          console.log("[pdfParser] pdf-parse fallback failed/timed out, using fragmented pdfjs-dist text");
          data = { text: allText };
        }
      } else {
        data = { text: allText };
      }
    } catch (err) {
      console.error("[pdfParser] pdfjs-dist also failed on encrypted PDF:", err);
      data = { text: "" };
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParseModule = require("pdf-parse");
    const pdfParse = (typeof pdfParseModule === "function" ? pdfParseModule : pdfParseModule.default) as (buf: Buffer) => Promise<{ text: string }>;

    // Wrap pdf-parse in a timeout as safety net
    const PDF_PARSE_TIMEOUT = 15000;
    try {
      data = await Promise.race([
        pdfParse(buffer),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("PDF parsing timed out")), PDF_PARSE_TIMEOUT)
        ),
      ]);
    } catch (err) {
      console.error("[pdfParser] pdf-parse failed or timed out:", err);
      data = { text: "" };
    }
  }
  let text = data.text;
  let lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // If pdf-parse returned no text, try server-side OCR via Tesseract
  if (lines.length === 0) {
    console.log("[pdfParser] pdf-parse returned 0 lines, trying server-side OCR...");
    try {
      const ocrText = await serverOCR(buffer);
      if (ocrText.trim()) {
        text = ocrText;
        lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        console.log(`[pdfParser] OCR extracted ${lines.length} lines`);
      }
    } catch (err) {
      console.error("[pdfParser] Server OCR failed:", err);
    }
  }

  const bank = detectBank(text);
  const year = extractYear(text);

  let transactions: RawTransaction[];

  switch (bank) {
    case "td-credit":
      transactions = parseTDCredit(lines, year);
      break;
    case "td-bank":
      transactions = parseTDBank(lines, year);
      break;
    case "scotiabank":
      transactions = parseScotiabank(lines, year);
      break;
    case "cibc-bank":
      transactions = parseCIBCBank(lines, year);
      break;
    case "cibc-credit":
      transactions = parseCIBCCredit(lines, year);
      break;
    case "bmo-credit":
      transactions = parseBMOCredit(lines, year);
      break;
    case "bmo":
    case "scotiabank-bank":
      transactions = parseBMO(lines, year);
      break;
    case "eq":
      transactions = parseEQBank(lines, year);
      break;
    case "rbc-credit":
      transactions = parseRBCCredit(lines, year);
      break;
    case "rbc-chequing":
      transactions = parseRBCChequing(lines, year);
      break;
    default:
      transactions = parseGeneric(lines, year);
  }

  // Fallback to generic if bank-specific found nothing
  if (transactions.length === 0 && bank !== "unknown") {
    transactions = parseGeneric(lines, year);
  }

  // Mask sensitive data and strip trailing amount-like numbers from descriptions
  transactions = transactions.map((tx) => ({
    ...tx,
    description: stripTrailingAmountFromDescription(maskSensitiveData(tx.description)),
  }));

  return { transactions, bankDetected: bank, rawText: text, rawLines: lines };
}
