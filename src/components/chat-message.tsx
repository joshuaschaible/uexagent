"use client";

import { useState, useMemo } from "react";
import { Copy, Check, RotateCw, Download, ArrowUpDown, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PriceChart } from "@/components/price-chart";
import { ProfitDisplay } from "@/components/profit-display";
import { SystemMap } from "@/components/system-map";
import type { ProfitData, NamedTable } from "@/lib/types";

type ChatMessageProps = {
  role: "user" | "bot";
  text: string;
  table?: {
    headers: string[];
    rows: string[][];
  };
  chart?: {
    type: "line";
    data: { label: string; buyPrice: number; sellPrice: number }[];
    commodityName: string;
  };
  map?: {
    system: string;
    routes: { from: string; to: string; profit: number; commodity: string }[];
    highlights: string[];
  };
  profit?: ProfitData;
  tables?: NamedTable[];
  isError?: boolean;
  isLLM?: boolean;
  isStreaming?: boolean;
  retryText?: string;
  onRetry?: (text: string) => void;
};

function downloadCsv(headers: string[], rows: string[][], filename: string) {
  const csvContent = [
    headers.join(","),
    ...rows.map((r) => r.map((c) => `"${c.replace(/\{\{uex:[^}]+\}\}/g, "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function SortableTable({
  headers,
  rows,
  title,
}: {
  headers: string[];
  rows: string[][];
  title?: string;
}) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const sortedRows = useMemo(() => {
    if (sortCol === null) return rows;
    return [...rows].sort((a, b) => {
      const aVal = a[sortCol] || "";
      const bVal = b[sortCol] || "";
      // Try numeric sort (strip formatting like commas, +, aUEC, SCU, %)
      const aNum = parseFloat(aVal.replace(/[^0-9.\-]/g, ""));
      const bNum = parseFloat(bVal.replace(/[^0-9.\-]/g, ""));
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortAsc ? aNum - bNum : bNum - aNum;
      }
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
  }, [rows, sortCol, sortAsc]);

  function handleSort(colIndex: number) {
    if (sortCol === colIndex) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(colIndex);
      setSortAsc(true);
    }
  }

  return (
    <div className="mt-3">
      {title && (
        <div className="flex items-center justify-between mb-1.5 px-1">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {title}
          </div>
          <button
            onClick={() => downloadCsv(headers, rows, title.replace(/[^a-zA-Z0-9]/g, "_"))}
            className="p-1 rounded hover:bg-muted transition-colors cursor-pointer"
            title="Download CSV"
          >
            <Download className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50">
              {headers.map((h, i) => (
                <th
                  key={i}
                  onClick={() => handleSort(i)}
                  className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-foreground transition-colors select-none"
                >
                  <span className="inline-flex items-center gap-1">
                    {h}
                    <ArrowUpDown className={`h-3 w-3 ${sortCol === i ? "text-foreground" : "opacity-30"}`} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr
                key={i}
                className="border-t border-border/50 hover:bg-muted/30 transition-colors"
              >
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 whitespace-nowrap">
                    {renderInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ChatMessage({
  role,
  text,
  table,
  chart,
  map,
  profit,
  tables,
  isError,
  isLLM,
  isStreaming,
  retryText,
  onRetry,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = role === "user";

  async function handleCopy() {
    let content = text;
    if (table) {
      const tsv = [
        table.headers.join("\t"),
        ...table.rows.map((r) => r.join("\t")),
      ].join("\n");
      content += "\n\n" + tsv;
    }
    if (tables) {
      for (const t of tables) {
        const tsv = [
          t.headers.join("\t"),
          ...t.rows.map((r) => r.join("\t")),
        ].join("\n");
        content += `\n\n${t.title}\n${tsv}`;
      }
    }
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard not available
    }
  }

  function handleDownloadAll() {
    if (table) {
      downloadCsv(table.headers, table.rows, "trade_data");
    }
    if (tables) {
      for (const t of tables) {
        downloadCsv(t.headers, t.rows, t.title.replace(/[^a-zA-Z0-9]/g, "_"));
      }
    }
  }

  if (isUser) {
    return (
      <div className="flex justify-end py-3">
        <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-3 py-1.5">
          <p className="text-sm leading-relaxed">{text}</p>
        </div>
      </div>
    );
  }

  const hasTableData = !!(table || (tables && tables.length > 0));

  return (
    <div className="group flex gap-3 py-4 animate-in fade-in duration-300">
      {/* Bot avatar hidden */}
      <div className="flex-1 min-w-0">
        <div className="text-sm leading-relaxed text-foreground">
          {renderMarkdown(text)}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>

        {/* Price Chart */}
        {chart && (
          <PriceChart data={chart.data} commodityName={chart.commodityName} />
        )}

        {/* Profit Calculator */}
        {profit && (
          <ProfitDisplay
            shipName={profit.shipName}
            commodityName={profit.commodityName}
            scu={profit.scu}
            buyPrice={profit.buyPrice}
            sellPrice={profit.sellPrice}
            buyTerminal={profit.buyTerminal}
            sellTerminal={profit.sellTerminal}
          />
        )}

        {/* System Map */}
        {map && (
          <SystemMap
            system={map.system}
            routes={map.routes}
            highlights={map.highlights}
          />
        )}

        {/* Data Table (sortable) */}
        {table && (
          <SortableTable headers={table.headers} rows={table.rows} />
        )}

        {/* Multiple Named Tables (sortable) */}
        {tables && tables.map((t, ti) => (
          <SortableTable key={ti} headers={t.headers} rows={t.rows} title={t.title} />
        ))}

        {/* Action buttons */}
        <div className="flex items-center gap-1 mt-2">
          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all cursor-pointer"
            title="Copy response"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>

          {/* Download CSV button */}
          {hasTableData && (
            <button
              onClick={handleDownloadAll}
              className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all cursor-pointer"
              title="Download as CSV"
            >
              <Download className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}

          {/* Retry button */}
          {isError && retryText && onRetry && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() => onRetry(retryText)}
            >
              <RotateCw className="h-3 w-3" />
              Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Bullet list items
    if (line.match(/^[-*]\s/)) {
      elements.push(
        <div key={i} className="flex gap-2 ml-1">
          <span className="text-muted-foreground select-none">&#8226;</span>
          <span>{renderInline(line.replace(/^[-*]\s/, ""))}</span>
        </div>
      );
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
      continue;
    }

    // Regular line
    elements.push(<div key={i}>{renderInline(line)}</div>);
  }

  return elements;
}

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\{\{uex:[^}]+\}\}|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("{{uex:") && part.endsWith("}}")) {
      const slug = part.slice(6, -2);
      return (
        <a
          key={i}
          href={`https://uexcorp.space/commodities/info/name/${slug}/`}
          target="_blank"
          rel="noopener noreferrer"
          title="View on UEX"
          className="inline-flex items-center ml-1 text-muted-foreground hover:text-foreground"
        >
          <ArrowUpRight className="h-3 w-3" />
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
