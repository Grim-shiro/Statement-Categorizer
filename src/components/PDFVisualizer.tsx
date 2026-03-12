"use client";

import { useState, useMemo, useCallback } from "react";
import { PDFVisualizerData } from "@/hooks/useTransactions";
import { RawTransaction } from "@/types";
import { maskSensitiveData } from "@/lib/maskSensitive";

interface PDFVisualizerProps {
  data: PDFVisualizerData;
  onDismiss: () => void;
  onTransactionsExtracted: (transactions: RawTransaction[], bankId: string) => void;
}

// Try to extract a transaction from a single line
function extractTransactionFromLine(line: string): RawTransaction | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Try to find a dollar amount (with or without $, with optional commas)
  const amountMatch = trimmed.match(/-?\$?([\d,]+\.\d{2})/);
  if (!amountMatch) return null;

  const amount = parseFloat(amountMatch[1].replace(/,/g, ""));
  if (isNaN(amount) || amount === 0) return null;

  // Try to find a date in various formats
  const datePatterns = [
    // Jan 15, Jan15, JAN 15
    /\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2})\b/i,
    // 15 Jan, 15Jan
    /\b(\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\b/i,
    // 01/15, 1/15, 01-15
    /\b(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/,
    // 2024-01-15
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
    // No date found - use the line without the amount as description
    const description = maskSensitiveData(
      trimmed
        .replace(/-?\$?[\d,]+\.\d{2}/, "")
        .replace(/\s+/g, " ")
        .trim()
    );
    return {
      date: "",
      description: description || trimmed,
      amount: trimmed.includes("-") && amountMatch[0].startsWith("-") ? -amount : amount,
    };
  }

  // Description is everything between date and amount (or the rest of the line)
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

  // Clean up description
  description = description.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();

  const signedAmount =
    trimmed.includes("-") && amountMatch[0].startsWith("-") ? -amount : amount;

  return { date: dateStr, description: maskSensitiveData(description), amount: signedAmount };
}

// Build a regex pattern string from selected transaction lines for future matching
function buildPatternFromLines(lines: string[]): {
  dateRegex: string;
  amountRegex: string;
} {
  // Detect the most common date format
  let dateRegex =
    "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s*\\d{1,2}";
  const slashDateCount = lines.filter((l) => /\d{1,2}\/\d{1,2}/.test(l)).length;
  const monthNameCount = lines.filter((l) =>
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2}/i.test(l)
  ).length;
  const dayFirstCount = lines.filter((l) =>
    /\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(l)
  ).length;
  const isoCount = lines.filter((l) => /\d{4}-\d{2}-\d{2}/.test(l)).length;

  if (slashDateCount >= monthNameCount && slashDateCount >= dayFirstCount) {
    dateRegex = "\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?";
  } else if (dayFirstCount > monthNameCount) {
    dateRegex =
      "\\d{1,2}\\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
  } else if (isoCount > monthNameCount) {
    dateRegex = "\\d{4}-\\d{2}-\\d{2}";
  }

  const amountRegex = "-?\\$?\\d{1,3}(?:,\\d{3})*\\.\\d{2}";

  return { dateRegex, amountRegex };
}

