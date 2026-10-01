export type ReportMetadata = {
  date_added?: number | string | null;
  date_modified?: number | string | null;
  game_version?: string | null;
};

/** UEX timestamps are Unix seconds; accepting milliseconds also avoids double scaling. */
export function reportTimestampMs(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const milliseconds = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  return Number.isFinite(new Date(milliseconds).getTime()) ? milliseconds : null;
}

export function formatReportTimestamp(value: unknown): string {
  const timestamp = reportTimestampMs(value);
  return timestamp === null ? "Unknown" : `${new Date(timestamp).toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

function reportTime(row: ReportMetadata): number | null {
  return reportTimestampMs(row.date_modified) ?? reportTimestampMs(row.date_added);
}

function ageLabel(ageMs: number): string {
  if (ageMs < 0) return "future-dated";
  if (ageMs < 60_000) return "under a minute ago";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  return `${Math.floor(ageMs / 86_400_000)}d ago`;
}

export function summarizeDataFreshness(
  rows: readonly ReportMetadata[],
  liveVersion?: string | null,
  nowMs = Date.now()
): string {
  const timestamps = rows.map(reportTime).filter((time): time is number => time !== null);
  const parts: string[] = [];
  if (timestamps.length > 0) {
    const oldest = Math.min(...timestamps);
    const newest = Math.max(...timestamps);
    parts.push(`UEX reports: ${formatReportTimestamp(oldest)}${oldest === newest ? "" : ` – ${formatReportTimestamp(newest)}`} (newest ${ageLabel(nowMs - newest)}).`);
    const staleCount = timestamps.filter((time) => nowMs - time > 86_400_000).length;
    if (staleCount > 0) parts.push(`${staleCount} report${staleCount === 1 ? " is" : "s are"} over 24 hours old.`);
  } else {
    parts.push("UEX report time is unknown.");
  }
  const unknownTimes = rows.length - timestamps.length;
  if (timestamps.length > 0 && unknownTimes > 0) parts.push(`${unknownTimes} report${unknownTimes === 1 ? " has" : "s have"} no timestamp.`);

  const versions = [...new Set(rows.map((row) => row.game_version?.trim()).filter((version): version is string => !!version))].sort();
  parts.push(versions.length > 0 ? `Source game version${versions.length > 1 ? "s" : ""}: ${versions.join(", ")}.` : "Source game version is unknown.");
  const unknownVersions = rows.filter((row) => !row.game_version?.trim()).length;
  if (versions.length > 0 && unknownVersions > 0) parts.push(`${unknownVersions} report${unknownVersions === 1 ? " has" : "s have"} no game version.`);
  if (liveVersion?.trim()) {
    parts.push(`UEX LIVE version: ${liveVersion.trim()}.`);
    if (versions.some((version) => version !== liveVersion.trim())) parts.push("Some source versions differ from LIVE; verify prices in-game.");
  } else {
    parts.push("Current LIVE version metadata is unavailable.");
  }
  return parts.join(" ");
}
