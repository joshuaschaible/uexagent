import type { ParsedQuery } from "@/lib/query-parser";
import type { ChatResponse } from "@/lib/types";
import {
  getCommodityPrices,
  getCommodityPricesAll,
  getCommodityRoutes,
  getCommodityAverages,
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
import { getReferenceData } from "@/lib/data/cache";
import { planMultiHopRoute } from "@/lib/route-planner";
import { generateResponseText, type DataContext } from "@/lib/response-generator";

type HandlerResult = ChatResponse & {
  dataContext?: DataContext;
  fallbackText: string;
};

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** Check if a price record has active sell data.
 *  The raw prices endpoint omits status_sell — treat undefined as valid. */
function isSellable(p: CommodityPrice): boolean {
  return p.price_sell > 0 && (p.status_sell === undefined || p.status_sell > 0);
}

/** Check if a price record has active buy data.
 *  The raw prices endpoint omits status_buy — treat undefined as valid. */
function isBuyable(p: CommodityPrice): boolean {
  return p.price_buy > 0 && (p.status_buy === undefined || p.status_buy > 0);
}

/** Wrap a commodity name with a UEX link marker for rendering */
function uexLink(name: string): string {
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${name}{{uex:${slug}}}`;
}

/** Filter any location-bearing records by star system, planet, and/or moon */
function filterByLocation<T extends { star_system_name?: string; planet_name?: string | null; id_moon?: number }>(
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
  return filtered;
}

/** Format SCU stock, returning fallback when unavailable */
function formatStock(scu: number | undefined, fallback = "Unknown"): string {
  return (scu ?? 0) > 0 ? `${scu} SCU` : fallback;
}

/** Get display name for a vehicle (prefer full name) */
function vehicleDisplayName(v: Vehicle): string {
  return vehicleDisplayName(v);
}

/** Build a human-readable location label from query context */
function locationLabel(query: ParsedQuery): string {
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
  return [...byTerminal.values()];
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
          dataDescription: `Yes, ${query.terminal.name} buys ${query.commodity.name} at ${formatPrice(match.price_sell)} aUEC/SCU. Demand: ${formatStock(match.scu_sell_stock)}. A single-row table with details is shown separately.`,
        },
        table: {
          headers: ["Terminal", "Commodity", "Sell Price (aUEC/SCU)", "Demand"],
          rows: [[
            query.terminal.name,
            query.commodity.name,
            formatPrice(match.price_sell),
            formatStock(match.scu_sell_stock),
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
          headers: ["Terminal", "Location", "Sell Price (aUEC/SCU)", "Stock Demand"],
          rows: sellable.map((p) => [
            p.terminal_name,
            [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
            formatPrice(p.price_sell),
            formatStock(p.scu_sell_stock),
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
    dataContext: {
      intent: "sell",
      dataDescription: `Found ${sellable.length} locations buying ${query.commodity.name}${loc}. Best price: ${formatPrice(sellable[0].price_sell)} aUEC/SCU at ${sellable[0].terminal_name}. Lowest price: ${formatPrice(sellable[sellable.length - 1].price_sell)} aUEC/SCU.${hasBestModifier ? ` Showing top ${shown.length}.` : ""} A table with all locations and prices is shown separately.`,
    },
    table: {
      headers: ["Terminal", "Location", "Sell Price (aUEC/SCU)", "Stock Demand"],
      rows: shown.map((p) => [
        p.terminal_name,
        [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
        formatPrice(p.price_sell),
        formatStock(p.scu_sell_stock),
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
        table: {
          headers: ["Terminal", "Commodity", "Buy Price (aUEC/SCU)", "Available SCU"],
          rows: [[
            query.terminal.name,
            query.commodity.name,
            formatPrice(match.price_buy),
            formatStock(match.scu_buy),
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
          headers: ["Terminal", "Location", "Buy Price (aUEC/SCU)", "Available SCU"],
          rows: buyable.map((p) => [
            p.terminal_name,
            [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
            formatPrice(p.price_buy),
            formatStock(p.scu_buy),
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
    dataContext: {
      intent: "buy",
      dataDescription: `Found ${buyable.length} locations selling ${query.commodity.name}${loc}. Cheapest: ${formatPrice(buyable[0].price_buy)} aUEC/SCU at ${buyable[0].terminal_name}. Most expensive: ${formatPrice(buyable[buyable.length - 1].price_buy)} aUEC/SCU.${hasBestModifier ? ` Showing top ${shown.length}.` : ""} A table with all locations and prices is shown separately.`,
    },
    table: {
      headers: ["Terminal", "Location", "Buy Price (aUEC/SCU)", "Available SCU"],
      rows: shown.map((p) => [
        p.terminal_name,
        [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
        formatPrice(p.price_buy),
        formatStock(p.scu_buy),
      ]),
    },
  };
}

async function handleTradeRoute(query: ParsedQuery): Promise<HandlerResult> {
  const params: Record<string, number> = {};

  if (query.commodity) {
    params.id_commodity = query.commodity.id;
  }
  if (query.planet) {
    params.id_planet_origin = query.planet.planetId;
  }

  if (Object.keys(params).length === 0) {
    const text = 'I need more info to find trade routes. Try: "Best trade route for Laranite" or "Best trade route from Hurston"';
    return { text, fallbackText: text };
  }

  try {
    const routes = await getCommodityRoutes(params);
    const sorted = routes.sort((a, b) => (b.score || 0) - (a.score || 0));
    const top = sorted.slice(0, 5);

    if (top.length === 0) {
      const text = "No trade routes found for those criteria. Try different commodities or locations.";
      return { text, fallbackText: text };
    }

    const systemName = top[0].origin_star_system_name || "Stanton";
    const mapRoutes = top.map((r) => ({
      from: r.origin_terminal_name || `Terminal #${r.id_terminal_origin}`,
      to: r.destination_terminal_name || `Terminal #${r.id_terminal_destination}`,
      profit: r.price_margin,
      commodity: r.commodity_name,
    }));
    const highlights = [
      ...new Set(
        top.flatMap((r) => [
          r.origin_terminal_name,
          r.destination_terminal_name,
        ]).filter(Boolean)
      ),
    ];

    const bestRoute = top[0];
    const fallbackText = query.commodity
      ? `Here are the **best trade routes for ${query.commodity.name}**:`
      : `Here are the **most profitable trade routes**:`;

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "trade_route",
        dataDescription: `Found ${top.length} trade routes${query.commodity ? ` for ${query.commodity.name}` : ""}. Best route: buy ${bestRoute.commodity_name} at ${bestRoute.origin_terminal_name} (${formatPrice(bestRoute.price_origin)} aUEC) → sell at ${bestRoute.destination_terminal_name} (${formatPrice(bestRoute.price_destination)} aUEC) for ${formatPrice(bestRoute.price_margin)} aUEC/SCU profit. A table and map are shown separately.`,
      },
      table: {
        headers: ["Commodity", "Buy At", "Sell At", "Buy Price", "Sell Price", "Profit/SCU"],
        rows: top.map((r) => [
          uexLink(r.commodity_name),
          r.origin_terminal_name || `Terminal #${r.id_terminal_origin}`,
          r.destination_terminal_name || `Terminal #${r.id_terminal_destination}`,
          formatPrice(r.price_origin),
          formatPrice(r.price_destination),
          formatPrice(r.price_margin),
        ]),
      },
      map: {
        system: systemName,
        routes: mapRoutes,
        highlights,
      },
    };
  } catch {
    const text = 'Couldn\'t fetch trade routes. Try specifying a commodity: "Best trade route for Agricium"';
    return { text, fallbackText: text };
  }
}

