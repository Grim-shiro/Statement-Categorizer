"use client";

import { useState, useCallback, useEffect } from "react";

export interface CustomBankPattern {
  bankId: string; // e.g., "unknown", "cibc-bank", etc.
  dateRegex: string; // regex string that matches the date portion
  amountRegex: string; // regex string that matches amount
  sampleLines: string[]; // sample lines for reference
  createdAt: number;
}

const STORAGE_KEY = "budget-categorizer-custom-patterns";

export function useCustomPatterns() {
  const [patterns, setPatterns] = useState<Record<string, CustomBankPattern>>(
    {}
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setPatterns(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  const savePattern = useCallback(
    (pattern: CustomBankPattern) => {
      const updated = { ...patterns, [pattern.bankId]: pattern };
      setPatterns(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    },
    [patterns]
  );

  const removePattern = useCallback(
    (bankId: string) => {
      const updated = { ...patterns };
      delete updated[bankId];
      setPatterns(updated);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    },
    [patterns]
  );

  return { patterns, savePattern, removePattern };
}
