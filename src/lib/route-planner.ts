import { getOrbitDistances, getJumpPoints, type CommodityPrice, type Terminal, type Vehicle, type OrbitDistance, type JumpPoint } from "@/lib/uex-client";
import { getReferenceData } from "@/lib/data/cache";
import { getTradePrices, isBuyable, isSellable, availableTradeScu, getCargoConstraint } from "@/lib/trade-data";
import type { ReportMetadata } from "@/lib/data-freshness";

export type RouteStop = {
  step: number;
  action: "buy" | "sell" | "fly";
  terminalName: string;
  location: string;
  commodityName?: string;
  pricePerScu?: number;
  totalCost?: number;
  profit?: number;
  quantity?: number;
  distanceGm?: number | null;
  fromTerminalName?: string;
  reposition?: boolean;
};

export type MultiHopResult = {
  stops: RouteStop[];
  totalProfit: number;
  totalInvestment: number;
  scu: number;
  system: string;
  distanceGm: number | null;
  warnings: string[];
  sourceRows: ReportMetadata[];
};

export type RouteDistanceData = { distances: OrbitDistance[]; jumps: JumpPoint[]; warnings: string[] };
type DistanceCacheEntry = { value?: RouteDistanceData; time: number; pending?: Promise<RouteDistanceData> };
const distanceCache = new Map<string, DistanceCacheEntry>();
let cacheGeneration = 0;
const DISTANCE_TTL = 60 * 60 * 1000;

export function clearRouteDistanceCache(): void {
  distanceCache.clear();
  cacheGeneration++;
}

/** At most four orbital graph requests plus one jump request, never one call per candidate. */
export async function getRouteDistanceData(systemIds: number[]): Promise<RouteDistanceData> {
  const systems = [...new Set(systemIds.filter((id) => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
  const selected = systems.slice(0, 4);
  const key = systems.join(",");
  const existing = distanceCache.get(key);
  if (existing?.value && Date.now() - existing.time < DISTANCE_TTL) return existing.value;
  if (existing?.pending) return existing.pending;
  const generation = cacheGeneration;
  const entry: DistanceCacheEntry = { time: 0 };
  const pending = Promise.allSettled([...selected.map((id) => getOrbitDistances(id)), getJumpPoints()])
    .then((results) => {
      const distances: OrbitDistance[] = [];
      const warnings: string[] = [];
      let jumps: JumpPoint[] = [];
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          if (index === selected.length) jumps = result.value as JumpPoint[];
          else distances.push(...result.value as OrbitDistance[]);
        } else warnings.push(index === selected.length ? "Jump connections could not be checked; cross-system routes were excluded." : "Some orbital distances could not be loaded.");
      });
      if (systems.length > selected.length) warnings.push("Distance lookup was limited to four systems; other distances are unknown.");
      const data = { distances, jumps, warnings };
      // Failed/partial loads are not cached; a subsequent request can recover.
      if (generation === cacheGeneration && results.every((result) => result.status === "fulfilled")) {
        entry.value = data;
        entry.time = Date.now();
      }
      return data;
    }).finally(() => { if (entry.pending === pending) entry.pending = undefined; });
  entry.pending = pending;
  distanceCache.set(key, entry);
  if (distanceCache.size > 8) {
    const oldKey = [...distanceCache.keys()].find((candidate) => candidate !== key && !distanceCache.get(candidate)?.pending);
    if (oldKey) distanceCache.delete(oldKey);
  }
  return pending;
}

function location(price: CommodityPrice): string {
  return [...new Set([price.moon_name || price.space_station_name || price.city_name || price.outpost_name, price.planet_name, price.star_system_name].filter(Boolean))].join(", ");
}

function distanceLookup(data: RouteDistanceData) {
  const graph = new Map<string, Map<string, number>>();
  for (const row of data.distances) {
    if (!Number.isFinite(row.distance) || row.distance < 0) continue;
    const from = `${row.id_star_system_origin}:${row.id_orbit_origin}`;
    const to = `${row.id_star_system_destination}:${row.id_orbit_destination}`;
    const edges = graph.get(from) || new Map<string, number>();
    edges.set(to, Math.min(edges.get(to) ?? Infinity, row.distance));
    graph.set(from, edges);
  }
  const fromCache = new Map<string, Map<string, number>>();
  return (from: CommodityPrice, to: CommodityPrice): number | null => {
    if (from.id_terminal === to.id_terminal) return 0;
    if (!from.id_orbit || !to.id_orbit || from.id_star_system !== to.id_star_system) return null;
    const start = `${from.id_star_system}:${from.id_orbit}`;
    const destination = `${to.id_star_system}:${to.id_orbit}`;
    if (start === destination) return null; // Local approaches have no orbital distance.
    if (!fromCache.has(start)) {
      const best = new Map<string, number>([[start, 0]]);
      const visited = new Set<string>();
      while (true) {
        let node: string | undefined;
        let nearest = Infinity;
        for (const [candidate, value] of best) if (!visited.has(candidate) && value < nearest) { node = candidate; nearest = value; }
        if (node === undefined) break;
        visited.add(node);
        for (const [next, edge] of graph.get(node) || []) {
          if (nearest + edge < (best.get(next) ?? Infinity)) best.set(next, nearest + edge);
        }
      }
      fromCache.set(start, best);
    }
    return fromCache.get(start)!.get(destination) ?? null;
  };
}

