import {
  getCommodityPriceHistory,
  getCommodityPrices,
  getGameVersions,
  getTerminals,
  uexFetch,
  type CommodityPrice,
  type CommodityPriceHistory,
  type Terminal,
} from "./uex-client";
import { getCommodityStatusLabel, isBuyable, isSellable } from "./trade-data";
import { formatReportTimestamp, reportTimestampMs, summarizeDataFreshness } from "./data-freshness";
import type { ParsedQuery } from "./query-parser";
import type { ChatResponse } from "./types";

const MAX_HISTORY_REPORTS = 500;
const MAX_ALERTS = 25;
const MAX_TERMINAL_CHOICES = 10;

type LocationRecord = {
  id_terminal?: number;
  id_star_system?: number;
  id_planet?: number;
  id_moon?: number;
  id_orbit?: number;
  id_poi?: number;
  id_city?: number;
  id_space_station?: number;
  terminal_name?: string | null;
  star_system_name?: string | null;
  planet_name?: string | null;
  moon_name?: string | null;
  orbit_name?: string | null;
  poi_name?: string | null;
  city_name?: string | null;
  space_station_name?: string | null;
};

export type MarketAlert = LocationRecord & {
  id_commodity: number;
  id_terminal: number;
  commodity_name: string;
  terminal_name: string;
  price_buy: number;
  price_sell: number;
  scu_buy?: number;
  scu_sell?: number;
  status_buy?: number | null;
  status_sell?: number | null;
  date_added?: number;
  game_version?: string | null;
};

export async function getMarketAlerts(idCommodity?: number): Promise<MarketAlert[]> {
  return uexFetch<MarketAlert>("commodities_alerts", idCommodity ? { id_commodity: idCommodity } : undefined);
}

const sameName = (left: string | null | undefined, right: string) =>
  typeof left === "string" && left.trim().toLowerCase() === right.trim().toLowerCase();

function locationProblem(query: ParsedQuery): string | null {
  if (query.locationError) return query.locationError;
  if (query.locationName && !query.terminal && !query.starSystem && !query.planet && !query.moon && !query.orbit && !query.poi && !query.city && !query.station) {
    return `I couldn't match **${query.locationName}** to a UEX location. Use a named terminal, system, planet, moon, or Lagrange point.`;
  }
  return null;
}

function matchesLocation(row: LocationRecord, query: ParsedQuery, terminals: readonly Terminal[]): boolean {
  if (query.terminal && row.id_terminal !== query.terminal.id) return false;
  const terminal = terminals.find((item) => item.id === row.id_terminal);
  const location = { ...terminal, ...row };
  if (query.starSystem && location.id_star_system !== query.starSystem.id && !sameName(location.star_system_name, query.starSystem.name)) return false;
  if (query.planet && location.id_planet !== query.planet.planetId && !sameName(location.planet_name, query.planet.planetName)) return false;
  if (query.moon && location.id_moon !== query.moon.moonId && !sameName(location.moon_name, query.moon.moonName)) return false;
  if (query.orbit && location.id_orbit !== query.orbit.orbitId && !sameName(location.orbit_name, query.orbit.orbitName)) return false;
  if (query.poi && location.id_poi !== query.poi.poiId && !sameName(location.poi_name, query.poi.poiName)) return false;
  if (query.city && location.id_city !== query.city.cityId && !sameName(location.city_name, query.city.cityName)) return false;
  if (query.station && location.id_space_station !== query.station.stationId && !sameName(location.space_station_name, query.station.stationName)) return false;
  return true;
}

function dateBoundary(date: string | undefined, end: boolean): number | null {
  if (!date) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return NaN;
  return timestamp + (end ? 86_399_999 : 0);
}

function dateProblem(query: ParsedQuery): string | null {
  const from = dateBoundary(query.dateFrom, false);
  const to = dateBoundary(query.dateTo, true);
  if (Number.isNaN(from) || Number.isNaN(to) || (from !== null && to !== null && from > to)) {
    return "Use a valid date range in YYYY-MM-DD format, with the start date before the end date.";
  }
  return null;
}

function matchesReport(row: { date_added?: number; game_version?: string | null }, query: ParsedQuery): boolean {
  if (query.gameVersion && row.game_version !== query.gameVersion) return false;
  const from = dateBoundary(query.dateFrom, false);
  const to = dateBoundary(query.dateTo, true);
  if (from === null && to === null) return true;
  const timestamp = reportTimestampMs(row.date_added);
  return timestamp !== null && (from === null || timestamp >= from) && (to === null || timestamp <= to);
}

function reportScope(query: ParsedQuery): string {
  return `${query.gameVersion ? ` for game version ${query.gameVersion}` : ""}${query.dateFrom ? ` from ${query.dateFrom}` : ""}${query.dateTo ? ` through ${query.dateTo}` : ""}`;
}

