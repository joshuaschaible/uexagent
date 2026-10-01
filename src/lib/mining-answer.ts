import type { Commodity, StarSystem } from "./uex-client";
import type { ParsedQuery } from "./query-parser";
import type { ChatResponse } from "./types";
import { getReferenceData } from "./data/cache";
import { getMiningData, type MiningData } from "./data/mining";

type LocationKind = "planet" | "moon" | "orbit" | "poi" | "system";
type MiningLocation = {
  id: number;
  kind: LocationKind;
  name: string;
  label: string;
  systemId: number;
  system: string;
  parent: string;
  aliases?: string[];
};

const SOURCE_NOTE = "UEX lists general mining areas, not exact deposits or spawn rates. Unlisted ores or locations may still be present.";

/** Empty, malformed and zero IDs are not locations. */
export function parseMiningIds(value: string | null | undefined): number[] {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(",").map((part) => part.trim())
    .filter((part) => /^[1-9]\d*$/.test(part))
    .map(Number).filter(Number.isSafeInteger))];
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function aliases(name: string): string[] {
  const names = [normalize(name)];
  if (names[0] === "microtech") names.push("micro tech");
  if (names[0] === "arccorp") names.push("arc corp");
  return names;
}

function matchLocations(text: string, locations: MiningLocation[]): MiningLocation[] {
  let remaining = ` ${normalize(text)} `;
  const matches: MiningLocation[] = [];
  // Consume longer names first: Pyro I is a planet, not merely the Pyro system.
  const longestName = (location: MiningLocation) => Math.max(location.name.length, ...(location.aliases || []).map((name) => name.length));
  for (const location of [...locations].sort((a, b) => longestName(b) - longestName(a))) {
    for (const alias of [location.name, ...(location.aliases || [])].flatMap(aliases)) {
      if (alias.length < 2 || !remaining.includes(` ${alias} `)) continue;
      matches.push(location);
      remaining = remaining.replaceAll(` ${alias} `, " ");
      break;
    }
  }
  return matches;
}

function hasUnknownLocationWords(text: string, matches: MiningLocation[]): boolean {
  let remainder = ` ${normalize(text)} `;
  const knownNames = matches.flatMap((l) => [l.name, ...(l.aliases || [])].flatMap(aliases))
    .sort((a, b) => b.length - a.length);
  for (const name of knownNames) remainder = remainder.replaceAll(` ${name} `, " ");
  return remainder.trim().split(/\s+/).some((word) => word && ![
    "the", "planet", "moon", "star", "system", "surface", "of", "and", "or", "on", "in", "at", "near", "around",
  ].includes(word));
}

function locationCatalog(data: MiningData, systems: StarSystem[]): MiningLocation[] {
  const systemName = (id: number, name?: string | null) => name || systems.find((s) => s.id === id)?.name || "Unknown";
  return [
    ...data.planets.map((p): MiningLocation => ({ id: p.id, kind: "planet", label: "Planet", name: p.name, aliases: p.name_origin ? [p.name_origin] : [],
      systemId: p.id_star_system, system: systemName(p.id_star_system, p.star_system_name), parent: "—" })),
    ...data.moons.map((m): MiningLocation => ({ id: m.id, kind: "moon", label: "Moon", name: m.name, aliases: m.name_origin ? [m.name_origin] : [],
      systemId: m.id_star_system, system: systemName(m.id_star_system, m.star_system_name), parent: m.planet_name || "—" })),
    ...data.orbits.filter((o) => o.is_lagrange || o.is_asteroid).map((o): MiningLocation => ({ id: o.id, kind: "orbit",
      label: o.is_lagrange ? "Lagrange point" : "Asteroid belt", name: o.name_origin || o.name, aliases: [o.name, o.code],
      systemId: o.id_star_system, system: systemName(o.id_star_system, o.star_system_name), parent: "—" })),
    ...data.pointsOfInterest.filter((p) => p.is_mining_related).map((p): MiningLocation => ({ id: p.id, kind: "poi", label: "Mining area", name: p.name,
      aliases: [p.nickname, p.name.replace(/\bAsteroid\s+/i, "")].filter(Boolean),
      systemId: p.id_star_system, system: systemName(p.id_star_system, p.star_system_name), parent: p.moon_name || p.planet_name || "—" })),
    ...systems.map((s): MiningLocation => ({ id: s.id, kind: "system", label: "Star system (area unspecified)", name: s.name,
      systemId: s.id, system: s.name, parent: "—" })),
  ];
}

function oreName(name: string): string {
  return normalize(name.replace(/\s*\((?:ore|raw|refined|pure)\)\s*/gi, ""));
}

