/**
 * Category normalization and deduplication for business spending categories.
 * - Display/storage: Title Case (e.g. "Office Supplies").
 * - Canonical key: lowercase, trimmed, collapsed spaces (for dedupe and lookup).
 */

/** Collapse internal spaces and trim. */
function normalizeSpaces(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * Returns a canonical key for deduplication and lookup.
 * e.g. "Office Supplies" -> "office supplies", "  MEALS  &  ENTERTAINMENT  " -> "meals & entertainment"
 */
export function getCategoryKey(category: string): string {
  return normalizeSpaces(category).toLowerCase();
}

/**
 * Returns the category label in Title Case for display and storage.
 * - First letter of each word uppercase, rest lowercase.
 * - Keeps "&" and similar as-is (e.g. "Meals & Entertainment").
 * - Handles multiple spaces and trim.
 */
export function normalizeCategoryLabel(category: string): string {
  const trimmed = normalizeSpaces(category);
  if (!trimmed) return trimmed;

  return trimmed
    .split(/\s+/)
    .map((word) => {
      if (!word.length) return word;
      const lower = word.toLowerCase();
      const first = lower.slice(0, 1).toUpperCase();
      const rest = lower.slice(1);
      return first + rest;
    })
    .join(" ");
}

/**
 * Normalize for storage: same as label (Title Case).
 * Use when saving a category or assigning to a transaction so all stored values are consistent.
 */
export function normalizeCategoryForStorage(category: string): string {
  return normalizeCategoryLabel(category);
}

/**
 * Check if two category strings refer to the same category (ignore casing/spacing).
 */
export function isSameCategory(a: string, b: string): boolean {
  return getCategoryKey(a) === getCategoryKey(b);
}
