import type { ParsedQuery } from "@/lib/query-parser";
import type { ChatResponse } from "@/lib/types";
import {
  getCommodityPrices as fetchUexCommodityPrices,
  getGameVersions,
  getCommodityRoutes,
  getCommodityRawPrices,
  getSpaceStations,
  getCities,
  getOutposts,
  getRefineryYields,
  getRefineryCapacities,
  getVehiclePurchasePrices,
  getVehiclePurchasePricesAll,
  getVehicleRentalPrices,
  getVehicleRentalPricesAll,
  type CommodityPrice,
  type Vehicle,
} from "@/lib/uex-client";
import { getReferenceData, findMoon, findPlanet, findStarSystem } from "@/lib/data/cache";
import { planMultiHopRoute } from "@/lib/route-planner";
import { getTradePrices, enrichPriceSummaries, isBuyable, isSellable, getCargoConstraint } from "@/lib/trade-data";
import { findTradeOpportunities, TRADE_ESTIMATE_NOTE, type TradeOpportunity } from "@/lib/trade-recommendations";
import { formatCrew, compareCrew, cargoHandlingNotes, shipLogistics } from "@/lib/vehicle-details";
import { summarizeDataFreshness, formatReportTimestamp, type ReportMetadata } from "@/lib/data-freshness";
import { buildPriceHistoryAnswer, buildMarketAlertsAnswer } from "@/lib/market-answer";
import { buildEquipmentAnswer } from "@/lib/equipment-answer";
import { buildExtendedLocationAnswer } from "@/lib/location-answer";
import { buildCraftingAnswer } from "@/lib/crafting-answer";
import { buildMiningAnswer } from "@/lib/mining-answer";
import { generateResponseText, type DataContext } from "@/lib/response-generator";
import {
  getShipWikiData,
  getManufacturerWikiData,
  getShipHardpoints,
  getSystemWikiData,
  getPlanetWikiData,
  getJumpPoints,
  truncateLore,
} from "@/lib/wiki-client";

