"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { PDFVisualizerData } from "@/hooks/useTransactions";
import { RawTransaction } from "@/types";
import { maskSensitiveData } from "@/lib/maskSensitive";
import PDFPageRenderer, { SelectionRect } from "./PDFPageRenderer";

interface PDFVisualizerProps {
  data: PDFVisualizerData;
  onDismiss: () => void;
  onTransactionsExtracted: (
    transactions: RawTransaction[],
    bankId: string
  ) => void;
}

// Try to extract a transaction from a single line
function extractTransactionFromLine(line: string): RawTransaction | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const amountMatch = trimmed.match(/-?\$?([\d,]+\.\d{2})/);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(/,/g, ""));
  if (isNaN(amount) || amount === 0) return null;

  const datePatterns = [
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2})\b/i,
    /\b(\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\b/i,
    /\b(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/,
    /\b(\d{4}-\d{2}-\d{2})\b/,
  ];

  let dateStr = "";
  let dateEnd = 0;
  for (const pattern of datePatterns) {
    const m = trimmed.match(pattern);
    if (m) {
      dateStr = m[1];
      dateEnd = (m.index || 0) + m[0].length;
      break;
    }
  }

  if (!dateStr) {
    const description = maskSensitiveData(
      trimmed
        .replace(/-?\$?[\d,]+\.\d{2}/, "")
        .replace(/\s+/g, " ")
        .trim()
    );
    return {
      date: "",
      description: description || trimmed,
      amount:
        trimmed.includes("-") && amountMatch[0].startsWith("-")
          ? -amount
          : amount,
    };
  }

  const amountPos = trimmed.indexOf(amountMatch[0]);
  let description: string;
  if (amountPos > dateEnd) {
    description = trimmed.substring(dateEnd, amountPos).trim();
  } else {
    description = trimmed
      .substring(dateEnd)
      .replace(/-?\$?[\d,]+\.\d{2}/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  description = description.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();

  const signedAmount =
    trimmed.includes("-") && amountMatch[0].startsWith("-") ? -amount : amount;

  return {
    date: dateStr,
    description: maskSensitiveData(description),
    amount: signedAmount,
  };
}

function buildPatternFromLines(lines: string[]): {
  dateRegex: string;
  amountRegex: string;
} {
  let dateRegex =
    "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s*\\d{1,2}";
  const slashDateCount = lines.filter((l) => /\d{1,2}\/\d{1,2}/.test(l))
    .length;
  const monthNameCount = lines.filter((l) =>
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2}/i.test(l)
  ).length;
  const dayFirstCount = lines.filter((l) =>
    /\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(l)
  ).length;
  const isoCount = lines.filter((l) => /\d{4}-\d{2}-\d{2}/.test(l)).length;

  if (slashDateCount >= monthNameCount && slashDateCount >= dayFirstCount)
    dateRegex = "\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?";
  else if (dayFirstCount > monthNameCount)
    dateRegex =
      "\\d{1,2}\\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
  else if (isoCount > monthNameCount) dateRegex = "\\d{4}-\\d{2}-\\d{2}";

  return { dateRegex, amountRegex: "-?\\$?\\d{1,3}(?:,\\d{3})*\\.\\d{2}" };
}

// Extract text from a PDF region using pdfjs text content, with OCR fallback
async function extractTextFromRegion(
  pdfBase64: string,
  selection: SelectionRect
): Promise<string[]> {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const binaryStr = atob(pdfBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(selection.page);
    const viewport = page.getViewport({ scale: 1.0 });

    // Convert normalized coordinates to PDF coordinates
    const selTop = selection.normY * viewport.height;
    const selBottom = (selection.normY + selection.normHeight) * viewport.height;
    const selLeft = selection.normX * viewport.width;
    const selRight = (selection.normX + selection.normWidth) * viewport.width;

    const textContent = await page.getTextContent();
    const linesInRegion: { y: number; items: { x: number; str: string }[] }[] = [];

    for (const item of textContent.items) {
      if (!("transform" in item)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const textItem = item as any;
      const pdfX = textItem.transform[4];
      const pdfY = textItem.transform[5];
      const viewY = viewport.height - pdfY;
      const viewX = pdfX;

      if (
        viewX >= selLeft - 20 &&
        viewX <= selRight + 20 &&
        viewY >= selTop - 5 &&
        viewY <= selBottom + 5
      ) {
        const existingLine = linesInRegion.find(
          (l) => Math.abs(l.y - viewY) < 8
        );
        if (existingLine) {
          existingLine.items.push({ x: viewX, str: textItem.str });
        } else {
          linesInRegion.push({ y: viewY, items: [{ x: viewX, str: textItem.str }] });
        }
      }
    }

    // Sort lines by Y, items within each line by X
    linesInRegion.sort((a, b) => a.y - b.y);
    const lines = linesInRegion.map((l) => {
      l.items.sort((a, b) => a.x - b.x);
      return l.items.map((i) => i.str).join(" ").trim();
    }).filter((l) => l.length > 0);

    // If pdfjs text extraction found lines, return them
    if (lines.length > 0) {
      console.log("[PDFVisualizer] pdfjs extracted", lines.length, "lines");
      return lines;
    }

    // ── Fallback: OCR via Tesseract.js ──
    console.log("[PDFVisualizer] pdfjs returned 0 text items, falling back to OCR...");
    return await ocrExtractFromRegion(pdf, page, viewport, selection);
  } catch (err) {
    console.error("Failed to extract text from region:", err);
    return [];
  }
}

// OCR fallback: render the selected zone to a canvas and use Tesseract.js
// Uses word-level bounding boxes to reconstruct table rows properly
async function ocrExtractFromRegion(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewport: any,
  selection: SelectionRect
): Promise<string[]> {
  try {
    // Render the full page at high res for OCR quality
    const ocrScale = 3.0;
    const ocrViewport = page.getViewport({ scale: ocrScale });
    const canvas = document.createElement("canvas");
    canvas.width = ocrViewport.width;
    canvas.height = ocrViewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport: ocrViewport }).promise;

    // Crop to the selected region
    const cropX = Math.floor(selection.normX * ocrViewport.width);
    const cropY = Math.floor(selection.normY * ocrViewport.height);
    const cropW = Math.ceil(selection.normWidth * ocrViewport.width);
    const cropH = Math.ceil(selection.normHeight * ocrViewport.height);

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d")!;
    cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

    // Run Tesseract OCR with word-level output
    const Tesseract = await import("tesseract.js");
    console.log("[PDFVisualizer] Running OCR on zone...");
    const result = await Tesseract.recognize(cropCanvas.toDataURL("image/png"), "eng", {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") {
          console.log(`[OCR] ${Math.round(m.progress * 100)}%`);
        }
      },
    });

    // Use word-level bounding boxes to reconstruct table rows
    // Group words by their Y-center position (same row)
    interface OcrWord { text: string; x: number; y: number; width: number; height: number }
    const words: OcrWord[] = [];
    for (const block of result.data.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          for (const word of line.words || []) {
            if (!word.text.trim()) continue;
            const bbox = word.bbox;
            words.push({
              text: word.text.trim(),
              x: bbox.x0,
              y: (bbox.y0 + bbox.y1) / 2, // Y center
              width: bbox.x1 - bbox.x0,
              height: bbox.y1 - bbox.y0,
            });
          }
        }
      }
    }

    if (words.length === 0) {
      // Fallback to plain text if no word-level data
      const text = result.data.text;
      console.log("[PDFVisualizer] OCR text (no word data):", text.substring(0, 500));
      return text.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    }

    // Group words into rows by Y-center (tolerance based on average word height)
    const avgHeight = words.reduce((s, w) => s + w.height, 0) / words.length;
    const rowTolerance = avgHeight * 0.6;

    const rows: { y: number; words: OcrWord[] }[] = [];
    const sortedByY = [...words].sort((a, b) => a.y - b.y);

    for (const word of sortedByY) {
      const existingRow = rows.find(r => Math.abs(r.y - word.y) < rowTolerance);
      if (existingRow) {
        existingRow.words.push(word);
        // Update row Y to average
        existingRow.y = existingRow.words.reduce((s, w) => s + w.y, 0) / existingRow.words.length;
      } else {
        rows.push({ y: word.y, words: [word] });
      }
    }

    // Sort rows top-to-bottom, words left-to-right within each row
    rows.sort((a, b) => a.y - b.y);
    const lines: string[] = rows.map(row => {
      row.words.sort((a, b) => a.x - b.x);
      return row.words.map(w => w.text).join(" ");
    });

    console.log("[PDFVisualizer] OCR reconstructed", lines.length, "rows from", words.length, "words");
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
      console.log(`  [${i}] ${lines[i]}`);
    }

    return lines;
  } catch (err) {
    console.error("[PDFVisualizer] OCR fallback failed:", err);
    return [];
  }
}