async function handlePriceCheck(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.commodity) {
    const text = 'Which commodity do you want to check the price of? Try: "What\'s the price of Agricium?"';
    return { text, fallbackText: text };
  }

  let prices = await getCommodityPrices({ commodity_name: query.commodity.name });
  prices = filterByLocation(prices, query);

  if (prices.length === 0) {
    const loc = locationLabel(query);
    const text = `No price data found for **${query.commodity.name}**${loc}.`;
    return { text, fallbackText: text };
  }

  const buyPrices = prices.filter((p) => p.price_buy > 0);
  const sellPrices = prices.filter((p) => p.price_sell > 0);

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
  dataSummary += `${prices.length} terminals trading this commodity.`;
  if (query.commodity.is_illegal) dataSummary += ` Warning: this is an illegal commodity.`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "price_check",
      dataDescription: dataSummary,
    },
  };
}

async function handlePriceHistory(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.commodity) {
    const text = 'Which commodity do you want price history for? Try: "Price history of Laranite"';
    return { text, fallbackText: text };
  }

  try {
    const averages = await getCommodityAverages({ id_commodity: query.commodity.id });

    if (averages.length === 0) {
      const text = `No average data found for **${query.commodity.name}**.`;
      return { text, fallbackText: text };
    }

    const avg = averages[0];
    let fallbackText = `**${query.commodity.name}** price averages:\n\n`;
    fallbackText += `- Current Buy: ${formatPrice(avg.price_buy)} aUEC/SCU\n`;
    fallbackText += `- Buy Range: ${formatPrice(avg.price_buy_min)} - ${formatPrice(avg.price_buy_max)} (avg ${formatPrice(avg.price_buy_avg)})\n`;
    fallbackText += `- Current Sell: ${formatPrice(avg.price_sell)} aUEC/SCU\n`;
    fallbackText += `- Sell Range: ${formatPrice(avg.price_sell_min)} - ${formatPrice(avg.price_sell_max)} (avg ${formatPrice(avg.price_sell_avg)})\n`;
    fallbackText += `- Buy Volatility: ${avg.volatility_price_buy.toFixed(1)}%\n`;
    fallbackText += `- Sell Volatility: ${avg.volatility_price_sell.toFixed(1)}%\n`;
    if (avg.cax_score) fallbackText += `- CAX Score: ${avg.cax_score}`;

    // Build chart data from averages (show current, min, avg, max as data points)
    const chartData = [
      { label: "Min", buyPrice: avg.price_buy_min, sellPrice: avg.price_sell_min },
      { label: "Average", buyPrice: avg.price_buy_avg, sellPrice: avg.price_sell_avg },
      { label: "Current", buyPrice: avg.price_buy, sellPrice: avg.price_sell },
      { label: "Max", buyPrice: avg.price_buy_max, sellPrice: avg.price_sell_max },
    ];

    const dataSummary = `${query.commodity.name} price history. Current buy: ${formatPrice(avg.price_buy)} aUEC/SCU (range: ${formatPrice(avg.price_buy_min)}-${formatPrice(avg.price_buy_max)}, avg: ${formatPrice(avg.price_buy_avg)}). Current sell: ${formatPrice(avg.price_sell)} aUEC/SCU (range: ${formatPrice(avg.price_sell_min)}-${formatPrice(avg.price_sell_max)}, avg: ${formatPrice(avg.price_sell_avg)}). Buy volatility: ${avg.volatility_price_buy.toFixed(1)}%. Sell volatility: ${avg.volatility_price_sell.toFixed(1)}%.${avg.cax_score ? ` CAX Score: ${avg.cax_score}.` : ""} A chart is shown separately.`;

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "price_history",
        dataDescription: dataSummary,
      },
      chart: {
        type: "line" as const,
        data: chartData,
        commodityName: query.commodity.name,
      },
    };
  } catch {
    const text = `Couldn't fetch price history for **${query.commodity.name}**. The averages endpoint may require authentication.`;
    return { text, fallbackText: text };
  }
}