type HandlerResult = ChatResponse & {
  dataContext?: DataContext;
  fallbackText: string;
  sourceRows?: ReportMetadata[];
  notes?: string[];
};

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Wrap a commodity name with a UEX link marker for rendering */
function uexLink(name: string): string {
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${name}{{uex:${slug}}}`;
}

/** Filter any location-bearing records by star system, planet, and/or moon */
function filterByLocation<T extends { star_system_name?: string; planet_name?: string | null; id_moon?: number; id_orbit?: number; id_poi?: number; id_city?: number; id_space_station?: number; space_station_name?: string | null }>(
  items: T[],
  query: ParsedQuery
): T[] {
  let filtered = items;
  if (query.starSystem) {
    filtered = filtered.filter(
      (p) =>
        p.star_system_name?.toLowerCase() === query.starSystem!.name.toLowerCase()
    );
  }
  if (query.planet) {
    filtered = filtered.filter(
      (p) =>
        p.planet_name?.toLowerCase() === query.planet!.planetName.toLowerCase()
    );
  }
  if (query.moon) {
    filtered = filtered.filter((p) => p.id_moon === query.moon!.moonId);
  }
  if (query.orbit) filtered = filtered.filter((p) => p.id_orbit === query.orbit!.orbitId);
  if (query.poi) filtered = filtered.filter((p) => p.id_poi === query.poi!.poiId);
  if (query.city) filtered = filtered.filter((p) => p.id_city === query.city!.cityId);
  if (query.station) filtered = filtered.filter((p) => p.id_space_station === query.station!.stationId || p.space_station_name?.toLowerCase() === query.station!.stationName.toLowerCase());
  return filtered;
}

/** Format SCU stock, returning fallback when unavailable */
function formatStock(scu: number | undefined | null, fallback = "Unknown"): string {
  return typeof scu === "number" && Number.isFinite(scu) && scu >= 0 ? `${scu} SCU` : fallback;
}

/** Get display name for a vehicle (prefer full name) */
function vehicleDisplayName(v: Vehicle): string {
  return v.name_full || v.name;
}

/** Build a human-readable location label from query context */
function locationLabel(query: ParsedQuery): string {
  if (query.terminal) return ` at ${query.terminal.name}`;
  if (query.city) return ` at ${query.city.cityName}`;
  if (query.station) return ` at ${query.station.stationName}`;
  if (query.poi) return ` at ${query.poi.poiName}`;
  if (query.orbit) return ` near ${query.orbit.orbitName}`;
  if (query.moon) return ` on ${query.moon.moonName}`;
  if (query.planet && query.starSystem) return ` on ${query.planet.planetName} in ${query.starSystem.name}`;
  if (query.planet) return ` on ${query.planet.planetName}`;
  if (query.starSystem) return ` in ${query.starSystem.name}`;
  return "";
}

function getVehicleRoles(v: Vehicle): string[] {
  const roles: string[] = [];
  if (v.is_cargo) roles.push("Cargo");
  if (v.is_mining) roles.push("Mining");
  if (v.is_salvage) roles.push("Salvage");
  if (v.is_combat) roles.push("Combat");
  if (v.is_exploration) roles.push("Exploration");
  if (v.is_medical) roles.push("Medical");
  if (v.is_racing) roles.push("Racing");
  if (v.is_refuel) roles.push("Refueling");
  if (v.is_repair) roles.push("Repair");
  if (v.is_stealth) roles.push("Stealth");
  return roles;
}

/** Detailed reports also need terminal-only availability flags and station IDs. */
async function getCommodityPrices(params: Parameters<typeof fetchUexCommodityPrices>[0]): Promise<CommodityPrice[]> {
  const [prices, reference] = await Promise.all([fetchUexCommodityPrices(params), getReferenceData()]);
  return enrichPriceSummaries(prices, reference.terminals);
}

/** Fetch prices for a raw commodity from both endpoints, deduplicating by terminal */
async function fetchRawCommodityPrices(
  commodity: { id: number; name: string }
): Promise<CommodityPrice[]> {
  const [rawResult, regularResult] = await Promise.allSettled([
    getCommodityRawPrices({ id_commodity: commodity.id }),
    getCommodityPrices({ commodity_name: commodity.name }),
  ]);
  const raw = rawResult.status === "fulfilled" ? rawResult.value : [];
  const regular = regularResult.status === "fulfilled" ? regularResult.value : [];

  // Deduplicate by terminal — prefer whichever entry has more data
  const byTerminal = new Map<string, CommodityPrice>();
  for (const p of raw) byTerminal.set(p.terminal_name, p);
  for (const p of regular) {
    const existing = byTerminal.get(p.terminal_name);
    if (!existing) {
      byTerminal.set(p.terminal_name, p);
    } else {
      // Prefer the entry that has sell price data when the other doesn't
      const existHasSell = existing.price_sell > 0;
      const newHasSell = p.price_sell > 0;
      if (newHasSell && !existHasSell) byTerminal.set(p.terminal_name, p);
    }
  }
  const { terminals } = await getReferenceData();
  return enrichPriceSummaries([...byTerminal.values()], terminals);
}

/** Fetch prices for a single commodity (raw-aware) */
async function fetchCommodityPrices(
  commodity: { id: number; name: string; is_raw: number }
): Promise<CommodityPrice[]> {
  if (commodity.is_raw) {
    return fetchRawCommodityPrices(commodity);
  }
  return getCommodityPrices({ commodity_name: commodity.name });
}

/** Fetch sell prices for a single commodity, filtered by location */
async function fetchSellPrices(
  commodity: { id: number; name: string; is_raw: number },
  query: ParsedQuery
): Promise<CommodityPrice[]> {
  const prices = await fetchCommodityPrices(commodity);
  return filterByLocation(prices, query);
}

async function handleSell(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.commodity) {
    const text = 'I need to know which commodity you want to sell. Try: "Where should I sell Bexalite?"';
    return { text, fallbackText: text };
  }

  // --- Specific terminal check: "Can I sell X at Y?" ---
  if (query.terminal && query.commodity) {
    const prices = await getCommodityPrices({ terminal_name: query.terminal.name });
    const match = prices.find(
      (p) => p.commodity_name.toLowerCase() === query.commodity!.name.toLowerCase()
        && isSellable(p)
    );
    if (match) {
      const fallbackText = `**Yes**, ${query.terminal.name} buys **${query.commodity.name}** at **${formatPrice(match.price_sell)} aUEC/SCU**.`;
      return {
        text: fallbackText,
        fallbackText,
        dataContext: {
          intent: "sell_terminal_check",
          dataDescription: `Yes, ${query.terminal.name} buys ${query.commodity.name} at ${formatPrice(match.price_sell)} aUEC/SCU. Demand: ${formatStock(match.scu_sell)}. A single-row table with details is shown separately.`,
        },
        sourceRows: [match],
        table: {
          headers: ["Terminal", "Commodity", "Sell Price (aUEC/SCU)", "Forecast Demand", "Terminal Inventory", "Reported (UTC)", "Patch"],
          rows: [[
            query.terminal.name,
            query.commodity.name,
            formatPrice(match.price_sell),
            formatStock(match.scu_sell),
            formatStock(match.scu_sell_stock),
            formatReportTimestamp(match.date_modified ?? match.date_added),
            match.game_version || "Unknown",
          ]],
        },
      };
    } else {
      const fallbackText = `**No**, ${query.terminal.name} does not currently buy **${query.commodity.name}**.`;
      return {
        text: fallbackText,
        fallbackText,
        dataContext: {
          intent: "sell_terminal_check",
          dataDescription: `No, ${query.terminal.name} does not currently buy ${query.commodity.name}. The commodity is either not traded at this terminal or has no active demand.`,
        },
      };
    }
  }

  const commodities = query.commodities && query.commodities.length > 1
    ? query.commodities
    : [query.commodity];

  // --- Multi-commodity path ---
  if (commodities.length > 1) {
    const hasBoth = query.modifiers.some((m) => ["both", "all"].includes(m));
    const loc = locationLabel(query);

    if (hasBoth) {
      const allPrices = await Promise.all(
        commodities.map((c) => fetchSellPrices(c, query))
      );
      const sellSets = allPrices.map((prices) => {
        const sellable = prices.filter((p) => isSellable(p));
        return new Map(sellable.map((p) => [p.terminal_name, p]));
      });
      const commonTerminals = [...sellSets[0].keys()].filter((t) =>
        sellSets.every((s) => s.has(t))
      );

      if (commonTerminals.length === 0) {
        const fallbackText = `No terminals currently buy **both ${commodities.map((c) => c.name).join(" and ")}**${loc}.`;
        return {
          text: fallbackText,
          fallbackText,
          dataContext: {
            intent: "sell_multi_both",
            dataDescription: `No terminals currently buy both ${commodities.map((c) => c.name).join(" and ")}${loc}. No intersection found.`,
          },
        };
      }

      const names = commodities.map((c) => c.name);
      const headers = ["Terminal", "Location", ...names.map((n) => `${n} Sell Price`)];
      const rows = commonTerminals.map((t) => {
        const first = sellSets[0].get(t)!;
        return [
          t,
          [first.planet_name, first.star_system_name].filter(Boolean).join(", "),
          ...sellSets.map((s) => formatPrice(s.get(t)!.price_sell) + " aUEC/SCU"),
        ];
      });

      const fallbackText = `Here are locations that buy **both ${names.join(" and ")}**${loc} (${commonTerminals.length}):`;
      return {
        text: fallbackText,
        fallbackText,
        dataContext: {
          intent: "sell_multi_both",
          dataDescription: `Found ${commonTerminals.length} locations${loc} that buy both ${names.join(" and ")}. A table with prices at each location is shown separately.`,
        },
        table: { headers, rows },
      };
    }

    // Separate tables: one per commodity
    const tables: import("@/lib/types").NamedTable[] = [];
    const summaryParts: string[] = [];
    for (const c of commodities) {
      const prices = await fetchSellPrices(c, query);
      const sellable = prices
        .filter((p) => isSellable(p))
        .sort((a, b) => b.price_sell - a.price_sell);

      if (sellable.length > 0) {
        tables.push({
          title: `Sell ${c.name} (${sellable.length})`,
          headers: ["Terminal", "Location", "Sell Price (aUEC/SCU)", "Forecast Demand", "Terminal Inventory", "Reported (UTC)", "Patch"],
          rows: sellable.map((p) => [
            p.terminal_name,
            [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
            formatPrice(p.price_sell),
            formatStock(p.scu_sell),
            formatStock(p.scu_sell_stock),
            formatReportTimestamp(p.date_modified ?? p.date_added),
            p.game_version || "Unknown",
          ]),
        });
        summaryParts.push(`${sellable.length} locations buying ${c.name} (best: ${formatPrice(sellable[0].price_sell)} aUEC/SCU at ${sellable[0].terminal_name})`);
      } else {
        summaryParts.push(`No locations buying ${c.name}`);
      }
    }

    if (tables.length === 0) {
      const fallbackText = `No sell locations found for ${commodities.map((c) => c.name).join(" or ")}${loc}.`;
      return { text: fallbackText, fallbackText };
    }

    const fallbackText = `Here are locations buying **${commodities.map((c) => c.name).join(" and ")}**${loc}:`;
    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "sell_multi",
        dataDescription: `${summaryParts.join(". ")}${loc}. Separate tables per commodity are shown below.`,
      },
      tables,
    };
  }

  // --- Single commodity path ---
  const prices = await fetchSellPrices(query.commodity, query);
  const sellable = prices
    .filter((p) => isSellable(p))
    .sort((a, b) => b.price_sell - a.price_sell);

  if (sellable.length === 0) {
    const loc = locationLabel(query);
    const fallbackText = `No terminals are currently buying **${query.commodity.name}**${loc}. This could be a data issue or the commodity may not be sellable right now.`;
    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "sell",
        dataDescription: `No terminals are currently buying ${query.commodity.name}${loc}. The commodity may be out of stock or unavailable.`,
      },
    };
  }

  const loc = locationLabel(query);
  const hasBestModifier = query.modifiers.some((m) => ["best", "top", "highest"].includes(m));
  const shown = hasBestModifier ? sellable.slice(0, 10) : sellable;
  const fallbackText = hasBestModifier
    ? `Here are the **top ${shown.length} places to sell ${query.commodity.name}${loc}**:`
    : `Here are **all locations buying ${query.commodity.name}${loc}** (${sellable.length}):`;
  return {
    text: fallbackText,
    fallbackText,
    sourceRows: shown,
    dataContext: {
      intent: "sell",
      dataDescription: `Found ${sellable.length} locations buying ${query.commodity.name}${loc}. Best price: ${formatPrice(sellable[0].price_sell)} aUEC/SCU at ${sellable[0].terminal_name}. Lowest price: ${formatPrice(sellable[sellable.length - 1].price_sell)} aUEC/SCU.${hasBestModifier ? ` Showing top ${shown.length}.` : ""} A table with all locations and prices is shown separately.`,
    },
    table: {
      headers: ["Terminal", "Location", "Sell Price (aUEC/SCU)", "Forecast Demand", "Terminal Inventory", "Reported (UTC)", "Patch"],
      rows: shown.map((p) => [
        p.terminal_name,
        [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
        formatPrice(p.price_sell),
        formatStock(p.scu_sell),
        formatStock(p.scu_sell_stock),
        formatReportTimestamp(p.date_modified ?? p.date_added),
        p.game_version || "Unknown",
      ]),
    },
  };
}

async function handleBuy(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.commodity) {
    const text = 'I need to know which commodity you want to buy. Try: "Where can I buy Laranite?"';
    return { text, fallbackText: text };
  }

  // --- Specific terminal check: "Can I buy X at Y?" ---
  if (query.terminal && query.commodity) {
    const prices = await getCommodityPrices({ terminal_name: query.terminal.name });
    const match = prices.find(
      (p) => p.commodity_name.toLowerCase() === query.commodity!.name.toLowerCase()
        && isBuyable(p)
    );
    if (match) {
      const fallbackText = `**Yes**, ${query.terminal.name} sells **${query.commodity.name}** at **${formatPrice(match.price_buy)} aUEC/SCU**.`;
      return {
        text: fallbackText,
        fallbackText,
        dataContext: {
          intent: "buy_terminal_check",
          dataDescription: `Yes, ${query.terminal.name} sells ${query.commodity.name} at ${formatPrice(match.price_buy)} aUEC/SCU. Available stock: ${formatStock(match.scu_buy)}. A single-row table with details is shown separately.`,
        },
        sourceRows: [match],
        table: {
          headers: ["Terminal", "Commodity", "Buy Price (aUEC/SCU)", "Available SCU", "Reported (UTC)", "Patch"],
          rows: [[
            query.terminal.name,
            query.commodity.name,
            formatPrice(match.price_buy),
            formatStock(match.scu_buy),
            formatReportTimestamp(match.date_modified ?? match.date_added),
            match.game_version || "Unknown",
          ]],
        },
      };
    } else {
      const fallbackText = `**No**, ${query.terminal.name} does not currently sell **${query.commodity.name}**.`;
      return {
        text: fallbackText,
        fallbackText,
        dataContext: {
          intent: "buy_terminal_check",
          dataDescription: `No, ${query.terminal.name} does not currently sell ${query.commodity.name}. The commodity is either not stocked or unavailable at this terminal.`,
        },
      };
    }
  }

  const commodities = query.commodities && query.commodities.length > 1
    ? query.commodities
    : [query.commodity];

  // --- Multi-commodity path ---
  if (commodities.length > 1) {
    const hasBoth = query.modifiers.some((m) => ["both", "all"].includes(m));
    const loc = locationLabel(query);

    if (hasBoth) {
      const allPrices = await Promise.all(
        commodities.map(async (c) => {
          const prices = await getCommodityPrices({ commodity_name: c.name });
          return filterByLocation(prices, query);
        })
      );
      const buySets = allPrices.map((prices) => {
        const buyable = prices.filter((p) => isBuyable(p));
        return new Map(buyable.map((p) => [p.terminal_name, p]));
      });
      const commonTerminals = [...buySets[0].keys()].filter((t) =>
        buySets.every((s) => s.has(t))
      );

      if (commonTerminals.length === 0) {
        const fallbackText = `No terminals currently sell **both ${commodities.map((c) => c.name).join(" and ")}**${loc}.`;
        return {
          text: fallbackText,
          fallbackText,
          dataContext: {
            intent: "buy_multi_both",
            dataDescription: `No terminals currently sell both ${commodities.map((c) => c.name).join(" and ")}${loc}. No intersection found.`,
          },
        };
      }

      const names = commodities.map((c) => c.name);
      const headers = ["Terminal", "Location", ...names.map((n) => `${n} Buy Price`)];
      const rows = commonTerminals.map((t) => {
        const first = buySets[0].get(t)!;
        return [
          t,
          [first.planet_name, first.star_system_name].filter(Boolean).join(", "),
          ...buySets.map((s) => formatPrice(s.get(t)!.price_buy) + " aUEC/SCU"),
        ];
      });

      const fallbackText = `Here are locations that sell **both ${names.join(" and ")}**${loc} (${commonTerminals.length}):`;
      return {
        text: fallbackText,
        fallbackText,
        dataContext: {
          intent: "buy_multi_both",
          dataDescription: `Found ${commonTerminals.length} locations${loc} that sell both ${names.join(" and ")}. A table with prices at each location is shown separately.`,
        },
        table: { headers, rows },
      };
    }

    // Separate tables: one per commodity
    const tables: import("@/lib/types").NamedTable[] = [];
    const summaryParts: string[] = [];
    for (const c of commodities) {
      let prices = await getCommodityPrices({ commodity_name: c.name });
      prices = filterByLocation(prices, query);
      const buyable = prices
        .filter((p) => isBuyable(p))
        .sort((a, b) => a.price_buy - b.price_buy);

      if (buyable.length > 0) {
        tables.push({
          title: `Buy ${c.name} (${buyable.length})`,
          headers: ["Terminal", "Location", "Buy Price (aUEC/SCU)", "Available SCU", "Reported (UTC)", "Patch"],
          rows: buyable.map((p) => [
            p.terminal_name,
            [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
            formatPrice(p.price_buy),
            formatStock(p.scu_buy),
            formatReportTimestamp(p.date_modified ?? p.date_added),
            p.game_version || "Unknown",
          ]),
        });
        summaryParts.push(`${buyable.length} locations selling ${c.name} (cheapest: ${formatPrice(buyable[0].price_buy)} aUEC/SCU at ${buyable[0].terminal_name})`);
      } else {
        summaryParts.push(`No locations selling ${c.name}`);
      }
    }

    if (tables.length === 0) {
      const fallbackText = `No buy locations found for ${commodities.map((c) => c.name).join(" or ")}${loc}.`;
      return { text: fallbackText, fallbackText };
    }

    const fallbackText = `Here are locations selling **${commodities.map((c) => c.name).join(" and ")}**${loc}:`;
    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "buy_multi",
        dataDescription: `${summaryParts.join(". ")}${loc}. Separate tables per commodity are shown below.`,
      },
      tables,
    };
  }

  // --- Single commodity path ---
  let buyPrices = await getCommodityPrices({ commodity_name: query.commodity.name });
  buyPrices = filterByLocation(buyPrices, query);
  const buyable = buyPrices
    .filter((p) => isBuyable(p))
    .sort((a, b) => a.price_buy - b.price_buy);

  if (buyable.length === 0) {
    const loc = locationLabel(query);
    const fallbackText = `No terminals are currently selling **${query.commodity.name}**${loc}. It may be out of stock or unavailable.`;
    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "buy",
        dataDescription: `No terminals are currently selling ${query.commodity.name}${loc}. May be out of stock or unavailable.`,
      },
    };
  }

  const loc = locationLabel(query);
  const hasBestModifier = query.modifiers.some((m) => ["best", "cheapest", "top", "lowest"].includes(m));
  const shown = hasBestModifier ? buyable.slice(0, 10) : buyable;
  const fallbackText = hasBestModifier
    ? `Here are the **top ${shown.length} cheapest places to buy ${query.commodity.name}${loc}**:`
    : `Here are **all locations selling ${query.commodity.name}${loc}** (${buyable.length}):`;
  return {
    text: fallbackText,
    fallbackText,
    sourceRows: shown,
    dataContext: {
      intent: "buy",
      dataDescription: `Found ${buyable.length} locations selling ${query.commodity.name}${loc}. Cheapest: ${formatPrice(buyable[0].price_buy)} aUEC/SCU at ${buyable[0].terminal_name}. Most expensive: ${formatPrice(buyable[buyable.length - 1].price_buy)} aUEC/SCU.${hasBestModifier ? ` Showing top ${shown.length}.` : ""} A table with all locations and prices is shown separately.`,
    },
    table: {
      headers: ["Terminal", "Location", "Buy Price (aUEC/SCU)", "Available SCU", "Reported (UTC)", "Patch"],
      rows: shown.map((p) => [
        p.terminal_name,
        [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
        formatPrice(p.price_buy),
        formatStock(p.scu_buy),
        formatReportTimestamp(p.date_modified ?? p.date_added),
        p.game_version || "Unknown",
      ]),
    },
  };
}

async function handleTradeRoute(query: ParsedQuery): Promise<HandlerResult> {
  const params: Record<string, number> = {};
  if (query.commodity) params.id_commodity = query.commodity.id;
  if (query.planet) params.id_planet_origin = query.planet.planetId;
  if (query.terminal) params.id_terminal_origin = query.terminal.id;
  if (query.orbit) params.id_orbit_origin = query.orbit.orbitId;
  if (!Object.keys(params).length) {
    const [prices, reference] = await Promise.all([getTradePrices(), getReferenceData()]);
    const capacity = query.vehicle?.scu ?? 96;
    const trades = findTradeOpportunities(filterByLocation(prices, query), reference.terminals, capacity, query.budget, query.vehicle).slice(0, 8);
    const text = trades.length ? `**Trade routes for ${query.vehicle?.name || `${capacity} SCU cargo`}**${locationLabel(query)}, ranked by estimated gross profit. ${TRADE_ESTIMATE_NOTE}` : "No available profitable trade routes match those locations and ship constraints.";
    return { text, fallbackText: text, sourceRows: trades.flatMap(t => [t.buy, t.sell]), table: tradeTable(trades) };
  }
  const [routes, { terminals }] = await Promise.all([getCommodityRoutes(params), getReferenceData()]);
  const byId = new Map(terminals.map(t => [t.id, t]));
  const available = routes.filter(r => {
    const origin = byId.get(r.id_terminal_origin), destination = byId.get(r.id_terminal_destination);
    if (r.price_origin <= 0 || r.price_destination <= r.price_origin || r.id_terminal_origin === r.id_terminal_destination) return false;
    if (!isBuyable({price_buy:r.price_origin,status_buy:r.status_origin ?? undefined}) || !isSellable({price_sell:r.price_destination,status_sell:r.status_destination ?? undefined})) return false;
    if (getCargoConstraint(query.vehicle, origin) || getCargoConstraint(query.vehicle, destination)) return false;
    if (query.terminal && r.id_terminal_origin !== query.terminal.id) return false;
    if (query.starSystem && (r.id_star_system_origin !== query.starSystem.id || r.id_star_system_destination !== query.starSystem.id)) return false;
    if (query.planet && origin?.id_planet !== query.planet.planetId) return false;
    if (query.moon && origin?.id_moon !== query.moon.moonId) return false;
    if (query.orbit && origin?.id_orbit !== query.orbit.orbitId) return false;
    if (query.poi && origin?.id_poi !== query.poi.poiId) return false;
    if (query.city && origin?.id_city !== query.city.cityId) return false;
    if (query.station && origin?.id_space_station !== query.station.stationId) return false;
    return [origin, destination].every(t => t?.is_available !== 0 && t?.is_available_live !== 0 && t?.is_visible !== 0);
  }).sort((a, b) => (b.price_destination - b.price_origin) - (a.price_destination - a.price_origin)).slice(0, 8);
  if (!available.length) {
    const text = "No available profitable routes match those commodity, location, and ship constraints.";
    return { text, fallbackText: text };
  }
  const text = `**Trade routes by gross price spread**${query.commodity ? ` for ${query.commodity.name}` : ""}${locationLabel(query)}. Spread is sell price minus buy price, in aUEC/SCU. Fuel, fees, travel time, and load quantity are not included. Ask for a profit estimate to apply current supply, forecast demand, and cargo capacity.`;
  const systems = new Set(available.flatMap(r => [r.origin_star_system_name, r.destination_star_system_name]));
  return { text, fallbackText: text,
    sourceRows: available.flatMap(r => [{ game_version: r.game_version_origin }, { game_version: r.game_version_destination }]),
    table: { headers: ["Commodity", "Buy At", "Sell At", "Buy (aUEC/SCU)", "Sell (aUEC/SCU)", "Spread (aUEC/SCU)", "Reported Distance (Gm)", "Source Patches"],
      rows: available.map(r => [uexLink(r.commodity_name), r.origin_terminal_name, r.destination_terminal_name, formatPrice(r.price_origin), formatPrice(r.price_destination), formatPrice(r.price_destination-r.price_origin), r.distance > 0 ? String(r.distance) : "Unknown", `${r.game_version_origin || "Unknown"} / ${r.game_version_destination || "Unknown"}`]) },
    map: systems.size === 1 && available[0].origin_star_system_name ? {
      system: available[0].origin_star_system_name,
      routes: available.map(r => ({ from: r.origin_terminal_name, to: r.destination_terminal_name, profit: r.price_destination-r.price_origin, commodity: r.commodity_name })),
      highlights: [...new Set(available.flatMap(r => [r.origin_terminal_name, r.destination_terminal_name]))],
    } : undefined,
  };
}

async function handlePriceCheck(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.commodity) {
    const text = 'Which commodity do you want to check the price of? Try: "What\'s the price of Agricium?"';
    return { text, fallbackText: text };
  }

  let prices = await getCommodityPrices({ commodity_name: query.commodity.name });
  prices = filterByLocation(prices, query).filter((price) => isBuyable(price) || isSellable(price));

  if (prices.length === 0) {
    const loc = locationLabel(query);
    const text = `No price data found for **${query.commodity.name}**${loc}.`;
    return { text, fallbackText: text };
  }

  const buyPrices = prices.filter(isBuyable);
  const sellPrices = prices.filter(isSellable);

  const minBuy = buyPrices.length > 0 ? Math.min(...buyPrices.map((p) => p.price_buy)) : 0;
  const maxBuy = buyPrices.length > 0 ? Math.max(...buyPrices.map((p) => p.price_buy)) : 0;
  const avgBuy = buyPrices.length > 0 ? buyPrices.reduce((s, p) => s + p.price_buy, 0) / buyPrices.length : 0;
  const minSell = sellPrices.length > 0 ? Math.min(...sellPrices.map((p) => p.price_sell)) : 0;
  const maxSell = sellPrices.length > 0 ? Math.max(...sellPrices.map((p) => p.price_sell)) : 0;
  const avgSell = sellPrices.length > 0 ? sellPrices.reduce((s, p) => s + p.price_sell, 0) / sellPrices.length : 0;

  const loc = locationLabel(query);
  let fallbackText = `**${query.commodity.name}** price overview${loc}:\n\n`;
  fallbackText += buyPrices.length > 0
    ? `- Buy: ${formatPrice(minBuy)} - ${formatPrice(maxBuy)} aUEC/SCU (avg ${formatPrice(avgBuy)})\n`
    : `- Buy: Not available at any terminal\n`;
  fallbackText += sellPrices.length > 0
    ? `- Sell: ${formatPrice(minSell)} - ${formatPrice(maxSell)} aUEC/SCU (avg ${formatPrice(avgSell)})\n`
    : `- Sell: Not accepted at any terminal\n`;
  fallbackText += `- Terminals trading: ${prices.length}`;
  if (query.commodity.is_illegal) fallbackText += `\n- **Warning:** This is an illegal commodity!`;

  let dataSummary = `${query.commodity.name} price overview${loc}. `;
  if (buyPrices.length > 0) {
    dataSummary += `Buy range: ${formatPrice(minBuy)} - ${formatPrice(maxBuy)} aUEC/SCU (avg ${formatPrice(avgBuy)}). `;
  } else {
    dataSummary += `Not available to buy at any terminal. `;
  }
  if (sellPrices.length > 0) {
    dataSummary += `Sell range: ${formatPrice(minSell)} - ${formatPrice(maxSell)} aUEC/SCU (avg ${formatPrice(avgSell)}). `;
  } else {
    dataSummary += `Not accepted for sale at any terminal. `;
  }
  dataSummary += `${prices.length} reported trading locations: ${buyPrices.length} offer purchases by the player and ${sellPrices.length} accept sales from the player. Each location may support only one direction.`;
  if (query.commodity.is_illegal) dataSummary += ` Warning: this is an illegal commodity.`;

  return {
    text: fallbackText,
    fallbackText,
    sourceRows: prices,
    ...(/\b(?:buy\s+and\s+sell|sell\s+and\s+buy)\b/i.test(query.raw) ? {
      table: {
        headers: ["Terminal", "Location", "Buy (aUEC/SCU)", "Sell (aUEC/SCU)"],
        rows: prices.filter((price) => isBuyable(price) || isSellable(price)).slice(0, 50).map((price) => [
          price.terminal_name,
          [price.moon_name || price.planet_name || price.space_station_name, price.star_system_name].filter(Boolean).join(", "),
          isBuyable(price) ? formatPrice(price.price_buy) : "Not available",
          isSellable(price) ? formatPrice(price.price_sell) : "Not accepted",
        ]),
      },
    } : {}),
    dataContext: {
      intent: "price_check",
      dataDescription: dataSummary,
    },
  };
}

async function handlePriceHistory(query: ParsedQuery): Promise<HandlerResult> {
  const result = await buildPriceHistoryAnswer(query);
  return { ...result, fallbackText: result.text };
}

async function handleCommodityRanking(query: ParsedQuery): Promise<HandlerResult> {
  const [prices, { terminals }] = await Promise.all([getTradePrices(), getReferenceData()]);
  const trades = findTradeOpportunities(filterByLocation(prices, query), terminals, 1, undefined, query.vehicle).slice(0, 10);
  const text = trades.length ? "**Commodity rankings by estimated gross profit for up to 1 SCU**, limited by available buy/sell quantities. " + TRADE_ESTIMATE_NOTE : "No profitable, available commodity pairs found for those locations.";
  return { text, fallbackText: text, sourceRows: trades.flatMap(t => [t.buy, t.sell]),
    table: { headers: ["Commodity", "Buy At", "Sell At", "Spread (aUEC/SCU)", "Planned SCU", "Gross Profit (aUEC)", "ROI"],
      rows: trades.map(t => [uexLink(t.name), t.buy.terminal_name, t.sell.terminal_name, formatPrice(t.profitPerScu), String(t.scu), formatPrice(t.profit), `${(100*t.profitPerScu/t.buy.price_buy).toFixed(1)}%`]) } };
}

async function handleFindCommodity(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.commodity) {
    const { commodities } = await getReferenceData();
    const available = commodities
      .filter((c) => c.is_available && c.is_visible)
      .map((c) => c.name)
      .slice(0, 20);
    const text = `I'm not sure which commodity you mean. Here are some available commodities:\n\n${available.join(", ")}`;
    return { text, fallbackText: text };
  }

  const c = query.commodity;
  let fallbackText = `**${c.name}** (${c.code})\n\n`;
  fallbackText += `- Type: ${c.kind || "Unknown"}\n`;
  if (c.price_buy > 0) fallbackText += `- Avg Buy Price: ${formatPrice(c.price_buy)} aUEC/SCU\n`;
  if (c.price_sell > 0) fallbackText += `- Avg Sell Price: ${formatPrice(c.price_sell)} aUEC/SCU\n`;

  const flags: string[] = [];
  if (c.is_extractable) flags.push("Mineable");
  if (c.is_illegal) flags.push("Illegal");
  if (c.is_raw) flags.push("Raw");
  if (c.is_refined) flags.push("Refined");
  if (c.is_harvestable) flags.push("Harvestable");
  if (c.is_refinable) flags.push("Refinable");
  if (c.is_pure) flags.push("Pure");
  if (flags.length > 0) fallbackText += `- Tags: ${flags.join(", ")}`;

  let prices = await fetchCommodityPrices(c);
  prices = filterByLocation(prices, query);

  const tables: import("@/lib/types").NamedTable[] = [];
  const buyLocations = prices
    .filter((p) => isBuyable(p))
    .sort((a, b) => a.price_buy - b.price_buy);
  const sellLocations = prices
    .filter((p) => isSellable(p))
    .sort((a, b) => b.price_sell - a.price_sell);

  if (buyLocations.length > 0) {
    tables.push({
      title: `Where to Buy (${buyLocations.length})`,
      headers: ["Terminal", "Location", "Buy Price", "Stock", "Reported (UTC)", "Patch"],
      rows: buyLocations.map((p) => [
        p.terminal_name,
        [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
        `${formatPrice(p.price_buy)} aUEC/SCU`,
        formatStock(p.scu_buy),
        formatReportTimestamp(p.date_modified ?? p.date_added),
        p.game_version || "Unknown",
      ]),
    });
  }
  if (sellLocations.length > 0) {
    tables.push({
      title: `Where to Sell (${sellLocations.length})`,
      headers: ["Terminal", "Location", "Sell Price", "Forecast Demand", "Terminal Inventory", "Reported (UTC)", "Patch"],
      rows: sellLocations.map((p) => [
        p.terminal_name,
        [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
        `${formatPrice(p.price_sell)} aUEC/SCU`,
        formatStock(p.scu_sell),
        formatStock(p.scu_sell_stock),
        formatReportTimestamp(p.date_modified ?? p.date_added),
        p.game_version || "Unknown",
      ]),
    });
  }

  let dataSummary = `${c.name} (${c.code}) is a ${c.kind || "Unknown"} type commodity.`;
  if (c.price_buy > 0) dataSummary += ` Average buy price: ${formatPrice(c.price_buy)} aUEC/SCU.`;
  if (c.price_sell > 0) dataSummary += ` Average sell price: ${formatPrice(c.price_sell)} aUEC/SCU.`;
  if (flags.length > 0) dataSummary += ` Tags: ${flags.join(", ")}.`;
  dataSummary += ` ${buyLocations.length} buy locations, ${sellLocations.length} sell locations.`;
  if (buyLocations.length > 0) dataSummary += ` Cheapest buy: ${formatPrice(buyLocations[0].price_buy)} aUEC/SCU at ${buyLocations[0].terminal_name}.`;
  if (sellLocations.length > 0) dataSummary += ` Best sell: ${formatPrice(sellLocations[0].price_sell)} aUEC/SCU at ${sellLocations[0].terminal_name}.`;
  dataSummary += ` Tables with full details are shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    sourceRows: prices,
    dataContext: {
      intent: "find_commodity",
      dataDescription: dataSummary,
    },
    tables: tables.length > 0 ? tables : undefined,
  };
}

async function handleVehicleInfo(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.vehicle) {
    const { vehicles } = await getReferenceData();
    const ships = vehicles
      .filter((v) => v.is_spaceship && !v.is_concept && v.scu > 0)
      .sort((a, b) => b.scu - a.scu)
      .slice(0, 10);

    const fallbackText = "Here are the **top cargo ships** by SCU capacity:";
    const top3 = ships.slice(0, 3).map((v) => `${v.name} (${v.scu} SCU)`).join(", ");
    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "vehicle_info",
        dataDescription: `Top ${ships.length} cargo ships by SCU capacity. Top 3: ${top3}. A table with all ships is shown separately.`,
      },
      table: {
        headers: ["Ship", "Manufacturer", "SCU", "Crew", "Pad Size"],
        rows: ships.map((v) => [
          v.name,
          v.company_name,
          String(v.scu),
          formatCrew(v.crew),
          v.pad_type || "N/A",
        ]),
      },
    };
  }

  const v = query.vehicle;
  const { vehicles: catalogue } = await getReferenceData();
  const loanerIds = (v.ids_vehicles_loaners || "").split(",").map(Number).filter(id => id > 0);
  const logistics = shipLogistics(v);
  if (loanerIds.length) logistics.push(`Loaners: ${loanerIds.map(id => catalogue.find(ship => ship.id === id)?.name_full || `Vehicle #${id}`).join(", ")}.`);

  // Fetch UEX prices + wiki data in parallel for speed
  const [purchaseResult, rentalResult, wikiResult, hardpointResult, manufacturerResult] =
    await Promise.allSettled([
      getVehiclePurchasePrices({ id_vehicle: v.id }),
      getVehicleRentalPrices({ id_vehicle: v.id }),
      getShipWikiData(v.name_full || v.name),
      getShipHardpoints(v.name_full || v.name),
      getManufacturerWikiData(v.company_name),
    ]);

  const purchases = purchaseResult.status === "fulfilled" ? purchaseResult.value : [];
  const rentals = rentalResult.status === "fulfilled" ? rentalResult.value : [];
  const wiki = wikiResult.status === "fulfilled" ? wikiResult.value : null;
  const hardpoints = hardpointResult.status === "fulfilled" ? hardpointResult.value : null;
  const mfr = manufacturerResult.status === "fulfilled" ? manufacturerResult.value : null;

  let fallbackText = `**${vehicleDisplayName(v)}**\n\n`;
  fallbackText += `- Manufacturer: ${v.company_name}\n`;
  fallbackText += `- Cargo: ${v.scu} SCU\n`;
  fallbackText += `- Crew: ${formatCrew(v.crew)}\n`;
  if (v.length > 0 || v.width > 0 || v.height > 0) {
    fallbackText += `- Dimensions: ${v.length}m x ${v.width}m x ${v.height}m\n`;
  }
  if (v.mass) fallbackText += `- Mass: ${formatPrice(v.mass)} kg\n`;
  fallbackText += `- Pad Size: ${v.pad_type || "N/A"}\n`;
  if (v.fuel_quantum) fallbackText += `- Quantum Fuel: ${formatPrice(v.fuel_quantum)}\n`;
  if (v.fuel_hydrogen) fallbackText += `- Hydrogen Fuel: ${formatPrice(v.fuel_hydrogen)}\n`;

  const roles = getVehicleRoles(v);
  if (roles.length > 0) fallbackText += `- Roles: ${roles.join(", ")}\n`;

  // Wiki-sourced fields
  if (wiki?.career) fallbackText += `- Career: ${wiki.career}\n`;
  if (wiki?.pledgeCost) fallbackText += `- Pledge Cost: $${wiki.pledgeCost}\n`;
  if (wiki?.productionState) fallbackText += `- Status: ${wiki.productionState}\n`;
  if (wiki?.series) fallbackText += `- Series: ${wiki.series}\n`;

  let dataSummary = `${vehicleDisplayName(v)} by ${v.company_name}. Cargo: ${v.scu} SCU. Crew: ${formatCrew(v.crew)}. Pad size: ${v.pad_type || "N/A"}.`;
  if (v.length > 0) dataSummary += ` Dimensions: ${v.length}m x ${v.width}m x ${v.height}m.`;
  if (v.mass) dataSummary += ` Mass: ${formatPrice(v.mass)} kg.`;
  if (v.fuel_quantum) dataSummary += ` Quantum fuel: ${formatPrice(v.fuel_quantum)}.`;
  if (v.fuel_hydrogen) dataSummary += ` Hydrogen fuel: ${formatPrice(v.fuel_hydrogen)}.`;
  if (roles.length > 0) dataSummary += ` Roles: ${roles.join(", ")}.`;

  // In-game prices
  if (purchases.length > 0) {
    const cheapest = [...purchases].sort((a, b) => a.price_buy - b.price_buy)[0];
    fallbackText += `- In-game Price: from ${formatPrice(cheapest.price_buy)} aUEC (${purchases.length} locations)\n`;
    dataSummary += ` In-game purchase from ${formatPrice(cheapest.price_buy)} aUEC at ${purchases.length} locations.`;
  }
  if (rentals.length > 0) {
    const cheapest = [...rentals].sort((a, b) => a.price_rent - b.price_rent)[0];
    fallbackText += `- Rental: from ${formatPrice(cheapest.price_rent)} aUEC (${rentals.length} locations)\n`;
    dataSummary += ` Rental from ${formatPrice(cheapest.price_rent)} aUEC at ${rentals.length} locations.`;
  }

  // Wiki lore — append truncated description for LLM context
  if (wiki?.lore) {
    const loreSummary = truncateLore(wiki.lore, 2);
    dataSummary += ` Lore: ${loreSummary}`;
    fallbackText += `\n${wiki.lore.split(/[.!?]\s/)[0]}.\n`;
  }

  // Manufacturer context for LLM
  if (mfr?.lore) {
    dataSummary += ` Manufacturer (${v.company_name}): ${truncateLore(mfr.lore, 1)}`;
  }
  if (mfr?.headquarters) {
    dataSummary += ` Headquartered in ${mfr.headquarters}.`;
  }

  // Hardpoint summary for LLM
  if (hardpoints?.summary) {
    dataSummary += ` Hardpoints: ${hardpoints.summary.slice(0, 300)}`;
  }

  // Image from wiki
  const image = wiki?.imageUrl
    ? { url: wiki.imageUrl, alt: vehicleDisplayName(v), caption: `${vehicleDisplayName(v)} — via Star Citizen Wiki` }
    : undefined;

  return {
    text: fallbackText,
    fallbackText,
    image,
    notes: logistics,
    sourceRows: [v],
    dataContext: {
      intent: "vehicle_info",
      dataDescription: dataSummary,
    },
  };
}

async function handleVehicleCompare(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.vehicle || !query.vehicle2) {
    const text = 'I need two ships to compare. Try: "Compare C2 Hercules vs Caterpillar"';
    return { text, fallbackText: text };
  }

  const a = query.vehicle;
  const b = query.vehicle2;

  const fallbackText = `**${a.name}** vs **${b.name}** comparison:`;

  // Helper to bold the "winner" value
  function compare(
    aVal: number,
    bVal: number,
    higherIsBetter: boolean
  ): [string, string] {
    const aStr = formatPrice(aVal);
    const bStr = formatPrice(bVal);
    if (aVal === bVal) return [aStr, bStr];
    const aWins = higherIsBetter ? aVal > bVal : aVal < bVal;
    return aWins ? [`**${aStr}**`, bStr] : [aStr, `**${bStr}**`];
  }

  const [scuA, scuB] = compare(a.scu, b.scu, true);
  const [crewA, crewB] = compareCrew(a.crew, b.crew);
  const [massA, massB] = compare(a.mass, b.mass, false);
  const [lenA, lenB] = compare(a.length, b.length, false);
  const [qfA, qfB] = compare(a.fuel_quantum, b.fuel_quantum, true);
  const [hfA, hfB] = compare(a.fuel_hydrogen, b.fuel_hydrogen, true);

  const rows: string[][] = [
    ["Manufacturer", a.company_name, b.company_name],
    ["Cargo (SCU)", scuA, scuB],
    ["Crew", crewA, crewB],
  ];

  if (a.mass > 0 || b.mass > 0) rows.push(["Mass (kg)", massA, massB]);
  if (a.length > 0 || b.length > 0) rows.push(["Length (m)", lenA, lenB]);
  if (a.width > 0 || b.width > 0) rows.push(["Width (m)", String(a.width), String(b.width)]);
  if (a.height > 0 || b.height > 0) rows.push(["Height (m)", String(a.height), String(b.height)]);
  rows.push(["Pad Size", a.pad_type || "N/A", b.pad_type || "N/A"]);
  rows.push(["Concept", a.is_concept == null ? "Unknown" : a.is_concept ? "Yes" : "No", b.is_concept == null ? "Unknown" : b.is_concept ? "Yes" : "No"]);
  rows.push(["Loading Dock Required", a.is_loading_dock == null ? "Unknown" : a.is_loading_dock ? "Yes" : "No", b.is_loading_dock == null ? "Unknown" : b.is_loading_dock ? "Yes" : "No"]);
  rows.push(["Container Sizes (SCU)", a.container_sizes || "Unknown", b.container_sizes || "Unknown"]);
  if (a.fuel_quantum > 0 || b.fuel_quantum > 0) rows.push(["Quantum Fuel", qfA, qfB]);
  if (a.fuel_hydrogen > 0 || b.fuel_hydrogen > 0) rows.push(["Hydrogen Fuel", hfA, hfB]);
  rows.push(["Roles", getVehicleRoles(a).join(", ") || "N/A", getVehicleRoles(b).join(", ") || "N/A"]);

  const cargoWinner = a.scu > b.scu ? a.name : b.scu > a.scu ? b.name : "tied";
  const rolesA = getVehicleRoles(a).join(", ") || "N/A";
  const rolesB = getVehicleRoles(b).join(", ") || "N/A";
  const dataSummary = `Comparing ${a.name} (by ${a.company_name}) vs ${b.name} (by ${b.company_name}). ${a.name}: ${a.scu} SCU cargo, ${formatCrew(a.crew)} crew, ${a.pad_type || "N/A"} pad, roles: ${rolesA}. ${b.name}: ${b.scu} SCU cargo, ${formatCrew(b.crew)} crew, ${b.pad_type || "N/A"} pad, roles: ${rolesB}. Cargo winner: ${cargoWinner}. A comparison table is shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "vehicle_compare",
      dataDescription: dataSummary,
    },
    table: {
      headers: ["Spec", a.name, b.name],
      rows,
    },
  };
}

