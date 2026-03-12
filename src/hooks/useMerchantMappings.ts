"use client";

import { useState, useEffect, useCallback } from "react";
import { Category, MerchantMappings } from "@/types";

const STORAGE_KEY = "budget-categorizer-merchant-mappings";

export function useMerchantMappings() {
  const [mappings, setMappings] = useState<MerchantMappings>({});

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setMappings(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  const saveMapping = useCallback(
    (merchant: string, category: Category) => {
      setMappings((prev) => {
        const next = { ...prev, [merchant]: category };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const removeMapping = useCallback((merchant: string) => {
    setMappings((prev) => {
      const next = { ...prev };
      delete next[merchant];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearMappings = useCallback(() => {
    setMappings({});
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { mappings, saveMapping, removeMapping, clearMappings };
}