async function handleCommodityRanking(): Promise<HandlerResult> {
  try {
    const allPrices = await getCommodityPricesAll();

    // Group by commodity and compute best buy/sell spread
    const commodityData = new Map<string, { minBuy: number; maxSell: number; name: string }>();

    for (const p of allPrices) {
      const existing = commodityData.get(p.commodity_name);
      if (!existing) {
        commodityData.set(p.commodity_name, {
          name: p.commodity_name,
          minBuy: p.price_buy > 0 ? p.price_buy : Infinity,
          maxSell: p.price_sell > 0 ? p.price_sell : 0,
        });
      } else {
        if (p.price_buy > 0 && p.price_buy < existing.minBuy) existing.minBuy = p.price_buy;
        if (p.price_sell > 0 && p.price_sell > existing.maxSell) existing.maxSell = p.price_sell;
      }
    }

    const ranked = Array.from(commodityData.values())
      .filter((c) => c.minBuy < Infinity && c.maxSell > 0)
      .map((c) => ({
        ...c,
        profit: c.maxSell - c.minBuy,
        roi: ((c.maxSell - c.minBuy) / c.minBuy) * 100,
      }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 10);

    if (ranked.length === 0) {
      const text = "No commodity ranking data available right now.";
      return { text, fallbackText: text };
    }

    const fallbackText = "Here are the **most profitable commodities** (best buy vs best sell spread):";
    const top3 = ranked.slice(0, 3).map((r) => `${r.name} (${formatPrice(r.profit)} aUEC/SCU profit, ${r.roi.toFixed(1)}% ROI)`).join(", ");

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "commodity_ranking",
        dataDescription: `Top ${ranked.length} most profitable commodities by buy/sell spread. Top 3: ${top3}. A table with all rankings is shown separately.`,
      },
      table: {
        headers: ["Commodity", "Best Buy", "Best Sell", "Profit/SCU", "ROI %"],
        rows: ranked.map((r) => [
          uexLink(r.name),
          formatPrice(r.minBuy),
          formatPrice(r.maxSell),
          formatPrice(r.profit),
          `${r.roi.toFixed(1)}%`,
        ]),
      },
    };
  } catch {
    const text = "Couldn't compute commodity rankings right now. Please try again later.";
    return { text, fallbackText: text };
  }
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
      headers: ["Terminal", "Location", "Buy Price", "Stock"],
      rows: buyLocations.map((p) => [
        p.terminal_name,
        [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
        `${formatPrice(p.price_buy)} aUEC/SCU`,
        formatStock(p.scu_buy),
      ]),
    });
  }
  if (sellLocations.length > 0) {
    tables.push({
      title: `Where to Sell (${sellLocations.length})`,
      headers: ["Terminal", "Location", "Sell Price", "Demand"],
      rows: sellLocations.map((p) => [
        p.terminal_name,
        [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
        `${formatPrice(p.price_sell)} aUEC/SCU`,
        formatStock(p.scu_sell_stock),
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
      .filter((v) => v.is_spaceship && v.scu > 0)
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
          String(v.crew),
          v.pad_type || "N/A",
        ]),
      },
    };
  }

  const v = query.vehicle;
  let fallbackText = `**${vehicleDisplayName(v)}**\n\n`;
  fallbackText += `- Manufacturer: ${v.company_name}\n`;
  fallbackText += `- Cargo: ${v.scu} SCU\n`;
  fallbackText += `- Crew: ${v.crew}\n`;
  if (v.length > 0 || v.width > 0 || v.height > 0) {
    fallbackText += `- Dimensions: ${v.length}m x ${v.width}m x ${v.height}m\n`;
  }
  if (v.mass) fallbackText += `- Mass: ${formatPrice(v.mass)} kg\n`;
  fallbackText += `- Pad Size: ${v.pad_type || "N/A"}\n`;
  if (v.fuel_quantum) fallbackText += `- Quantum Fuel: ${formatPrice(v.fuel_quantum)}\n`;
  if (v.fuel_hydrogen) fallbackText += `- Hydrogen Fuel: ${formatPrice(v.fuel_hydrogen)}\n`;

  const roles = getVehicleRoles(v);
  if (roles.length > 0) fallbackText += `- Roles: ${roles.join(", ")}\n`;

  let dataSummary = `${vehicleDisplayName(v)} by ${v.company_name}. Cargo: ${v.scu} SCU. Crew: ${v.crew}. Pad size: ${v.pad_type || "N/A"}.`;
  if (v.length > 0) dataSummary += ` Dimensions: ${v.length}m x ${v.width}m x ${v.height}m.`;
  if (v.mass) dataSummary += ` Mass: ${formatPrice(v.mass)} kg.`;
  if (v.fuel_quantum) dataSummary += ` Quantum fuel: ${formatPrice(v.fuel_quantum)}.`;
  if (v.fuel_hydrogen) dataSummary += ` Hydrogen fuel: ${formatPrice(v.fuel_hydrogen)}.`;
  if (roles.length > 0) dataSummary += ` Roles: ${roles.join(", ")}.`;

  // Enrich with in-game purchase and rental prices
  const [purchaseResult, rentalResult] = await Promise.allSettled([
    getVehiclePurchasePrices({ id_vehicle: v.id }),
    getVehicleRentalPrices({ id_vehicle: v.id }),
  ]);
  const purchases = purchaseResult.status === "fulfilled" ? purchaseResult.value : [];
  const rentals = rentalResult.status === "fulfilled" ? rentalResult.value : [];

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

  return {
    text: fallbackText,
    fallbackText,
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
  const [crewA, crewB] = compare(a.crew, b.crew, false);
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
  if (a.fuel_quantum > 0 || b.fuel_quantum > 0) rows.push(["Quantum Fuel", qfA, qfB]);
  if (a.fuel_hydrogen > 0 || b.fuel_hydrogen > 0) rows.push(["Hydrogen Fuel", hfA, hfB]);
  rows.push(["Roles", getVehicleRoles(a).join(", ") || "N/A", getVehicleRoles(b).join(", ") || "N/A"]);

  const cargoWinner = a.scu > b.scu ? a.name : b.scu > a.scu ? b.name : "tied";
  const dataSummary = `Comparing ${a.name} vs ${b.name}. ${a.name}: ${a.scu} SCU cargo, ${a.crew} crew, ${a.pad_type || "N/A"} pad. ${b.name}: ${b.scu} SCU cargo, ${b.crew} crew, ${b.pad_type || "N/A"} pad. Cargo winner: ${cargoWinner}. A comparison table is shown separately.`;

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
  // Need at least a vehicle or commodity
  if (!query.vehicle && !query.commodity) {
    const text = 'I need a ship and/or commodity to calculate profit. Try: "How much profit with a C2 selling Laranite?"';
    return { text, fallbackText: text };
  }

  // If we have a vehicle but no commodity, suggest the most profitable one
  if (query.vehicle && !query.commodity) {
    const text = `The **${query.vehicle.name}** has **${query.vehicle.scu} SCU** of cargo capacity. To calculate profit, specify a commodity too. Try: "How much profit selling Laranite with a ${query.vehicle.name}?"`;
    return { text, fallbackText: text };
  }

  if (!query.commodity) {
    const text = 'I need to know which commodity to calculate profit for. Try: "How much can I make selling Laranite?"';
    return { text, fallbackText: text };
  }

  // Get prices
  let prices = await getCommodityPrices({ commodity_name: query.commodity.name });
  prices = filterByLocation(prices, query);

  const buyable = prices.filter((p) => isBuyable(p)).sort((a, b) => a.price_buy - b.price_buy);
  const sellable = prices.filter((p) => isSellable(p)).sort((a, b) => b.price_sell - a.price_sell);

  if (buyable.length === 0 || sellable.length === 0) {
    const text = `Can't calculate profit for **${query.commodity.name}** — not enough price data (need both buy and sell prices).`;
    return { text, fallbackText: text };
  }

  const bestBuy = buyable[0];
  const bestSell = sellable[0];
  const scu = query.vehicle?.scu || 96; // Default to 96 SCU if no ship specified
  const shipName = query.vehicle?.name || `${scu} SCU cargo`;

  const profitData = {
    shipName,
    commodityName: query.commodity.name,
    scu,
    buyPrice: bestBuy.price_buy,
    sellPrice: bestSell.price_sell,
    buyTerminal: bestBuy.terminal_name,
    sellTerminal: bestSell.terminal_name,
  };

  const investment = bestBuy.price_buy * scu;
  const revenue = bestSell.price_sell * scu;
  const profit = revenue - investment;
  const roi = investment > 0 ? ((profit / investment) * 100).toFixed(1) : "0";

  let fallbackText = `**${query.commodity.name}** profit calculation with **${shipName}** (${scu} SCU):\n\n`;
  fallbackText += `- Buy at **${bestBuy.terminal_name}** for ${formatPrice(bestBuy.price_buy)} aUEC/SCU\n`;
  fallbackText += `- Sell at **${bestSell.terminal_name}** for ${formatPrice(bestSell.price_sell)} aUEC/SCU\n`;
  fallbackText += `- Investment: ${formatPrice(investment)} aUEC\n`;
  fallbackText += `- Revenue: ${formatPrice(revenue)} aUEC\n`;
  fallbackText += `- **Profit per run: ${formatPrice(profit)} aUEC** (${roi}% ROI)`;

  const dataSummary = `Profit calculation for ${query.commodity.name} with ${shipName} (${scu} SCU). Buy at ${bestBuy.terminal_name} for ${formatPrice(bestBuy.price_buy)} aUEC/SCU. Sell at ${bestSell.terminal_name} for ${formatPrice(bestSell.price_sell)} aUEC/SCU. Investment: ${formatPrice(investment)} aUEC. Revenue: ${formatPrice(revenue)} aUEC. Profit per run: ${formatPrice(profit)} aUEC (${roi}% ROI). A profit visualization is shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "profit_calc",
      dataDescription: dataSummary,
    },
    profit: profitData,
  };
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
      headers: ["Commodity", "Buy Price", "Stock"],
      rows: buying.map((p) => [
        uexLink(p.commodity_name),
        `${formatPrice(p.price_buy)} aUEC/SCU`,
        formatStock(p.scu_buy),
      ]),
    });
  }
  if ((showBoth || wantsSell) && selling.length > 0) {
    tables.push({
      title: `Sellable Here (${selling.length})`,
      headers: ["Commodity", "Sell Price", "Demand"],
      rows: selling.map((p) => [
        uexLink(p.commodity_name),
        `${formatPrice(p.price_sell)} aUEC/SCU`,
        formatStock(p.scu_sell_stock),
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
  const available = stations.filter((s) => s.is_available);

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
  const available = cities.filter((c) => c.is_available);

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
  const available = outposts.filter((o) => o.is_available);

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
  if (query.moon) {
    const outposts = await getOutposts({ id_moon: query.moon.moonId });
    const available = outposts.filter((o) => o.is_available);
    const withTrade = available.filter((o) => o.has_trade_terminal).length;
    const withRefinery = available.filter((o) => o.has_refinery).length;

    let fallbackText = `**${query.moon.moonName}** overview:\n\n`;
    fallbackText += `- Outposts: ${available.length}\n`;
    fallbackText += `- With Trade Terminals: ${withTrade}\n`;
    fallbackText += `- With Refineries: ${withRefinery}\n\n`;
    if (available.length > 0) {
      fallbackText += `Ask more specifically:\n`;
      fallbackText += `- "Outposts on ${query.moon.moonName}"\n`;
      fallbackText += `- "Sell Laranite on ${query.moon.moonName}"`;
    }

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "location_info",
        dataDescription: `${query.moon.moonName} has ${available.length} outposts, ${withTrade} with trade terminals, ${withRefinery} with refineries.`,
      },
    };
  }

  if (query.planet) {
    const [stations, cities, outposts] = await Promise.all([
      getSpaceStations({ id_planet: query.planet.planetId }),
      getCities({ id_planet: query.planet.planetId }),
      getOutposts({ id_planet: query.planet.planetId }),
    ]);

    const stationCount = stations.filter((s) => s.is_available).length;
    const cityCount = cities.filter((c) => c.is_available).length;
    const outpostCount = outposts.filter((o) => o.is_available).length;

    let fallbackText = `**${query.planet.planetName}** overview:\n\n`;
    fallbackText += `- Space Stations: ${stationCount}\n`;
    fallbackText += `- Cities: ${cityCount}\n`;
    fallbackText += `- Outposts: ${outpostCount}\n\n`;
    fallbackText += `Ask more specifically:\n`;
    fallbackText += `- "Stations near ${query.planet.planetName}"\n`;
    fallbackText += `- "Cities on ${query.planet.planetName}"\n`;
    fallbackText += `- "Outposts on ${query.planet.planetName}"`;

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "location_info",
        dataDescription: `${query.planet.planetName} has ${stationCount} space stations, ${cityCount} cities, and ${outpostCount} outposts.`,
      },
    };
  }

  if (query.starSystem) {
    const [stations, cities, outposts] = await Promise.all([
      getSpaceStations({ id_star_system: query.starSystem.id }),
      getCities({ id_star_system: query.starSystem.id }),
      getOutposts({ id_star_system: query.starSystem.id }),
    ]);

    const stationCount = stations.filter((s) => s.is_available).length;
    const cityCount = cities.filter((c) => c.is_available).length;
    const outpostCount = outposts.filter((o) => o.is_available).length;

    let fallbackText = `**${query.starSystem.name} System** overview:\n\n`;
    fallbackText += `- Space Stations: ${stationCount}\n`;
    fallbackText += `- Cities: ${cityCount}\n`;
    fallbackText += `- Outposts: ${outpostCount}`;

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "location_info",
        dataDescription: `${query.starSystem.name} system has ${stationCount} space stations, ${cityCount} cities, and ${outpostCount} outposts.`,
      },
    };
  }

  const result = handleUnknown();
  return { ...result, fallbackText: result.text };
}

async function handleMultiHop(query: ParsedQuery): Promise<HandlerResult> {
  const scu = query.vehicle?.scu || 96;
  const shipName = query.vehicle?.name || `${scu} SCU cargo`;
  const systemFilter = query.starSystem?.name;

  try {
    const result = await planMultiHopRoute(scu, 3, systemFilter);

    if (!result || result.stops.length === 0) {
      const text = "Couldn't find profitable multi-hop routes right now. Try specifying a ship or system.";
      return { text, fallbackText: text };
    }

    let fallbackText = `**Multi-hop route plan** for **${shipName}** (${scu} SCU):\n\n`;

    for (const stop of result.stops) {
      if (stop.action === "buy") {
        fallbackText += `- **Step ${stop.step}:** Buy **${stop.commodityName}** at **${stop.terminalName}** (${formatPrice(stop.pricePerScu!)} aUEC/SCU, ${formatPrice(stop.totalCost!)} total)\n`;
      } else if (stop.action === "fly") {
        fallbackText += `- **Step ${stop.step}:** Fly to **${stop.terminalName}**\n`;
      } else if (stop.action === "sell") {
        fallbackText += `- **Step ${stop.step}:** Sell **${stop.commodityName}** at **${stop.terminalName}** (${formatPrice(stop.pricePerScu!)} aUEC/SCU, +${formatPrice(stop.profit!)} profit)\n`;
      }
    }

    fallbackText += `\n**Total profit: ${formatPrice(result.totalProfit)} aUEC** | Investment: ${formatPrice(result.totalInvestment)} aUEC`;

    // Build map data
    const mapRoutes: { from: string; to: string; profit: number; commodity: string }[] = [];
    const highlights: string[] = [];

    for (let i = 0; i < result.stops.length; i++) {
      const stop = result.stops[i];
      highlights.push(stop.terminalName);

      if (stop.action === "buy") {
        // Find the next sell stop
        const sellStop = result.stops.find(
          (s, j) =>
            j > i && s.action === "sell" && s.commodityName === stop.commodityName
        );
        if (sellStop) {
          mapRoutes.push({
            from: stop.terminalName,
            to: sellStop.terminalName,
            profit: sellStop.profit || 0,
            commodity: stop.commodityName || "",
          });
        }
      }
    }

    const stopCount = result.stops.filter((s) => s.action !== "fly").length;
    const dataSummary = `Multi-hop route plan for ${shipName} (${scu} SCU) with ${stopCount} trade stops. Total profit: ${formatPrice(result.totalProfit)} aUEC. Investment: ${formatPrice(result.totalInvestment)} aUEC. A map is shown separately.`;

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent: "multi_hop",
        dataDescription: dataSummary,
      },
      map: {
        system: result.system,
        routes: mapRoutes,
        highlights: [...new Set(highlights)],
      },
    };
  } catch {
    const text = "Couldn't compute multi-hop routes right now. Please try again later.";
    return { text, fallbackText: text };
  }
}

async function handleBudgetTrade(query: ParsedQuery): Promise<HandlerResult> {
  const budget = query.budget || 50000;
  const scu = query.vehicle?.scu || 96;
  const shipName = query.vehicle?.name || `${scu} SCU cargo`;

  const allPrices = await getCommodityPricesAll();
  const filtered = filterByLocation(allPrices, query);

  // Group by commodity: find cheapest buy and highest sell
  const commodityData = new Map<string, { name: string; minBuy: CommodityPrice; maxSell: CommodityPrice }>();

  for (const p of filtered) {
    if (isBuyable(p)) {
      const existing = commodityData.get(p.commodity_name);
      if (!existing || p.price_buy < existing.minBuy.price_buy) {
        commodityData.set(p.commodity_name, {
          name: p.commodity_name,
          minBuy: p,
          maxSell: existing?.maxSell || p,
        });
      }
    }
    if (isSellable(p)) {
      const existing = commodityData.get(p.commodity_name);
      if (existing && p.price_sell > existing.maxSell.price_sell) {
        existing.maxSell = p;
      }
    }
  }

  // Calculate best trades within budget
  const trades = Array.from(commodityData.values())
    .filter((c) => c.minBuy.price_buy > 0 && c.maxSell.price_sell > c.minBuy.price_buy)
    .map((c) => {
      const maxAffordableScu = Math.min(scu, Math.floor(budget / c.minBuy.price_buy));
      const investment = c.minBuy.price_buy * maxAffordableScu;
      const revenue = c.maxSell.price_sell * maxAffordableScu;
      const profit = revenue - investment;
      return { ...c, maxAffordableScu, investment, revenue, profit };
    })
    .filter((t) => t.maxAffordableScu > 0 && t.profit > 0)
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 8);

  if (trades.length === 0) {
    const text = `No profitable trades found with a budget of **${formatPrice(budget)} aUEC**.`;
    return { text, fallbackText: text };
  }

  const fallbackText = `**Best trades with ${formatPrice(budget)} aUEC** using **${shipName}** (${scu} SCU):`;
  const bestTrade = trades[0];
  const dataSummary = `Found ${trades.length} profitable trades within a budget of ${formatPrice(budget)} aUEC using ${shipName} (${scu} SCU). Best trade: ${bestTrade.name} — buy at ${bestTrade.minBuy.terminal_name}, sell at ${bestTrade.maxSell.terminal_name} for +${formatPrice(bestTrade.profit)} aUEC profit. A table with all trades is shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "budget_trade",
      dataDescription: dataSummary,
    },
    table: {
      headers: ["Commodity", "Buy At", "Sell At", "SCU", "Investment", "Profit"],
      rows: trades.map((t) => [
        uexLink(t.name),
        t.minBuy.terminal_name,
        t.maxSell.terminal_name,
        String(t.maxAffordableScu),
        formatPrice(t.investment),
        `+${formatPrice(t.profit)}`,
      ]),
    },
  };
}