async function handleProfitCalc(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.commodity) {
    const text = 'Specify a commodity to estimate profit, for example: "How much profit with a C2 selling Laranite?"';
    return { text, fallbackText: text };
  }
  const capacity = query.vehicle?.scu ?? 96;
  const [prices, { terminals }] = await Promise.all([fetchCommodityPrices(query.commodity), getReferenceData()]);
  const trade = findTradeOpportunities(filterByLocation(prices, query), terminals, capacity, query.budget, query.vehicle, query.terminal?.id)[0];
  if (!trade) {
    const text = `No profitable, available trade for **${query.commodity.name}** fits those locations, supply, demand, and ship constraints.`;
    return { text, fallbackText: text };
  }
  const assumptions = [TRADE_ESTIMATE_NOTE, ...trade.assumptions].join(" ");
  const text = `**${formatPrice(trade.profit)} aUEC estimated gross profit** carrying **${trade.scu} / ${capacity} SCU** of ${trade.name}. Buy at **${trade.buy.terminal_name}**, then sell at **${trade.sell.terminal_name}**.\n\n${assumptions}`;
  return { text, fallbackText: text, sourceRows: [trade.buy, trade.sell], profit: {
    commodityName: trade.name, shipName: query.vehicle?.name || `${capacity} SCU cargo`, scu: trade.scu, cargoCapacity: capacity,
    buyPrice: trade.buy.price_buy, sellPrice: trade.sell.price_sell, buyTerminal: trade.buy.terminal_name, sellTerminal: trade.sell.terminal_name,
    assumptions,
  } };
}

