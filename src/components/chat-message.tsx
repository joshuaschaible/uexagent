"use client";

import { useState, useMemo } from "react";
import { Copy, Check, RotateCw, Download, ArrowUpDown, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PriceChart } from "@/components/price-chart";
import { safeImageUrl, tableToCsv, tableToTsv } from "@/lib/browser-output";
import { isProgressionTable, progressionOptions, type ProgressionStep } from "@/lib/progression-display";
import type { NamedTable, PriceChartData } from "@/lib/types";

type ChatMessageProps = {
  role: "user" | "bot";
  text: string;
  table?: {
    headers: string[];
    rows: string[][];
  };
  chart?: PriceChartData;
  image?: {
    url: string;
    alt: string;
    caption?: string;
  };
  tables?: NamedTable[];
  isError?: boolean;
  isLLM?: boolean;
  isStreaming?: boolean;
  retryText?: string;
  onRetry?: (text: string) => void;
};

function downloadCsv(headers: string[], rows: string[][], filename: string) {
  const csvContent = tableToCsv(headers, rows);
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
  const [expanded, setExpanded] = useState(false);
  const isLongTable = rows.length > 6;

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
                  aria-sort={sortCol === i ? (sortAsc ? "ascending" : "descending") : "none"}
                  className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider whitespace-nowrap"
                >
                  <button type="button" onClick={() => handleSort(i)} className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring rounded">
                    {h}
                    <ArrowUpDown className={`h-3 w-3 ${sortCol === i ? "text-foreground" : "opacity-30"}`} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(isLongTable && !expanded ? sortedRows.slice(0, 3) : sortedRows).map((row, i) => (
              <tr
                key={i}
                className="border-t border-border/50 hover:bg-muted/30 transition-colors"
              >
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 align-top whitespace-pre-wrap min-w-24 max-w-sm break-words">
                    {cell.length > 240 ? (
                      <details>
                        <summary className="cursor-pointer text-xs font-medium rounded focus-visible:outline-2 focus-visible:outline-ring">Show details</summary>
                        <div className="mt-2">{renderInline(cell)}</div>
                      </details>
                    ) : renderInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isLongTable && (
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-xs font-medium text-foreground underline underline-offset-4 cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring">
          {expanded ? "Show fewer rows" : `Show all ${rows.length} rows`}
        </button>
      )}
    </div>
  );
}

function MissionCard({ step, number }: { step: ProgressionStep; number?: number }) {
  const stopped = /stops here|not loaded|not expanded|not reported/i.test(step.instruction);
  return <div className="rounded-xl border border-border bg-muted/20 p-3">
    <div className="flex items-start gap-3">
      {number !== undefined && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-xs font-semibold">{number}</span>}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold break-words">{renderInline(step.name)}</div>
        <div className="mt-1 text-sm text-foreground">{step.standing === "Not reported" ? "Standing not reported" : step.standing}</div>
        {stopped && <p className="mt-2 text-sm font-medium">{step.instruction}</p>}
        {!step.groups.length && !stopped && <p className="mt-1 text-xs text-muted-foreground">{step.instruction}</p>}
      </div>
    </div>
  </div>;
}

function MissionBranch({ step }: { step: ProgressionStep }) {
  return <div className="space-y-3">
    {step.groups.map((group, index) => <div key={group.path} className="border-l-2 border-border pl-3 space-y-2">
      <p className="text-sm font-medium">Prerequisite group {index + 1}</p>
      <p className="text-xs text-muted-foreground">{group.requirement}</p>
      {group.choices.length ? group.choices.map((child, choice) => <details key={child.path} open={group.choices.length === 1} className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring rounded">Choice {choice + 1}: {child.name.replace(/\{\{wiki:[^}]+\}\}/g, "")}</summary>
        <div className="mt-3"><MissionBranch step={child} /></div>
      </details>) : <p className="text-sm">No linked mission to expand this requirement.</p>}
    </div>)}
    {step.groups.length > 0 && <p className="text-xs text-muted-foreground">Then, after meeting the reported requirements:</p>}
    <MissionCard step={step} />
  </div>;
}

function MissionPath({ rows, title }: { rows: string[][]; title?: string }) {
  const options = useMemo(() => progressionOptions(rows), [rows]);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? options : options.slice(0, 3);
  return <section aria-label="Mission progression" className="mt-4 space-y-3">
    <h3 className="text-sm font-semibold">{title || "Mission path"}</h3>
    {options.length > 1 && <p className="text-xs text-muted-foreground">Choose an option below. These are alternative paths, not one combined checklist.</p>}
    {visible.map((option, index) => {
      const content = <>
        {option.linear ? <ol className="space-y-0">{option.steps.map((step, i) => <li key={step.path}>
          {i > 0 && <div aria-hidden="true" className="ml-6 h-5 border-l border-border" />}
          <MissionCard step={step} number={i + 1} />
        </li>)}</ol> : option.root ? <MissionBranch step={option.root} /> : <p className="text-sm">This option is incomplete. Review the reported details below.</p>}
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring">Requirements, sources and patch details</summary>
          <ul className="mt-2 space-y-2">{option.rows.map((row, i) => <li key={i} className="break-words"><span className="font-medium">{row[0]} · {renderInline(row[1])}</span><br />{row[3]} · Patch: {row[4]}</li>)}</ul>
        </details>
      </>;
      return options.length === 1 ? <div key={option.label}>{content}</div> : <details key={option.label} open={index === 0} className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium rounded focus-visible:outline-2 focus-visible:outline-ring">{option.label}: {option.root?.name.replace(/\{\{wiki:[^}]+\}\}/g, "") || "Unresolved mission"}</summary>
        <div className="mt-3">{content}</div>
      </details>;
    })}
    {options.length > 3 && <button type="button" aria-expanded={showAll} onClick={() => setShowAll(!showAll)} className="text-sm underline underline-offset-4 cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring">{showAll ? "Show fewer options" : `Show all ${options.length} options`}</button>}
  </section>;
}

function ResponseData({ headers, rows, title }: { headers: string[]; rows: string[][]; title?: string }) {
  return isProgressionTable(headers) ? <MissionPath rows={rows} title={title} /> : <SortableTable headers={headers} rows={rows} title={title} />;
}

export function ChatMessage({
  role,
  text,
  table,
  chart,
  image,
  tables,
  isError,
  isStreaming,
  retryText,
  onRetry,
}: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = role === "user";
  const imageUrl = image ? safeImageUrl(image.url) : null;

  async function handleCopy() {
    let content = text;
    if (table) {
      const tsv = tableToTsv(table.headers, table.rows);
      content += "\n\n" + tsv;
    }
    if (tables) {
      for (const t of tables) {
        const tsv = tableToTsv(t.headers, t.rows);
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
      <div className="flex justify-end py-2">
        <div className="max-w-[80%] rounded-2xl bg-primary text-primary-foreground px-3 py-1.5">
          <p className="text-sm leading-relaxed">{text}</p>
        </div>
      </div>
    );
  }

  const hasTableData = !!(table || (tables && tables.length > 0));

  return (
    <div className="group flex gap-3 py-2 animate-in fade-in duration-300">
      {/* Bot avatar hidden */}
      <div className="flex-1 min-w-0">
        <div className="text-sm leading-relaxed text-foreground">
          {renderMarkdown(text)}
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>

        {/* Ship/Location Image */}
        {image && imageUrl && (
          <div className="mt-3 rounded-lg overflow-hidden border border-border max-w-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={image.alt}
              className="w-full h-auto object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            {image.caption && (
              <div className="px-3 py-1.5 text-xs text-muted-foreground bg-muted/30">
                {image.caption}
              </div>
            )}
          </div>
        )}

        {/* Price Chart */}
        {chart && (
          <PriceChart data={chart.data} commodityName={chart.commodityName} terminalName={chart.terminalName} gameVersion={chart.gameVersion} />
        )}

        {/* Data Table (sortable) */}
        {table && (
          <ResponseData headers={table.headers} rows={table.rows} />
        )}

        {/* Multiple Named Tables (sortable) */}
        {tables && tables.map((t, ti) => ti === 0 ? (
          <ResponseData key={ti} headers={t.headers} rows={t.rows} title={t.title} />
        ) : (
          <details key={ti} className="mt-3 rounded-lg border border-border px-3 py-2">
            <summary className="text-sm font-medium cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring">{t.title} ({t.rows.length} rows)</summary>
            <ResponseData headers={t.headers} rows={t.rows} title={t.title} />
          </details>
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
  const parts = text.split(/(\{\{(?:uex|wiki):[^}]+\}\}|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("{{wiki:") && part.endsWith("}}")) {
      const path = part.slice(7, -2);
      if (!/^(?:blueprints|missions)\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(path)) return null;
      return <a key={i} href={`https://api.star-citizen.wiki/${path}`} target="_blank" rel="noopener noreferrer" title="View source on Star Citizen Wiki" className="inline-flex items-center ml-1 text-muted-foreground hover:text-foreground"><ArrowUpRight className="h-3 w-3" /></a>;
    }
    if (part.startsWith("{{uex:") && part.endsWith("}}")) {
      const slug = part.slice(6, -2);
      return (
        <a
          key={i}
          href={`https://uexcorp.space/commodities/info/name/${encodeURIComponent(slug)}/`}
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
