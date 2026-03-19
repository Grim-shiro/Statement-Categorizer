"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Transaction,
  RawTransaction,
  Category,
  MerchantMappings,
} from "@/types";
import { computeSummary } from "@/lib/categorizer";
import { maskSensitiveData } from "@/lib/maskSensitive";
import { isTotalOrSummaryDescription } from "@/lib/totalSummaryFilter";
import {
  generateEncryptionKey,
  exportKey,
  decrypt,
  encrypt,
} from "@/lib/encryption";

export type AppState =
  | "idle"
  | "uploading"
  | "categorizing"
  | "done"
  | "error";

export interface PDFVisualizerData {
  rawLines: string[];
  bankDetected: string;
  pdfBase64?: string; // Original PDF for rendering pages as images
}

// Try to parse lines using a saved custom pattern from localStorage
function tryCustomPatternParse(
  lines: string[],
  bankId: string
): RawTransaction[] {
  try {
    const stored = localStorage.getItem("budget-categorizer-custom-patterns");
    if (!stored) return [];

    const patterns = JSON.parse(stored);
    const pattern = patterns[bankId];
    if (!pattern || !pattern.dateRegex || !pattern.amountRegex) return [];

    const dateRe = new RegExp(pattern.dateRegex, "i");
    const amountRe = new RegExp(pattern.amountRegex);
    const txns: RawTransaction[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const dateMatch = trimmed.match(dateRe);
      const amountMatch = trimmed.match(amountRe);
      if (!dateMatch || !amountMatch) continue;

      const amount = parseFloat(amountMatch[0].replace(/[$,]/g, ""));
      if (isNaN(amount) || amount === 0) continue;

      const dateEnd = (dateMatch.index || 0) + dateMatch[0].length;
      const amountPos = trimmed.indexOf(amountMatch[0]);
      let description: string;
      if (amountPos > dateEnd) {
        description = trimmed.substring(dateEnd, amountPos).trim();
      } else {
        description = trimmed
          .substring(dateEnd)
          .replace(new RegExp(pattern.amountRegex), "")
          .trim();
      }
      description = description.replace(/^[\s\-–—]+|[\s\-–—]+$/g, "").trim();

      const signedAmount = amountMatch[0].startsWith("-") ? -amount : amount;

      txns.push({
        date: dateMatch[0],
        description: maskSensitiveData(description || trimmed),
        amount: signedAmount,
      });
    }

    return txns;
  } catch {
    return [];
  }
}