async function handleTerminalInfo(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.terminal) {
    const text = 'I need to know which terminal you\'re asking about. Try: "Refinery Shop - CRU-L1" or use @ to mention a station.';
    return { text, fallbackText: text };
  }

  const terminal = query.terminal;
  const prices = await getCommodityPrices({ terminal_name: terminal.name });

  const location = [
    terminal.city_name || terminal.space_station_name || terminal.outpost_name,
    terminal.moon_name,
    terminal.planet_name,
    terminal.star_system_name,
  ].filter(Boolean).join(", ");

  let fallbackText = `**${terminal.name}**\n\n`;
  fallbackText += `- Location: ${location}\n`;
  fallbackText += `- Type: ${terminal.type || "Trade Terminal"}\n`;
  if (terminal.has_loading_dock) fallbackText += `- Loading Dock: Yes\n`;
  if (terminal.has_docking_port) fallbackText += `- Docking Port: Yes\n`;
  if (terminal.has_freight_elevator) fallbackText += `- Freight Elevator: Yes\n`;
  if (terminal.max_container_size > 0) fallbackText += `- Max Container: ${terminal.max_container_size} SCU\n`;

  if (prices.length === 0) {
    fallbackText += `\nNo commodity price data available for this terminal.`;
    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "terminal_info",
        dataDescription: `${terminal.name} is located at ${location}. Type: ${terminal.type || "Trade Terminal"}. No commodity price data available.`,
      },
    };
  }

  const buying = prices
    .filter((p) => isBuyable(p))
    .sort((a, b) => a.price_buy - b.price_buy);

  const selling = prices
    .filter((p) => isSellable(p))
    .sort((a, b) => b.price_sell - a.price_sell);

  const wantsSell = query.modifiers.includes("sell");
  const wantsBuy = query.modifiers.includes("buy");
  const showBoth = !wantsSell && !wantsBuy;

  if (wantsSell) {
    fallbackText += selling.length > 0
      ? `\nYou can sell **${selling.length} commodities** at ${terminal.name}:`
      : `\nThis terminal does not buy any commodities.`;
  } else if (wantsBuy) {
    fallbackText += buying.length > 0
      ? `\nYou can buy **${buying.length} commodities** at ${terminal.name}:`
      : `\nThis terminal does not sell any commodities.`;
  }

  const tables: import("@/lib/types").NamedTable[] = [];
  if ((showBoth || wantsBuy) && buying.length > 0) {
    tables.push({
      title: `Available to Buy (${buying.length})`,
      headers: ["Commodity", "Buy Price", "Stock", "Reported (UTC)", "Patch"],
      rows: buying.map((p) => [
        uexLink(p.commodity_name),
        `${formatPrice(p.price_buy)} aUEC/SCU`,
        formatStock(p.scu_buy),
        formatReportTimestamp(p.date_modified ?? p.date_added),
        p.game_version || "Unknown",
      ]),
    });
  }
  if ((showBoth || wantsSell) && selling.length > 0) {
    tables.push({
      title: `Sellable Here (${selling.length})`,
      headers: ["Commodity", "Sell Price", "Forecast Demand", "Terminal Inventory", "Reported (UTC)", "Patch"],
      rows: selling.map((p) => [
        uexLink(p.commodity_name),
        `${formatPrice(p.price_sell)} aUEC/SCU`,
        formatStock(p.scu_sell),
        formatStock(p.scu_sell_stock),
        formatReportTimestamp(p.date_modified ?? p.date_added),
        p.game_version || "Unknown",
      ]),
    });
  }

  // Build data summary for LLM
  const features = [];
  if (terminal.has_loading_dock) features.push("loading dock");
  if (terminal.has_docking_port) features.push("docking port");
  if (terminal.has_freight_elevator) features.push("freight elevator");

  let dataSummary = `${terminal.name} is a ${terminal.type || "Trade Terminal"} at ${location}.`;
  if (features.length > 0) dataSummary += ` Has: ${features.join(", ")}.`;
  if (terminal.max_container_size > 0) dataSummary += ` Max container: ${terminal.max_container_size} SCU.`;
  if (wantsSell) {
    dataSummary += selling.length > 0
      ? ` You can sell ${selling.length} commodities here. Best sell price: ${selling[0].commodity_name} at ${formatPrice(selling[0].price_sell)} aUEC/SCU.`
      : ` This terminal does not buy any commodities.`;
  } else if (wantsBuy) {
    dataSummary += buying.length > 0
      ? ` You can buy ${buying.length} commodities here. Cheapest: ${buying[0].commodity_name} at ${formatPrice(buying[0].price_buy)} aUEC/SCU.`
      : ` This terminal does not sell any commodities.`;
  } else {
    dataSummary += ` ${buying.length} commodities available to buy, ${selling.length} commodities you can sell here.`;
  }
  dataSummary += ` Tables with full details are shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    sourceRows: prices,
    dataContext: {
      intent: "terminal_info",
      dataDescription: dataSummary,
    },
    tables: tables.length > 0 ? tables : undefined,
  };
}

async function handleStationInfo(query: ParsedQuery): Promise<HandlerResult> {
  const filters: Record<string, number> = {};
  if (query.starSystem) filters.id_star_system = query.starSystem.id;
  if (query.planet) filters.id_planet = query.planet.planetId;

  const stations = await getSpaceStations(filters);
  const available = filterByLocation(stations, { ...query, station: undefined }).filter(s => s.is_available && (!query.station || s.id === query.station.stationId));

  if (available.length === 0) {
    const text = "No space stations found for that location.";
    return { text, fallbackText: text };
  }

  // Detect feature filters from the raw query
  const lower = query.raw.toLowerCase();
  type FeatureFilter = { key: keyof typeof available[0]; label: string };
  const featureFilters: FeatureFilter[] = [
    { key: "has_refinery", label: "refineries" },
    { key: "has_trade_terminal", label: "trade terminals" },
    { key: "has_refuel", label: "refueling" },
    { key: "has_repair", label: "repair services" },
    { key: "has_clinic", label: "clinics" },
  ];
  const activeFilter = featureFilters.find((f) => {
    if (f.key === "has_refinery") return /refiner/i.test(lower);
    if (f.key === "has_trade_terminal") return /\btrade\b/i.test(lower) && !/trade route/i.test(lower);
    if (f.key === "has_refuel") return /refuel/i.test(lower);
    if (f.key === "has_repair") return /repair/i.test(lower);
    if (f.key === "has_clinic") return /clinic|medical/i.test(lower);
    return false;
  });

  const shown = activeFilter
    ? available.filter((s) => s[activeFilter.key])
    : available;

  const locationLabel = query.planet
    ? `near ${query.planet.planetName}`
    : query.starSystem
      ? `in ${query.starSystem.name}`
      : "";

  const filterLabel = activeFilter ? ` with ${activeFilter.label}` : "";
  const fallbackText = query.planet
    ? `**Space stations${filterLabel} near ${query.planet.planetName}**:`
    : query.starSystem
      ? `**Space stations${filterLabel} in ${query.starSystem.name}**:`
      : `**Space stations${filterLabel}**:`;

  const dataSummary = activeFilter
    ? `Found ${shown.length} space stations${filterLabel}${locationLabel ? ` ${locationLabel}` : ""} out of a total of ${available.length} space stations. A table with details is shown separately.`
    : `Found ${available.length} space stations${locationLabel ? ` ${locationLabel}` : ""}. ${available.filter((s) => s.has_trade_terminal).length} have trade terminals, ${available.filter((s) => s.has_refinery).length} have refineries. A table with details is shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "station_info",
      dataDescription: dataSummary,
    },
    table: {
      headers: ["Station", "Location", "Trade", "Refuel", "Repair", "Refinery", "Clinic", "Pads"],
      rows: shown.map((s) => [
        s.name,
        [s.orbit_name, s.planet_name, s.star_system_name].filter(Boolean).join(", "),
        s.has_trade_terminal ? "Yes" : "No",
        s.has_refuel ? "Yes" : "No",
        s.has_repair ? "Yes" : "No",
        s.has_refinery ? "Yes" : "No",
        s.has_clinic ? "Yes" : "No",
        s.pad_types || "N/A",
      ]),
    },
  };
}

