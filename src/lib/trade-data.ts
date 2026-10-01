import { getCommodityPricesAll, type CommodityPrice, type CommodityPriceSummary, type Terminal, type Vehicle } from "./uex-client";
import { getReferenceData } from "./data/cache";

export function enrichPriceSummaries(summaries: CommodityPriceSummary[], terminals: Terminal[]): CommodityPrice[] {
  const byId = new Map(terminals.map((terminal) => [terminal.id, terminal]));
  return summaries.map((price) => {
    const terminal = byId.get(price.id_terminal);
    return {
      ...price,
      commodity_code: price.commodity_code || "",
      terminal_code: terminal?.code || price.terminal_code || "",
      id_star_system: terminal?.id_star_system || 0,
      id_planet: terminal?.id_planet || 0,
      id_orbit: terminal?.id_orbit || 0,
      id_moon: terminal?.id_moon || 0,
      id_city: terminal?.id_city || 0,
      id_outpost: terminal?.id_outpost || 0,
      id_space_station: terminal?.id_space_station,
      id_poi: terminal?.id_poi,
      star_system_name: terminal?.star_system_name || "Unknown",
      planet_name: terminal?.planet_name ?? null,
      moon_name: terminal?.moon_name ?? null,
      orbit_name: terminal?.orbit_name ?? null,
      city_name: terminal?.city_name ?? null,
      outpost_name: terminal?.outpost_name ?? null,
      space_station_name: terminal?.space_station_name ?? null,
      poi_name: terminal?.poi_name ?? null,
      terminal_is_available: terminal?.is_available,
      terminal_is_available_live: terminal?.is_available_live,
      terminal_is_visible: terminal?.is_visible,
      // A terminal's game_version dates its facilities, not the price report.
    };
  });
}

let cached: CommodityPrice[] | null = null;
let cachedAt = 0;
let pending: Promise<CommodityPrice[]> | null = null;
let generation = 0;
const CACHE_TTL = 60_000;

export function clearTradeDataCache(): void {
  cached = null;
  cachedAt = 0;
  pending = null;
  generation++;
}

export async function getTradePrices(): Promise<CommodityPrice[]> {
  if (cached && Date.now() - cachedAt < CACHE_TTL) return cached;
  if (pending) return pending;
  const startedGeneration = generation;
  const load = Promise.all([getCommodityPricesAll(), getReferenceData()])
    .then(([prices, reference]) => {
      const rows = enrichPriceSummaries(prices, reference.terminals);
      if (generation === startedGeneration) { cached = rows; cachedAt = Date.now(); }
      return rows;
    }).finally(() => { if (pending === load) pending = null; });
  pending = load;
  return load;
}

function knownQuantity(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function terminalAvailable(price: Partial<CommodityPrice>): boolean {
  return price.terminal_is_available !== 0 && price.terminal_is_available_live !== 0 && price.terminal_is_visible !== 0;
}

/** Buy code 1 spans 0–14% but is labelled Out of Stock by UEX: exclude conservatively. */
export function isBuyable(price: Partial<CommodityPrice>): boolean {
  return terminalAvailable(price) && Number.isFinite(price.price_buy) && (price.price_buy ?? 0) > 0
    && (price.status_buy == null || (price.status_buy >= 2 && price.status_buy <= 7))
    && (!knownQuantity(price.scu_buy) || price.scu_buy! > 0);
}

/** Sell code 7 means no demand; inventory already at the terminal is not demand. */
export function isSellable(price: Partial<CommodityPrice>): boolean {
  return terminalAvailable(price) && Number.isFinite(price.price_sell) && (price.price_sell ?? 0) > 0
    && (price.status_sell == null || (price.status_sell >= 1 && price.status_sell <= 6))
    && (!knownQuantity(price.scu_sell) || price.scu_sell! > 0);
}

export function availableTradeScu(buy: Partial<CommodityPrice>, sell: Partial<CommodityPrice>, capacity: number, budget?: number): number {
  if (!isBuyable(buy) || !isSellable(sell) || !Number.isFinite(capacity) || capacity <= 0) return 0;
  if (budget !== undefined && (!Number.isFinite(budget) || budget <= 0)) return 0;
  let quantity = capacity;
  if (knownQuantity(buy.scu_buy)) quantity = Math.min(quantity, Math.max(0, buy.scu_buy!));
  if (knownQuantity(sell.scu_sell)) quantity = Math.min(quantity, Math.max(0, sell.scu_sell!));
  if (budget !== undefined) quantity = Math.min(quantity, budget / buy.price_buy!);
  // Preserve fractional SCU present in the API while never rounding above budget.
  return Math.floor(quantity * 1000) / 1000;
}

/** Unknown facility/ship fields never establish incompatibility. */
export function getCargoConstraint(vehicle: Partial<Vehicle> | undefined, terminal: Partial<Terminal> | undefined): string | undefined {
  if (!vehicle) return undefined;
  if (vehicle.is_concept === 1) return "This ship is still marked as a concept by UEX.";
  if (!terminal) return undefined;
  if (vehicle.is_loading_dock === 1 && terminal.has_loading_dock === 0) return "This ship requires a loading dock, which this terminal does not have.";
  const sizes = typeof vehicle.container_sizes === "string" ? vehicle.container_sizes.split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  if (sizes.length && typeof terminal.max_container_size === "number" && terminal.max_container_size > 0
    && sizes.every((size) => size > terminal.max_container_size!)) {
    return `This terminal accepts at most ${terminal.max_container_size} SCU containers; none of the ship's listed container sizes fit.`;
  }
  return undefined;
}

export function getCommodityStatusLabel(status: number | null | undefined, side: "buy" | "sell" = "buy"): string {
  if (status == null) return "Unknown";
  if (status === 0) return "Unavailable";
  if (status === 7 && side === "sell") return "No demand";
  return ({ 1: "Out of stock (0–14%)", 2: "Very low inventory", 3: "Low inventory", 4: "Medium inventory", 5: "High inventory", 6: "Very high inventory", 7: "Maximum inventory" } as Record<number, string>)[status] || "Unknown";
}