// Fix common OCR misreads in bank statement text
function cleanOcrLine(line: string): string {
  const MONTHS = /(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)/gi;

  // Fix dates: OCR misreads digits after month names (O→0, S→5, I/l→1, B→8, Z→2)
  let cleaned = line.replace(
    new RegExp(`((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))\\s*([A-Z0-9]{1,2})\\b`, "gi"),
    (match, month, dayPart) => {
      // Convert letter-digit confusions in the day part
      const fixedDay = dayPart
        .replace(/[Oo]/g, "0")
        .replace(/[Ss]/g, "5")
        .replace(/[Ii|lL]/g, "1")
        .replace(/[Bb]/g, "8")
        .replace(/[Zz]/g, "2");
      // Only fix if the result is a valid day (01-31)
      const dayNum = parseInt(fixedDay, 10);
      if (dayNum >= 1 && dayNum <= 31) {
        return `${month.toUpperCase()}${fixedDay}`;
      }
      return match;
    }
  );

  // Remove stray pipe characters from OCR (| often appears as column separator artifact)
  cleaned = cleaned.replace(/\s*\|\s*/g, " ");

  // Fix common OCR artifacts in amounts: space in middle of number
  cleaned = cleaned.replace(/(\d),\s+(\d{3})\./g, "$1,$2.");

  return cleaned;
}

