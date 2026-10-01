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
import { formatReportTimestamp } from "@/lib/data-freshness";
import type { PriceChartData } from "@/lib/types";

type PriceChartProps = Omit<PriceChartData, "type">;

export function PriceChart({ data, commodityName, terminalName, gameVersion }: PriceChartProps) {
  if (!data || data.length === 0) return null;
  const dated = data
    .filter((point) => typeof point.timestamp === "number" && Number.isFinite(point.timestamp))
    .map((point) => ({
      ...point,
      buyPrice: point.buyPrice !== null && point.buyPrice > 0 ? point.buyPrice : null,
      sellPrice: point.sellPrice !== null && point.sellPrice > 0 ? point.sellPrice : null,
    }))
    .sort((left, right) => left.timestamp! - right.timestamp!);
  if (dated.length === 0) {
    return <p className="mt-3 text-xs text-muted-foreground">This saved chart has no dated reports. Ask for price history at a terminal to load a timeline.</p>;
  }

  return (
    <div className="mt-3 rounded-lg border border-border p-4">
      <p className="text-xs text-muted-foreground mb-3 font-medium">
        {commodityName} Price Reports{terminalName ? ` · ${terminalName}` : ""}{gameVersion ? ` · ${gameVersion}` : ""}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={dated} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) => new Date(value).toISOString().slice(5, 16).replace("T", " ")}
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
            formatter={(value) => `${value?.toLocaleString() ?? "—"} aUEC`}
            labelFormatter={(value) => formatReportTimestamp(value)}
          />
          <Legend
            wrapperStyle={{ fontSize: "11px" }}
          />
          {dated.some((d) => d.buyPrice !== null) && (
            <Line
              type="linear"
              dataKey="buyPrice"
              name="Buy"
              stroke="oklch(0.65 0.2 250)"
              strokeWidth={2}
              dot={{ r: dated.length > 100 ? 1.5 : 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
          {dated.some((d) => d.sellPrice !== null) && (
            <Line
              type="linear"
              dataKey="sellPrice"
              name="Sell"
              stroke="oklch(0.65 0.2 150)"
              strokeWidth={2}
              dot={{ r: dated.length > 100 ? 1.5 : 3 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[11px] text-muted-foreground">
        UTC · Each point is a report. {dated.length === 1 ? "One report cannot establish a trend." : "Prices between reports are unknown; gaps indicate no quote."}
      </p>
    </div>
  );
}
