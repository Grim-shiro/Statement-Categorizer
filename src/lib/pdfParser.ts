import { RawTransaction } from "@/types";
import { maskSensitiveData } from "./maskSensitive";

// ─── Bank Detection ───────────────────────────────────────────────
type BankType = "cibc-credit" | "cibc-bank" | "bmo" | "eq" | "rbc-credit" | "rbc-chequing" | "chase" | "scotiabank" | "scotiabank-bank" | "unknown";

function detectBank(text: string): BankType {
  const lower = text.toLowerCase();

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

  if (lower.includes("bmo") || lower.includes("bank of montreal")) return "bmo";

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
const SKIP_DESC_TERMS = [
  "balance", "total", "opening", "closing", "previous", "new balance",
  "beginning", "ending", "statement", "payment due", "due date",
  "minimum payment", "credit limit", "available credit",
  "interest charge", "annual fee", "rewards", "points earned",
  "summary", "sub-total", "closing totals", "opening totals",
];

function isSkipDescription(desc: string): boolean {
  const lower = desc.toLowerCase();
  return SKIP_DESC_TERMS.some((term) => lower.includes(term));
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
    if (amountMatch[2] === "-") amount = -amount; // Credit/payment

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

// ─── CIBC Bank Parser ─────────────────────────────────────────────
// Multi-line format:
// Line 1: "Jan 15INTERNET BILL PAY 000000105840"
// Line 2: "EBOX" (continuation of description)
// Line 3: "45.20330.47" (amounts: withdrawal/deposit + balance)
// OR: "Jan 30SERVICE CHARGE\nCAPPED MONTHLY FEE$16.95\n..."

function parseCIBCBank(lines: string[], year: number): RawTransaction[] {
  const txns: RawTransaction[] = [];
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

    // Extract amounts: first is withdrawal/deposit, last is balance
    const amounts = amountLine.match(/\$?[\d,]+\.\d{2}/g);
    if (!amounts || amounts.length === 0) return;

    let amount = parseAmountStr(amounts[0]);
    if (isNaN(amount) || amount === 0) return;

    // Determine credit vs debit from balance change
    const balance = amounts.length >= 2 ? parseAmountStr(amounts[amounts.length - 1]) : null;
    if (prevBalance !== null && balance !== null) {
      if (balance < prevBalance) {
        amount = -amount; // Withdrawal/debit
      }
      // If balance went up, it's a deposit/credit (positive)
    }
    if (balance !== null) prevBalance = balance;

    txns.push({ date: lastDate!, description, amount });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/transaction\s*details/i.test(line) || isTableHeader(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/^important:/i.test(line) || /this statement/i.test(line)) break;
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

  return txns;
}

// ─── BMO Parser ───────────────────────────────────────────────────
// No-space format: "Jan31INTERACe-TransferReceived600.00638.05"
// Amounts concatenated at end with no spaces. Uses .XX boundary detection.

function isValidCommaAmount(s: string): boolean {
  return /^\d{1,3}(,\d{3})*\.\d{2}$/.test(s);
}

function extractBMOAmountFromSegment(segText: string): { value: number; start: number } | null {
  const dotPos = segText.lastIndexOf(".");
  if (dotPos < 1 || dotPos + 3 > segText.length) return null;

  const candidates: { value: number; start: number }[] = [];
  for (let start = dotPos - 1; start >= Math.max(0, dotPos - 10); start--) {
    const candidate = segText.substring(start, dotPos + 3);
    if (/^\d{1,3}\.\d{2}$/.test(candidate) || isValidCommaAmount(candidate)) {
      candidates.push({ value: parseFloat(candidate.replace(/,/g, "")), start });
    }
    if (start > 0 && !/[\d,]/.test(segText[start - 1])) break;
  }
  if (candidates.length === 0) return null;

  // Pick largest candidate ≤ $50K
  const reasonable = candidates.filter((c) => c.value <= 50000);
  return reasonable.length > 0 ? reasonable[reasonable.length - 1] : candidates[0];
}

function parseBMO(lines: string[], year: number): RawTransaction[] {
  const txns: RawTransaction[] = [];
  let inSection = false;
  let prevBalance: number | null = null;

  for (const line of lines) {
    if (/here.?s\s*what\s*happened/i.test(line) || /amounts?\s*deducted/i.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (/please\s*report/i.test(line) || /trade-?marks/i.test(line)) break;
    if (/^page/i.test(line) || /owners?:/i.test(line) || /^miss/i.test(line) || /primary/i.test(line) || /continued/i.test(line)) continue;

    const dateMatch = line.match(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))(\d{1,2})/i);
    if (!dateMatch) continue;

    const date = parseMonthDayDate(`${dateMatch[1]} ${dateMatch[2]}`, year);
    if (!date) continue;

    const afterDate = line.substring(dateMatch[0].length);

    // Find all ".XX" positions to split into segments
    const dotPositions: number[] = [];
    for (let i = 0; i < afterDate.length - 2; i++) {
      if (afterDate[i] === "." && /\d/.test(afterDate[i + 1]) && /\d/.test(afterDate[i + 2])) {
        dotPositions.push(i);
      }
    }

    // Opening/closing balance lines have only 1 amount — capture for debit/credit tracking
    if (dotPositions.length === 1 && /opening|closing|balance/i.test(afterDate)) {
      const m = afterDate.match(/(\d[\d,]*\.\d{2})/);
      if (m) prevBalance = parseFloat(m[1].replace(/,/g, ""));
      continue;
    }
    if (dotPositions.length < 2) continue;

    // Split into segments at .XX boundaries
    const segments: { text: string; start: number; end: number }[] = [];
    for (let i = 0; i < dotPositions.length; i++) {
      const segStart = i === 0 ? 0 : dotPositions[i - 1] + 3;
      const segEnd = dotPositions[i] + 3;
      segments.push({ text: afterDate.substring(segStart, segEnd), start: segStart, end: segEnd });
    }

    // Extract amounts from last 2-3 segments
    const amounts: { value: number; start: number; end: number }[] = [];
    for (let i = segments.length - 1; i >= Math.max(0, segments.length - 3); i--) {
      const seg = segments[i];

      if (i > 0) {
        const m = seg.text.match(/^(\d[\d,]*\.\d{2})$/);
        if (m && (isValidCommaAmount(m[1]) || /^\d{1,3}\.\d{2}$/.test(m[1]))) {
          amounts.unshift({ value: parseFloat(m[1].replace(/,/g, "")), start: seg.start, end: seg.end });
          continue;
        }
      }

      const match = extractBMOAmountFromSegment(seg.text);
      if (match) {
        amounts.unshift({ value: match.value, start: seg.start + match.start, end: seg.end });
      }
    }

    if (amounts.length < 2) continue;

    const txAmount = amounts[amounts.length - 2];
    const balance = amounts[amounts.length - 1].value;
    let description = afterDate.substring(0, txAmount.start)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .trim();

    if (!description || isSkipDescription(description)) {
      // Still track balance for opening/closing rows
      prevBalance = amounts[amounts.length - 1].value;
      continue;
    }
    if (isNaN(txAmount.value) || txAmount.value === 0) continue;

    // Determine debit vs credit by comparing balance change
    let signedAmount = txAmount.value;
    if (prevBalance !== null) {
      // If balance went down, it's a debit (negative)
      // If balance went up, it's a credit (positive)
      if (balance < prevBalance) {
        signedAmount = -txAmount.value;
      }
    }

    prevBalance = balance;
    txns.push({ date, description, amount: signedAmount });
  }

  return txns;
}

// ─── EQ Bank Parser ──────────────────────────────────────────────
// Multi-line format:
// Line 1: "Jan 14Card Load" (date + description)
// Line 2: "-$100.00$420.00" (amounts: withdrawal/deposit + balance)

function parseEQBank(lines: string[], year: number): RawTransaction[] {
  const txns: RawTransaction[] = [];
  let inSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/activity\s*details/i.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
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

    txns.push({ date, description, amount });
    i++; // Skip the amount line
  }

  return txns;
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
  const txns: RawTransaction[] = [];
  let inSection = false;
  let prevBalance: number | null = null;
  let lastDate: string | null = null;
  let pendingDesc = "";

  // Process a single transaction entry (description + amounts concatenated)
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

    // Extract amounts from last segments
    const amounts: { value: number; start: number; end: number }[] = [];
    for (let si = segments.length - 1; si >= Math.max(0, segments.length - 3); si--) {
      const seg = segments[si];
      if (si > 0) {
        const m = seg.text.match(/^(\d[\d,]*\.\d{2})$/);
        if (m && (isValidCommaAmount(m[1]) || /^\d{1,3}\.\d{2}$/.test(m[1]))) {
          amounts.unshift({ value: parseFloat(m[1].replace(/,/g, "")), start: seg.start, end: seg.end });
          continue;
        }
      }
      const match = extractBMOAmountFromSegment(seg.text);
      if (match) {
        amounts.unshift({ value: match.value, start: seg.start + match.start, end: seg.end });
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
      txns.push({ date: lastDate!, description, amount: signedAmount });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/Details of your account activity/i.test(line)) { inSection = true; continue; }
    if (!inSection) continue;
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

  return txns;
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

    const firstAmountIdx = amountSource.indexOf(amountMatches[0]);
    const description = amountSource.substring(0, firstAmountIdx).trim();

    if (!description || isSkipDescription(description)) continue;
    if (/^\d{6,}$/.test(description.replace(/\s/g, ""))) continue;

    const amount = parseAmountStr(amountMatches[0]);
    if (isNaN(amount) || amount === 0) continue;

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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParseModule = require("pdf-parse");
  const pdfParse = (typeof pdfParseModule === "function" ? pdfParseModule : pdfParseModule.default) as (buf: Buffer) => Promise<{ text: string }>;
  const data = await pdfParse(buffer);
  const text = data.text;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bank = detectBank(text);
  const year = extractYear(text);

  let transactions: RawTransaction[];

  switch (bank) {
    case "scotiabank":
      transactions = parseScotiabank(lines, year);
      break;
    case "cibc-bank":
    case "cibc-credit":
      transactions = parseCIBCBank(lines, year);
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

  // Mask sensitive data (account numbers, emails, references) in all descriptions
  transactions = transactions.map((tx) => ({
    ...tx,
    description: maskSensitiveData(tx.description),
  }));

  return { transactions, bankDetected: bank, rawText: text, rawLines: lines };
}