// Parse lines as a bank statement table with column headers
// Handles formats like: Description | Withdrawals | Deposits | Date | Balance
function parseBankTable(lines: string[]): RawTransaction[] {
  if (lines.length < 2) return [];

  // Try to detect a header row with "withdrawal" and "deposit" keywords
  // Search ALL lines (OCR of full page can have many lines before the header)
  let headerIdx = -1;
  let hasWithdrawalCol = false;
  let hasDepositCol = false;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    const hasW = lower.includes("withdrawal") || lower.includes("debit");
    const hasD = lower.includes("deposit") || lower.includes("credit");
    if (hasW || hasD) {
      hasWithdrawalCol = hasWithdrawalCol || hasW;
      hasDepositCol = hasDepositCol || hasD;
      headerIdx = i;
      break;
    }
  }

  if (headerIdx === -1) return [];

  // Clean OCR artifacts from all lines
  lines = lines.map(cleanOcrLine);
  console.log("[parseBankTable] Cleaned lines after header:");
  for (let i = headerIdx + 1; i < Math.min(lines.length, headerIdx + 25); i++) {
    console.log(`  [${i}] ${lines[i]}`);
  }

  // First pass: extract all rows with date, amounts, and balance
  interface TableRow {
    line: string;
    date: string;
    description: string;
    amounts: number[];
    balance: number | null;
    lineIdx: number;
  }

  const DATE_RE = /\b((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\d{1,2})\b/i;
  const rows: TableRow[] = [];
  let startingBalance: number | null = null;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/total|closing\s*balance|opening\s*balance/i.test(line)) continue;
    if (/account.*type|fees|rebate\s*balance|waived|paid\s*fees/i.test(line)) continue;

    const dateMatch = line.match(DATE_RE);
    if (!dateMatch) continue;

    // Extract all amounts from the line
    const amounts: { value: number; pos: number }[] = [];
    const amtRe = /\$?([\d,]+\.\d{2})/g;
    let m: RegExpExecArray | null;
    while ((m = amtRe.exec(line)) !== null) {
      amounts.push({ value: parseFloat(m[1].replace(/,/g, "")), pos: m.index });
    }
    if (amounts.length === 0) continue;

    // Description: text before the first amount, without the date
    const firstAmtPos = amounts[0].pos;
    let description = firstAmtPos > 0 ? line.substring(0, firstAmtPos).trim() : "";
    description = description.replace(DATE_RE, "").trim();
    description = description.replace(/\s+/g, " ").replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();

    // Starting balance row
    if (/^starting\s*balance/i.test(description) || /starting\s*balance/i.test(line)) {
      const lastAmt = amounts[amounts.length - 1].value;
      startingBalance = lastAmt;
      continue;
    }

    if (!description) continue;

    // If there are 2+ amounts, the last one is likely the balance
    let balance: number | null = null;
    const txAmounts = amounts.map(a => a.value);
    if (txAmounts.length >= 2) {
      balance = txAmounts[txAmounts.length - 1];
    }

    rows.push({
      line,
      date: dateMatch[1],
      description,
      amounts: txAmounts,
      balance,
      lineIdx: i,
    });
  }

  console.log("[parseBankTable] Found", rows.length, "data rows, startingBalance=", startingBalance);

  // Second pass: use balance column to determine signs
  // Balance goes: startingBalance → startingBalance + deposit - withdrawal → ...
  // For each row, if we know the previous balance and current balance,
  // sign = (currentBalance - prevBalance) matches the transaction amount
  const txns: RawTransaction[] = [];
  let prevBalance = startingBalance;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const txAmount = row.amounts[0]; // First amount is the transaction amount
    const rowBalance = row.balance;

    let signedAmount: number;

    // Try to determine sign from balance change
    if (prevBalance !== null && rowBalance !== null) {
      const delta = Math.round((rowBalance - prevBalance) * 100) / 100;
      // delta > 0 means balance increased (deposit), delta < 0 means decreased (withdrawal)
      // The transaction amount should be close to |delta| (possibly with multiple txns between balances)
      if (Math.abs(Math.abs(delta) - txAmount) < 0.02) {
        signedAmount = delta > 0 ? txAmount : -txAmount;
      } else {
        // Multiple transactions between balance points — use heuristic
        signedAmount = heuristicSign(row.description, txAmount);
      }
    } else if (prevBalance !== null && rowBalance === null) {
      // No balance on this row — check next row with a balance to determine accumulated delta
      signedAmount = heuristicSign(row.description, txAmount);
    } else {
      signedAmount = heuristicSign(row.description, txAmount);
    }

    // Update prevBalance if this row has a balance
    if (rowBalance !== null) prevBalance = rowBalance;

    txns.push({
      date: row.date,
      description: maskSensitiveData(row.description),
      amount: signedAmount,
    });
  }

  return txns;
}

// Heuristic sign determination based on description
function heuristicSign(description: string, amount: number): number {
  const desc = description.toLowerCase();
  // Withdrawals (negative)
  if (/send\s*e-?t/i.test(desc)) return -amount;
  if (/bill\s*py?mt|monthly.*fee|account\s*fee/i.test(desc)) return -amount;
  if (/tfr-?to|trf.*to|transfer.*to/i.test(desc)) return -amount;
  if (/atm\s*w\/d|atm.*withdraw/i.test(desc)) return -amount;
  if (/^wise\b/i.test(desc)) return -amount;
  if (/ind\s*all\s*life|sun\s*life|manulife|great.*west/i.test(desc)) return -amount;

  // Deposits (positive)
  if (/^e-?transfer/i.test(desc)) return amount;
  if (/deposit|received|credit|refund|rebate|payroll|salary|income|interest/i.test(desc)) return amount;
  if (/admin\s*by|canada\s*life|ins\s*$/i.test(desc)) return amount;
  if (/cashback|cash\s*back|dividend|reimbursement/i.test(desc)) return amount;

  // Default: withdrawal (most bank transactions are outgoing)
  return -amount;
}

// Detect transaction types using running totals / balance analysis
// Returns a reason string and updated transactions with corrected signs
interface SignAnalysis {
  transactions: RawTransaction[];
  method: "running-balance" | "column-position" | "heuristic";
  explanation: string;
  confidence: "high" | "medium" | "low";
  details: string[];
}

