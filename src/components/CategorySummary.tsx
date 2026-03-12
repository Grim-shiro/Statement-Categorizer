"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface CategorySummaryProps {
  summary: Record<string, number>;
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

export default function CategorySummary({ summary }: CategorySummaryProps) {
  const data = Object.entries(summary)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const total = data.reduce((sum, d) => sum + d.value, 0);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">
        Category Summary
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
                  borderRadius: "8px",
                  border: "1px solid #e5e7eb",
                  fontSize: "13px",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Category List */}
        <div className="space-y-2">
          {data.map((item, index) => {
            const percent = total > 0 ? ((item.value / total) * 100).toFixed(1) : "0";
            return (
              <div
                key={item.name}
                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: COLORS[index % COLORS.length] }}
                  />
                  <span className="text-sm text-gray-700 font-medium">
                    {item.name}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-gray-400">{percent}%</span>
                  <span className="text-sm font-mono font-semibold text-gray-900 w-24 text-right">
                    {formatCurrency(item.value)}
                  </span>
                </div>
              </div>
            );
          })}

          <div className="border-t border-gray-200 mt-3 pt-3 flex items-center justify-between px-3">
            <span className="font-semibold text-gray-800">Total</span>
            <span className="font-bold font-mono text-gray-900 text-lg">
              {formatCurrency(total)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
