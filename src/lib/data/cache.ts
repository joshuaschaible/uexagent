import {
  getCommodities,
  getTerminals,
  getStarSystems,
  getVehicles,
  getRefineryMethods,
  getFuelPricesAll,
  type Commodity,
  type Terminal,
  type StarSystem,
  type Vehicle,
  type RefineryMethod,
  type FuelPrice,
} from "@/lib/uex-client";
import { clearMiningDataCache } from "./mining";

type ReferenceData = {
  commodities: Commodity[];
  terminals: Terminal[];
  starSystems: StarSystem[];
  vehicles: Vehicle[];
  refineryMethods: RefineryMethod[];
  fuelPrices: FuelPrice[];
  commodityMap: Map<string, Commodity>;
  terminalMap: Map<number, Terminal>;
  starSystemMap: Map<string, StarSystem>;
  vehicleMap: Map<string, Vehicle>;
};

let cached: ReferenceData | null = null;
let cacheTime = 0;
let pendingLoad: Promise<ReferenceData> | null = null;
let cacheGeneration = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export function getCacheAge(): number {
  return cacheTime > 0 ? Date.now() - cacheTime : 0;
}

export function clearCache(): void {
  clearMiningDataCache();
  cached = null;
  cacheTime = 0;
  pendingLoad = null;
  cacheGeneration++;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function getReferenceData(): Promise<ReferenceData> {
  if (cached && Date.now() - cacheTime < CACHE_TTL) {
    return cached;
  }
  if (pendingLoad) return pendingLoad;

  const generation = cacheGeneration;
  const load = loadReferenceData().then((data) => {
    // A manual clear during a fetch must not repopulate the cleared cache.
    if (generation === cacheGeneration) {
      cached = data;
      cacheTime = Date.now();
    }
    return data;
  }).finally(() => {
    if (pendingLoad === load) pendingLoad = null;
  });
  pendingLoad = load;
  return load;
}

async function loadReferenceData(): Promise<ReferenceData> {
  const [commodities, terminals, starSystems, vehicles, refineryMethods, fuelPrices] = await Promise.all([
    getCommodities(),
    getTerminals(),
    getStarSystems(),
    getVehicles(),
    getRefineryMethods(),
    getFuelPricesAll(),
  ]);

  const commodityMap = new Map<string, Commodity>();
  for (const c of commodities) {
    commodityMap.set(normalize(c.name), c);
    // Only set code key if it doesn't collide with an existing name key
    if (c.code && !commodityMap.has(normalize(c.code))) {
      commodityMap.set(normalize(c.code), c);
    }
  }

  const terminalMap = new Map<number, Terminal>();
  for (const t of terminals) {
    terminalMap.set(t.id, t);
  }

  const starSystemMap = new Map<string, StarSystem>();
  for (const s of starSystems) {
    starSystemMap.set(normalize(s.name), s);
  }

  const vehicleMap = new Map<string, Vehicle>();
  for (const v of vehicles) {
    vehicleMap.set(normalize(v.name), v);
    if (v.name_full) vehicleMap.set(normalize(v.name_full), v);
  }

  return {
    commodities, terminals, starSystems, vehicles,
    refineryMethods, fuelPrices,
    commodityMap, terminalMap, starSystemMap, vehicleMap,
  };
}

export function findCommodity(
  name: string,
  commodityMap: Map<string, Commodity>
): Commodity | undefined {
  const key = normalize(name);
  if (key.length < 3) return undefined;
  if (commodityMap.has(key)) return commodityMap.get(key);
  for (const [k, v] of commodityMap) {
    // Commodity name contains search term — safe, natural substring match
    if (k.includes(key)) return v;
    // Search contains commodity name — strict ratio to prevent short codes
    // matching long concatenated phrases (e.g. "comp" in "comparelaranite")
    if (key.includes(k) && k.length >= 3 && k.length >= key.length * 0.3) return v;
  }
  return undefined;
}

export function findStarSystem(
  name: string,
  starSystemMap: Map<string, StarSystem>
): StarSystem | undefined {
  const key = normalize(name);
  if (key.length < 3) return undefined;
  if (starSystemMap.has(key)) return starSystemMap.get(key);
  const words = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  for (const v of starSystemMap.values()) {
    const systemName = v.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (systemName && words.includes(` ${systemName} `)) return v;
  }
  return undefined;
}

export function findPlanet(
  name: string,
  terminals: Terminal[]
): { planetName: string; planetId: number } | undefined {
  const key = normalize(name);
  for (const t of terminals) {
    if (t.planet_name && normalize(t.planet_name).includes(key)) {
      return { planetName: t.planet_name, planetId: t.id_planet };
    }
  }
  return undefined;
}

export function findMoon(
  name: string,
  terminals: Terminal[]
): { moonName: string; moonId: number } | undefined {
  const key = normalize(name);
  for (const t of terminals) {
    if (t.moon_name && normalize(t.moon_name).includes(key)) {
      return { moonName: t.moon_name, moonId: t.id_moon };
    }
  }
  return undefined;
}

export function findVehicle(
  name: string,
  vehicleMap: Map<string, Vehicle>
): Vehicle | undefined {
  const key = normalize(name);
  if (key.length < 2) return undefined;
  if (vehicleMap.has(key)) return vehicleMap.get(key);
  for (const [k, v] of vehicleMap) {
    if (k.includes(key)) return v;
    if (key.includes(k) && k.length >= 3 && k.length >= key.length * 0.3) return v;
  }
  return undefined;
}

/** Resolve shop short names, optionally qualified by their reported location. */
export function findTerminalByAlias(name: string, terminals: Terminal[]): Terminal | undefined {
  const [shop, scope] = name.toLowerCase().split(/\s+(?:in|on|at)\s+/);
  const shopKey = normalize(shop);
  if (shopKey.length < 5) return undefined;
  const scopeKey = scope ? normalize(scope) : undefined;
  function closeLocation(value: string): boolean {
    const key = normalize(value);
    if (key === scopeKey) return true;
    if (!scopeKey || Math.min(key.length, scopeKey.length) < 5 || Math.abs(key.length - scopeKey.length) > 1) return false;
    // Allow a single insertion, deletion or substitution in a location qualifier.
    let a = 0, b = 0, edits = 0;
    while (a < key.length && b < scopeKey.length) {
      if (key[a] === scopeKey[b]) { a++; b++; continue; }
      if (++edits > 1) return false;
      if (key.length >= scopeKey.length) a++;
      if (scopeKey.length >= key.length) b++;
    }
    return edits + (key.length - a) + (scopeKey.length - b) <= 1;
  }
  const matches = terminals.filter(t => {
    const aliases = [t.name, t.name.split(/\s+-\s+/)[0], t.nickname];
    if (!aliases.some(alias => alias && normalize(alias) === shopKey)) return false;
    return !scopeKey || [t.city_name, t.planet_name, t.moon_name, t.space_station_name, t.star_system_name]
      .some(location => location && closeLocation(location));
  });
  return matches.length === 1 ? matches[0] : undefined;
}

export function findTerminal(
  name: string,
  terminals: Terminal[]
): Terminal | undefined {
  const key = normalize(name);
  if (key.length < 3) return undefined;

  // Exact match first
  for (const t of terminals) {
    if (normalize(t.name) === key) return t;
  }

  const alias = findTerminalByAlias(name, terminals);
  if (alias) return alias;

  // Contains match (terminal name contains query or query contains terminal name)
  // Require at least 5 chars for substring matching to avoid false positives
  if (key.length >= 5) {
    for (const t of terminals) {
      const tNorm = normalize(t.name);
      if (tNorm.includes(key) || key.includes(tNorm)) return t;
    }
  }

  return undefined;
}
