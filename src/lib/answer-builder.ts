import type { ParsedQuery } from "@/lib/query-parser";
import {
  getCommodityPrices,
  getCommodityRoutes,
  type CommodityPrice,
  type CommodityRoute,
} from "@/lib/uex-client";
import { getReferenceData } from "@/lib/data/cache";

export type ChatResponse = {
  text: string;
  table?: {
    headers: string[];
    rows: string[][];
  };
};

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function locationLabel(
  terminalName: string,
  planetName: string | null,
  systemName?: string
): string {
  const parts = [terminalName];
  if (planetName) parts.push(planetName);
  if (systemName) parts.push(systemName);
  return parts.join(" - ");
}

async function handleSell(query: ParsedQuery): Promise<ChatResponse> {
  if (!query.commodity) {
    return {
      text: "I need to know which commodity you want to sell. Try something like: \"Where should I sell Bexalite?\"",
    };
  }

  const prices = await getCommodityPrices({
    commodity_name: query.commodity.name,
  });

  const sellable = prices
    .filter((p) => p.price_sell > 0 && p.status_sell > 0)
    .sort((a, b) => b.price_sell - a.price_sell);

  if (sellable.length === 0) {
    return {
      text: `No terminals are currently buying **${query.commodity.name}**. This could be a data availability issue or the commodity may not be sellable right now.`,
    };
  }

  const top = sellable.slice(0, 5);

  return {
    text: `Here are the **best places to sell ${query.commodity.name}**:`,
    table: {
      headers: ["Terminal", "Location", "Sell Price (aUEC/SCU)", "Stock Demand"],
      rows: top.map((p) => [
        p.terminal_name,
        [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
        formatPrice(p.price_sell),
        p.scu_sell_stock > 0 ? `${p.scu_sell_stock} SCU` : "Unknown",
      ]),
    },
  };
}

async function handleBuy(query: ParsedQuery): Promise<ChatResponse> {
  if (!query.commodity) {
    return {
      text: "I need to know which commodity you want to buy. Try: \"Where can I buy Laranite?\"",
    };
  }

  const prices = await getCommodityPrices({
    commodity_name: query.commodity.name,
  });

  const buyable = prices
    .filter((p) => p.price_buy > 0 && p.status_buy > 0)
    .sort((a, b) => a.price_buy - b.price_buy);

  if (buyable.length === 0) {
    return {
      text: `No terminals are currently selling **${query.commodity.name}**. It may be out of stock or unavailable.`,
    };
  }

  const top = buyable.slice(0, 5);

  return {
    text: `Here are the **cheapest places to buy ${query.commodity.name}**:`,
    table: {
      headers: ["Terminal", "Location", "Buy Price (aUEC/SCU)", "Available SCU"],
      rows: top.map((p) => [
        p.terminal_name,
        [p.planet_name, p.star_system_name].filter(Boolean).join(", "),
        formatPrice(p.price_buy),
        p.scu_buy > 0 ? `${p.scu_buy} SCU` : "Unknown",
      ]),
    },
  };
}

async function handleTradeRoute(query: ParsedQuery): Promise<ChatResponse> {
  const params: Record<string, number> = {};

  if (query.commodity) {
    params.id_commodity = query.commodity.id;
  }

  if (query.planet) {
    params.id_planet_origin = query.planet.planetId;
  }

  // Need at least one parameter for the routes endpoint
  if (Object.keys(params).length === 0) {
    return {
      text: "I need more info to find trade routes. Try: \"Best trade route for Laranite\" or \"Best trade route from Hurston\"",
    };
  }

  try {
    const routes = await getCommodityRoutes(params);

    const sorted = routes.sort((a, b) => (b.score || 0) - (a.score || 0));
    const top = sorted.slice(0, 5);

    if (top.length === 0) {
      return {
        text: "No trade routes found for those criteria. Try different commodities or locations.",
      };
    }

    return {
      text: query.commodity
        ? `Here are the **best trade routes for ${query.commodity.name}**:`
        : `Here are the **most profitable trade routes**:`,
      table: {
        headers: [
          "Commodity",
          "Buy At",
          "Sell At",
          "Buy Price",
          "Sell Price",
          "Profit/SCU",
        ],
        rows: top.map((r) => [
          r.commodity_name,
          r.origin_terminal_name || `Terminal #${r.id_terminal_origin}`,
          r.destination_terminal_name || `Terminal #${r.id_terminal_destination}`,
          formatPrice(r.price_origin),
          formatPrice(r.price_destination),
          formatPrice(r.price_margin),
        ]),
      },
    };
  } catch {
    return {
      text: "Couldn't fetch trade routes. Try specifying a commodity: \"Best trade route for Agricium\"",
    };
  }
}

async function handlePriceCheck(query: ParsedQuery): Promise<ChatResponse> {
  if (!query.commodity) {
    return {
      text: "Which commodity do you want to check the price of? Try: \"What's the price of Agricium?\"",
    };
  }

  const prices = await getCommodityPrices({
    commodity_name: query.commodity.name,
  });

  if (prices.length === 0) {
    return {
      text: `No price data found for **${query.commodity.name}**.`,
    };
  }

  const buyPrices = prices.filter((p) => p.price_buy > 0);
  const sellPrices = prices.filter((p) => p.price_sell > 0);

  const avgBuy =
    buyPrices.length > 0
      ? buyPrices.reduce((sum, p) => sum + p.price_buy, 0) / buyPrices.length
      : 0;
  const avgSell =
    sellPrices.length > 0
      ? sellPrices.reduce((sum, p) => sum + p.price_sell, 0) / sellPrices.length
      : 0;

  const minBuy = buyPrices.length > 0 ? Math.min(...buyPrices.map((p) => p.price_buy)) : 0;
  const maxSell =
    sellPrices.length > 0 ? Math.max(...sellPrices.map((p) => p.price_sell)) : 0;

  let text = `**${query.commodity.name}** price overview:\n\n`;
  if (buyPrices.length > 0) {
    text += `- Buy: ${formatPrice(minBuy)} - ${formatPrice(Math.max(...buyPrices.map((p) => p.price_buy)))} aUEC/SCU (avg ${formatPrice(avgBuy)})\n`;
  } else {
    text += `- Buy: Not available at any terminal\n`;
  }
  if (sellPrices.length > 0) {
    text += `- Sell: ${formatPrice(Math.min(...sellPrices.map((p) => p.price_sell)))} - ${formatPrice(maxSell)} aUEC/SCU (avg ${formatPrice(avgSell)})\n`;
  } else {
    text += `- Sell: Not accepted at any terminal\n`;
  }
  text += `- Terminals trading: ${prices.length}`;

  if (query.commodity.is_illegal) {
    text += `\n- **Warning:** This is an illegal commodity!`;
  }

  return { text };
}

async function handleFindCommodity(query: ParsedQuery): Promise<ChatResponse> {
  if (!query.commodity) {
    const { commodities } = await getReferenceData();
    const available = commodities
      .filter((c) => c.is_available && c.is_visible)
      .map((c) => c.name)
      .slice(0, 20);
    return {
      text: `I'm not sure which commodity you mean. Here are some available commodities:\n\n${available.join(", ")}`,
    };
  }

  const c = query.commodity;
  let text = `**${c.name}** (${c.code})\n\n`;
  text += `- Type: ${c.kind || "Unknown"}\n`;
  if (c.price_buy > 0) text += `- Avg Buy Price: ${formatPrice(c.price_buy)} aUEC/SCU\n`;
  if (c.price_sell > 0) text += `- Avg Sell Price: ${formatPrice(c.price_sell)} aUEC/SCU\n`;

  const flags: string[] = [];
  if (c.is_extractable) flags.push("Mineable");
  if (c.is_illegal) flags.push("Illegal");
  if (c.is_raw) flags.push("Raw");
  if (c.is_refined) flags.push("Refined");
  if (c.is_harvestable) flags.push("Harvestable");
  if (flags.length > 0) text += `- Tags: ${flags.join(", ")}`;

  return { text };
}

function handleUnknown(): ChatResponse {
  return {
    text: `I'm not sure what you're asking. Here are some things I can help with:\n\n- **"Where should I sell Bexalite?"** - Find the best sell prices\n- **"Where can I buy Laranite?"** - Find the cheapest buy prices\n- **"What's the price of Agricium?"** - Get price overview\n- **"Best trade route for Quantanium"** - Find profitable routes\n- **"Best trade route from Hurston"** - Routes from a location\n- **"Tell me about Titanium"** - Commodity info`,
  };
}

export async function buildAnswer(query: ParsedQuery): Promise<ChatResponse> {
  switch (query.intent) {
    case "sell":
      return handleSell(query);
    case "buy":
      return handleBuy(query);
    case "trade_route":
      return handleTradeRoute(query);
    case "price_check":
      return handlePriceCheck(query);
    case "find_commodity":
      return handleFindCommodity(query);
    case "unknown":
    default:
      return handleUnknown();
  }
}