function quote(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function historicalQuote(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function buyQuote(row: Pick<CommodityPrice, "price_buy" | "status_buy">): number | null {
  return isBuyable(row) && Number.isFinite(row.price_buy) && row.price_buy > 0 ? row.price_buy : null;
}

function sellQuote(row: Pick<CommodityPrice, "price_sell" | "status_sell">): number | null {
  return isSellable(row) && Number.isFinite(row.price_sell) && row.price_sell > 0 ? row.price_sell : null;
}

export function createHistoryTerminalChoices(
  query: ParsedQuery,
  prices: readonly CommodityPrice[],
  terminals: readonly Terminal[]
): ChatResponse {
  const problem = locationProblem(query) ?? dateProblem(query);
  if (problem) return { text: problem };
  const commodity = query.commodity;
  if (!commodity) return { text: 'Which commodity do you want history for? Try "Price history of Laranite".' };
  const candidates = prices.filter((row) => row.id_commodity === commodity.id && Number.isSafeInteger(row.id_terminal) && row.id_terminal > 0 && matchesLocation(row, query, terminals));
  const byTerminal = new Map(candidates.map((row) => [row.id_terminal, row]));
  const choices = [...byTerminal.values()].sort((left, right) => left.terminal_name.localeCompare(right.terminal_name)).slice(0, MAX_TERMINAL_CHOICES);
  if (choices.length === 0) {
    return { text: `Price history for **${commodity.name}** needs a specific terminal. I found no terminal price records matching this location. Name a terminal to check its history${reportScope(query)}; older reports may exist even without a current price listing.` };
  }
  return {
    text: `Price history for **${commodity.name}** is specific to a terminal. Choose one of these ${choices.length}${byTerminal.size > choices.length ? ` of ${byTerminal.size}` : ""} matching terminals, or name another. These choices have current price records; historical coverage may differ${reportScope(query)}.`,
    table: {
      headers: ["Terminal", "System", "Ask for history"],
      rows: choices.map((row) => [
        row.terminal_name,
        row.star_system_name || terminals.find((terminal) => terminal.id === row.id_terminal)?.star_system_name || "Unknown",
        `Price history of ${commodity.name} at ${row.terminal_name}${reportScope(query)}`,
      ]),
    },
  };
}

export function createPriceHistoryResponse(
  query: ParsedQuery,
  records: readonly CommodityPriceHistory[],
  liveVersion?: string | null
): ChatResponse {
  const problem = locationProblem(query) ?? dateProblem(query);
  if (problem) return { text: problem };
  if (!query.commodity || !query.terminal) return { text: "Name a commodity and a specific terminal to view dated price reports." };
  const commodity = query.commodity;
  const terminal = query.terminal;
  const matching = records.filter((row) => row.id_commodity === commodity.id && row.id_terminal === terminal.id && matchesReport(row, query));
  const ordered = [...matching].sort((left, right) => (reportTimestampMs(left.date_added) ?? Infinity) - (reportTimestampMs(right.date_added) ?? Infinity));
  const reports = ordered.length > MAX_HISTORY_REPORTS ? ordered.slice(-MAX_HISTORY_REPORTS) : ordered;
  const terminalName = terminal.displayname || terminal.name;
  if (reports.length === 0) {
    return { text: `UEX returned no matching dated price reports for **${commodity.name}** at **${terminalName}**${reportScope(query)}. The history endpoint returns up to 500 reports, so this does not prove prices were unchanged or that no older reports exist.` };
  }
  const points = reports.flatMap((row) => {
    const timestamp = reportTimestampMs(row.date_added);
    return timestamp === null ? [] : [{
      label: formatReportTimestamp(timestamp),
      timestamp,
      buyPrice: historicalQuote(row.price_buy),
      sellPrice: historicalQuote(row.price_sell),
    }];
  });
  const usablePoints = points.filter((point) => point.buyPrice !== null || point.sellPrice !== null);
  const omitted = reports.length - points.length;
  let text = `**${commodity.name}** at **${terminalName}**: ${reports.length} UEX price report${reports.length === 1 ? "" : "s"}${reportScope(query)}. Prices are in aUEC/SCU. Zero or missing quotes appear as gaps; inventory status is listed separately, so a quoted price does not imply stock or demand.\n\n`;
  if (usablePoints.length < 2) text += usablePoints.length === 1 ? "Only one usable dated report is available; it cannot establish a price trend.\n\n" : "No usable dated quotes are available to chart.\n\n";
  if (omitted > 0) text += `${omitted} report${omitted === 1 ? " lacks" : "s lack"} a valid timestamp and ${omitted === 1 ? "is" : "are"} excluded from the chart.\n\n`;
  text += `${summarizeDataFreshness(reports, liveVersion)}\n\nThe endpoint returns up to 500 reports. Reporting gaps and the endpoint limit can leave the requested period incomplete; lines between reports do not establish prices at unreported times.`;
  return {
    text,
    table: {
      headers: ["Reported (UTC)", "Buy aUEC/SCU", "Buy status", "Sell aUEC/SCU", "Sell status", "Game version"],
      rows: reports.map((row) => [formatReportTimestamp(row.date_added), quote(historicalQuote(row.price_buy)), getCommodityStatusLabel(row.status_buy, "buy"), quote(historicalQuote(row.price_sell)), getCommodityStatusLabel(row.status_sell, "sell"), row.game_version || "Unknown"]),
    },
    ...(usablePoints.length > 0 ? { chart: { type: "line" as const, commodityName: commodity.name, terminalName, ...(query.gameVersion ? { gameVersion: query.gameVersion } : {}), data: points } } : {}),
  };
}

export async function buildPriceHistoryAnswer(query: ParsedQuery): Promise<ChatResponse> {
  const problem = locationProblem(query) ?? dateProblem(query);
  if (problem) return { text: problem };
  if (!query.commodity) return { text: 'Which commodity do you want history for? Try "Price history of Laranite".' };
  try {
    if (!query.terminal) {
      const [prices, terminals] = await Promise.all([
        getCommodityPrices({ id_commodity: query.commodity.id }),
        getTerminals().catch(() => []),
      ]);
      return createHistoryTerminalChoices(query, prices, terminals);
    }
    const [records, versions] = await Promise.all([
      getCommodityPriceHistory({ id_commodity: query.commodity.id, id_terminal: query.terminal.id, ...(query.gameVersion ? { game_version: query.gameVersion } : {}) }),
      getGameVersions().catch(() => null),
    ]);
    return createPriceHistoryResponse(query, records, versions?.live);
  } catch {
    return { text: "I couldn't load UEX price history right now. Try again shortly; no historical values have been estimated." };
  }
}

export function createMarketAlertsResponse(
  query: ParsedQuery,
  alerts: readonly MarketAlert[],
  terminals: readonly Terminal[],
  liveVersion?: string | null
): ChatResponse {
  const problem = locationProblem(query) ?? dateProblem(query);
  if (problem) return { text: problem };
  const matching = alerts.filter((row) => (!query.commodity || row.id_commodity === query.commodity.id) && matchesLocation(row, query, terminals) && matchesReport(row, query));
  matching.sort((left, right) => (reportTimestampMs(right.date_added) ?? -Infinity) - (reportTimestampMs(left.date_added) ?? -Infinity));
  const selected = matching.slice(0, MAX_ALERTS);
  if (selected.length === 0) return { text: `UEX returned no market alerts matching your filters${reportScope(query)}. This feed is not a complete market history and does not establish that prices or stock stayed unchanged.` };
  return {
    text: `**UEX market alerts**${query.commodity ? ` for ${query.commodity.name}` : ""}: showing ${selected.length}${matching.length > selected.length ? ` of ${matching.length}` : ""} matching records, newest first${reportScope(query)}. These are reported price and inventory states; the feed supplies no before/after values or reason for a change. Unavailable buy/sell quotes are shown as —.\n\n${summarizeDataFreshness(selected, liveVersion)}`,
    table: {
      headers: ["Commodity", "Terminal", "Reported (UTC)", "Buy aUEC/SCU", "Buy inventory", "Sell aUEC/SCU", "Sell inventory", "Game version"],
      rows: selected.map((row) => [row.commodity_name, row.terminal_name, formatReportTimestamp(row.date_added), quote(buyQuote(row)), `${getCommodityStatusLabel(row.status_buy, "buy")} · ${typeof row.scu_buy === "number" && row.scu_buy >= 0 ? quote(row.scu_buy) : "Unknown"} SCU stock`, quote(sellQuote(row)), `${getCommodityStatusLabel(row.status_sell, "sell")} · ${typeof row.scu_sell === "number" && row.scu_sell >= 0 ? quote(row.scu_sell) : "Unknown"} SCU demand`, row.game_version || "Unknown"]),
    },
  };
}

export async function buildMarketAlertsAnswer(query: ParsedQuery): Promise<ChatResponse> {
  const problem = locationProblem(query) ?? dateProblem(query);
  if (problem) return { text: problem };
  try {
    const [alerts, terminals, versions] = await Promise.all([
      getMarketAlerts(query.commodity?.id),
      getTerminals().catch(() => []),
      getGameVersions().catch(() => null),
    ]);
    return createMarketAlertsResponse(query, alerts, terminals, versions?.live);
  } catch {
    return { text: "I couldn't load UEX market alerts right now. Try again shortly." };
  }
}
