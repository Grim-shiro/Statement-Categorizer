"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Transaction, Category } from "@/types";
import CategorySelect from "./CategorySelect";

interface TransactionsTableProps {
  transactions: Transaction[];
  onCategoryChange: (id: string, category: Category, merchant: string) => void;
  allCategories: string[];
  onAddCategory: (rawInput: string) => { success: true; label: string } | { success: false; reason: string };
  canAddCategory: boolean;
}

type SortField = "date" | "description" | "amount" | "category";
type SortDir = "asc" | "desc";

export default function TransactionsTable({
  transactions,
  onCategoryChange,
  allCategories,
  onAddCategory,
  canAddCategory,
}: TransactionsTableProps) {
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState("");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filtered = transactions.filter(
    (tx) =>
      !filter ||
      tx.description.toLowerCase().includes(filter.toLowerCase()) ||
      tx.category.toLowerCase().includes(filter.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    const mul = sortDir === "asc" ? 1 : -1;
    switch (sortField) {
      case "date":
        return mul * a.date.localeCompare(b.date);
      case "description":
        return mul * a.description.localeCompare(b.description);
      case "amount":
        return mul * (a.amount - b.amount);
      case "category":
        return mul * a.category.localeCompare(b.category);
      default:
        return 0;
    }
  });

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field)
      return <span className="text-gray-300 ml-1">&#8597;</span>;
    return (
      <span className="text-[#e94560] ml-1">
        {sortDir === "asc" ? "\u25B2" : "\u25BC"}
      </span>
    );
  };

  const formatAmount = (amount: number) => {
    const abs = Math.abs(amount);
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(abs);
    return amount < 0 ? `-${formatted}` : formatted;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">
          Transactions{" "}
          {filter && filtered.length !== transactions.length
            ? `(${filtered.length} of ${transactions.length})`
            : `(${transactions.length})`}
        </h2>
        <div className="relative">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Filter by description or category..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-200 rounded-xl text-sm w-72 focus:outline-none focus:ring-2 focus:ring-[#0f3460]/30 focus:border-[#0f3460]/40 bg-white/80 backdrop-blur-sm transition-all"
          />
        </div>
      </div>

      <div className="glass-card overflow-x-auto rounded-2xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-gray-50/80 to-gray-100/80 text-left border-b border-gray-200/60">
              <th
                className="px-4 py-3.5 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 whitespace-nowrap transition-colors"
                onClick={() => handleSort("date")}
              >
                Date <SortIcon field="date" />
              </th>
              <th
                className="px-4 py-3.5 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 transition-colors"
                onClick={() => handleSort("description")}
              >
                Description <SortIcon field="description" />
              </th>
              <th
                className="px-4 py-3.5 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 text-right whitespace-nowrap transition-colors"
                onClick={() => handleSort("amount")}
              >
                Amount <SortIcon field="amount" />
              </th>
              <th
                className="px-4 py-3.5 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 transition-colors"
                onClick={() => handleSort("category")}
              >
                Category <SortIcon field="category" />
              </th>
              <th className="px-4 py-3.5 font-semibold text-gray-600">Source</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence mode="popLayout">
              {sorted.map((tx, i) => (
                <motion.tr
                  key={tx.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.5) }}
                  className={`border-t border-gray-100/60 hover:bg-[#0f3460]/[0.03] transition-colors ${
                    i % 2 === 0 ? "bg-white/60" : "bg-gray-50/40"
                  }`}
                >
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap min-w-[100px]">
                    {tx.date}
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium max-w-xs truncate">
                    {tx.description}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono whitespace-nowrap font-semibold ${
                      tx.amount < 0 ? "text-red-500" : "text-emerald-600"
                    }`}
                  >
                    {formatAmount(tx.amount)}
                  </td>
                  <td className="px-4 py-3 min-w-[160px]">
                    <CategorySelect
                      value={tx.category}
                      allCategories={allCategories}
                      onChange={(category) =>
                        onCategoryChange(tx.id, category, tx.merchant)
                      }
                      onAddCategory={onAddCategory}
                      canAddCategory={canAddCategory}
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[180px]" title={tx.source}>
                    {tx.source}
                  </td>
                </motion.tr>
              ))}
            </AnimatePresence>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-gray-400"
                >
                  {filter
                    ? "No transactions match your filter"
                    : "No transactions yet"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
