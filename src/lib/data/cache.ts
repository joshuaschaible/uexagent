import {
  getCommodities,
  getTerminals,
  getStarSystems,
  type Commodity,
  type Terminal,
  type StarSystem,
} from "@/lib/uex-client";

type ReferenceData = {
  commodities: Commodity[];
  terminals: Terminal[];
  starSystems: StarSystem[];
  commodityMap: Map<string, Commodity>;
  terminalMap: Map<number, Terminal>;
  starSystemMap: Map<string, StarSystem>;
};

let cached: ReferenceData | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function getReferenceData(): Promise<ReferenceData> {
  if (cached && Date.now() - cacheTime < CACHE_TTL) {
    return cached;
  }

  const [commodities, terminals, starSystems] = await Promise.all([
    getCommodities(),
    getTerminals(),
    getStarSystems(),
  ]);

  const commodityMap = new Map<string, Commodity>();
  for (const c of commodities) {
    commodityMap.set(normalize(c.name), c);
    if (c.code) commodityMap.set(normalize(c.code), c);
  }

  const terminalMap = new Map<number, Terminal>();
  for (const t of terminals) {
    terminalMap.set(t.id, t);
  }

  const starSystemMap = new Map<string, StarSystem>();
  for (const s of starSystems) {
    starSystemMap.set(normalize(s.name), s);
  }

  cached = { commodities, terminals, starSystems, commodityMap, terminalMap, starSystemMap };
  cacheTime = Date.now();
  return cached;
}

export function findCommodity(
  name: string,
  commodityMap: Map<string, Commodity>
): Commodity | undefined {
  const key = normalize(name);
  // Exact match first
  if (commodityMap.has(key)) return commodityMap.get(key);
  // Partial match
  for (const [k, v] of commodityMap) {
    if (k.includes(key) || key.includes(k)) return v;
  }
  return undefined;
}

export function findStarSystem(
  name: string,
  starSystemMap: Map<string, StarSystem>
): StarSystem | undefined {
  const key = normalize(name);
  if (starSystemMap.has(key)) return starSystemMap.get(key);
  for (const [k, v] of starSystemMap) {
    if (k.includes(key) || key.includes(k)) return v;
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