async function handleCityInfo(query: ParsedQuery): Promise<HandlerResult> {
  const filters: Record<string, number> = {};
  if (query.starSystem) filters.id_star_system = query.starSystem.id;
  if (query.planet) filters.id_planet = query.planet.planetId;

  const cities = await getCities(filters);
  const available = filterByLocation(cities, { ...query, city: undefined }).filter(c => c.is_available && (!query.city || c.id === query.city.cityId));

  if (available.length === 0) {
    const text = "No cities found for that location.";
    return { text, fallbackText: text };
  }

  const locationLabel = query.planet ? `on ${query.planet.planetName}` : "";
  const fallbackText = query.planet
    ? `**Cities on ${query.planet.planetName}**:`
    : "**Cities**:";

  const withTrade = available.filter((c) => c.has_trade_terminal).length;
  const withCargo = available.filter((c) => c.has_cargo_center).length;
  const dataSummary = `Found ${available.length} cities${locationLabel ? ` ${locationLabel}` : ""}. ${withTrade} have trade terminals, ${withCargo} have cargo centers. A table with details is shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "city_info",
      dataDescription: dataSummary,
    },
    table: {
      headers: ["City", "Planet", "Trade", "Cargo Center", "Refinery", "Clinic", "Shops", "Pads"],
      rows: available.map((c) => [
        c.name,
        [c.planet_name, c.star_system_name].filter(Boolean).join(", "),
        c.has_trade_terminal ? "Yes" : "No",
        c.has_cargo_center ? "Yes" : "No",
        c.has_refinery ? "Yes" : "No",
        c.has_clinic ? "Yes" : "No",
        c.has_shops ? "Yes" : "No",
        c.pad_types || "N/A",
      ]),
    },
  };
}

async function handleOutpostInfo(query: ParsedQuery): Promise<HandlerResult> {
  const filters: Record<string, number> = {};
  if (query.starSystem) filters.id_star_system = query.starSystem.id;
  if (query.planet) filters.id_planet = query.planet.planetId;
  if (query.moon) filters.id_moon = query.moon.moonId;

  const outposts = await getOutposts(filters);
  const available = filterByLocation(outposts, query).filter(o => o.is_available);

  if (available.length === 0) {
    const text = "No outposts found for that location. Try specifying a planet or moon like Hurston, Daymar, or Cellin.";
    return { text, fallbackText: text };
  }

  const locationName = query.moon?.moonName || query.planet?.planetName;

  // Detect feature filters from the raw query
  const lower = query.raw.toLowerCase();
  type FeatureFilter = { key: keyof typeof available[0]; label: string };
  const featureFilters: FeatureFilter[] = [
    { key: "has_refinery", label: "refineries" },
    { key: "has_trade_terminal", label: "trade terminals" },
    { key: "has_refuel", label: "refueling" },
    { key: "has_clinic", label: "clinics" },
  ];
  const activeFilter = featureFilters.find((f) => {
    if (f.key === "has_refinery") return /refiner|mining/i.test(lower);
    if (f.key === "has_trade_terminal") return /\btrade\b/i.test(lower) && !/trade route/i.test(lower);
    if (f.key === "has_refuel") return /refuel/i.test(lower);
    if (f.key === "has_clinic") return /clinic|medical/i.test(lower);
    return false;
  });

  const shown = activeFilter
    ? available.filter((o) => o[activeFilter.key])
    : available;

  const filterLabel = activeFilter ? ` with ${activeFilter.label}` : "";
  const fallbackText = locationName
    ? `**Outposts${filterLabel} on ${locationName}**:`
    : `**Outposts${filterLabel}**:`;

  const dataSummary = activeFilter
    ? `Found ${shown.length} outposts${filterLabel}${locationName ? ` on ${locationName}` : ""} out of ${available.length} total. A table with details is shown separately.`
    : `Found ${available.length} outposts${locationName ? ` on ${locationName}` : ""}. ${available.filter((o) => o.has_trade_terminal).length} have trade terminals, ${available.filter((o) => o.has_refinery).length} have refineries. A table with details is shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "outpost_info",
      dataDescription: dataSummary,
    },
    table: {
      headers: ["Outpost", "Location", "Trade", "Mining/Refinery", "Clinic", "Refuel"],
      rows: shown.map((o) => [
        o.name,
        [o.moon_name, o.planet_name, o.star_system_name].filter(Boolean).join(", "),
        o.has_trade_terminal ? "Yes" : "No",
        o.has_refinery ? "Yes" : "No",
        o.has_clinic ? "Yes" : "No",
        o.has_refuel ? "Yes" : "No",
      ]),
    },
  };
}

async function handleLocationInfo(query: ParsedQuery): Promise<HandlerResult> {
  if (query.orbit || query.poi) {
    const result = await buildExtendedLocationAnswer(query);
    return { ...result, fallbackText: result.text };
  }
  // Fallback: if no specific entity resolved, try to resolve from locationName or raw query text
  if (!query.moon && !query.planet && !query.starSystem) {
    const { terminals, starSystemMap } = await getReferenceData();
    // Try locationName first, then extract from raw query
    let locationName = query.locationName;
    if (!locationName) {
      const match = query.raw.match(/(?:tell me about|info about|info on|what'?s at|whats at)\s+(.+?)(?:\?|$)/i);
      if (match) locationName = match[1].trim();
    }
    // Last resort: use the full raw query stripped of common words
    if (!locationName) {
      locationName = query.raw.replace(/^(tell me about|what is|what's|whats|info on|info about)\s+/i, "").replace(/[?!.]/g, "").trim();
    }
    if (locationName) {
      const resolvedMoon = findMoon(locationName, terminals);
      if (resolvedMoon) {
        query = { ...query, moon: resolvedMoon };
      } else {
        const resolvedPlanet = findPlanet(locationName, terminals);
        if (resolvedPlanet) {
          query = { ...query, planet: resolvedPlanet };
        } else {
          const resolvedSystem = findStarSystem(locationName, starSystemMap);
          if (resolvedSystem) {
            query = { ...query, starSystem: resolvedSystem };
          }
        }
      }
    }
  }

  if (query.moon) {
    const [outposts, wikiResult] = await Promise.allSettled([
      getOutposts({ id_moon: query.moon.moonId }),
      getPlanetWikiData(query.moon.moonName),
    ]);
    const outpostList = outposts.status === "fulfilled" ? outposts.value : [];
    const wiki = wikiResult.status === "fulfilled" ? wikiResult.value : null;

    // Determine parent planet from outpost data
    const parentPlanet = outpostList.find((o) => o.planet_name)?.planet_name;
    const parentSystem = outpostList.find((o) => o.star_system_name)?.star_system_name;

    const available = outpostList.filter((o) => o.is_available);
    const withTrade = available.filter((o) => o.has_trade_terminal).length;
    const withRefinery = available.filter((o) => o.has_refinery).length;

    let fallbackText = `**${query.moon.moonName}**`;
    if (parentPlanet) fallbackText += ` (moon of ${parentPlanet})`;
    fallbackText += ` overview:\n\n`;
    if (wiki?.lore) {
      fallbackText += `${wiki.lore.split(/[.!?]\s/)[0]}.\n\n`;
    }
    fallbackText += `- Outposts: ${available.length}\n`;
    fallbackText += `- With Trade Terminals: ${withTrade}\n`;
    fallbackText += `- With Refineries: ${withRefinery}\n\n`;
    if (available.length > 0) {
      fallbackText += `Ask more specifically:\n`;
      fallbackText += `- "Outposts on ${query.moon.moonName}"\n`;
      fallbackText += `- "Sell Laranite on ${query.moon.moonName}"`;
    }

    let dataSummary = `${query.moon.moonName} is a moon of ${parentPlanet || "unknown planet"}${parentSystem ? ` in the ${parentSystem} system` : ""}. It has ${available.length} outposts, ${withTrade} with trade terminals, ${withRefinery} with refineries.`;
    if (wiki?.lore) dataSummary += ` Lore: ${truncateLore(wiki.lore, 2)}`;

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "location_info",
        dataDescription: dataSummary,
      },
    };
  }

  if (query.planet) {
    const [stations, cities, outposts, wikiResult] = await Promise.allSettled([
      getSpaceStations({ id_planet: query.planet.planetId }),
      getCities({ id_planet: query.planet.planetId }),
      getOutposts({ id_planet: query.planet.planetId }),
      getPlanetWikiData(query.planet.planetName, query.starSystem?.name),
    ]);
    const stationList = stations.status === "fulfilled" ? stations.value : [];
    const cityList = cities.status === "fulfilled" ? cities.value : [];
    const outpostList = outposts.status === "fulfilled" ? outposts.value : [];
    const wiki = wikiResult.status === "fulfilled" ? wikiResult.value : null;

    const stationCount = stationList.filter((s) => s.is_available).length;
    const cityCount = cityList.filter((c) => c.is_available).length;
    const outpostCount = outpostList.filter((o) => o.is_available).length;

    let fallbackText = `**${query.planet.planetName}** overview:\n\n`;
    if (wiki?.lore) {
      fallbackText += `${wiki.lore.split(/[.!?]\s/)[0]}.\n\n`;
    }
    if (wiki?.type) fallbackText += `- Type: ${wiki.type}\n`;
    if (wiki?.habitable) fallbackText += `- Habitable: ${wiki.habitable}\n`;
    fallbackText += `- Space Stations: ${stationCount}\n`;
    fallbackText += `- Cities: ${cityCount}\n`;
    fallbackText += `- Outposts: ${outpostCount}\n\n`;
    fallbackText += `Ask more specifically:\n`;
    fallbackText += `- "Stations near ${query.planet.planetName}"\n`;
    fallbackText += `- "Cities on ${query.planet.planetName}"\n`;
    fallbackText += `- "Outposts on ${query.planet.planetName}"`;

    // Determine parent system from data if not in query
    const parentSystem = query.starSystem?.name
      || stationList.find((s) => s.star_system_name)?.star_system_name
      || cityList.find((c) => c.star_system_name)?.star_system_name
      || "";
    let dataSummary = `${query.planet.planetName} is a planet${parentSystem ? ` in the ${parentSystem} system` : ""}. It has ${stationCount} space stations, ${cityCount} cities, and ${outpostCount} outposts.`;
    if (wiki?.lore) dataSummary += ` Lore: ${truncateLore(wiki.lore, 2)}`;
    if (wiki?.type) dataSummary += ` Type: ${wiki.type}.`;
    if (wiki?.habitable) dataSummary += ` Habitable: ${wiki.habitable}.`;
    if (wiki?.affiliation) dataSummary += ` Affiliation: ${wiki.affiliation}.`;

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "location_info",
        dataDescription: dataSummary,
      },
    };
  }

  if (query.starSystem) {
    const [stations, cities, outposts, wikiResult, jumpResult] = await Promise.allSettled([
      getSpaceStations({ id_star_system: query.starSystem.id }),
      getCities({ id_star_system: query.starSystem.id }),
      getOutposts({ id_star_system: query.starSystem.id }),
      getSystemWikiData(query.starSystem.name),
      getJumpPoints(query.starSystem.name),
    ]);

    const stationList = stations.status === "fulfilled" ? stations.value : [];
    const cityList = cities.status === "fulfilled" ? cities.value : [];
    const outpostList = outposts.status === "fulfilled" ? outposts.value : [];
    const wiki = wikiResult.status === "fulfilled" ? wikiResult.value : null;
    const jumpPoints = jumpResult.status === "fulfilled" ? jumpResult.value : [];

    const stationCount = stationList.filter((s) => s.is_available).length;
    const cityCount = cityList.filter((c) => c.is_available).length;
    const outpostCount = outpostList.filter((o) => o.is_available).length;

    let fallbackText = `**${query.starSystem.name} System** overview:\n\n`;
    if (wiki?.lore) {
      fallbackText += `${wiki.lore.split(/[.!?]\s/)[0]}.\n\n`;
    }
    if (wiki?.type) fallbackText += `- Type: ${wiki.type}\n`;
    if (wiki?.starType) fallbackText += `- Star Type: ${wiki.starType}\n`;
    if (wiki?.affiliation) fallbackText += `- Affiliation: ${wiki.affiliation}\n`;
    fallbackText += `- Space Stations: ${stationCount}\n`;
    fallbackText += `- Cities: ${cityCount}\n`;
    fallbackText += `- Outposts: ${outpostCount}\n`;

    // Jump points
    if (jumpPoints.length > 0) {
      fallbackText += `\n**Jump Point Connections:**\n`;
      for (const jp of jumpPoints) {
        const dest = jp.from.toLowerCase() === query.starSystem.name.toLowerCase() ? jp.to : jp.from;
        const sizeLabel = jp.size ? ` (${jp.size})` : "";
        fallbackText += `- ${query.starSystem.name} ↔ ${dest}${sizeLabel}\n`;
      }
    }

    let dataSummary = `${query.starSystem.name} system has ${stationCount} space stations, ${cityCount} cities, and ${outpostCount} outposts.`;
    if (wiki?.starType) dataSummary += ` Star type: ${wiki.starType}.`;
    if (wiki?.lore) dataSummary += ` Lore: ${truncateLore(wiki.lore, 2)}`;
    if (wiki?.type) dataSummary += ` Type: ${wiki.type}.`;
    if (wiki?.affiliation) dataSummary += ` Affiliation: ${wiki.affiliation}.`;
    if (jumpPoints.length > 0) {
      const jpDetails = jumpPoints.map((jp) => {
        const dest = jp.from.toLowerCase() === query.starSystem!.name.toLowerCase() ? jp.to : jp.from;
        return jp.size ? `${dest} (${jp.size})` : dest;
      });
      dataSummary += ` Jump point connections: ${jpDetails.join(", ")}.`;
    }

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "location_info",
        dataDescription: dataSummary,
      },
    };
  }

  const result = handleUnknown();
  return { ...result, fallbackText: result.text };
}