function systemReachability(jumps: JumpPoint[]) {
  const graph = new Map<number, Set<number>>();
  for (const jump of jumps) {
    const next = graph.get(jump.id_star_system_origin) || new Set<number>();
    next.add(jump.id_star_system_destination);
    graph.set(jump.id_star_system_origin, next);
  }
  return (from: number, to: number) => {
    if (!from || !to) return false;
    if (from === to) return true;
    const todo = [from];
    const visited = new Set<number>();
    for (let index = 0; index < todo.length; index++) {
      const system = todo[index];
      if (visited.has(system)) continue;
      visited.add(system);
      for (const next of graph.get(system) || []) {
        if (next === to) return true;
        if (!visited.has(next)) todo.push(next);
      }
    }
    return false;
  };
}

export type RouteConstraints = {
  budget?: number;
  originTerminalId?: number;
  originPlanetId?: number;
  originMoonId?: number;
  originOrbitId?: number;
  originPoiId?: number;
  originCityId?: number;
  originStationId?: number;
};
type RouteOptions = { scu: number; maxHops?: number; systemFilter?: string; vehicle?: Vehicle } & RouteConstraints;

/** Greedy connected itinerary over one market snapshot; no stock replenishment is assumed. */
export function buildConnectedRoute(prices: CommodityPrice[], terminals: Terminal[], options: RouteOptions, distances: RouteDistanceData): MultiHopResult | null {
  const { vehicle, systemFilter } = options;
  const capacity = vehicle && Number.isFinite(vehicle.scu) ? Math.min(options.scu, vehicle.scu) : options.scu;
  if (!Number.isFinite(capacity) || capacity <= 0 || vehicle?.is_concept === 1) return null;
  const maxHops = Math.min(3, Math.max(1, Math.floor(options.maxHops ?? 3)));
  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  const filtered = prices.filter((price) => (!systemFilter || price.star_system_name?.toLowerCase() === systemFilter.toLowerCase())
    && !getCargoConstraint(vehicle, byId.get(price.id_terminal)));
  const buyers = new Map<number, CommodityPrice[]>();
  const sellers = new Map<number, CommodityPrice[]>();
  for (const price of filtered) {
    if (isBuyable(price)) buyers.set(price.id_commodity, [...(buyers.get(price.id_commodity) || []), price]);
    if (isSellable(price)) sellers.set(price.id_commodity, [...(sellers.get(price.id_commodity) || []), price]);
  }
  const canTravel = systemReachability(distances.jumps);
  const getDistance = distanceLookup(distances);
  const pairs: { buy: CommodityPrice; sell: CommodityPrice; key: string }[] = [];
  for (const [commodity, buyRows] of buyers) for (const buy of buyRows) for (const sell of sellers.get(commodity) || []) {
    if (buy.id_terminal !== sell.id_terminal && sell.price_sell > buy.price_buy && canTravel(buy.id_star_system, sell.id_star_system)) {
      pairs.push({ buy, sell, key: `${commodity}:${buy.id_terminal}:${sell.id_terminal}` });
    }
  }
  const usedPairs = new Set<string>();
  const usedSupply = new Map<string, number>();
  const usedDemand = new Map<string, number>();
  const inventoryKey = (row: CommodityPrice) => `${row.id_terminal}:${row.id_commodity}`;
  const stops: RouteStop[] = [];
  const warnings = new Set(distances.warnings);
  let totalProfit = 0;
  let totalInvestment = 0;
  let totalDistance: number | null = 0;
  let current: CommodityPrice | undefined;
  const systemsUsed = new Set<string>();
  const sourceRows: ReportMetadata[] = [];
  let cashBalance = options.budget;
  function matchesOrigin(price: CommodityPrice): boolean {
    const terminal = byId.get(price.id_terminal);
    const fields = [
      [options.originTerminalId, price.id_terminal],
      [options.originPlanetId, terminal?.id_planet ?? price.id_planet],
      [options.originMoonId, terminal?.id_moon ?? price.id_moon],
      [options.originOrbitId, terminal?.id_orbit ?? price.id_orbit],
      [options.originPoiId, terminal?.id_poi ?? price.id_poi],
      [options.originCityId, terminal?.id_city ?? price.id_city],
      [options.originStationId, terminal?.id_space_station ?? price.id_space_station],
    ];
    return fields.every(([requested, actual]) => requested === undefined || requested === actual);
  }
  function fly(from: CommodityPrice, to: CommodityPrice, reposition: boolean) {
    if (from.id_terminal === to.id_terminal) return;
    const distance = getDistance(from, to);
    if (distance === null) { totalDistance = null; warnings.add("Some flight distances are unknown, including local approaches or jump travel."); }
    else if (totalDistance !== null) totalDistance += distance;
    stops.push({ step: stops.length + 1, action: "fly", fromTerminalName: from.terminal_name, terminalName: to.terminal_name,
      location: location(to), distanceGm: distance, reposition });
  }
  for (let hop = 0; hop < maxHops; hop++) {
    const candidates = pairs.flatMap((pair) => {
      if (usedPairs.has(pair.key) || (current && !canTravel(current.id_star_system, pair.buy.id_star_system))) return [];
      if (!current && !matchesOrigin(pair.buy)) return [];
      const buy = { ...pair.buy, scu_buy: pair.buy.scu_buy === undefined ? undefined : pair.buy.scu_buy - (usedSupply.get(inventoryKey(pair.buy)) || 0) };
      const sell = { ...pair.sell, scu_sell: pair.sell.scu_sell === undefined ? undefined : pair.sell.scu_sell - (usedDemand.get(inventoryKey(pair.sell)) || 0) };
      const quantity = availableTradeScu(buy, sell, capacity, cashBalance);
      if (quantity <= 0) return [];
      const profit = (sell.price_sell - buy.price_buy) * quantity;
      const loaded = getDistance(buy, sell);
      const reposition = current ? getDistance(current, buy) : 0;
      const distance = loaded !== null && reposition !== null ? loaded + reposition : null;
      return [{ ...pair, quantity, profit, distance }];
    });
    candidates.sort((a, b) => {
      const aKnown = a.distance !== null && a.distance > 0;
      const bKnown = b.distance !== null && b.distance > 0;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      const score = aKnown && bKnown ? b.profit / b.distance! - a.profit / a.distance! : b.profit - a.profit;
      return score || b.profit - a.profit || a.key.localeCompare(b.key);
    });
    const selected = candidates[0];
    if (!selected) break;
    const { buy, sell, quantity, profit } = selected;
    if (current) fly(current, buy, true);
    if (buy.scu_buy === undefined || sell.scu_sell === undefined) warnings.add("Some stock or demand quantities are unreported; those projections assume enough for the shown load.");
    const investment = buy.price_buy * quantity;
    stops.push({ step: stops.length + 1, action: "buy", terminalName: buy.terminal_name, location: location(buy),
      commodityName: buy.commodity_name, pricePerScu: buy.price_buy, totalCost: investment, quantity });
    fly(buy, sell, false);
    stops.push({ step: stops.length + 1, action: "sell", terminalName: sell.terminal_name, location: location(sell),
      commodityName: sell.commodity_name, pricePerScu: sell.price_sell, totalCost: sell.price_sell * quantity, profit, quantity });
    usedPairs.add(selected.key);
    usedSupply.set(inventoryKey(buy), (usedSupply.get(inventoryKey(buy)) || 0) + quantity);
    usedDemand.set(inventoryKey(sell), (usedDemand.get(inventoryKey(sell)) || 0) + quantity);
    systemsUsed.add(buy.star_system_name); systemsUsed.add(sell.star_system_name);
    sourceRows.push(...[buy, sell].map((row) => ({ date_added: row.date_added, date_modified: row.date_modified, game_version: row.game_version })));
    if (cashBalance !== undefined) cashBalance += profit;
    totalProfit += profit; totalInvestment += investment; current = sell;
  }
  if (!stops.length) return null;
  warnings.add("Reported orbital distance estimates exclude local approach travel.");
  warnings.add("Routes prefer profit per known orbital Gm; unknown-distance options use gross profit. Fuel, travel time and loading costs are not included.");
  return { stops, totalProfit, totalInvestment, scu: capacity, system: [...systemsUsed].join(" / "), distanceGm: totalDistance, warnings: [...warnings], sourceRows };
}

export async function planMultiHopRoute(scu: number, maxHops = 3, systemFilter?: string, vehicle?: Vehicle, constraints: RouteConstraints = {}): Promise<MultiHopResult | null> {
  const [prices, reference] = await Promise.all([getTradePrices(), getReferenceData()]);
  const relevant = prices.filter((price) => !systemFilter || price.star_system_name?.toLowerCase() === systemFilter.toLowerCase());
  const distances = await getRouteDistanceData(relevant.map((price) => price.id_star_system));
  return buildConnectedRoute(relevant, reference.terminals, { scu, maxHops, systemFilter, vehicle, ...constraints }, distances);
}