async function handleLocationTrade(query: ParsedQuery): Promise<HandlerResult> {
  if (!query.terminal) {
    const text = 'I need to know your current location. Try: "I\'m at Admin - HUR-L1, what should I buy?" or use @ to mention a station.';
    return { text, fallbackText: text };
  }

  const terminal = query.terminal;
  const prices = await getCommodityPrices({ terminal_name: terminal.name });

  const location = [
    terminal.city_name || terminal.space_station_name || terminal.outpost_name,
    terminal.planet_name,
    terminal.star_system_name,
  ].filter(Boolean).join(", ");

  // What you can buy here and sell profitably elsewhere
  const buyHere = prices.filter((p) => isBuyable(p));

  if (buyHere.length === 0) {
    const text = `**${terminal.name}** (${location}) doesn't sell any commodities right now. Try a different terminal.`;
    return { text, fallbackText: text };
  }

  // For each buyable commodity, find best sell location
  const allPrices = await getCommodityPricesAll();
  const opportunities: { commodity: string; buyPrice: number; sellTerminal: string; sellLocation: string; sellPrice: number; profitPerScu: number }[] = [];

  for (const buy of buyHere) {
    const sellOptions = allPrices
      .filter((p) => p.commodity_name === buy.commodity_name && p.price_sell > buy.price_buy && (p.status_sell === undefined || p.status_sell > 0) && p.terminal_name !== terminal.name)
      .sort((a, b) => b.price_sell - a.price_sell);

    if (sellOptions.length > 0) {
      const best = sellOptions[0];
      opportunities.push({
        commodity: buy.commodity_name,
        buyPrice: buy.price_buy,
        sellTerminal: best.terminal_name,
        sellLocation: [best.planet_name, best.star_system_name].filter(Boolean).join(", "),
        sellPrice: best.price_sell,
        profitPerScu: best.price_sell - buy.price_buy,
      });
    }
  }

  opportunities.sort((a, b) => b.profitPerScu - a.profitPerScu);
  const top = opportunities.slice(0, 8);

  if (top.length === 0) {
    const text = `No profitable trades found from **${terminal.name}**. All commodities here sell for less elsewhere.`;
    return { text, fallbackText: text };
  }

  const fallbackText = `You're at **${terminal.name}** (${location}). Here are the **best commodities to buy and where to sell them**:`;
  const bestOpp = top[0];
  const dataSummary = `At ${terminal.name} (${location}), found ${top.length} profitable trade opportunities. Best: buy ${bestOpp.commodity} here for ${formatPrice(bestOpp.buyPrice)} aUEC/SCU, sell at ${bestOpp.sellTerminal} for +${formatPrice(bestOpp.profitPerScu)} aUEC/SCU profit. A table with all opportunities is shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "location_trade",
      dataDescription: dataSummary,
    },
    table: {
      headers: ["Commodity", "Buy Price", "Sell At", "Sell Price", "Profit/SCU"],
      rows: top.map((o) => [
        uexLink(o.commodity),
        `${formatPrice(o.buyPrice)}`,
        o.sellTerminal,
        `${formatPrice(o.sellPrice)}`,
        `+${formatPrice(o.profitPerScu)}`,
      ]),
    },
  };
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

  const sys1Buy = sys1Prices.filter((p) => p.price_buy > 0).sort((a, b) => a.price_buy - b.price_buy);
  const sys1Sell = sys1Prices.filter((p) => p.price_sell > 0).sort((a, b) => b.price_sell - a.price_sell);
  const sys2Buy = sys2Prices.filter((p) => p.price_buy > 0).sort((a, b) => a.price_buy - b.price_buy);
  const sys2Sell = sys2Prices.filter((p) => p.price_sell > 0).sort((a, b) => b.price_sell - a.price_sell);

  if (sys1Buy.length > 0 || sys1Sell.length > 0) {
    const rows: string[][] = [];
    for (const p of sys1Buy.slice(0, 5)) {
      rows.push([p.terminal_name, `${formatPrice(p.price_buy)} (buy)`, formatStock(p.scu_buy, "—")]);
    }
    for (const p of sys1Sell.slice(0, 5)) {
      rows.push([p.terminal_name, `${formatPrice(p.price_sell)} (sell)`, formatStock(p.scu_sell_stock, "—")]);
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
      rows.push([p.terminal_name, `${formatPrice(p.price_sell)} (sell)`, formatStock(p.scu_sell_stock, "—")]);
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
    dataContext: {
      intent: "price_compare",
      dataDescription: dataSummary,
    },
    tables: tables.length > 0 ? tables : undefined,
  };
}

async function handleFleetTrade(query: ParsedQuery): Promise<HandlerResult> {
  const vehicles: { name: string; scu: number }[] = [];

  if (query.vehicle) vehicles.push({ name: query.vehicle.name, scu: query.vehicle.scu });
  if (query.vehicle2) vehicles.push({ name: query.vehicle2.name, scu: query.vehicle2.scu });

  if (vehicles.length < 2) {
    const text = 'I need at least two ships for fleet trading. Try: "Best trades for my C2 and Caterpillar"';
    return { text, fallbackText: text };
  }

  const allPrices = await getCommodityPricesAll();
  const filtered = filterByLocation(allPrices, query);

  const tables: import("@/lib/types").NamedTable[] = [];
  const summaryParts: string[] = [];

  for (const ship of vehicles) {
    // Find best single-run trade for this ship
    const commodityData = new Map<string, { minBuy: CommodityPrice; maxSell: CommodityPrice }>();

    for (const p of filtered) {
      if (isBuyable(p)) {
        const existing = commodityData.get(p.commodity_name);
        if (!existing || p.price_buy < existing.minBuy.price_buy) {
          commodityData.set(p.commodity_name, {
            minBuy: p,
            maxSell: existing?.maxSell || p,
          });
        }
      }
      if (isSellable(p)) {
        const existing = commodityData.get(p.commodity_name);
        if (existing && p.price_sell > existing.maxSell.price_sell) {
          existing.maxSell = p;
        }
      }
    }

    const trades = Array.from(commodityData.entries())
      .filter(([, c]) => c.maxSell.price_sell > c.minBuy.price_buy)
      .map(([name, c]) => ({
        name,
        buyAt: c.minBuy.terminal_name,
        sellAt: c.maxSell.terminal_name,
        profit: (c.maxSell.price_sell - c.minBuy.price_buy) * ship.scu,
        profitPerScu: c.maxSell.price_sell - c.minBuy.price_buy,
        investment: c.minBuy.price_buy * ship.scu,
      }))
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    tables.push({
      title: `${ship.name} (${ship.scu} SCU)`,
      headers: ["Commodity", "Buy At", "Sell At", "Profit/Run", "Investment"],
      rows: trades.map((t) => [
        uexLink(t.name),
        t.buyAt,
        t.sellAt,
        `+${formatPrice(t.profit)}`,
        formatPrice(t.investment),
      ]),
    });

    if (trades.length > 0) {
      summaryParts.push(`${ship.name} (${ship.scu} SCU): best trade is ${trades[0].name} for +${formatPrice(trades[0].profit)} aUEC/run`);
    }
  }

  const fallbackText = `**Fleet trade recommendations** for ${vehicles.map((v) => `**${v.name}** (${v.scu} SCU)`).join(" and ")}:`;
  const dataSummary = `Fleet trade recommendations. ${summaryParts.join(". ")}. Tables with top trades per ship are shown separately.`;

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent: "fleet_trade",
      dataDescription: dataSummary,
    },
    tables: tables.length > 0 ? tables : undefined,
  };
}

function handleUnknown(): ChatResponse {
  return {
    text: `I'm not sure what you're asking. Here are some things I can help with:\n\n` +
      `**Trading:**\n` +
      `- "Where should I sell Bexalite?" - Best sell prices\n` +
      `- "Where can I buy Laranite?" - Cheapest buy prices\n` +
      `- "Sell Iron on Hurston" - Filter by planet\n` +
      `- "I have 50000 aUEC" - Budget-aware trades\n` +
      `- "I'm at Admin - HUR-L1" - Trade from your location\n\n` +
      `**Market:**\n` +
      `- "What's the price of Agricium?" - Price overview\n` +
      `- "Best trade route for Quantanium" - Profitable routes\n` +
      `- "What's the most profitable commodity?" - Rankings\n` +
      `- "Price history of Laranite" - Price trends\n` +
      `- "Compare Laranite prices in Stanton vs Pyro"\n` +
      `- "Show me all metals" - Browse by category\n\n` +
      `**Ships:**\n` +
      `- "Tell me about the C2 Hercules" - Ship specs\n` +
      `- "Compare C2 vs Caterpillar" - Side-by-side comparison\n` +
      `- "Best trades for my C2 and Caterpillar" - Fleet trades\n\n` +
      `**Locations:**\n` +
      `- "Space stations in Stanton" - Station list\n` +
      `- "Cities on Hurston" - City info\n` +
      `- Type @station-name to see what's traded there`,
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
  // Refinery yields use raw ore names (e.g. "Quantainium (Raw)") while the
  // commodity entity may be the refined form ("Quantainium"). Match by:
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
    const fallbackText = `No refinery yield data found for **${what}**${locationLabel(query)}. It may not be refinable.`;
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
    table: {
      headers: ["Refinery", "Location", "Commodity", "Yield Bonus", "Capacity (SCU)"],
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
  const { fuelPrices } = await getReferenceData();
  let filtered = [...fuelPrices];

  // Detect fuel type from query
  const lower = query.raw.toLowerCase();
  const isHydrogen = lower.includes("hydrogen");
  const isQuantum = lower.includes("quantum");

  if (isHydrogen) {
    filtered = filtered.filter((f) => f.commodity_name.toLowerCase().includes("hydrogen"));
  } else if (isQuantum) {
    filtered = filtered.filter((f) => f.commodity_name.toLowerCase().includes("quantum"));
  }

  // Filter by location (reuses generic filterByLocation which also handles moon)
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
    dataContext: {
      intent: "fuel_prices",
      dataDescription: `Found ${filtered.length} ${fuelType.trim()} fuel price entries${loc}. Cheapest: ${cheapest.terminal_name} at ${formatPrice(cheapest.price_buy)} aUEC. A table with all locations and prices is shown separately.`,
    },
    table: {
      headers: ["Terminal", "Location", "Fuel Type", "Price (aUEC)", "Avg Price"],
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
  TSummary extends { id_vehicle: number; vehicle_name: string; terminal_name: string },
  TDetail extends { terminal_name: string; city_name?: string | null; moon_name?: string | null; space_station_name?: string | null; outpost_name?: string | null; planet_name?: string | null; star_system_name: string },
>(query: ParsedQuery, config: VehiclePriceConfig<TSummary, TDetail>): Promise<HandlerResult> {
  const { intent, noun, fetchAll, fetchOne, getPrice, getAvgPrice } = config;

  // No specific ship — show all available ships with cheapest price
  if (!query.vehicle) {
    const allPrices = await fetchAll();
    if (allPrices.length === 0) {
      const text = config.emptyAllMsg;
      return { text, fallbackText: text };
    }

    const byVehicle = new Map<number, { name: string; price: number; terminal: string }>();
    for (const p of allPrices) {
      const price = getPrice(p);
      const existing = byVehicle.get(p.id_vehicle);
      if (!existing || price < existing.price) {
        byVehicle.set(p.id_vehicle, { name: p.vehicle_name, price, terminal: p.terminal_name });
      }
    }
    const ships = [...byVehicle.values()].sort((a, b) => a.price - b.price);
    const fallbackText = `Here are **all ${ships.length} ships available for in-game ${noun}** (sorted by cheapest price):`;

    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent,
        dataDescription: `Found ${ships.length} ships available for in-game ${noun}. Cheapest: ${ships[0].name} at ${formatPrice(ships[0].price)} aUEC. Most expensive: ${ships[ships.length - 1].name} at ${formatPrice(ships[ships.length - 1].price)} aUEC. A table with all ships and prices is shown separately.`,
      },
      table: {
        headers: ["Ship", config.allTableHeader, "Location"],
        rows: ships.map((s) => [s.name, formatPrice(s.price), s.terminal]),
      },
    };
  }

  // Specific vehicle(s) — fetch detailed prices
  const vehicles = [query.vehicle];
  if (query.vehicle2) vehicles.push(query.vehicle2);

  const allPricesArrays = await Promise.all(
    vehicles.map((v) => fetchOne({ id_vehicle: v.id }))
  );

  const tables: import("@/lib/types").NamedTable[] = [];
  const summaryParts: string[] = [];

  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i];
    const prices = allPricesArrays[i];
    const name = vehicleDisplayName(v);

    if (prices.length === 0) {
      summaryParts.push(`No ${noun} locations found for ${name}.`);
      continue;
    }

    const sorted = [...prices].sort((a, b) => getPrice(a) - getPrice(b));
    const cheapest = sorted[0];
    summaryParts.push(`${name}: ${sorted.length} locations, cheapest at ${cheapest.terminal_name} for ${formatPrice(getPrice(cheapest))} aUEC.`);
    tables.push({
      title: name,
      headers: ["Terminal", "Location", config.detailPriceHeader, "Avg Price"],
      rows: sorted.map((p) => [
        p.terminal_name,
        vehicleLocation(p),
        formatPrice(getPrice(p)),
        formatPrice(getAvgPrice(p)),
      ]),
    });
  }

  if (tables.length === 0) {
    const names = vehicles.map((v) => vehicleDisplayName(v)).join(" and ");
    const fallbackText = `No ${noun} locations found for **${names}**. ${config.emptyVehicleMsg}`;
    return {
      text: fallbackText,
      fallbackText,
      dataContext: { intent, dataDescription: fallbackText },
    };
  }

  const names = vehicles.map((v) => vehicleDisplayName(v)).join(" and ");
  const fallbackText = `Here are the **${noun} locations for ${names}**:`;

  if (tables.length === 1) {
    return {
      text: fallbackText,
      fallbackText,
      dataContext: {
        intent,
        dataDescription: summaryParts.join(" ") + ` A table with ${noun} locations is shown separately.`,
      },
      table: { headers: tables[0].headers, rows: tables[0].rows },
    };
  }

  return {
    text: fallbackText,
    fallbackText,
    dataContext: {
      intent,
      dataDescription: summaryParts.join(" ") + ` Tables with ${noun} locations are shown separately.`,
    },
    tables,
  };
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
      return handleCommodityRanking();
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
    case "unknown":
    default: {
      const result = handleUnknown();
      return { ...result, fallbackText: result.text };
    }
  }
}

export async function buildAnswer(query: ParsedQuery): Promise<ChatResponse> {
  const result = await getHandlerResult(query);

  if (result.dataContext) {
    // Augment data context with active ship info for natural language generation
    const augmentedContext = { ...result.dataContext };
    if (query.vehicle && augmentedContext.dataDescription) {
      augmentedContext.dataDescription += ` Using ship: ${query.vehicle.name_full || query.vehicle.name} (${query.vehicle.scu} SCU cargo capacity).`;
    }
    const text = await generateResponseText(
      query.raw,
      augmentedContext,
      result.fallbackText
    );
    const { dataContext, fallbackText, ...chatResponse } = result;
    return { ...chatResponse, text };
  }

  const { dataContext, fallbackText, ...chatResponse } = result;
  return { ...chatResponse, text: fallbackText };
}
