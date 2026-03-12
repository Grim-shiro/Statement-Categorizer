"use client";

import { useState } from "react";
import { Transaction, Category, CATEGORIES } from "@/types";

interface TransactionsTableProps {
  transactions: Transaction[];
  onCategoryChange: (id: string, category: Category, merchant: string) => void;
}

type SortField = "date" | "description" | "amount" | "category";
type SortDir = "asc" | "desc";

export default function TransactionsTable({
  transactions,
  onCategoryChange,
}: TransactionsTableProps) {
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
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
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-800">
          Transactions ({transactions.length})
        </h2>
        <input
          type="text"
          placeholder="Filter by description or category..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-lg text-sm w-72 focus:outline-none focus:ring-2 focus:ring-[#0f3460] focus:border-transparent"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th
                className="px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 whitespace-nowrap"
                onClick={() => handleSort("date")}
              >
                Date <SortIcon field="date" />
              </th>
              <th
                className="px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
                onClick={() => handleSort("description")}
              >
                Description <SortIcon field="description" />
              </th>
              <th
                className="px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-gray-900 text-right whitespace-nowrap"
                onClick={() => handleSort("amount")}
              >
                Amount <SortIcon field="amount" />
              </th>
              <th
                className="px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
                onClick={() => handleSort("category")}
              >
                Category <SortIcon field="category" />
              </th>
              <th className="px-4 py-3 font-semibold text-gray-600">Source</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((tx, i) => (
              <tr
                key={tx.id}
                className={`border-t border-gray-100 hover:bg-blue-50/50 transition-colors ${
                  i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                }`}
              >
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                  {tx.date}
                </td>
                <td className="px-4 py-3 text-gray-900 font-medium max-w-xs truncate">
                  {tx.description}
                </td>
                <td
                  className={`px-4 py-3 text-right font-mono whitespace-nowrap ${
                    tx.amount < 0 ? "text-red-600" : "text-green-600"
                  }`}
                >
                  {formatAmount(tx.amount)}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={tx.category}
                    onChange={(e) =>
                      onCategoryChange(
                        tx.id,
                        e.target.value as Category,
                        tx.merchant
                      )
                    }
                    className="w-full px-2 py-1 border border-gray-200 rounded text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0f3460] focus:border-transparent"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs truncate max-w-[150px]">
                  {tx.source}
                </td>
              </tr>
            ))}
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
    </div>
  );
}
