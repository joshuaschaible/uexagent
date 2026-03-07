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
  scu_buy: number;
  scu_buy_avg: number;
  scu_sell_stock: number;
  scu_sell_stock_avg: number;
  status_buy: number;
  status_sell: number;
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