export default function PDFVisualizer({
  data,
  onDismiss,
  onTransactionsExtracted,
}: PDFVisualizerProps) {
  const [search, setSearch] = useState("");
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [selectedLines, setSelectedLines] = useState<Set<number>>(new Set());
  const [step, setStep] = useState<"select" | "preview">("select");
  const [extractedTxns, setExtractedTxns] = useState<RawTransaction[]>([]);

  const filteredLines = useMemo(() => {
    if (!search.trim())
      return data.rawLines.map((line, idx) => ({ line, originalIdx: idx }));
    const lower = search.toLowerCase();
    return data.rawLines
      .map((line, idx) => ({ line, originalIdx: idx }))
      .filter(({ line }) => line.toLowerCase().includes(lower));
  }, [data.rawLines, search]);

  // Highlight lines that look like they might contain transaction data
  const isTransactionLike = (line: string): boolean => {
    const hasAmount = /\$?\d{1,3}(?:,\d{3})*\.\d{2}/.test(line);
    const hasDate =
      /(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*\d{1,2}|\d{1,2}\/\d{1,2}|\d{4}-\d{2}-\d{2})/i.test(
        line
      );
    return hasAmount && hasDate;
  };

  const hasAmountPattern = (line: string): boolean => {
    return /\$?\d{1,3}(?:,\d{3})*\.\d{2}/.test(line);
  };

  const txLikeCount = useMemo(
    () => data.rawLines.filter(isTransactionLike).length,
    [data.rawLines]
  );

  const toggleLine = useCallback((idx: number) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }, []);

  const selectAllLikely = useCallback(() => {
    const likely = new Set<number>();
    data.rawLines.forEach((line, idx) => {
      if (isTransactionLike(line)) likely.add(idx);
    });
    setSelectedLines(likely);
  }, [data.rawLines]);

  const clearSelection = useCallback(() => {
    setSelectedLines(new Set());
  }, []);

  const handleExtract = useCallback(() => {
    const lines = Array.from(selectedLines)
      .sort((a, b) => a - b)
      .map((idx) => data.rawLines[idx]);

    const txns: RawTransaction[] = [];
    for (const line of lines) {
      const tx = extractTransactionFromLine(line);
      if (tx) txns.push(tx);
    }

    setExtractedTxns(txns);
    setStep("preview");
  }, [selectedLines, data.rawLines]);

  const handleConfirm = useCallback(() => {
    if (extractedTxns.length === 0) return;

    // Save the pattern to localStorage for future parsing
    const selectedLineTexts = Array.from(selectedLines)
      .sort((a, b) => a - b)
      .map((idx) => data.rawLines[idx]);

    const pattern = buildPatternFromLines(selectedLineTexts);

    try {
      const stored = localStorage.getItem("budget-categorizer-custom-patterns");
      const patterns = stored ? JSON.parse(stored) : {};
      patterns[data.bankDetected] = {
        bankId: data.bankDetected,
        dateRegex: pattern.dateRegex,
        amountRegex: pattern.amountRegex,
        sampleLines: selectedLineTexts.slice(0, 5),
        createdAt: Date.now(),
      };
      localStorage.setItem(
        "budget-categorizer-custom-patterns",
        JSON.stringify(patterns)
      );
    } catch {
      // localStorage not available, skip saving
    }

    onTransactionsExtracted(extractedTxns, data.bankDetected);
  }, [extractedTxns, selectedLines, data, onTransactionsExtracted]);

  const handleBack = useCallback(() => {
    setStep("select");
  }, []);

  if (step === "preview") {
    return (
      <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
        {/* Preview Header */}
        <div className="bg-emerald-50 border-b border-emerald-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
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
                  Extracted {extractedTxns.length} transaction
                  {extractedTxns.length !== 1 ? "s" : ""} from{" "}
                  {selectedLines.size} selected line
                  {selectedLines.size !== 1 ? "s" : ""}
                </h3>
                <p className="text-xs text-emerald-700 mt-1">
                  Review the extracted transactions below. If they look correct,
                  click &quot;Confirm &amp; Use&quot; to add them. The pattern
                  will be saved for future statements from this bank.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Extracted Transactions Table */}
        <div className="max-h-[400px] overflow-y-auto">
          {extractedTxns.length === 0 ? (
            <div className="px-5 py-8 text-center text-gray-400">
              <p>Could not extract valid transactions from the selected lines.</p>
              <p className="mt-1 text-xs">
                Try selecting different lines that contain dates and amounts.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
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
                    <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {tx.date || "—"}
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

        {/* Action Buttons */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={handleBack}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors"
          >
            &larr; Back to selection
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
                Confirm &amp; Use {extractedTxns.length} Transaction
                {extractedTxns.length !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-amber-50 border-b border-amber-200 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 p-2 bg-amber-100 rounded-lg">
              <svg
                className="w-5 h-5 text-amber-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-amber-900">
                No transactions auto-detected &mdash; Select them manually
              </h3>
              <p className="text-xs text-amber-700 mt-1">
                Click on the lines below that contain your transactions. The app
                will learn this format for future{" "}
                <span className="font-medium">
                  {data.bankDetected === "unknown"
                    ? "PDF"
                    : data.bankDetected.toUpperCase()}
                </span>{" "}
                statements.
              </p>
              <div className="flex items-center gap-4 mt-2 text-xs text-amber-600">
                <span>{data.rawLines.length} lines extracted</span>
                <span>&middot;</span>
                <span>
                  {txLikeCount} lines look like potential transactions
                </span>
                {selectedLines.size > 0 && (
                  <>
                    <span>&middot;</span>
                    <span className="font-semibold text-[#0f3460]">
                      {selectedLines.size} selected
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="p-1.5 text-amber-400 hover:text-amber-600 hover:bg-amber-100 rounded-lg transition-colors"
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
      </div>

      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
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
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300"
          />
        </div>

        <button
          onClick={selectAllLikely}
          className="px-3 py-1.5 text-xs bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition-colors"
        >
          Auto-select likely
        </button>
        {selectedLines.size > 0 && (
          <button
            onClick={clearSelection}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Clear selection
          </button>
        )}

        <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showLineNumbers}
            onChange={(e) => setShowLineNumbers(e.target.checked)}
            className="rounded border-gray-300 text-amber-500 focus:ring-amber-300"
          />
          Line #
        </label>

        <div className="flex items-center gap-1.5 ml-auto">
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-3 h-3 rounded bg-green-100 border border-green-300 inline-block" />
            Likely
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 ml-2">
            <span className="w-3 h-3 rounded bg-blue-50 border border-blue-200 inline-block" />
            Amount
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 ml-2">
            <span className="w-3 h-3 rounded bg-[#0f3460]/10 border border-[#0f3460]/30 inline-block" />
            Selected
          </span>
        </div>
      </div>

      {/* Lines */}
      <div className="max-h-[500px] overflow-y-auto font-mono text-xs">
        {filteredLines.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400">
            {search
              ? "No lines match your search"
              : "No text extracted from PDF"}
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {filteredLines.map(({ line, originalIdx }) => {
              const isTx = isTransactionLike(line);
              const hasAmt = !isTx && hasAmountPattern(line);
              const isSelected = selectedLines.has(originalIdx);

              return (
                <div
                  key={originalIdx}
                  onClick={() => toggleLine(originalIdx)}
                  className={`flex items-start cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-[#0f3460]/10 border-l-4 border-l-[#0f3460]"
                      : isTx
                      ? "bg-green-50/60 hover:bg-green-100/60 border-l-4 border-l-transparent"
                      : hasAmt
                      ? "bg-blue-50/40 hover:bg-blue-100/40 border-l-4 border-l-transparent"
                      : "hover:bg-gray-50 border-l-4 border-l-transparent"
                  }`}
                >
                  {/* Checkbox */}
                  <span className="flex-shrink-0 w-8 flex items-center justify-center py-1.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleLine(originalIdx)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded border-gray-300 text-[#0f3460] focus:ring-[#0f3460]/30 w-3.5 h-3.5"
                    />
                  </span>
                  {showLineNumbers && (
                    <span className="flex-shrink-0 w-10 px-1 py-1.5 text-right text-gray-300 select-none border-r border-gray-100">
                      {originalIdx + 1}
                    </span>
                  )}
                  <span
                    className={`flex-1 px-3 py-1.5 whitespace-pre-wrap break-all ${
                      line.trim() === "" ? "text-gray-300" : "text-gray-700"
                    }`}
                  >
                    {line || "\u00A0"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with action */}
      <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
        <p className="text-xs text-gray-500">
          <span className="font-medium">Tip:</span> Click lines containing
          transactions, then extract them. The format will be remembered.
        </p>
        {selectedLines.size > 0 && (
          <button
            onClick={handleExtract}
            className="px-5 py-2 text-sm bg-[#0f3460] text-white rounded-lg hover:bg-[#16213e] transition-colors font-medium flex items-center gap-2"
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
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Extract {selectedLines.size} Line
            {selectedLines.size !== 1 ? "s" : ""}
          </button>
        )}
      </div>
    </div>
  );
}