export function useTransactions() {
  const [rawTransactions, setRawTransactions] = useState<
    { transactions: RawTransaction[]; source: string }[]
  >([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [pdfVisualizerData, setPdfVisualizerData] = useState<PDFVisualizerData | null>(null);
  const [appState, setAppState] = useState<AppState>("idle");
  const [error, setError] = useState<string | null>(null);

  // Per-session E2E encryption key
  const encryptionKey = useRef<CryptoKey | null>(null);
  const exportedKey = useRef<string | null>(null);

  useEffect(() => {
    generateEncryptionKey().then(async (key) => {
      encryptionKey.current = key;
      exportedKey.current = await exportKey(key);
    });
  }, []);

  const getEncHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (exportedKey.current) {
      headers["X-Encryption-Key"] = exportedKey.current;
    }
    return headers;
  };

  // Decrypt server response if it's E2E encrypted
  const decryptResponse = async (
    data: { encrypted?: string; e2e?: boolean; error?: string; [key: string]: unknown }
  ) => {
    if (data.e2e && data.encrypted && encryptionKey.current) {
      const decrypted = await decrypt(encryptionKey.current, data.encrypted);
      return JSON.parse(decrypted);
    }
    return data;
  };

  const uploadFile = useCallback(async (file: File) => {
    setAppState("uploading");
    setError(null);

    try {
      let res: Response;

      if (encryptionKey.current && exportedKey.current) {
        // E2E encrypted upload: convert file to base64, encrypt, send as JSON
        const arrayBuffer = await file.arrayBuffer();
        // Convert to base64 in chunks to avoid call-stack overflow on large files
        const bytes = new Uint8Array(arrayBuffer);
        const CHUNK = 8192;
        let binary = "";
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const base64 = btoa(binary);
        const payload = JSON.stringify({
          filename: file.name,
          fileBase64: base64,
        });
        const encryptedPayload = await encrypt(
          encryptionKey.current,
          payload
        );
        res = await fetch("/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Encryption-Key": exportedKey.current,
          },
          body: JSON.stringify({ encrypted: encryptedPayload }),
        });
      } else {
        // Fallback: plain FormData upload
        const formData = new FormData();
        formData.append("file", file);
        res = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
      }

      const rawData = await res.json();

      if (!res.ok) {
        throw new Error(rawData.error || "Upload failed");
      }

      const data = await decryptResponse(rawData);

      // If no transactions found, try saved custom patterns first
      if (data.needsManualSelection && data.rawLines) {
        const bankId = data.bankDetected || "unknown";
        const autoTxns = tryCustomPatternParse(data.rawLines, bankId);

        if (autoTxns.length > 0) {
          // Custom pattern matched — use the extracted transactions
          setRawTransactions((prev) => [
            ...prev,
            {
              transactions: autoTxns,
              source: `${bankId.toUpperCase()} Statement (${autoTxns.length} transactions)`,
            },
          ]);
          setPdfVisualizerData(null);
          setAppState("idle");
          return { ...data, transactions: autoTxns };
        }

        // No saved pattern or pattern didn't match — show visualizer
        setPdfVisualizerData({
          rawLines: data.rawLines,
          bankDetected: bankId,
          pdfBase64: data.pdfBase64,
        });
        setAppState("idle");
        return data;
      }

      setRawTransactions((prev) => [
        ...prev,
        { transactions: data.transactions, source: data.filename },
      ]);
      setPdfVisualizerData(null);
      setAppState("idle");
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
      setAppState("error");
      throw err;
    }
  }, []);

  const categorize = useCallback(
    async (merchantMappings: MerchantMappings) => {
      if (rawTransactions.length === 0) return;

      setAppState("categorizing");
      setError(null);

      try {
        const allCategorized: Transaction[] = [];

        for (const batch of rawTransactions) {
          const payload = {
            transactions: batch.transactions,
            source: batch.source,
            merchantMappings,
          };

          // Encrypt the request body if we have a key
          let body: string;
          if (encryptionKey.current && exportedKey.current) {
            const encryptedPayload = await encrypt(
              encryptionKey.current,
              JSON.stringify(payload)
            );
            body = JSON.stringify({ encrypted: encryptedPayload });
          } else {
            body = JSON.stringify(payload);
          }

          const res = await fetch("/api/categorize", {
            method: "POST",
            headers: getEncHeaders(),
            body,
          });

          const rawData = await res.json();
          if (!res.ok)
            throw new Error(rawData.error || "Categorization failed");

          const data = await decryptResponse(rawData);
          allCategorized.push(...data.transactions);
        }

        const displayOnly = allCategorized.filter(
          (tx) => !isTotalOrSummaryDescription(tx.description)
        );
        setTransactions(displayOnly);
        setSummary(computeSummary(displayOnly));
        setRawTransactions([]); // Clear raw data so categorize can't be pressed again
        setAppState("done");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Categorization failed";
        setError(message);
        setAppState("error");
      }
    },
    [rawTransactions]
  );

  const updateCategory = useCallback(
    (id: string, newCategory: Category) => {
      setTransactions((prev) => {
        const updated = prev.map((tx) =>
          tx.id === id ? { ...tx, category: newCategory } : tx
        );
        setSummary(computeSummary(updated));
        return updated;
      });
    },
    []
  );

  const exportToExcel = useCallback(async () => {
    if (transactions.length === 0 || !summary) return;

    try {
      const payload = { transactions, summary };

      // Encrypt the export request body
      let body: string;
      if (encryptionKey.current && exportedKey.current) {
        const encryptedPayload = await encrypt(
          encryptionKey.current,
          JSON.stringify(payload)
        );
        body = JSON.stringify({ encrypted: encryptedPayload });
      } else {
        body = JSON.stringify(payload);
      }

      const res = await fetch("/api/export", {
        method: "POST",
        headers: getEncHeaders(),
        body,
      });

      if (!res.ok) throw new Error("Export failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "categorized-transactions.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      setError(message);
    }
  }, [transactions, summary]);

  const dismissVisualizer = useCallback(() => {
    setPdfVisualizerData(null);
  }, []);

  const addManualTransactions = useCallback(
    (txns: RawTransaction[], bankId: string) => {
      if (txns.length === 0) return;
      setRawTransactions((prev) => [
        ...prev,
        {
          transactions: txns,
          source: `${bankId.toUpperCase()} Statement (${txns.length} manual)`,
        },
      ]);
      setPdfVisualizerData(null);
    },
    []
  );

  const clearAll = useCallback(() => {
    setRawTransactions([]);
    setTransactions([]);
    setSummary(null);
    setPdfVisualizerData(null);
    setAppState("idle");
    setError(null);
  }, []);

  return {
    rawTransactions,
    transactions,
    summary,
    appState,
    error,
    pdfVisualizerData,
    uploadFile,
    categorize,
    updateCategory,
    exportToExcel,
    clearAll,
    dismissVisualizer,
    addManualTransactions,
    hasRawData: rawTransactions.length > 0,
  };
}