function analyzeTransactionSigns(
  txns: RawTransaction[],
  lines: string[],
  documentType: "bank" | "credit-card" | null = null
): SignAnalysis {
  const details: string[] = [];

  // Method 1: Check if lines have separate withdrawal/deposit columns
  // Look for column headers
  const headerLine = lines.find((l) => {
    const lower = l.toLowerCase();
    return (
      (lower.includes("withdrawal") || lower.includes("debit")) &&
      (lower.includes("deposit") || lower.includes("credit"))
    );
  });

  if (headerLine) {
    details.push(`Detected column headers: "${headerLine.trim()}"`);
    // Already handled by parseBankTable — signs should be correct
    return {
      transactions: txns,
      method: "column-position",
      explanation:
        "Detected separate Withdrawal/Deposit columns in the statement. Transaction signs are based on which column the amount appears in.",
      confidence: "high",
      details,
    };
  }

  // Method 2: Try to find a running balance pattern
  // Look for lines that have 2+ dollar amounts (last one being balance)
  const AMT_RE = /\$?([\d,]+\.\d{2})/g;
  const balanceRows: { txIdx: number; amounts: number[] }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const amounts: number[] = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(AMT_RE.source, "g");
    while ((m = re.exec(lines[i])) !== null) {
      amounts.push(parseFloat(m[1].replace(/,/g, "")));
    }
    if (amounts.length >= 2) {
      balanceRows.push({ txIdx: i, amounts });
    }
  }

  if (balanceRows.length >= 2) {
    // Try to infer sign from balance changes
    let balanceMatched = 0;
    let balanceTotal = 0;
    const updatedTxns = [...txns];

    for (let i = 1; i < balanceRows.length && i < txns.length; i++) {
      const prevBal = balanceRows[i - 1].amounts[balanceRows[i - 1].amounts.length - 1];
      const curBal = balanceRows[i].amounts[balanceRows[i].amounts.length - 1];
      const txAmt = Math.abs(txns[i]?.amount ?? 0);
      const delta = Math.round((curBal - prevBal) * 100) / 100;

      balanceTotal++;
      if (Math.abs(Math.abs(delta) - txAmt) < 0.02) {
        balanceMatched++;
        if (delta > 0) {
          updatedTxns[i] = { ...updatedTxns[i], amount: txAmt };
        } else {
          updatedTxns[i] = { ...updatedTxns[i], amount: -txAmt };
        }
      }
    }

    if (balanceMatched > 0 && balanceMatched >= balanceTotal * 0.5) {
      details.push(
        `Found running balance in ${balanceRows.length} rows.`,
        `Successfully matched ${balanceMatched}/${balanceTotal} transactions to balance changes.`
      );
      return {
        transactions: updatedTxns,
        method: "running-balance",
        explanation: `Detected a running balance column. Used balance changes to determine ${balanceMatched} transaction sign(s). Remaining transactions use keyword-based heuristics.`,
        confidence: balanceMatched === balanceTotal ? "high" : "medium",
        details,
      };
    }
  }

  // Method 3: Credit card — most amounts are charges (negative), payments are positive
  if (documentType === "credit-card") {
    details.push(
      "Document identified as credit card statement.",
      "All amounts treated as charges (debit) unless description indicates a payment, refund, or credit."
    );

    const updatedTxns = txns.map((tx) => {
      const desc = tx.description.toLowerCase();
      const isCredit =
        /payment|refund|credit|rebate|cashback|cash\s*back|reward|reversal|dispute|returned/i.test(desc);
      return {
        ...tx,
        amount: isCredit ? Math.abs(tx.amount) : -Math.abs(tx.amount),
      };
    });

    return {
      transactions: updatedTxns,
      method: "heuristic",
      explanation:
        "Credit card statement: all transactions are charges (debit) unless marked as payment, refund, or credit.",
      confidence: "medium",
      details,
    };
  }

  // Method 4: Bank statement without balance columns — use keyword heuristics
  if (documentType === "bank") {
    details.push(
      "Document identified as bank statement, but no running balance column detected.",
      "Using keyword-based heuristics to determine withdrawals vs deposits."
    );
  } else {
    details.push(
      "No running balance or separate columns detected.",
      "Using keyword-based heuristics (e.g., 'payment', 'deposit', 'fee') to determine credit/debit."
    );
  }

  const updatedTxns = txns.map((tx) => ({
    ...tx,
    amount: heuristicSign(tx.description, Math.abs(tx.amount)),
  }));

  return {
    transactions: updatedTxns,
    method: "heuristic",
    explanation: documentType === "bank"
      ? "Bank statement without a visible balance column. Used keyword patterns to determine withdrawals vs deposits."
      : "No balance column found. Transaction types were determined using keyword patterns in descriptions (e.g., payments, fees → withdrawal; deposits, refunds → credit).",
    confidence: "low",
    details,
  };
}