async function handleMultiHop(query: ParsedQuery): Promise<HandlerResult> {
  const capacity = query.vehicle?.scu ?? 96;
  const result = await planMultiHopRoute(capacity, 3, query.starSystem?.name, query.vehicle, {
    budget: query.budget, originTerminalId: query.terminal?.id, originPlanetId: query.planet?.planetId,
    originMoonId: query.moon?.moonId, originOrbitId: query.orbit?.orbitId, originPoiId: query.poi?.poiId,
    originCityId: query.city?.cityId, originStationId: query.station?.stationId,
  });
  if (!result?.stops.length) {
    const text = "No profitable multi-hop route fits the available reports and ship constraints.";
    return { text, fallbackText: text };
  }
  const text = `**Multi-hop route for ${query.vehicle?.name || `${capacity} SCU cargo`}**: **${formatPrice(result.totalProfit)} aUEC estimated gross profit**, with ${formatPrice(result.totalInvestment)} aUEC total purchase costs across the legs.\n\n${TRADE_ESTIMATE_NOTE} Reported distance: ${result.distanceGm === null ? "incomplete or unknown" : `${result.distanceGm.toFixed(3)} Gm`}.`;
  const flights = result.stops.filter(s => s.action === "fly");
  return { text, fallbackText: text, notes: [...result.warnings, ...(query.terminal || query.planet || query.moon || query.orbit || query.poi || query.city || query.station ? ["The selected location constrains the first pickup; later legs may travel elsewhere in the selected system."] : []), ...(query.budget !== undefined ? [`Starting budget: ${formatPrice(query.budget)} aUEC. Later purchases reinvest the proceeds of earlier sales.`] : [])], sourceRows: result.sourceRows,
    table: { headers: ["Step", "Action", "Terminal", "Cargo", "SCU", "Amount (aUEC)", "Distance (Gm)"],
      rows: result.stops.map(s => [String(s.step), s.action === "fly" && s.reposition ? "Fly empty to next pickup" : s.action,
        s.terminalName, s.commodityName || "—", s.quantity == null ? "—" : String(s.quantity),
        s.action === "buy" ? formatPrice(s.totalCost || 0) : s.action === "sell" ? `+${formatPrice(s.profit || 0)} gross profit` : "—",
        s.action === "fly" ? s.distanceGm == null ? "Unknown" : s.distanceGm.toFixed(3) : "—"]) },
    map: result.system && !result.system.includes("→") && !result.system.includes(",") && !result.system.includes(" / ") ? {
      system: result.system, highlights: [...new Set(result.stops.map(s => s.terminalName))],
      routes: flights.map(s => ({ from: s.fromTerminalName || "Unknown", to: s.terminalName, profit: 0, commodity: s.reposition ? "Empty reposition" : s.commodityName || "Cargo" })),
    } : undefined,
  };
}

function tradeTable(trades: TradeOpportunity[]) {
  return { headers: ["Commodity", "Buy At", "Sell At", "Planned SCU", "Investment (aUEC)", "Gross Profit (aUEC)", "Assumptions"],
    rows: trades.map(t => [uexLink(t.name), t.buy.terminal_name, t.sell.terminal_name, String(t.scu), formatPrice(t.investment), `+${formatPrice(t.profit)}`, t.assumptions.join("; ") || "Reported supply and forecast demand"]) };
}

async function handleBudgetTrade(query: ParsedQuery): Promise<HandlerResult> {
  const budget = query.budget ?? 50000;
  const capacity = query.vehicle?.scu ?? 96;
  const [prices, { terminals }] = await Promise.all([getTradePrices(), getReferenceData()]);
  const trades = findTradeOpportunities(filterByLocation(prices, query), terminals, capacity, budget, query.vehicle).slice(0, 8);
  const text = trades.length
    ? `**Best trades with ${formatPrice(budget)} aUEC**, using ${query.vehicle?.name || `${capacity} SCU cargo`}${locationLabel(query)}.\n\n${TRADE_ESTIMATE_NOTE}`
    : `No profitable, available trades fit a budget of **${formatPrice(budget)} aUEC** and those ship/location constraints.`;
  return { text, fallbackText: text, sourceRows: trades.flatMap(t => [t.buy, t.sell]), table: tradeTable(trades) };
}

async function handleLocationTrade(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.terminal) {
    const text = 'Specify a starting terminal, for example: "I am at Admin - HUR-L1, what should I buy?"';
    return { text, fallbackText: text };
  }
  const terminal = query.terminal;
  const [local, all, { terminals }] = await Promise.all([getCommodityPrices({ id_terminal: String(terminal.id) }), getTradePrices(), getReferenceData()]);
  const prices = [...all.filter(p => p.id_terminal !== terminal.id), ...local];
  const trades = findTradeOpportunities(prices, terminals, query.vehicle?.scu ?? 96, query.budget, query.vehicle, terminal.id).slice(0, 8);
  const text = trades.length ? `**Trades from ${terminal.name}**${query.vehicle ? ` with ${query.vehicle.name}` : " using 96 SCU capacity"}.\n\n${TRADE_ESTIMATE_NOTE}`
    : `No profitable, available trades from **${terminal.name}** fit the reported supply, demand, and ship constraints.`;
  return { text, fallbackText: text, sourceRows: trades.flatMap(t => [t.buy, t.sell]), table: tradeTable(trades) };
}