function oreLocations(commodity: Commodity, catalog: MiningLocation[]): MiningLocation[] {
  const ids: Record<LocationKind, number[]> = {
    planet: parseMiningIds(commodity.ids_planets),
    moon: parseMiningIds(commodity.ids_moons),
    orbit: parseMiningIds(commodity.ids_orbits),
    poi: parseMiningIds(commodity.ids_poi),
    system: parseMiningIds(commodity.ids_star_systems),
  };
  const detailed = catalog.filter((l) => l.kind !== "system" && ids[l.kind].includes(l.id));
  // Keep system-level evidence where UEX has not identified any more specific area.
  return [...detailed, ...catalog.filter((l) => l.kind === "system" && ids.system.includes(l.id)
    && !detailed.some((d) => d.systemId === l.id))];
}

/** Deterministic answers preserve occurrence data and its limitations without model guesses. */
export function createMiningResponse(
  query: ParsedQuery,
  commodities: Commodity[],
  systems: StarSystem[],
  data: MiningData,
): ChatResponse {
  const catalog = locationCatalog(data, systems);
  const explicit = matchLocations(query.raw, catalog);
  const named = query.locationName ? matchLocations(query.locationName, catalog) : [];
  const selected = explicit.length ? explicit : named;

  if (query.locationName && (named.length === 0 || hasUnknownLocationWords(query.locationName, named))) {
    return { text: `I couldn't match **${query.locationName}** to a UEX mining location. Try a planet, moon, Lagrange point, mining area, or star system, such as **Daymar** or **ARC-L3**.` };
  }

  if (!selected.length) {
    const fallback = catalog.filter((l) =>
      (l.kind === "moon" && l.id === query.moon?.moonId) ||
      (l.kind === "planet" && l.id === query.planet?.planetId) ||
      (l.kind === "system" && l.id === query.starSystem?.id));
    selected.push(...fallback);
  }

  const requested = query.commodities?.length ? query.commodities : query.commodity ? [query.commodity] : [];
  if (!requested.length && !selected.length) {
    return { text: 'Tell me an ore or a mining location. Try **"Where can I mine Laranite?"** or **"Which ores are found on Hurston?"**.' };
  }

  const ores = commodities.filter((c) => c.is_extractable && (!requested.length || requested.some((r) =>
    c.id === r.id || c.id_parent === r.id || r.id_parent === c.id || oreName(c.name) === oreName(r.name))));
  const places = selected.filter((l) => l.kind !== "system");
  const selectedSystems = selected.filter((l) => l.kind === "system");
  const rows: string[][] = [];
  const seen = new Set<string>();
  for (const ore of ores) {
    for (const location of oreLocations(ore, catalog)) {
      if (places.length && !places.some((p) => p.kind === location.kind && p.id === location.id)) continue;
      if (selectedSystems.length && !selectedSystems.some((s) => s.id === location.systemId)) continue;
      const key = `${oreName(ore.name)}:${location.kind}:${location.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push([ore.name, location.name, location.label, location.system, location.parent]);
    }
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[3].localeCompare(b[3]) || a[2].localeCompare(b[2]) || a[1].localeCompare(b[1]));

  const oreLabel = requested.map((c) => `**${c.name}**`).join(" and ");
  const locationLabel = selected.map((l) => `**${l.name}**`).join(" / ");
  if (!rows.length) {
    return { text: `UEX has no recorded mining locations${oreLabel ? ` for ${oreLabel}` : " for ores"}${locationLabel ? ` at ${locationLabel}` : ""}. This does not confirm that the ore is absent. ${SOURCE_NOTE}` };
  }
  const oreCount = new Set(rows.map((r) => oreName(r[0]))).size;
  const locationCount = new Set(rows.map((r) => `${r[2]}:${r[1]}:${r[3]}`)).size;
  const title = oreLabel
    ? `UEX lists **${locationCount} mining location${locationCount === 1 ? "" : "s"}** for ${oreLabel}${locationLabel ? ` at ${locationLabel}` : ""}.`
    : `UEX lists **${oreCount} mineable ore${oreCount === 1 ? "" : "s"}** at ${locationLabel}.`;
  const maxRows = 250;
  const limitNote = rows.length > maxRows ? ` Showing ${maxRows} of ${rows.length} ore/location records; specify a planet or moon to narrow the list.` : "";
  return {
    text: `${title} ${SOURCE_NOTE}${limitNote}`,
    table: { headers: ["Ore", "Mining Location", "Location Type", "System", "Parent Planet / Moon"], rows: rows.slice(0, maxRows) },
  };
}

export async function buildMiningAnswer(query: ParsedQuery): Promise<ChatResponse> {
  try {
    const [reference, mining] = await Promise.all([getReferenceData(), getMiningData()]);
    return createMiningResponse(query, reference.commodities, reference.starSystems, mining);
  } catch {
    return { text: "I couldn't load UEX mining-location data right now. Please try again shortly." };
  }
}
