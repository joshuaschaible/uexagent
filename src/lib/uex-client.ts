const BASE_URL = "https://api.uexcorp.space/2.0";

export type Commodity = {
  id: number;
  id_parent: number | null;
  name: string;
  code: string;
  slug: string;
  kind: string | null;
  price_buy: number;
  price_sell: number;
  is_available: number;
  is_available_live: number;
  is_visible: number;
  is_extractable: number;
  is_mineral: number;
  is_raw: number;
  is_refined: number;
  is_buyable: number;
  is_sellable: number;
  is_illegal: number;
  is_fuel: number;
  is_harvestable: number;
  /** UEX occurrence locations, encoded as comma-separated IDs when known. */
  ids_star_systems?: string | null;
  ids_planets?: string | null;
  ids_moons?: string | null;
  ids_orbits?: string | null;
  ids_poi?: string | null;
  is_refinable?: number;
  is_pure?: number;
  is_volatile_qt?: number;
  is_volatile_time?: number;
  is_explosive?: number;
  is_inert?: number;
  is_buggy?: number;
  wiki?: string | null;
  date_added?: number;
  date_modified?: number;
};

export type Terminal = {
  id: number;
  id_star_system: number;
  id_planet: number;
  id_orbit: number;
  id_moon: number;
  id_space_station: number;
  id_outpost: number;
  id_city: number;
  id_faction: number;
  name: string;
  nickname: string;
  displayname: string;
  code: string;
  type: string;
  star_system_name: string;
  planet_name: string | null;
  orbit_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
  outpost_name: string | null;
  city_name: string | null;
  faction_name: string | null;
  is_available: number;
  is_available_live: number;
  is_visible: number;
  has_loading_dock: number;
  has_docking_port: number;
  has_freight_elevator: number;
  max_container_size: number;
  game_version: string;
  id_poi?: number;
  poi_name?: string | null;
  fullname?: string;
  is_auto_load?: number;
  is_nqa?: number;
  is_player_owned?: number;
  is_affinity_influenceable?: number;
  screenshot?: string | null;
  screenshot_full?: string | null;
  date_added?: number;
  date_modified?: number;
};

export type StarSystem = {
  id: number;
  name: string;
  code: string;
  is_available: number;
  is_available_live: number;
  is_visible: number;
  is_default: number;
  faction_name: string | null;
};

export type CommodityPrice = {
  id: number;
  id_commodity: number;
  id_terminal: number;
  id_star_system: number;
  id_planet: number;
  id_orbit: number;
  id_moon: number;
  id_city: number;
  id_outpost: number;
  price_buy: number;
  id_space_station?: number;
  price_buy_avg: number;
  price_sell: number;
  price_sell_avg: number;
  /** Missing from commodities_raw_prices endpoint */
  scu_buy?: number;
  scu_buy_avg?: number;
  /** Missing from commodities_raw_prices endpoint */
  scu_sell_stock?: number;
  scu_sell_stock_avg?: number;
  /** Missing from commodities_raw_prices endpoint — treat undefined as valid */
  status_buy?: number | null;
  /** Missing from commodities_raw_prices endpoint — treat undefined as valid */
  status_sell?: number | null;
  /** Reported remaining demand; distinct from inventory already at the terminal. */
  scu_sell?: number;
  scu_sell_avg?: number;
  container_sizes?: string | null;
  quality?: number | null;
  game_version?: string | null;
  date_added?: number;
  id_poi?: number;
  orbit_name?: string | null;
  moon_name?: string | null;
  space_station_name?: string | null;
  city_name?: string | null;
  outpost_name?: string | null;
  poi_name?: string | null;
  terminal_is_available?: number;
  terminal_is_available_live?: number;
  terminal_is_visible?: number;
  commodity_name: string;
  commodity_code: string;
  terminal_name: string;
  terminal_code: string;
  star_system_name: string;
  planet_name: string | null;
  date_modified: number;
};

/** Bulk prices omit geography and sometimes commodity/terminal codes. */
export type CommodityPriceSummary = Omit<CommodityPrice,
  "id_star_system" | "id_planet" | "id_orbit" | "id_moon" | "id_city" | "id_outpost" |
  "star_system_name" | "planet_name" | "commodity_code" | "terminal_code"> & {
  commodity_code?: string;
  terminal_code?: string;
};

