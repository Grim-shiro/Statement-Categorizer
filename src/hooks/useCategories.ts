"use client";

import { useState, useEffect, useCallback } from "react";
import { DEFAULT_CATEGORIES } from "@/types";
import type { CustomCategoryEntry } from "@/types";
import {
  getCategoryKey,
  normalizeCategoryLabel,
  isSameCategory,
} from "@/lib/categoryUtils";

const STORAGE_KEY = "budget-categorizer-custom-categories";

function loadCustomFromStorage(): CustomCategoryEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is CustomCategoryEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as CustomCategoryEntry).key === "string" &&
        typeof (e as CustomCategoryEntry).label === "string"
    );
  } catch {
    return [];
  }
}

function saveCustomToStorage(entries: CustomCategoryEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

/**
 * Returns the full list of categories: default first, then custom (no duplicates by key).
 * All labels are in normalized Title Case.
 */
export function useCategories() {
  const [custom, setCustom] = useState<CustomCategoryEntry[]>([]);

  useEffect(() => {
    setCustom(loadCustomFromStorage());
  }, []);

  const allCategories: string[] = [
    ...DEFAULT_CATEGORIES,
    ...custom.map((e) => e.label),
  ];

  const addCategory = useCallback((rawInput: string): { success: true; label: string } | { success: false; reason: string } => {
    const label = normalizeCategoryLabel(rawInput);
    if (!label) {
      return { success: false, reason: "Category name cannot be empty." };
    }
    const key = getCategoryKey(label);

    const exists =
      custom.some((e) => e.key === key) ||
      DEFAULT_CATEGORIES.some((c) => getCategoryKey(c) === key);
    if (exists) {
      return { success: false, reason: "That category already exists." };
    }

    const next = [...custom, { key, label }];
    saveCustomToStorage(next);
    setCustom(next);
    return { success: true, label };
  }, [custom]);

  /** Resolve user input to an existing category label (by key match), or null if no match. */
  const findMatchingCategory = useCallback(
    (input: string): string | null => {
      const key = getCategoryKey(input);
      if (!key) return null;
      const fromDefault = DEFAULT_CATEGORIES.find((c) => getCategoryKey(c) === key);
      if (fromDefault) return fromDefault;
      const fromCustom = custom.find((e) => e.key === key);
      return fromCustom ? fromCustom.label : null;
    },
    [custom]
  );

  /** Whether the current user can add new categories (e.g. accountant). For MVP, true. */
  const canAddCategory = true;

  return {
    allCategories,
    defaultCategories: [...DEFAULT_CATEGORIES],
    customCategories: custom.map((e) => e.label),
    addCategory,
    findMatchingCategory,
    isSameCategory,
    canAddCategory,
  };
}
