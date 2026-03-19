/** Default categories (read-only). Custom categories are added separately and persisted. */
export const DEFAULT_CATEGORIES = [
  "Rent",
  "Utilities",
  "Payroll",
  "Supplies",
  "Travel",
  "Meals & Entertainment",
  "Insurance",
  "Professional Services",
  "Advertising",
  "Office Expenses",
  "Telecommunications",
  "Vehicle & Fuel",
  "Bank Fees",
  "Taxes",
  "Owner Deposits",
  "Owner Draws",
  "Other",
] as const;

/** @deprecated Use DEFAULT_CATEGORIES for the default list; Category is now string to allow custom categories. */
export const CATEGORIES = DEFAULT_CATEGORIES;

/** Category is a string (default or custom). Stored and displayed in normalized Title Case. */
export type Category = string;

/** Stored custom category: key for dedupe, label for display. */
export interface CustomCategoryEntry {
  key: string;
  label: string;
}

export interface RawTransaction {
  date: string;
  description: string;
  amount: number;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: Category;
  source: string;
  merchant: string;
}

export interface CategorizedResult {
  transactions: Transaction[];
  summary: Record<string, number>;
}

export interface UploadResponse {
  transactions: RawTransaction[];
  filename: string;
}

export type MerchantMappings = Record<string, Category>;
