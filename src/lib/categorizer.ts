import { DEFAULT_CATEGORIES, MerchantMappings, RawTransaction, Transaction } from "@/types";
import type { Category } from "@/types";
import { matchKeywordRule, normalizeMerchant } from "./categories";
import { v4 as uuidv4 } from "uuid";

const HF_API_URL =
  "https://api-inference.huggingface.co/models/facebook/bart-large-mnli";

const HF_LABELS = [
  "Rent or lease payment",
  "Utility bill like electricity water gas",
  "Payroll salary wages",
  "Office supplies shopping retail",
  "Travel flights hotels transportation",
  "Meals dining restaurant food delivery",
  "Insurance premium",
  "Professional services legal accounting consulting",
  "Advertising marketing promotion",
  "Office software subscription",
  "Phone internet telecommunications",
  "Vehicle fuel gas transportation",
  "Bank fees charges",
  "Tax payment",
  "Owner deposit capital contribution equity investment",
  "Owner draw withdrawal distribution payout",
  "Other miscellaneous",
];

const LABEL_TO_CATEGORY: Record<string, Category> = {
  "Rent or lease payment": "Rent",
  "Utility bill like electricity water gas": "Utilities",
  "Payroll salary wages": "Payroll",
  "Office supplies shopping retail": "Supplies",
  "Travel flights hotels transportation": "Travel",
  "Meals dining restaurant food delivery": "Meals & Entertainment",
  "Insurance premium": "Insurance",
  "Professional services legal accounting consulting": "Professional Services",
  "Advertising marketing promotion": "Advertising",
  "Office software subscription": "Office Expenses",
  "Phone internet telecommunications": "Telecommunications",
  "Vehicle fuel gas transportation": "Vehicle & Fuel",
  "Bank fees charges": "Bank Fees",
  "Tax payment": "Taxes",
  "Owner deposit capital contribution equity investment": "Owner Deposits",
  "Owner draw withdrawal distribution payout": "Owner Draws",
  "Other miscellaneous": "Other",
};

async function classifyWithHF(
  descriptions: string[]
): Promise<(Category | null)[]> {
  const results: (Category | null)[] = [];

  for (const desc of descriptions) {
    try {
      const response = await fetch(HF_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: desc,
          parameters: { candidate_labels: HF_LABELS },
        }),
      });

      if (!response.ok) {
        results.push(null);
        continue;
      }

      const data = await response.json();
      const topLabel = data.labels?.[0];
      results.push(topLabel ? (LABEL_TO_CATEGORY[topLabel] ?? "Other") : null);
    } catch {
      results.push(null);
    }
  }

  return results;
}

export async function categorizeTransactions(
  rawTransactions: RawTransaction[],
  source: string,
  merchantMappings: MerchantMappings
): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  const needsHF: { index: number; description: string }[] = [];

  for (let i = 0; i < rawTransactions.length; i++) {
    const raw = rawTransactions[i];
    const merchant = normalizeMerchant(raw.description);

    const tx: Transaction = {
      id: uuidv4(),
      date: raw.date,
      description: raw.description,
      amount: raw.amount,
      category: "Other",
      source,
      merchant,
    };

    // Tier 1: Check user's learned mappings
    if (merchantMappings[merchant]) {
      tx.category = merchantMappings[merchant];
    }
    // Tier 2: Check keyword rules
    else {
      const keywordMatch = matchKeywordRule(raw.description);
      if (keywordMatch) {
        tx.category = keywordMatch;
      } else {
        needsHF.push({ index: i, description: raw.description });
      }
    }

    transactions.push(tx);
  }

  // Tier 3: Use Hugging Face for remaining uncategorized
  if (needsHF.length > 0) {
    const descriptions = needsHF.map((item) => item.description);
    const hfResults = await classifyWithHF(descriptions);

    for (let j = 0; j < needsHF.length; j++) {
      if (hfResults[j]) {
        transactions[needsHF[j].index].category = hfResults[j]!;
      }
    }
  }

  return transactions;
}

export function computeSummary(
  transactions: Transaction[]
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const tx of transactions) {
    summary[tx.category] = (summary[tx.category] ?? 0) + Math.abs(tx.amount);
  }
  return summary;
}