export default function PDFVisualizer({
  data,
  onDismiss,
  onTransactionsExtracted,
}: PDFVisualizerProps) {
  const [viewMode, setViewMode] = useState<"pdf" | "text">(
    data.pdfBase64 ? "pdf" : "text"
  );
  const [search, setSearch] = useState("");
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);
  const [step, setStep] = useState<"select" | "doc-type" | "review" | "preview">("select");
  const [extractedTxns, setExtractedTxns] = useState<RawTransaction[]>([]);
  const [pdfSelections, setPdfSelections] = useState<SelectionRect[]>([]);
  const [extracting, setExtracting] = useState(false);
  const lastClickedRef = useRef<number | null>(null);
  const [signAnalysis, setSignAnalysis] = useState<SignAnalysis | null>(null);
  const [reviewTxns, setReviewTxns] = useState<RawTransaction[]>([]);
  const [extractedLines, setExtractedLines] = useState<string[]>([]);
  const [docType, setDocType] = useState<"bank" | "credit-card" | null>(null);

  const filteredLines = useMemo(() => {
    if (!search.trim())
      return data.rawLines.map((line, idx) => ({ line, originalIdx: idx }));
    const lower = search.toLowerCase();
    return data.rawLines
      .map((line, idx) => ({ line, originalIdx: idx }))
      .filter(({ line }) => line.toLowerCase().includes(lower));
  }, [data.rawLines, search]);

  const isTransactionLike = (line: string): boolean => {
    const hasAmount = /\$?\d{1,3}(?:,\d{3})*\.\d{2}/.test(line);
    const hasDate =
      /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2}|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})/i.test(
        line
      );
    return hasAmount && hasDate;
  };

  const hasAmountPattern = (line: string): boolean =>
    /\$?\d{1,3}(?:,\d{3})*\.\d{2}/.test(line);

  const isInRange = useCallback(
    (idx: number): boolean => {
      if (rangeStart === null) return false;
      if (rangeEnd === null) return idx === rangeStart;
      const lo = Math.min(rangeStart, rangeEnd);
      const hi = Math.max(rangeStart, rangeEnd);
      return idx >= lo && idx <= hi;
    },
    [rangeStart, rangeEnd]
  );

  const selectedCount = useMemo(() => {
    if (rangeStart === null) return 0;
    if (rangeEnd === null) return 1;
    return Math.abs(rangeEnd - rangeStart) + 1;
  }, [rangeStart, rangeEnd]);

  const handleLineClick = useCallback(
    (idx: number, shiftKey: boolean) => {
      if (rangeStart === null || !shiftKey) {
        setRangeStart(idx);
        setRangeEnd(null);
        lastClickedRef.current = idx;
      } else {
        setRangeEnd(idx);
        lastClickedRef.current = idx;
      }
    },
    [rangeStart]
  );

  const clearSelection = useCallback(() => {
    setRangeStart(null);
    setRangeEnd(null);
    setPdfSelections([]);
  }, []);

  const autoDetectSection = useCallback(() => {
    const txLines: number[] = [];
    data.rawLines.forEach((line, idx) => {
      if (isTransactionLike(line)) txLines.push(idx);
    });
    if (txLines.length === 0) return;
    setRangeStart(txLines[0]);
    setRangeEnd(txLines[txLines.length - 1]);
  }, [data.rawLines]);

  // Handle PDF visual selection - accumulate selections (multiple per page allowed)
  const handlePdfSelection = useCallback(
    async (sel: SelectionRect) => {
      setPdfSelections((prev) => [...prev, sel].sort((a, b) => a.page - b.page));
    },
    []
  );

  // Extract transactions from all PDF selections
  const handlePdfExtract = useCallback(async () => {
    if (!data.pdfBase64 || pdfSelections.length === 0) return;

    setExtracting(true);
    try {
      const allLines: string[] = [];
      // Process each selection in page order
      for (const sel of pdfSelections) {
        const lines = await extractTextFromRegion(data.pdfBase64!, sel);
        allLines.push(...lines);
      }

      // Clean OCR artifacts from all extracted lines
      const cleanedLines = allLines.map(cleanOcrLine);
      console.log("[PDFVisualizer] Extracted lines (cleaned):", cleanedLines);
      setExtractedLines(cleanedLines);

      // First try: parse as a bank table (with header detection)
      let txns = parseBankTable(cleanedLines);

      // Fallback: parse each line individually
      if (txns.length === 0) {
        for (const line of cleanedLines) {
          const tx = extractTransactionFromLine(line);
          if (tx) txns.push(tx);
        }
      }

      setExtractedTxns(txns);
      setStep("doc-type");
    } catch (err) {
      console.error("[PDFVisualizer] Extract failed:", err);
    } finally {
      setExtracting(false);
    }
  }, [data.pdfBase64, pdfSelections]);

  // Handle text-mode extract
  const handleTextExtract = useCallback(() => {
    if (rangeStart === null) return;
    const lo = rangeEnd !== null ? Math.min(rangeStart, rangeEnd) : rangeStart;
    const hi = rangeEnd !== null ? Math.max(rangeStart, rangeEnd) : rangeStart;
    const sectionLines = data.rawLines.slice(lo, hi + 1);
    setExtractedLines(sectionLines);
    const txns: RawTransaction[] = [];
    for (const line of sectionLines) {
      const tx = extractTransactionFromLine(line);
      if (tx) txns.push(tx);
    }
    setExtractedTxns(txns);
    setStep("doc-type");
  }, [rangeStart, rangeEnd, data.rawLines]);

  const handleConfirm = useCallback(() => {
    const finalTxns = reviewTxns.length > 0 ? reviewTxns : extractedTxns;
    if (finalTxns.length === 0) return;

    // Get the lines for pattern learning
    const sectionLines = extractedLines.length > 0
      ? extractedLines
      : finalTxns.map((tx) => `${tx.date} ${tx.description} ${tx.amount}`);

    const pattern = buildPatternFromLines(sectionLines);
    try {
      const stored = localStorage.getItem("budget-categorizer-custom-patterns");
      const patterns = stored ? JSON.parse(stored) : {};
      patterns[data.bankDetected] = {
        bankId: data.bankDetected,
        dateRegex: pattern.dateRegex,
        amountRegex: pattern.amountRegex,
        sampleLines: sectionLines.slice(0, 5),
        createdAt: Date.now(),
      };
      localStorage.setItem(
        "budget-categorizer-custom-patterns",
        JSON.stringify(patterns)
      );
    } catch {
      // ignore
    }

    onTransactionsExtracted(finalTxns, data.bankDetected);
  }, [
    reviewTxns,
    extractedTxns,
    extractedLines,
    data,
    onTransactionsExtracted,
  ]);

  const handleBack = useCallback(() => {
    setStep("select");
  }, []);

  // Handle document type selection — run analysis then proceed to review
  const handleDocTypeSelect = useCallback((type: "bank" | "credit-card") => {
    setDocType(type);
    const analysis = analyzeTransactionSigns(extractedTxns, extractedLines, type);
    setSignAnalysis(analysis);
    setReviewTxns(analysis.transactions.map((tx) => ({ ...tx })));
    setStep("review");
  }, [extractedTxns, extractedLines]);

  // Toggle the sign of a transaction in review
  const toggleTxnSign = useCallback((idx: number) => {
    setReviewTxns((prev) =>
      prev.map((tx, i) =>
        i === idx ? { ...tx, amount: -tx.amount } : tx
      )
    );
  }, []);

  // Proceed from review to final preview/confirm
  const handleReviewConfirm = useCallback(() => {
    setExtractedTxns(reviewTxns);
    setStep("preview");
  }, [reviewTxns]);

  // ─── Document Type Step ────────────────────────────────────────
  if (step === "doc-type") {
    return (
      <div className="bg-white rounded-xl border border-purple-200 shadow-sm overflow-hidden">
        <div className="bg-purple-50 border-b border-purple-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 p-2 bg-purple-100 rounded-lg">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-purple-900">
                What type of document is this?
              </h3>
              <p className="text-xs text-purple-700 mt-1">
                Found {extractedTxns.length} transaction{extractedTxns.length !== 1 ? "s" : ""}.
                This helps us correctly categorize credits and debits.
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-6">
          <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto">
            {/* Bank Statement Option */}
            <button
              onClick={() => handleDocTypeSelect("bank")}
              className="flex flex-col items-center gap-3 p-5 border-2 border-gray-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all group"
            >
              <div className="p-3 bg-blue-100 rounded-xl group-hover:bg-blue-200 transition-colors">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-800">Bank Statement</p>
                <p className="text-[11px] text-gray-500 mt-1">
                  Chequing / Savings account with withdrawals &amp; deposits
                </p>
              </div>
              <span className="text-[10px] text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded-full">
                Uses balance validation
              </span>
            </button>

            {/* Credit Card Option */}
            <button
              onClick={() => handleDocTypeSelect("credit-card")}
              className="flex flex-col items-center gap-3 p-5 border-2 border-gray-200 rounded-xl hover:border-amber-400 hover:bg-amber-50 transition-all group"
            >
              <div className="p-3 bg-amber-100 rounded-xl group-hover:bg-amber-200 transition-colors">
                <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-800">Credit Card</p>
                <p className="text-[11px] text-gray-500 mt-1">
                  Charges &amp; payments on a credit card account
                </p>
              </div>
              <span className="text-[10px] text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-full">
                Charges as debits
              </span>
            </button>
          </div>
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={() => setStep("select")}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Re-select area
          </button>
          <button
            onClick={onDismiss}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // ─── Review Step (Credit/Debit Clarification) ─────────────────
  if (step === "review") {
    const totalCredits = reviewTxns
      .filter((tx) => tx.amount > 0)
      .reduce((sum, tx) => sum + tx.amount, 0);
    const totalDebits = reviewTxns
      .filter((tx) => tx.amount < 0)
      .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    return (
      <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="bg-blue-50 border-b border-blue-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 p-2 bg-blue-100 rounded-lg">
              <svg
                className="w-5 h-5 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-blue-900">
                Review Credit/Debit Classification
              </h3>
              <p className="text-xs text-blue-700 mt-1">
                We detected {reviewTxns.length} transaction{reviewTxns.length !== 1 ? "s" : ""}.
                Please verify the credit/debit classification below before proceeding.
              </p>
            </div>
          </div>
        </div>

        {/* Analysis explanation */}
        {signAnalysis && (
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/50">
            <div className="flex items-start gap-2">
              <span
                className={`mt-0.5 flex-shrink-0 px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${
                  signAnalysis.confidence === "high"
                    ? "bg-green-100 text-green-700"
                    : signAnalysis.confidence === "medium"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-orange-100 text-orange-700"
                }`}
              >
                {signAnalysis.confidence} confidence
              </span>
              <div className="flex-1">
                <p className="text-xs text-gray-700">
                  <span className="font-medium">Method:</span>{" "}
                  {signAnalysis.explanation}
                </p>
                {signAnalysis.details.length > 0 && (
                  <ul className="mt-1 text-[11px] text-gray-500 space-y-0.5">
                    {signAnalysis.details.map((d, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <span className="text-gray-400 mt-px">•</span>
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Summary totals */}
            <div className="flex gap-4 mt-3">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg">
                <span className="text-xs text-green-600 font-medium">Credits (Deposits):</span>
                <span className="text-xs text-green-700 font-bold">
                  ${totalCredits.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[10px] text-green-500">
                  ({reviewTxns.filter((tx) => tx.amount > 0).length})
                </span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 border border-red-200 rounded-lg">
                <span className="text-xs text-red-600 font-medium">Debits (Withdrawals):</span>
                <span className="text-xs text-red-700 font-bold">
                  ${totalDebits.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span className="text-[10px] text-red-500">
                  ({reviewTxns.filter((tx) => tx.amount < 0).length})
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Transaction table with toggle */}
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">#</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Date</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Description</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">Amount</th>
                <th className="text-center px-4 py-2 text-xs font-medium text-gray-500">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reviewTxns.map((tx, idx) => (
                <tr key={idx} className="hover:bg-gray-50 group">
                  <td className="px-4 py-2 text-xs text-gray-400">{idx + 1}</td>
                  <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                    {tx.date || "\u2014"}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-800 max-w-[250px] truncate">
                    {tx.description}
                  </td>
                  <td
                    className={`px-4 py-2 text-xs text-right whitespace-nowrap font-medium ${
                      tx.amount < 0 ? "text-red-600" : "text-green-600"
                    }`}
                  >
                    {tx.amount < 0 ? "-" : "+"}$
                    {Math.abs(tx.amount).toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => toggleTxnSign(idx)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-full transition-all border ${
                        tx.amount < 0
                          ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100"
                          : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                      }`}
                      title="Click to flip credit/debit"
                    >
                      {tx.amount < 0 ? (
                        <>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                          </svg>
                          Debit
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                          </svg>
                          Credit
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={() => setStep("select")}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Re-select area
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onDismiss}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            {reviewTxns.length > 0 && (
              <button
                onClick={handleReviewConfirm}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Looks Good — Confirm &amp; Learn ({reviewTxns.length})
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Preview Step ───────────────────────────────────────────────
  if (step === "preview") {
    return (
      <div className="bg-white rounded-xl border border-emerald-200 shadow-sm overflow-hidden">
        <div className="bg-emerald-50 border-b border-emerald-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 p-2 bg-emerald-100 rounded-lg">
              <svg
                className="w-5 h-5 text-emerald-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-emerald-900">
                Found {extractedTxns.length} transaction
                {extractedTxns.length !== 1 ? "s" : ""} in selected zone
              </h3>
              <p className="text-xs text-emerald-700 mt-1">
                Review below. Click &quot;Confirm &amp; Learn&quot; to use these
                and teach the app this format.
              </p>
            </div>
          </div>
        </div>

        <div className="max-h-[400px] overflow-y-auto">
          {extractedTxns.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400">
              <svg
                className="w-10 h-10 mx-auto mb-3 text-gray-300"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="font-medium text-gray-500">
                No transactions found in the selected zone
              </p>
              <p className="mt-1 text-xs">
                Try selecting a different area with dates and dollar amounts.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">
                    #
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">
                    Date
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">
                    Description
                  </th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-gray-500">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {extractedTxns.map((tx, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-xs text-gray-400">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {tx.date || "\u2014"}
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-800 max-w-[300px] truncate">
                      {tx.description}
                    </td>
                    <td
                      className={`px-4 py-2 text-xs text-right whitespace-nowrap font-medium ${
                        tx.amount < 0 ? "text-red-600" : "text-green-600"
                      }`}
                    >
                      {tx.amount < 0 ? "-" : ""}$
                      {Math.abs(tx.amount).toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={handleBack}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-1"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Adjust selection
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={onDismiss}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            {extractedTxns.length > 0 && (
              <button
                onClick={handleConfirm}
                className="px-5 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium flex items-center gap-2"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Confirm &amp; Learn ({extractedTxns.length})
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Selection Step ─────────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
      {/* PDF Submitted Banner */}
      <div className="bg-[#0f3460] text-white px-5 py-3 flex items-center gap-3">
        <div className="p-1.5 bg-white/20 rounded-lg">
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold">PDF Submitted</h3>
          <p className="text-xs text-white/70">
            {data.bankDetected !== "unknown"
              ? `Detected as ${data.bankDetected.toUpperCase()} statement`
              : "Bank format not recognized"}{" "}
            &middot; {data.rawLines.length} lines of text extracted
          </p>
        </div>

        {/* View Mode Toggle */}
        {data.pdfBase64 && (
          <div className="flex bg-white/10 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("pdf")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                viewMode === "pdf"
                  ? "bg-white text-[#0f3460]"
                  : "text-white/70 hover:text-white"
              }`}
            >
              PDF View
            </button>
            <button
              onClick={() => setViewMode("text")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                viewMode === "text"
                  ? "bg-white text-[#0f3460]"
                  : "text-white/70 hover:text-white"
              }`}
            >
              Text View
            </button>
          </div>
        )}

        <button
          onClick={onDismiss}
          className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          title="Dismiss"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Selector Instructions */}
      <div className="bg-amber-50 border-b border-amber-200 px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-amber-100 rounded-lg flex-shrink-0">
            <svg
              className="w-4 h-4 text-amber-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
              />
            </svg>
          </div>
          <div className="flex-1">
            {viewMode === "pdf" ? (
              <p className="text-xs text-amber-800">
                <span className="font-semibold">Selector Tool:</span>{" "}
                <span className="font-medium">Click and drag</span> a rectangle
                over the transactions section in the PDF. The app will extract
                and learn this format.
              </p>
            ) : (
              <p className="text-xs text-amber-800">
                <span className="font-semibold">Selector Tool:</span>{" "}
                <span className="font-medium">Click</span> the first
                transaction line, then{" "}
                <span className="font-medium">Shift+Click</span> the last one
                to highlight the section.
              </p>
            )}
          </div>
          {pdfSelections.length > 0 && viewMode === "pdf" && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="px-2.5 py-1 bg-[#0f3460] text-white text-xs font-semibold rounded-full">
                {pdfSelections.length} zone{pdfSelections.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={clearSelection}
                className="px-2 py-1 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="Clear all zones"
              >
                Reset
              </button>
            </div>
          )}
          {selectedCount > 0 && viewMode === "text" && (
            <span className="flex-shrink-0 px-2.5 py-1 bg-[#0f3460] text-white text-xs font-semibold rounded-full">
              {selectedCount} lines
            </span>
          )}
        </div>
      </div>

      {/* PDF View Mode */}
      {viewMode === "pdf" && data.pdfBase64 && (
        <>
          {extracting ? (
            <div className="px-5 py-12 text-center">
              <div className="w-8 h-8 border-2 border-[#0f3460] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm text-gray-500">
                Extracting transactions from selected zone...
              </p>
            </div>
          ) : (
            <PDFPageRenderer
              pdfBase64={data.pdfBase64}
              onSelectionComplete={handlePdfSelection}
              selections={pdfSelections}
            />
          )}
        </>
      )}

      {/* Text View Mode */}
      {viewMode === "text" && (
        <>
          {/* Toolbar */}
          <div className="px-5 py-2.5 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                placeholder="Search text..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300"
              />
            </div>

            <button
              onClick={autoDetectSection}
              className="px-3 py-1.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors flex items-center gap-1.5"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              Auto-detect
            </button>
            {selectedCount > 0 && (
              <button
                onClick={clearSelection}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}

            <div className="flex items-center gap-2 ml-auto text-xs text-gray-400">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-green-100 border border-green-300 inline-block" />
                Likely
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-[#0f3460]/15 border border-[#0f3460]/40 inline-block" />
                Selected
              </span>
            </div>
          </div>

          {/* Lines */}
          <div className="max-h-[450px] overflow-y-auto font-mono text-xs">
            {filteredLines.length === 0 ? (
              <div className="px-5 py-8 text-center text-gray-400">
                {search
                  ? "No lines match your search"
                  : "No text extracted from PDF"}
              </div>
            ) : (
              <div>
                {filteredLines.map(({ line, originalIdx }) => {
                  const isTx = isTransactionLike(line);
                  const hasAmt = !isTx && hasAmountPattern(line);
                  const inRange = isInRange(originalIdx);
                  const isRangeEdge =
                    originalIdx === rangeStart || originalIdx === rangeEnd;

                  return (
                    <div
                      key={originalIdx}
                      onClick={(e) =>
                        handleLineClick(originalIdx, e.shiftKey)
                      }
                      className={`flex items-start cursor-pointer transition-all border-l-4 ${
                        inRange
                          ? isRangeEdge
                            ? "bg-[#0f3460]/15 border-l-[#0f3460] ring-1 ring-inset ring-[#0f3460]/20"
                            : "bg-[#0f3460]/8 border-l-[#0f3460]/60"
                          : isTx
                          ? "bg-green-50/50 hover:bg-green-100/50 border-l-green-400/40"
                          : hasAmt
                          ? "bg-blue-50/30 hover:bg-blue-50/60 border-l-transparent"
                          : "hover:bg-gray-50 border-l-transparent"
                      }`}
                    >
                      <span className="flex-shrink-0 w-12 px-2 py-1 text-right text-gray-300 select-none border-r border-gray-100 tabular-nums">
                        {originalIdx + 1}
                      </span>
                      <span
                        className={`flex-1 px-3 py-1 whitespace-pre-wrap break-all ${
                          line.trim() === ""
                            ? "text-gray-300"
                            : inRange
                            ? "text-gray-900"
                            : "text-gray-600"
                        }`}
                      >
                        {line || "\u00A0"}
                      </span>
                      {inRange && isRangeEdge && (
                        <span className="flex-shrink-0 px-2 py-1 text-[10px] font-semibold text-[#0f3460] select-none">
                          {originalIdx ===
                          Math.min(rangeStart!, rangeEnd ?? rangeStart!)
                            ? "START"
                            : "END"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Footer */}
      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {viewMode === "pdf" ? (
            pdfSelections.length > 0 ? (
              <>
                <span className="text-[#0f3460] font-medium">
                  {pdfSelections.length} zone
                  {pdfSelections.length !== 1 ? "s" : ""} on page
                  {pdfSelections.length === 1
                    ? ` ${pdfSelections[0].page}`
                    : `s ${pdfSelections.map((s) => s.page).join(", ")}`}
                  .
                </span>{" "}
                Navigate to other pages to add more zones.
              </>
            ) : (
              <>Draw a rectangle over the transactions area in the PDF</>
            )
          ) : selectedCount === 0 ? (
            <>Click a line to start selecting the transactions section</>
          ) : selectedCount === 1 ? (
            <>
              <span className="text-[#0f3460] font-medium">Start set.</span>{" "}
              Now hold{" "}
              <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[10px] font-mono">
                Shift
              </kbd>{" "}
              and click the last transaction line.
            </>
          ) : (
            <>
              Lines{" "}
              <span className="font-medium text-gray-600">
                {Math.min(rangeStart!, rangeEnd!) + 1}
              </span>{" "}
              to{" "}
              <span className="font-medium text-gray-600">
                {Math.max(rangeStart!, rangeEnd!) + 1}
              </span>{" "}
              selected ({selectedCount} lines)
            </>
          )}
        </p>
        {viewMode === "pdf" && pdfSelections.length > 0 && (
          <button
            onClick={handlePdfExtract}
            className="px-5 py-2 text-sm bg-[#0f3460] text-white rounded-lg hover:bg-[#16213e] transition-colors font-medium flex items-center gap-2 shadow-sm"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            Extract from {pdfSelections.length} Zone
            {pdfSelections.length !== 1 ? "s" : ""}
          </button>
        )}
        {viewMode === "text" && selectedCount > 0 && (
          <button
            onClick={handleTextExtract}
            className="px-5 py-2 text-sm bg-[#0f3460] text-white rounded-lg hover:bg-[#16213e] transition-colors font-medium flex items-center gap-2 shadow-sm"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            Extract Transactions
          </button>
        )}
      </div>
    </div>
  );
}
