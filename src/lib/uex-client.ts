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
  status_buy?: number;
  /** Missing from commodities_raw_prices endpoint — treat undefined as valid */
  status_sell?: number;
  commodity_name: string;
  commodity_code: string;
  terminal_name: string;
  terminal_code: string;
  star_system_name: string;
  planet_name: string | null;
  date_modified: number;
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
};

type UexResponse<T> = {
  status: string;
  http_code: number;
  data: T[];
  message?: string;
};

async function uexFetch<T>(
  endpoint: string,
  params?: Record<string, string | number>
): Promise<T[]> {
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

  const res = await fetch(url.toString(), { headers, next: { revalidate: 3600 } });

  if (!res.ok) {
    throw new Error(`UEX API error: ${res.status} ${res.statusText}`);
  }

  const json: UexResponse<T> = await res.json();

  if (json.status !== "ok") {
    throw new Error(`UEX API returned status: ${json.status} - ${json.message}`);
  }

  return json.data;
}

export async function getCommodities(): Promise<Commodity[]> {
  return uexFetch<Commodity>("commodities");
}

export async function getCommodityPricesAll(): Promise<CommodityPrice[]> {
  return uexFetch<CommodityPrice>("commodities_prices_all");
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
  return uexFetch<CommodityPrice>(
    "commodities_prices",
    params as Record<string, string | number>
  );
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
  crew: number;
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
  return uexFetch<CommodityPrice>(
    "commodities_raw_prices",
    params as Record<string, string | number>
  );
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
  star_system_name: string;
  planet_name: string | null;
  moon_name: string | null;
  space_station_name: string | null;
  city_name: string | null;
  outpost_name: string | null;
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

// --- Planet & Moon types & functions ---

export type Planet = {
  id: number;
  id_star_system: number;
  name: string;
  code: string;
  is_available: number;
  star_system_name: string;
  faction_name: string | null;
};

export type Moon = {
  id: number;
  id_star_system: number;
  id_planet: number;
  name: string;
  code: string;
  is_available: number;
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
