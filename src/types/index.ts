export const CATEGORIES = [
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
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

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