export type CommodityRoute = {
  id: number;
  id_commodity: number;
  id_terminal_origin: number;
  id_terminal_destination: number;
  id_star_system_origin: number;
  id_star_system_destination: number;
  price_origin: number;
  price_destination: number;
  price_margin: number;
  profit: number;
  score: number;
  investment: number;
  scu_origin: number;
  scu_destination: number;
  commodity_name: string;
  commodity_code: string;
  origin_terminal_name: string;
  origin_terminal_code: string;
  origin_star_system_name: string;
  origin_planet_name: string | null;
  destination_terminal_name: string;
  destination_terminal_code: string;
  destination_star_system_name: string;
  destination_planet_name: string | null;
  distance: number;
  has_freight_elevator_origin: number;
  has_freight_elevator_destination: number;
  date_added: number;
  id_planet_origin?: number;
  id_planet_destination?: number;
  id_orbit_origin?: number;
  id_orbit_destination?: number;
  status_origin?: number | null;
  status_destination?: number | null;
  game_version_origin?: string | null;
  game_version_destination?: string | null;
  container_sizes_origin?: string | null;
  container_sizes_destination?: string | null;
  has_docking_port_origin?: number;
  has_docking_port_destination?: number;
  has_loading_dock_origin?: number;
  has_loading_dock_destination?: number;
  has_quantum_marker_origin?: number;
  has_quantum_marker_destination?: number;
  is_monitored_origin?: number;
  is_monitored_destination?: number;
  origin_orbit_name?: string | null;
  destination_orbit_name?: string | null;
  code?: string;
};

async function fetchUexData(
  endpoint: string,
  params?: Record<string, string | number>
): Promise<unknown> {
  if (!/^[a-z][a-z0-9_]*$/.test(endpoint)) throw new Error("Invalid UEX endpoint");
  const url = new URL(`${BASE_URL}/${endpoint}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  const token = process.env.UEX_API_TOKEN;
  if (token && token !== "your_token_here") {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), {
    headers,
    next: { revalidate: 3600, tags: ["uex-data"] },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });

  if (!res.ok) {
    throw new Error(`UEX API error: ${res.status}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error("UEX API returned an invalid response");
  }

  if (!json || typeof json !== "object" || !("status" in json) || json.status !== "ok" ||
      !("data" in json)) {
    throw new Error("UEX API returned an invalid response");
  }

  return json.data;
}

export async function uexFetch<T>(endpoint: string, params?: Record<string, string | number>, options?: { allowEmpty?: boolean }): Promise<T[]> {
  const data = await fetchUexData(endpoint, params);
  // Some item categories legitimately have no records and UEX returns data: null.
  if (data === null && options?.allowEmpty) return [];
  if (!Array.isArray(data)) throw new Error("UEX API returned an invalid response");
  return data as T[];
}