async function handleCommodityCategory(query: ParsedQuery): Promise<HandlerResult> {
  const { commodities } = await getReferenceData();
  const category = query.category;

  if (!category) {
    const text = 'Which category? Try: "Show me all metals", "List illegal commodities", "What minerals are there?"';
    return { text, fallbackText: text };
  }

  let filtered: typeof commodities;
  let categoryLabel: string;

  if (category === "_illegal") {
    filtered = commodities.filter((c) => c.is_illegal && c.is_available && c.is_visible);
    categoryLabel = "Illegal";
  } else if (category === "_raw") {
    filtered = commodities.filter((c) => c.is_raw && c.is_available && c.is_visible);
    categoryLabel = "Raw";
  } else if (category === "_extractable") {
    filtered = commodities.filter((c) => c.is_extractable && c.is_available && c.is_visible);
    categoryLabel = "Mineable";
  } else if (category === "_harvestable") {
    filtered = commodities.filter((c) => c.is_harvestable && c.is_available && c.is_visible);
    categoryLabel = "Harvestable";
  } else {
    filtered = commodities.filter((c) => c.kind === category && c.is_available && c.is_visible);
    categoryLabel = category;
  }

  if (filtered.length === 0) {
    const text = `No commodities found in the **${categoryLabel}** category.`;
    return { text, fallbackText: text };
  }

  const fallbackText = `**${categoryLabel} Commodities** (${filtered.length}):`;
  const withBuyPrice = filtered.filter((c) => c.price_buy > 0);
  const avgBuy = withBuyPrice.length > 0 ? withBuyPrice.reduce((s, c) => s + c.price_buy, 0) / withBuyPrice.length : 0;
  const dataSummary = `Found ${filtered.length} ${categoryLabel.toLowerCase()} commodities.${avgBuy > 0 ? ` Average buy price: ${formatPrice(avgBuy)} aUEC/SCU.` : ""} A table with all commodities is shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "commodity_category",
      dataDescription: dataSummary,
    },
    table: {
      headers: ["Commodity", "Code", "Avg Buy", "Avg Sell", "Tags"],
      rows: filtered.map((c) => {
        const tags: string[] = [];
        if (c.is_illegal) tags.push("Illegal");
        if (c.is_raw) tags.push("Raw");
        if (c.is_extractable) tags.push("Mineable");
        return [
          uexLink(c.name),
          c.code,
          c.price_buy > 0 ? formatPrice(c.price_buy) : "—",
          c.price_sell > 0 ? formatPrice(c.price_sell) : "—",
          tags.join(", ") || "—",
        ];
      }),
    },
  };
}

async function handlePriceCompare(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.commodity) {
    const text = 'I need a commodity to compare. Try: "Compare Laranite prices in Stanton vs Pyro"';
    return { text, fallbackText: text };
  }

  const sys1 = query.starSystem;
  const sys2 = query.starSystem2;

  if (!sys1 || !sys2) {
    const text = 'I need two systems to compare. Try: "Compare Laranite prices in Stanton vs Pyro"';
    return { text, fallbackText: text };
  }

  const allPrices = await getCommodityPrices({ commodity_name: query.commodity.name });

  const sys1Prices = allPrices.filter((p) => p.star_system_name?.toLowerCase() === sys1.name.toLowerCase());
  const sys2Prices = allPrices.filter((p) => p.star_system_name?.toLowerCase() === sys2.name.toLowerCase());

  const tables: import("@/lib/types").NamedTable[] = [];

  const sys1Buy = sys1Prices.filter(isBuyable).sort((a, b) => a.price_buy - b.price_buy);
  const sys1Sell = sys1Prices.filter(isSellable).sort((a, b) => b.price_sell - a.price_sell);
  const sys2Buy = sys2Prices.filter(isBuyable).sort((a, b) => a.price_buy - b.price_buy);
  const sys2Sell = sys2Prices.filter(isSellable).sort((a, b) => b.price_sell - a.price_sell);

  if (sys1Buy.length > 0 || sys1Sell.length > 0) {
    const rows: string[][] = [];
    for (const p of sys1Buy.slice(0, 5)) {
      rows.push([p.terminal_name, `${formatPrice(p.price_buy)} (buy)`, formatStock(p.scu_buy, "—")]);
    }
    for (const p of sys1Sell.slice(0, 5)) {
      rows.push([p.terminal_name, `${formatPrice(p.price_sell)} (sell)`, formatStock(p.scu_sell, "—")]);
    }
    tables.push({
      title: `${sys1.name} (${sys1Buy.length} buy, ${sys1Sell.length} sell)`,
      headers: ["Terminal", "Price", "Stock/Demand"],
      rows,
    });
  }

  if (sys2Buy.length > 0 || sys2Sell.length > 0) {
    const rows: string[][] = [];
    for (const p of sys2Buy.slice(0, 5)) {
      rows.push([p.terminal_name, `${formatPrice(p.price_buy)} (buy)`, formatStock(p.scu_buy, "—")]);
    }
    for (const p of sys2Sell.slice(0, 5)) {
      rows.push([p.terminal_name, `${formatPrice(p.price_sell)} (sell)`, formatStock(p.scu_sell, "—")]);
    }
    tables.push({
      title: `${sys2.name} (${sys2Buy.length} buy, ${sys2Sell.length} sell)`,
      headers: ["Terminal", "Price", "Stock/Demand"],
      rows,
    });
  }

  const avgBuy1 = sys1Buy.length > 0 ? sys1Buy.reduce((s, p) => s + p.price_buy, 0) / sys1Buy.length : 0;
  const avgSell1 = sys1Sell.length > 0 ? sys1Sell.reduce((s, p) => s + p.price_sell, 0) / sys1Sell.length : 0;
  const avgBuy2 = sys2Buy.length > 0 ? sys2Buy.reduce((s, p) => s + p.price_buy, 0) / sys2Buy.length : 0;
  const avgSell2 = sys2Sell.length > 0 ? sys2Sell.reduce((s, p) => s + p.price_sell, 0) / sys2Sell.length : 0;

  let fallbackText = `**${query.commodity.name}** prices: **${sys1.name}** vs **${sys2.name}**\n\n`;
  fallbackText += `- ${sys1.name} avg buy: ${avgBuy1 > 0 ? formatPrice(avgBuy1) : "N/A"} | avg sell: ${avgSell1 > 0 ? formatPrice(avgSell1) : "N/A"}\n`;
  fallbackText += `- ${sys2.name} avg buy: ${avgBuy2 > 0 ? formatPrice(avgBuy2) : "N/A"} | avg sell: ${avgSell2 > 0 ? formatPrice(avgSell2) : "N/A"}`;

  let dataSummary = `${query.commodity.name} price comparison between ${sys1.name} and ${sys2.name}. `;
  dataSummary += `${sys1.name}: ${sys1Buy.length} buy locations (avg ${avgBuy1 > 0 ? formatPrice(avgBuy1) : "N/A"}), ${sys1Sell.length} sell locations (avg ${avgSell1 > 0 ? formatPrice(avgSell1) : "N/A"}). `;
  dataSummary += `${sys2.name}: ${sys2Buy.length} buy locations (avg ${avgBuy2 > 0 ? formatPrice(avgBuy2) : "N/A"}), ${sys2Sell.length} sell locations (avg ${avgSell2 > 0 ? formatPrice(avgSell2) : "N/A"}). `;
  dataSummary += `Tables with details are shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    sourceRows: [...sys1Prices, ...sys2Prices],
    dataContext: {
      intent: "price_compare",
      dataDescription: dataSummary,
    },
    tables: tables.length > 0 ? tables : undefined,
  };
}

async function handleFleetTrade(query: ParsedQuery): Promise<HandlerResult> {
  const vehicles = [query.vehicle, query.vehicle2].filter((v): v is Vehicle => !!v);
  if (vehicles.length < 2) {
    const text = 'Specify two ships, for example: "Best trades for my C2 and Caterpillar"';
    return { text, fallbackText: text };
  }
  const [prices, { terminals }] = await Promise.all([getTradePrices(), getReferenceData()]);
  const filtered = filterByLocation(prices, query);
  const sourceRows: CommodityPrice[] = [];
  const tables = vehicles.map(ship => {
    const trades = findTradeOpportunities(filtered, terminals, ship.scu, query.budget, ship).slice(0, 5);
    sourceRows.push(...trades.flatMap(t => [t.buy, t.sell]));
    return { title: `${ship.name} (${ship.scu} SCU)${ship.is_concept ? " — concept; excluded" : trades.length ? "" : " — no matching trades"}`, ...tradeTable(trades) };
  });
  const text = `**Fleet trade comparison** for ${vehicles.map(v => v.name).join(" and ")}. Each ship is an independent scenario; these estimates do not allocate shared stock to simultaneous runs.\n\n${TRADE_ESTIMATE_NOTE}`;
  return { text, fallbackText: text, tables, sourceRows };
}

const HELP_TEXT =
  "**Crafting & Missions**\n" +
  "- What materials do I need to craft an XL-1 quantum drive?\n" +
  "- How do I unlock the XL-1 blueprint?\n" +
  "- Tell me about the Blackbox Retrieval mission\n\n" +
  `**Reported commodity prices**\n` +
  `- "Where's the best place to sell Laranite?"\n` +
  `- "Where can I buy Quantanium near Hurston?"\n` +
  `- "Where can I buy and sell Aluminum?"\n\n` +
  `**Market & Prices**\n` +
  `- "Price history of Agricium"\n` +
  `- "Compare Laranite prices in Stanton vs Pyro"\n` +
  `- "Show me all metals"\n\n` +
  `**Mining**\n` +
  `- "Where can I mine Laranite?"\n` +
  `- "Which ores are found on Hurston?"\n` +
  `- "Can I mine Agricium on Daymar?"\n\n` +
  `**Refining & Fuel**\n` +
  `- "Where should I refine Quantanium?"\n` +
  `- "What are the refining methods?"\n` +
  `- "What are the cheapest fuel prices in Stanton?"\n\n` +
  `**Ships**\n` +
  `- "Tell me about the C2 Hercules"\n` +
  `- "Where can I buy the Caterpillar in-game?"\n` +
  `- "What ships can I rent?"\n` +
  `- "Compare C2 vs Caterpillar"\n` +
  `**Equipment & alerts**\n` +
  `- "Where can I buy Lancet MH2?"\n` +
  `- "Compare Lancet MH2 vs Arbor MH1"\n` +
  `- "Show scraper modules"\n` +
  `- "Compare Abrade vs Trawler"\n` +
  `- "Show market alerts in Stanton"\n` +
  `- "Price history of Laranite at TDD - Area18"\n\n` +
  `**Locations**\n` +
  `- "What space stations have a refinery?"\n` +
  `- "Cities on Hurston"\n` +
  `- Type @terminal-name to see what's traded there`;

function handleHelp(): HandlerResult {
  return {
    text: `Here's what I can help you with:\n\n${HELP_TEXT}`,
    fallbackText: `Here's what I can help you with:\n\n${HELP_TEXT}`,
    dataContext: {
      intent: "help",
      dataDescription: "User asked what I can do. Displayed a list of features and example queries covering trading, market data, mining locations, refining, fuel, ships, and locations.",
    },
  };
}

function handleUnknown(): ChatResponse {
  return {
    text: `I'm not sure what you're asking. Here are some things I can help with:\n\n${HELP_TEXT}`,
  };
}

// --- Refinery handlers ---

async function handleRefineryYields(query: ParsedQuery): Promise<HandlerResult> {
  const [yields, capacities] = await Promise.all([
    getRefineryYields(),
    getRefineryCapacities(),
  ]);

  // Build capacity lookup by terminal id
  const capacityMap = new Map<number, number>();
  for (const c of capacities) {
    capacityMap.set(c.id_terminal, c.value);
  }

  let filtered = yields;

  // Filter by commodity if specified
  // Refinery yields use raw ore names (e.g. "Quantanium (Raw)") while the
  // commodity entity may be the refined form ("Quantanium"). Match by:
  // 1. Direct id match
  // 2. Parent id match (refined ↔ raw are linked via id_parent)
  // 3. Substring on names as fallback
  if (query.commodity) {
    const cId = query.commodity.id;
    const cParent = query.commodity.id_parent;
    const cName = query.commodity.name.toLowerCase();
    filtered = filtered.filter(
      (y) =>
        y.id_commodity === cId ||
        (cParent && y.id_commodity === cParent) ||
        y.commodity_name.toLowerCase().includes(cName) ||
        cName.includes(y.commodity_name.toLowerCase())
    );
  }

  // Filter by location (reuses generic filterByLocation which also handles moon)
  filtered = filterByLocation(filtered, query);

  // Sort by yield bonus descending (best refineries first)
  filtered.sort((a, b) => b.value - a.value);

  if (filtered.length === 0) {
    const what = query.commodity ? query.commodity.name : "that commodity";
    const fallbackText = `UEX has no reported refinery yield entries for **${what}**${locationLabel(query)}. I can't rank refineries for it from the available data.`;
    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "refinery_yields",
        dataDescription: `No refinery yield data found for ${what}${locationLabel(query)}.`,
      },
    };
  }

  const loc = locationLabel(query);
  const commodityLabel = query.commodity ? query.commodity.name : "all commodities";
  const best = filtered[0];
  const fallbackText = query.commodity
    ? `Here are the **refinery yields for ${query.commodity.name}${loc}** (${filtered.length} refineries):`
    : `Here are **refinery yields${loc}** (${filtered.length} entries):`;

  const shown = filtered.slice(0, 25);

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "refinery_yields",
      dataDescription: `Found ${filtered.length} refinery yield entries for ${commodityLabel}${loc}. Best yield bonus: ${best.terminal_name} at ${best.value >= 0 ? "+" : ""}${best.value}%. A table with all refineries, yield bonuses, and capacities is shown separately.`,
    },
    notes: ["UEX does not clearly specify the unit of its capacity values; they are shown as supplied, not as SCU."],
    table: {
      headers: ["Refinery", "Location", "Commodity", "Yield Bonus", "Capacity (UEX value)"],
      rows: shown.map((y) => [
        y.terminal_name,
        [y.planet_name || y.moon_name || y.space_station_name, y.star_system_name].filter(Boolean).join(", "),
        y.commodity_name,
        `${y.value >= 0 ? "+" : ""}${y.value}%`,
        capacityMap.has(y.id_terminal) ? formatPrice(capacityMap.get(y.id_terminal)!) : "Unknown",
      ]),
    },
  };
}

async function handleRefineryMethod(query: ParsedQuery): Promise<HandlerResult> {
  const { refineryMethods } = await getReferenceData();

  // Check if asking about a specific method
  const lower = query.raw.toLowerCase();
  const specificMethod = refineryMethods.find(
    (m) => lower.includes(m.name.toLowerCase()) || lower.includes(m.code.toLowerCase())
  );

  const ratingLabel = (n: number) => {
    if (n === 1) return "Low";
    if (n === 2) return "Moderate";
    return "High";
  };

  if (specificMethod) {
    const m = specificMethod;
    const fallbackText = `**${m.name}** (${m.code})\n\n` +
      `- Yield: ${ratingLabel(m.rating_yield)} (${m.rating_yield}/3)\n` +
      `- Cost: ${ratingLabel(m.rating_cost)} (${m.rating_cost}/3)\n` +
      `- Speed: ${ratingLabel(m.rating_speed)} (${m.rating_speed}/3)`;

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "refinery_method",
        dataDescription: `${m.name} (${m.code}): Yield ${ratingLabel(m.rating_yield)} (${m.rating_yield}/3), Cost ${ratingLabel(m.rating_cost)} (${m.rating_cost}/3), Speed ${ratingLabel(m.rating_speed)} (${m.rating_speed}/3). Higher yield = more output. Higher cost = more expensive. Higher speed = faster processing.`,
      },
    };
  }

  // Show all methods sorted by yield
  const sorted = [...refineryMethods].sort((a, b) => b.rating_yield - a.rating_yield || a.rating_cost - b.rating_cost);
  const fallbackText = `Here are all **${sorted.length} refining methods** with their ratings:`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "refinery_method",
      dataDescription: `There are ${sorted.length} refining methods. Each has yield, cost, and speed ratings from 1-3 (Low/Moderate/High). Higher yield = more refined output. Higher cost = more expensive. Higher speed = faster processing. Best yield methods: ${sorted.filter(m => m.rating_yield === 3).map(m => m.name).join(", ")}. A comparison table is shown separately.`,
    },
    table: {
      headers: ["Method", "Code", "Yield", "Cost", "Speed"],
      rows: sorted.map((m) => [
        m.name,
        m.code,
        `${ratingLabel(m.rating_yield)} (${m.rating_yield}/3)`,
        `${ratingLabel(m.rating_cost)} (${m.rating_cost}/3)`,
        `${ratingLabel(m.rating_speed)} (${m.rating_speed}/3)`,
      ]),
    },
  };
}

// --- Fuel handler ---

