"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type PriceChartProps = {
  data: { label: string; buyPrice: number; sellPrice: number }[];
  commodityName: string;
};

export function PriceChart({ data, commodityName }: PriceChartProps) {
  if (!data || data.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-border p-4">
      <p className="text-xs text-muted-foreground mb-3 font-medium">
        {commodityName} Price Trend
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => v.toLocaleString()}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: number) => [
              value.toLocaleString() + " aUEC",
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: "11px" }}
          />
          {data.some((d) => d.buyPrice > 0) && (
            <Line
              type="monotone"
              dataKey="buyPrice"
              name="Buy"
              stroke="oklch(0.65 0.2 250)"
              strokeWidth={2}
              dot={false}
            />
          )}
          {data.some((d) => d.sellPrice > 0) && (
            <Line
              type="monotone"
              dataKey="sellPrice"
              name="Sell"
              stroke="oklch(0.65 0.2 150)"
              strokeWidth={2}
              dot={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