export async function uexFetchObject<T>(endpoint: string, params?: Record<string, string | number>): Promise<T> {
  const data = await fetchUexData(endpoint, params);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("UEX API returned an invalid response");
  return data as T;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

/** Missing quantities stay unknown. Zero is a real reported quantity. */
function normalizePrice<T extends CommodityPriceSummary>(row: T): T {
  const result = { ...row };
  const target = result as Record<string, unknown>;
  for (const key of ["price_buy", "price_buy_avg", "price_sell", "price_sell_avg"]) target[key] = optionalNumber(target[key]) ?? 0;
  for (const key of ["scu_buy", "scu_buy_avg", "scu_sell", "scu_sell_avg", "scu_sell_stock", "scu_sell_stock_avg", "status_buy", "status_sell", "quality", "date_added", "date_modified"]) {
    target[key] = optionalNumber(target[key]);
  }
  return result;
}

export async function getCommodities(): Promise<Commodity[]> {
  return uexFetch<Commodity>("commodities");
}

export async function getCommodityPricesAll(): Promise<CommodityPriceSummary[]> {
  return (await uexFetch<CommodityPriceSummary>("commodities_prices_all")).map(normalizePrice);
}

export async function getTerminals(
  filters?: Partial<{ id_star_system: number; id_planet: number; type: string }>
): Promise<Terminal[]> {
  return uexFetch<Terminal>("terminals", filters as Record<string, string | number>);
}

export async function getStarSystems(): Promise<StarSystem[]> {
  return uexFetch<StarSystem>("star_systems");
}

export async function getCommodityPrices(
  params: Partial<{
    id_commodity: number;
    id_terminal: string;
    commodity_name: string;
    commodity_code: string;
    terminal_name: string;
  }>
): Promise<CommodityPrice[]> {
  return (await uexFetch<CommodityPrice>(
    "commodities_prices",
    params as Record<string, string | number>
  )).map(normalizePrice);
}

export async function getCommodityRoutes(
  params: Partial<{
    id_commodity: number;
    id_terminal_origin: number;
    id_planet_origin: number;
    id_terminal_destination: number;
    id_planet_destination: number;
    investment: number;
  }>
): Promise<CommodityRoute[]> {
  return uexFetch<CommodityRoute>(
    "commodities_routes",
    params as Record<string, string | number>
  );
}

// --- New types ---

export type CommodityRanking = {
  id: number;
  code: string;
  slug: string;
  name: string;
  is_temporary: number;
  price_buy_avg_month: number;
  price_sell_avg_month: number;
  price_buy_minimum: number;
  price_sell_maximum: number;
  scu_buy_avg_month: number;
  scu_sell_avg_month: number;
  volatility_price_buy: number;
  volatility_price_sell: number;
  cax_score: number;
  investment: number;
  investment_per_scu: number;
  profitability: number;
  profitability_relative_percentage: number;
  profitability_per_scu: number;
  availability_buy: number | null;
  availability_sell: number | null;
  terminal_id_price_buy_minimum: number;
  terminal_slug_price_buy_minimum: string;
  terminal_id_price_sell_maximum: number;
  terminal_slug_price_sell_maximum: string;
};

export type CommodityPriceHistory = {
  id: number;
  id_commodity: number;
  id_terminal: number;
  price_buy: number;
  price_sell: number;
  scu_buy: number;
  scu_sell_stock: number;
  scu_sell: number;
  status_buy: number | null;
  status_sell: number | null;
  game_version: string;
  date_added: number;
  date_modified?: number;
  commodity_name: string;
  terminal_name: string;
  star_system_name: string;
  planet_name: string | null;
};

export type Vehicle = {
  id: number;
  id_company: number;
  name: string;
  name_full: string;
  slug: string;
  scu: number;
  mass: number;
  width: number;
  height: number;
  length: number;
  crew: string | null;
  fuel_quantum: number;
  fuel_hydrogen: number;
  container_sizes: string;
  pad_type: string;
  is_spaceship: number;
  is_ground_vehicle: number;
  is_cargo: number;
  is_mining: number;
  is_salvage: number;
  is_medical: number;
  is_combat: number;
  is_exploration: number;
  is_racing: number;
  is_refuel: number;
  is_repair: number;
  is_stealth: number;
  is_quantum_capable: number;
  company_name: string;
  game_version: string;
  id_parent?: number;
  ids_vehicles_loaners?: string | null;
  is_concept?: number;
  is_addon?: number;
  is_loading_dock?: number;
  is_docking?: number;
  is_refinery?: number;
  is_military?: number;
  is_industrial?: number;
  is_tractor_beam?: number;
  is_scanning?: number;
  url_photo?: string | null;
  url_store?: string | null;
  url_brochure?: string | null;
  url_video?: string | null;
  date_added?: number;
  date_modified?: number;
};

export type SpaceStation = {
  id: number;
  id_star_system: number;
  id_planet: number;
  id_orbit: number;
  name: string;
  nickname: string;
  star_system_name: string;
  planet_name: string | null;
  orbit_name: string | null;
  faction_name: string | null;
  is_available: number;
  is_monitored: number;
  is_armistice: number;
  has_trade_terminal: number;
  has_habitation: number;
  has_refinery: number;
  has_cargo_center: number;
  has_clinic: number;
  has_food: number;
  has_shops: number;
  has_refuel: number;
  has_repair: number;
  has_loading_dock: number;
  has_docking_port: number;
  has_freight_elevator: number;
  pad_types: string;
  is_available_live?: number;
  is_visible?: number;
  is_landable?: number;
  is_decommissioned?: number;
  has_quantum_marker?: number;
  date_modified?: number;
};

export type City = {
  id: number;
  id_star_system: number;
  id_planet: number;
  name: string;
  star_system_name: string;
  planet_name: string | null;
  faction_name: string | null;
  is_available: number;
  is_armistice: number;
  has_trade_terminal: number;
  has_habitation: number;
  has_refinery: number;
  has_cargo_center: number;
  has_clinic: number;
  has_food: number;
  has_shops: number;
  has_refuel: number;
  has_repair: number;
  has_loading_dock: number;
  has_docking_port: number;
  has_freight_elevator: number;
  pad_types: string;
  is_available_live?: number;
  is_visible?: number;
  is_monitored?: number;
  has_quantum_marker?: number;
  date_modified?: number;
};

export type Outpost = {
  id: number;
  id_star_system: number;
  id_planet: number;
  id_moon: number;
  name: string;
  nickname: string;
  star_system_name: string;
  planet_name: string | null;
  moon_name: string | null;
  faction_name: string | null;
  is_available: number;
  has_trade_terminal: number;
  has_refinery: number;
  has_cargo_center: number;
  has_clinic: number;
  has_food: number;
  has_refuel: number;
  has_repair: number;
  has_loading_dock: number;
  has_freight_elevator: number;
  pad_types: string;
  is_available_live?: number;
  is_visible?: number;
  is_monitored?: number;
  is_armistice?: number;
  is_landable?: number;
  is_decommissioned?: number;
  has_quantum_marker?: number;
  date_modified?: number;
};

export type ItemPrice = {
  id: number;
  id_item: number;
  id_terminal: number;
  id_star_system: number;
  id_planet: number;
  price_buy: number;
  price_buy_avg: number;
  price_sell: number;
  price_sell_avg: number;
  item_name: string;
  terminal_name: string;
  star_system_name: string;
  planet_name: string | null;
  date_modified: number;
};

export type CommodityAverage = {
  id: number;
  id_commodity: number;
  commodity_name: string;
  commodity_code: string;
  price_buy: number;
  price_buy_min: number;
  price_buy_max: number;
  price_buy_avg: number;
  price_sell: number;
  price_sell_min: number;
  price_sell_max: number;
  price_sell_avg: number;
  scu_buy: number;
  scu_buy_avg: number;
  scu_sell: number;
  scu_sell_avg: number;
  volatility_price_buy: number;
  volatility_price_sell: number;
  cax_score: number;
  game_version: string;
};

// --- New API functions ---

export async function getCommodityRanking(): Promise<CommodityRanking[]> {
  return uexFetch<CommodityRanking>("commodities_ranking");
}

export async function getCommodityPriceHistory(params: {
  id_terminal: number;
  id_commodity: number;
  game_version?: string;
}): Promise<CommodityPriceHistory[]> {
  return uexFetch<CommodityPriceHistory>(
    "commodities_prices_history",
    params as Record<string, string | number>
  );
}

export async function getCommodityAverages(params: {
  id_commodity: number;
}): Promise<CommodityAverage[]> {
  return uexFetch<CommodityAverage>(
    "commodities_averages",
    params as Record<string, string | number>
  );
}

export async function getCommodityRawPrices(params: {
  id_commodity: number;
}): Promise<CommodityPrice[]> {
  return (await uexFetch<CommodityPrice>(
    "commodities_raw_prices",
    params as Record<string, string | number>
  )).map(normalizePrice);
}

export async function getVehicles(
  filters?: Partial<{ id_company: number }>
): Promise<Vehicle[]> {
  return uexFetch<Vehicle>("vehicles", filters as Record<string, string | number>);
}

export async function getSpaceStations(
  filters?: Partial<{ id_star_system: number; id_planet: number }>
): Promise<SpaceStation[]> {
  return uexFetch<SpaceStation>("space_stations", filters as Record<string, string | number>);
}

export async function getCities(
  filters?: Partial<{ id_star_system: number; id_planet: number }>
): Promise<City[]> {
  return uexFetch<City>("cities", filters as Record<string, string | number>);
}

export async function getOutposts(
  filters?: Partial<{ id_star_system: number; id_planet: number; id_moon: number }>
): Promise<Outpost[]> {
  return uexFetch<Outpost>("outposts", filters as Record<string, string | number>);
}

export async function getItemPrices(
  params: Partial<{ id_item: number; id_terminal: number; id_category: number }>
): Promise<ItemPrice[]> {
  return uexFetch<ItemPrice>("items_prices", params as Record<string, string | number>);
}

// --- Refinery types & functions ---

export type RefineryYield = {
  id: number;
  id_commodity: number;
  id_terminal: number;
  value: number;
  value_week: number;
  value_month: number;
  commodity_name: string;
  terminal_name: string;
  star_system_name: string;
  planet_name: string | null;
  orbit_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
};

export type RefineryMethod = {
  id: number;
  name: string;
  code: string;
  rating_yield: number;
  rating_cost: number;
  rating_speed: number;
};

export type RefineryCapacity = {
  id: number;
  id_terminal: number;
  value: number;
  value_week: number;
  value_month: number;
  terminal_name: string;
  star_system_name: string;
  planet_name: string | null;
  orbit_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
};

export async function getRefineryYields(): Promise<RefineryYield[]> {
  return uexFetch<RefineryYield>("refineries_yields");
}

export async function getRefineryMethods(): Promise<RefineryMethod[]> {
  return uexFetch<RefineryMethod>("refineries_methods");
}

export async function getRefineryCapacities(): Promise<RefineryCapacity[]> {
  return uexFetch<RefineryCapacity>("refineries_capacities");
}

// --- Fuel types & functions ---

export type FuelPrice = {
  id: number;
  id_commodity: number;
  id_terminal: number;
  price_buy: number;
  price_buy_avg: number;
  commodity_name: string;
  terminal_name: string;
};

export async function getFuelPricesAll(): Promise<FuelPrice[]> {
  return uexFetch<FuelPrice>("fuel_prices_all");
}

// --- Vehicle purchase & rental types & functions ---

export type VehiclePurchasePrice = {
  id: number;
  id_vehicle: number;
  id_terminal: number;
  price_buy: number;
  price_buy_avg: number;
  terminal_name: string;
  terminal_code: string;
  star_system_name: string;
  planet_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
  city_name: string | null;
  outpost_name: string | null;
};

export type VehicleRentalPrice = {
  id: number;
  id_vehicle: number;
  id_terminal: number;
  price_rent: number;
  price_rent_avg: number;
  terminal_name: string;
  terminal_code: string;
  star_system_name: string;
  planet_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
  city_name: string | null;
  outpost_name: string | null;
};

export async function getVehiclePurchasePrices(params: {
  id_vehicle: number;
}): Promise<VehiclePurchasePrice[]> {
  return uexFetch<VehiclePurchasePrice>(
    "vehicles_purchases_prices",
    params as Record<string, string | number>
  );
}

export type VehiclePurchasePriceSummary = {
  id: number;
  id_vehicle: number;
  id_terminal: number;
  price_buy: number;
  vehicle_name: string;
  terminal_name: string;
};

export async function getVehiclePurchasePricesAll(): Promise<VehiclePurchasePriceSummary[]> {
  return uexFetch<VehiclePurchasePriceSummary>("vehicles_purchases_prices_all");
}

export async function getVehicleRentalPrices(params: {
  id_vehicle: number;
}): Promise<VehicleRentalPrice[]> {
  return uexFetch<VehicleRentalPrice>(
    "vehicles_rentals_prices",
    params as Record<string, string | number>
  );
}

export type VehicleRentalPriceSummary = {
  id: number;
  id_vehicle: number;
  id_terminal: number;
  price_rent: number;
  vehicle_name: string;
  terminal_name: string;
};

export async function getVehicleRentalPricesAll(): Promise<VehicleRentalPriceSummary[]> {
  return uexFetch<VehicleRentalPriceSummary>("vehicles_rentals_prices_all");
}

// --- Mining location types & functions ---

export type Planet = {
  id: number;
  id_star_system: number;
  name: string;
  name_origin?: string;
  code: string;
  is_available: number;
  is_available_live?: number;
  is_visible?: number;
  star_system_name: string;
  faction_name: string | null;
};

export type Moon = {
  id: number;
  id_star_system: number;
  id_planet: number;
  name: string;
  name_origin?: string;
  code: string;
  is_available: number;
  is_available_live?: number;
  is_visible?: number;
  planet_name: string | null;
  star_system_name: string;
  faction_name: string | null;
};

export async function getPlanets(): Promise<Planet[]> {
  return uexFetch<Planet>("planets");
}

export async function getMoons(): Promise<Moon[]> {
  return uexFetch<Moon>("moons");
}

export type Orbit = {
  id: number;
  id_star_system: number;
  name: string;
  name_origin?: string;
  code: string;
  is_available: number;
  is_available_live: number;
  is_visible: number;
  is_lagrange: number;
  is_asteroid: number;
  is_planet: number;
  star_system_name: string | null;
  date_modified?: number;
};

export type PointOfInterest = {
  id: number;
  id_star_system: number;
  id_planet: number;
  id_orbit: number;
  id_moon: number;
  id_space_station: number;
  id_city: number;
  id_outpost: number;
  name: string;
  nickname: string;
  type?: string | null;
  subtype?: string | null;
  is_available: number;
  is_available_live: number;
  is_visible: number;
  is_mining_related: number;
  has_quantum_marker: number;
  star_system_name: string | null;
  planet_name: string | null;
  orbit_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
  outpost_name: string | null;
  city_name: string | null;
  is_monitored?: number;
  is_armistice?: number;
  is_landable?: number;
  is_decommissioned?: number;
  date_modified?: number;
};

export async function getOrbits(): Promise<Orbit[]> {
  return uexFetch<Orbit>("orbits");
}

export async function getPointsOfInterest(): Promise<PointOfInterest[]> {
  return uexFetch<PointOfInterest>("poi");
}

export type GameVersions = { live: string | null; ptu: string | null };

export async function getGameVersions(): Promise<GameVersions> {
  const data = await uexFetchObject<Record<string, unknown>>("game_versions");
  return { live: typeof data.live === "string" ? data.live : null, ptu: typeof data.ptu === "string" ? data.ptu : null };
}

export type CommodityStatus = {
  code: number;
  name: string;
  name_short: string;
  name_abbr: string;
  percentage: string;
  percentage_start: number;
  percentage_end: number;
  colors: string;
};
export type CommodityStatuses = { buy: CommodityStatus[]; sell: CommodityStatus[] };

export async function getCommodityStatuses(): Promise<CommodityStatuses> {
  const data = await uexFetchObject<CommodityStatuses>("commodities_status");
  if (!Array.isArray(data.buy) || !Array.isArray(data.sell)) throw new Error("UEX API returned an invalid response");
  return data;
}

export type OrbitDistance = {
  id_star_system_origin: number;
  id_star_system_destination: number;
  id_orbit_origin: number;
  id_orbit_destination: number;
  distance: number;
  game_version?: string;
  date_modified?: number;
};

export async function getOrbitDistances(originSystemId: number, destinationSystemId = originSystemId): Promise<OrbitDistance[]> {
  const rows = await uexFetch<OrbitDistance>("orbits_distances", {
    id_star_system_origin: originSystemId, id_star_system_destination: destinationSystemId,
  });
  return rows.flatMap((row) => {
    const distance = optionalNumber(row.distance);
    return distance !== undefined && distance >= 0 ? [{ ...row, distance }] : [];
  });
}

export type TerminalDistance = {
  terminal_name_origin: string;
  terminal_name_destination: string;
  orbit_name_origin: string | null;
  orbit_name_destination: string | null;
  distance: number | null;
};

export async function getTerminalDistance(originTerminalId: number, destinationTerminalId: number): Promise<TerminalDistance> {
  const row = await uexFetchObject<TerminalDistance>("terminals_distances", {
    id_terminal_origin: originTerminalId, id_terminal_destination: destinationTerminalId,
  });
  const distance = optionalNumber(row.distance);
  return { ...row, distance: distance !== undefined && distance >= 0 ? distance : null };
}

export type JumpPoint = {
  id: number;
  id_star_system_origin: number;
  id_star_system_destination: number;
  id_orbit_origin: number;
  id_orbit_destination: number;
  star_system_origin_name: string;
  star_system_destination_name: string;
  orbit_origin_name: string | null;
  orbit_destination_name: string | null;
  date_modified?: number;
};

export async function getJumpPoints(): Promise<JumpPoint[]> {
  const rows = await uexFetch<JumpPoint & { star_system_name_origin?: string; star_system_name_destination?: string }>("jump_points");
  return rows.map((row) => ({ ...row,
    star_system_origin_name: row.star_system_origin_name || row.star_system_name_origin || "Unknown",
    star_system_destination_name: row.star_system_destination_name || row.star_system_name_destination || "Unknown",
  }));
}

export type VehicleWithLoaners = Vehicle & { loaners: Vehicle[] };
export async function getVehicleLoaners(idVehicle?: number): Promise<VehicleWithLoaners[]> {
  return uexFetch<VehicleWithLoaners>("vehicles_loaners", idVehicle ? { id_vehicle: idVehicle } : undefined);
}