async function handleFuelPrices(query: ParsedQuery): Promise<HandlerResult> {
  const { fuelPrices, terminalMap } = await getReferenceData();

  // Enrich fuel prices with terminal location data (API only returns terminal_name, no location fields)
  type EnrichedFuelPrice = typeof fuelPrices[0] & {
    star_system_name: string;
    planet_name: string | null;
    moon_name: string | null;
    space_station_name: string | null;
    city_name: string | null;
    outpost_name: string | null;
  };
  const enriched: EnrichedFuelPrice[] = fuelPrices.map((f) => {
    const terminal = terminalMap.get(f.id_terminal);
    return {
      ...f,
      id_moon: terminal?.id_moon,
      id_orbit: terminal?.id_orbit,
      id_poi: terminal?.id_poi,
      id_city: terminal?.id_city,
      id_space_station: terminal?.id_space_station,
      star_system_name: terminal?.star_system_name ?? "",
      planet_name: terminal?.planet_name ?? null,
      moon_name: terminal?.moon_name ?? null,
      space_station_name: terminal?.space_station_name ?? null,
      city_name: terminal?.city_name ?? null,
      outpost_name: terminal?.outpost_name ?? null,
    };
  });

  let filtered = enriched.filter(f => Number.isFinite(f.price_buy) && f.price_buy > 0);

  // Detect fuel type from query
  const lower = query.raw.toLowerCase();
  const isHydrogen = lower.includes("hydrogen");
  const isQuantum = lower.includes("quantum");

  if (isHydrogen) {
    filtered = filtered.filter((f) => f.commodity_name.toLowerCase().includes("hydrogen"));
  } else if (isQuantum) {
    filtered = filtered.filter((f) => f.commodity_name.toLowerCase().includes("quantum"));
  }

  // Filter by location (now works because we enriched with terminal location data)
  filtered = filterByLocation(filtered, query);

  // Sort by price ascending (cheapest first)
  filtered.sort((a, b) => a.price_buy - b.price_buy);

  if (filtered.length === 0) {
    const fuelType = isHydrogen ? "Hydrogen " : isQuantum ? "Quantum " : "";
    const fallbackText = `No ${fuelType}fuel price data found${locationLabel(query)}.`;
    return { text: fallbackText, fallbackText };
  }

  const loc = locationLabel(query);
  const fuelType = isHydrogen ? "Hydrogen " : isQuantum ? "Quantum " : "";
  const cheapest = filtered[0];
  const fallbackText = `Here are **${fuelType}fuel prices${loc}** (${filtered.length} locations):`;

  return {
    text: fallbackText,
    fallbackText,
    sourceRows: filtered as (typeof filtered[number] & ReportMetadata)[],
    dataContext: {
      intent: "fuel_prices",
      dataDescription: `Found ${filtered.length} ${fuelType.trim()} fuel price entries${loc}. Cheapest: ${cheapest.terminal_name} at ${formatPrice(cheapest.price_buy)} aUEC/SCU. A table with all locations and prices is shown separately.`,
    },
    table: {
      headers: ["Terminal", "Location", "Fuel Type", "Price (aUEC/SCU)", "Average (aUEC/SCU)"],
      rows: filtered.map((f) => [
        f.terminal_name,
        [f.planet_name || f.moon_name || f.space_station_name || f.city_name, f.star_system_name].filter(Boolean).join(", "),
        f.commodity_name,
        formatPrice(f.price_buy),
        formatPrice(f.price_buy_avg),
      ]),
    },
  };
}

// --- Vehicle buy/rent handlers ---

type VehiclePriceConfig<TSummary, TDetail> = {
  intent: "vehicle_buy" | "vehicle_rent";
  noun: string;               // "purchase" | "rental"
  emptyAllMsg: string;        // message when no data at all
  emptyVehicleMsg: string;    // suffix when specific vehicle not found
  allTableHeader: string;     // "Cheapest Price (aUEC)" | "Cheapest Rental (aUEC)"
  detailPriceHeader: string;  // "Price (aUEC)" | "Rental Price (aUEC)"
  fetchAll: () => Promise<TSummary[]>;
  fetchOne: (params: { id_vehicle: number }) => Promise<TDetail[]>;
  getPrice: (p: TSummary | TDetail) => number;
  getAvgPrice: (p: TDetail) => number;
};

function vehicleLocation(p: { city_name?: string | null; moon_name?: string | null; space_station_name?: string | null; outpost_name?: string | null; planet_name?: string | null; star_system_name?: string }): string {
  return [p.city_name || p.moon_name || p.space_station_name || p.outpost_name, p.planet_name, p.star_system_name].filter(Boolean).join(", ");
}

async function handleVehiclePrices<
  TSummary extends { id_vehicle: number; id_terminal: number; vehicle_name: string; terminal_name: string },
  TDetail extends { id_terminal: number; terminal_name: string; city_name?: string | null; moon_name?: string | null; space_station_name?: string | null; outpost_name?: string | null; planet_name?: string | null; star_system_name: string },
>(query: ParsedQuery, config: VehiclePriceConfig<TSummary, TDetail>): Promise<HandlerResult> {
  const { noun, fetchAll, fetchOne, getPrice, getAvgPrice } = config;
  const reference = await getReferenceData();
  function enrich<T extends { id_terminal: number }>(rows: T[]) {
    return rows.filter(row => !query.terminal || row.id_terminal === query.terminal.id).map(row => {
      const terminal = reference.terminalMap.get(row.id_terminal);
      return { ...row, id_moon: terminal?.id_moon, id_orbit: terminal?.id_orbit, id_poi: terminal?.id_poi,
        id_city: terminal?.id_city, id_space_station: terminal?.id_space_station,
        star_system_name: terminal?.star_system_name, planet_name: terminal?.planet_name,
        city_name: terminal?.city_name, space_station_name: terminal?.space_station_name,
        moon_name: terminal?.moon_name, outpost_name: terminal?.outpost_name };
    });
  }
  if (!query.vehicle) {
    const allPrices = filterByLocation(enrich(await fetchAll()), query).filter(p => getPrice(p) > 0 && reference.vehicles.find(v => v.id === p.id_vehicle)?.is_concept !== 1);
    const byVehicle = new Map<number, typeof allPrices[number]>();
    for (const price of allPrices) {
      const previous = byVehicle.get(price.id_vehicle);
      if (!previous || getPrice(price) < getPrice(previous)) byVehicle.set(price.id_vehicle, price);
    }
    const ships = [...byVehicle.values()].sort((a, b) => getPrice(a) - getPrice(b));
    const text = ships.length ? `**${ships.length} ships available for in-game ${noun}**${locationLabel(query)}, sorted by cheapest reported price.` : `No ship ${noun} prices were found${locationLabel(query)}.`;
    return { text, fallbackText: text, sourceRows: ships as (typeof ships[number] & ReportMetadata)[],
      table: { headers: ["Ship", config.allTableHeader, "Terminal"], rows: ships.map(p => [p.vehicle_name, formatPrice(getPrice(p)), p.terminal_name]) } };
  }
  const vehicles = [query.vehicle, query.vehicle2].filter((v): v is Vehicle => !!v);
  const arrays = await Promise.all(vehicles.map(v => fetchOne({ id_vehicle: v.id })));
  const tables: import("@/lib/types").NamedTable[] = [];
  const sourceRows: ReportMetadata[] = [];
  const summaries: string[] = [];
  vehicles.forEach((vehicle, index) => {
    const prices = filterByLocation(enrich(arrays[index]), query).filter(p => getPrice(p) > 0).sort((a,b) => getPrice(a)-getPrice(b));
    if (!prices.length) { summaries.push(`No ${noun} prices found for ${vehicleDisplayName(vehicle)}${locationLabel(query)}.`); return; }
    const reports = prices as (typeof prices[number] & ReportMetadata)[];
    sourceRows.push(...reports);
    tables.push({ title: vehicleDisplayName(vehicle), headers: ["Terminal", "Location", config.detailPriceHeader, "Average (aUEC)", "Reported (UTC)", "Patch"],
      rows: reports.map(p => [p.terminal_name, vehicleLocation(p), formatPrice(getPrice(p)), getAvgPrice(p) > 0 ? formatPrice(getAvgPrice(p)) : "Unknown", formatReportTimestamp(p.date_modified ?? p.date_added), p.game_version || "Unknown"]) });
  });
  const text = tables.length ? `**Ship ${noun} locations**${locationLabel(query)}. ${summaries.join(" ")}` : summaries.join(" ");
  return { text, fallbackText: text, tables, sourceRows };
}

function handleVehicleBuy(query: ParsedQuery): Promise<HandlerResult> {
  return handleVehiclePrices(query, {
    intent: "vehicle_buy",
    noun: "purchase",
    emptyAllMsg: "No in-game ship purchase data is currently available.",
    emptyVehicleMsg: "They may only be available through the pledge store.",
    allTableHeader: "Cheapest Price (aUEC)",
    detailPriceHeader: "Price (aUEC)",
    fetchAll: getVehiclePurchasePricesAll,
    fetchOne: getVehiclePurchasePrices,
    getPrice: (p) => ("price_buy" in p ? p.price_buy : 0),
    getAvgPrice: (p) => ("price_buy_avg" in p ? p.price_buy_avg : 0),
  });
}

function handleVehicleRent(query: ParsedQuery): Promise<HandlerResult> {
  return handleVehiclePrices(query, {
    intent: "vehicle_rent",
    noun: "rental",
    emptyAllMsg: "No ship rental data is currently available.",
    emptyVehicleMsg: "They may not be available for rent.",
    allTableHeader: "Cheapest Rental (aUEC)",
    detailPriceHeader: "Rental Price (aUEC)",
    fetchAll: getVehicleRentalPricesAll,
    fetchOne: getVehicleRentalPrices,
    getPrice: (p) => ("price_rent" in p ? p.price_rent : 0),
    getAvgPrice: (p) => ("price_rent_avg" in p ? p.price_rent_avg : 0),
  });
}

async function getHandlerResult(query: ParsedQuery): Promise<HandlerResult> {
  switch (query.intent) {
    case "equipment_info":
    case "equipment_buy":
    case "equipment_compare": {
      const result = await buildEquipmentAnswer(query);
      return { ...result, fallbackText: result.text };
    }
    case "market_alerts": {
      const result = await buildMarketAlertsAnswer(query);
      return { ...result, fallbackText: result.text };
    }
    case "mining_locations": {
      const result = await buildMiningAnswer(query);
      return { ...result, fallbackText: result.text };
    }
    case "sell":
      return handleSell(query);
    case "buy":
      return handleBuy(query);
    case "trade_route":
      return handleTradeRoute(query);
    case "price_check":
      return handlePriceCheck(query);
    case "price_history":
      return handlePriceHistory(query);
    case "commodity_ranking":
      return handleCommodityRanking(query);
    case "find_commodity":
      return handleFindCommodity(query);
    case "vehicle_info":
      return handleVehicleInfo(query);
    case "vehicle_compare":
      return handleVehicleCompare(query);
    case "profit_calc":
      return handleProfitCalc(query);
    case "multi_hop":
      return handleMultiHop(query);
    case "terminal_info":
      return handleTerminalInfo(query);
    case "station_info":
      return handleStationInfo(query);
    case "city_info":
      return handleCityInfo(query);
    case "outpost_info":
      return handleOutpostInfo(query);
    case "location_info":
      return handleLocationInfo(query);
    case "budget_trade":
      return handleBudgetTrade(query);
    case "location_trade":
      return handleLocationTrade(query);
    case "commodity_category":
      return handleCommodityCategory(query);
    case "price_compare":
      return handlePriceCompare(query);
    case "fleet_trade":
      return handleFleetTrade(query);
    case "refinery_yields":
      return handleRefineryYields(query);
    case "refinery_method":
      return handleRefineryMethod(query);
    case "fuel_prices":
      return handleFuelPrices(query);
    case "vehicle_buy":
      return handleVehicleBuy(query);
    case "vehicle_rent":
      return handleVehicleRent(query);
    case "help":
      return handleHelp();
    case "unknown":
    default: {
      const result = handleUnknown();
      return { ...result, fallbackText: result.text };
    }
  }
}

export async function buildAnswer(query: ParsedQuery): Promise<ChatResponse> {
  if (["craft_recipe", "blueprint_unlock", "mission_info"].includes(query.intent)) return buildCraftingAnswer(query);
  if (["trade_route", "profit_calc", "multi_hop", "budget_trade", "location_trade", "fleet_trade", "commodity_ranking"].includes(query.intent)) {
    return { text: 'This assistant focuses on game reference lookups, rather than route planning or projected profit. Ask where to buy or sell a commodity, where to mine an ore, or where to buy a ship or component.' };
  }
  if (query.locationError) return { text: query.locationError };
  const { dataContext, fallbackText, sourceRows, notes = [], ...chatResponse } = await getHandlerResult(query);
  if (sourceRows?.length) {
    const versions = await getGameVersions().catch(() => null);
    notes.push(summarizeDataFreshness(sourceRows, versions?.live));
  }
  if (query.commodity) notes.push(...cargoHandlingNotes(query.commodity));
  const suffix = notes.length ? `\n\n${notes.join("\n\n")}` : "";

  if (dataContext) {
    const text = await generateResponseText(
      query.raw,
      dataContext,
      fallbackText
    );
    return { ...chatResponse, text: text + suffix };
  }

  return { ...chatResponse, text: fallbackText + suffix };
}
