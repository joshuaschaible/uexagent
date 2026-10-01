import type { Commodity, Vehicle } from "./uex-client";

export function parseCrew(value: unknown): { min: number; max: number } | undefined {
  if (value == null || value === "") return undefined;
  const tokens = String(value).split(/[,–-]/).map((v) => v.trim());
  if (!tokens.length || tokens.some((v) => !/^\d+$/.test(v))) return undefined;
  const values = tokens.map(Number);
  if (values.some((n) => !Number.isSafeInteger(n))) return undefined;
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function formatCrew(value: unknown): string {
  const crew = parseCrew(value);
  return crew ? crew.min === crew.max ? String(crew.min) : `${crew.min}–${crew.max}` : "Unknown";
}

export function compareCrew(a: unknown, b: unknown): [string, string] {
  const ca = parseCrew(a), cb = parseCrew(b);
  const labels: [string, string] = [formatCrew(a), formatCrew(b)];
  // A smaller minimum crew is the supported operating comparison, not CSV ordering.
  if (ca && cb && ca.min !== cb.min) {
    const index = ca.min < cb.min ? 0 : 1;
    labels[index] = `**${labels[index]}**`;
  }
  return labels;
}

export function cargoHandlingNotes(commodity: Commodity): string[] {
  const notes: string[] = [];
  if (commodity.is_volatile_qt) notes.push("UEX flags this cargo as volatile during quantum travel.");
  if (commodity.is_volatile_time) notes.push("UEX flags this cargo as unstable over time; no safe duration is supplied.");
  if (commodity.is_explosive) notes.push("UEX flags this material as explosive.");
  if (commodity.is_buggy) notes.push("UEX reports known issues with this commodity.");
  return notes;
}

export function shipLogistics(vehicle: Vehicle): string[] {
  const notes: string[] = [];
  if (vehicle.is_concept) notes.push("UEX marks this ship as a concept; excluded from practical trade recommendations.");
  if (vehicle.is_loading_dock) notes.push("Requires a terminal with a loading dock.");
  if (vehicle.container_sizes) notes.push(`Supported container sizes: ${vehicle.container_sizes.split(",").join(", ")} SCU.`);
  return notes;
}
