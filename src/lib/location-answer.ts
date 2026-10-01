import type { ParsedQuery } from "@/lib/query-parser";
import type { ChatResponse, NamedTable } from "@/lib/types";
import { getMiningData } from "@/lib/data/mining";
import { getReferenceData } from "@/lib/data/cache";

const flag = (value?: number | null) => value == null ? "Not reported" : value ? "Yes" : "No";
const includesId = (csv: string | null | undefined, id: number) => (csv || "").split(",").some((value) => Number(value.trim()) === id);

export async function buildExtendedLocationAnswer(query: ParsedQuery): Promise<ChatResponse> {
  if (query.locationError) return { text: query.locationError };
  try {
    const [geography, reference] = await Promise.all([getMiningData(), getReferenceData()]);
    const orbit = query.orbit ? geography.orbits.find((value) => value.id === query.orbit!.orbitId) : undefined;
    const poi = query.poi ? geography.pointsOfInterest.find((value) => value.id === query.poi!.poiId) : undefined;
    const location = poi || orbit;
    if (!location) return { text: "I couldn't find that orbit or point of interest in the UEX location catalogue." };
    const rows: string[][] = [
      ["Name", location.name], ["Location type", poi ? [poi.type, poi.subtype].filter(Boolean).join(" / ") || "Point of interest" : "Orbit"],
      ["Star system", location.star_system_name || "Not reported"], ["Available in game", flag(location.is_available_live)],
    ];
    if (orbit) rows.push(["Lagrange point", flag(orbit.is_lagrange)], ["Asteroid region", flag(orbit.is_asteroid)], ["Planetary orbit", flag(orbit.is_planet)]);
    if (poi) rows.push(
      ["Parent locations", [poi.moon_name, poi.planet_name, poi.orbit_name].filter(Boolean).join(", ") || "Not reported"],
      ["Mining related", flag(poi.is_mining_related)], ["Quantum marker", flag(poi.has_quantum_marker)],
      ["Monitored", flag(poi.is_monitored)], ["Armistice zone", flag(poi.is_armistice)],
      ["Landable", flag(poi.is_landable)], ["Decommissioned", flag(poi.is_decommissioned)],
    );
    const terminals = reference.terminals.filter((terminal) => terminal.is_available && (poi ? terminal.id_poi === poi.id : terminal.id_orbit === orbit!.id));
    const commodities = reference.commodities.filter((commodity) => commodity.is_extractable && commodity.is_available
      && (poi ? includesId(commodity.ids_poi, poi.id) : includesId(commodity.ids_orbits, orbit!.id)));
    const tables: NamedTable[] = [{ title: "Location details", headers: ["Property", "Reported value"], rows }];
    if (terminals.length) tables.push({
      title: `Related terminals (${terminals.length})`, headers: ["Terminal", "Type", "Freight elevator", "Docking port", "Loading dock", "Max container (SCU)"],
      rows: terminals.slice(0, 50).map((terminal) => [terminal.name, terminal.type, flag(terminal.has_freight_elevator), flag(terminal.has_docking_port), flag(terminal.has_loading_dock), terminal.max_container_size ? String(terminal.max_container_size) : "Not reported"]),
    });
    if (commodities.length) tables.push({ title: "Reported mining commodities", headers: ["Commodity", "Form"], rows: commodities.map((commodity) => [commodity.name, commodity.is_raw ? "Raw" : "Other extractable form"]) });
    return { text: `${location.name}: UEX reports ${terminals.length} related terminals${commodities.length ? ` and ${commodities.length} mining commodity entries` : ""}.`, tables };
  } catch {
    return { text: "Location details are temporarily unavailable. Please try again shortly." };
  }
}
