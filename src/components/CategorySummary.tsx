"use client";

import { motion } from "framer-motion";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { Transaction } from "@/types";

interface CategorySummaryProps {
  summary: Record<string, number>;
  transactions: Transaction[];
}

const COLORS = [
  "#0f3460",
  "#e94560",
  "#16213e",
  "#533483",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
  "#06b6d4",
];

export default function CategorySummary({ summary, transactions }: CategorySummaryProps) {
  const data = Object.entries(summary)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const totalIncome = transactions
    .filter((tx) => tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalOutgoing = transactions
    .filter((tx) => tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
  const netTotal = totalIncome - totalOutgoing;

  const barData = [
    { name: "Income", value: totalIncome, fill: "#10b981" },
    { name: "Expenses", value: totalOutgoing, fill: "#ef4444" },
  ];

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);

  return (
    <div className="space-y-6">
      {/* Income vs Expenses Bar Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="glass-card rounded-2xl p-6"
      >
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <div className="w-1.5 h-6 bg-gradient-to-b from-emerald-500 to-red-500 rounded-full" />
          Income vs Expenses
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} layout="vertical" barSize={36}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb80" />
                <XAxis
                  type="number"
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("en-US", {
                      style: "currency",
                      currency: "USD",
                      notation: "compact",
                    }).format(v)
                  }
                  fontSize={12}
                />
                <YAxis type="category" dataKey="name" width={80} fontSize={13} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #e5e7eb",
                    fontSize: "13px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                />
                <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-col justify-center space-y-3">
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="flex items-center justify-between py-2.5 px-4 bg-gradient-to-r from-emerald-50 to-emerald-50/50 rounded-xl border border-emerald-100/60"
            >
              <span className="text-sm font-medium text-emerald-700">Total Income</span>
              <span className="font-mono font-semibold text-emerald-700">
                {formatCurrency(totalIncome)}
              </span>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="flex items-center justify-between py-2.5 px-4 bg-gradient-to-r from-red-50 to-red-50/50 rounded-xl border border-red-100/60"
            >
              <span className="text-sm font-medium text-red-700">Total Expenses</span>
              <span className="font-mono font-semibold text-red-700">
                {formatCurrency(totalOutgoing)}
              </span>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.5 }}
              className={`flex items-center justify-between py-3.5 px-4 rounded-xl border-2 ${
              netTotal >= 0
                ? "bg-gradient-to-r from-emerald-50 to-emerald-50/30 border-emerald-200"
                : "bg-gradient-to-r from-red-50 to-red-50/30 border-red-200"
            }`}>
              <span className="font-semibold text-gray-800">Net Total</span>
              <span className={`font-bold font-mono text-lg ${
                netTotal >= 0 ? "text-emerald-700" : "text-red-700"
              }`}>
                {netTotal >= 0 ? "" : "-"}{formatCurrency(Math.abs(netTotal))}
              </span>
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* Category Breakdown */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="glass-card rounded-2xl p-6"
      >
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <div className="w-1.5 h-6 bg-gradient-to-b from-[#0f3460] to-[#e94560] rounded-full" />
          Category Breakdown
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pie Chart */}
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={120}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {data.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{
                    borderRadius: "12px",
                    border: "1px solid #e5e7eb",
                    fontSize: "13px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Category List */}
          <div className="space-y-1.5">
            {data.map((item, index) => {
              const expenseTotal = totalOutgoing > 0 ? totalOutgoing : 1;
              const percent = ((item.value / expenseTotal) * 100).toFixed(1);
              return (
                <motion.div
                  key={item.name}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.04 }}
                  className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-gray-50/80 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0 shadow-sm"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    />
                    <span className="text-sm text-gray-700 font-medium">
                      {item.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{percent}%</span>
                    <span className="text-sm font-mono font-semibold text-gray-900 w-24 text-right">
                      {formatCurrency(item.value)}
                    </span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
