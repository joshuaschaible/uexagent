import {
  getCommodityPricesAll,
  type CommodityPrice,
} from "@/lib/uex-client";

export type RouteStop = {
  step: number;
  action: "buy" | "sell" | "fly";
  terminalName: string;
  location: string;
  commodityName?: string;
  pricePerScu?: number;
  totalCost?: number;
  profit?: number;
};

export type MultiHopResult = {
  stops: RouteStop[];
  totalProfit: number;
  totalInvestment: number;
  scu: number;
  system: string;
};

/**
 * Greedy multi-hop route planner.
 * Finds the best sequence of buy→sell stops for a given cargo capacity.
 */
export async function planMultiHopRoute(
  scu: number,
  maxHops: number = 3,
  systemFilter?: string
): Promise<MultiHopResult | null> {
  const allPrices = await getCommodityPricesAll();

  if (allPrices.length === 0) return null;

  // Build a lookup: terminal → commodities it buys/sells
  const terminalBuy = new Map<string, CommodityPrice[]>();
  const terminalSell = new Map<string, CommodityPrice[]>();

  for (const p of allPrices) {
    // Filter by system if specified
    if (systemFilter) {
      const sysLower = systemFilter.toLowerCase();
      if (!p.star_system_name?.toLowerCase().includes(sysLower)) continue;
    }

    if (p.price_buy > 0 && p.status_buy > 0) {
      const existing = terminalBuy.get(p.terminal_name) || [];
      existing.push(p);
      terminalBuy.set(p.terminal_name, existing);
    }
    if (p.price_sell > 0 && p.status_sell > 0) {
      const existing = terminalSell.get(p.terminal_name) || [];
      existing.push(p);
      terminalSell.set(p.terminal_name, existing);
    }
  }

  // Find all possible buy→sell pairs with profit
  type TradePair = {
    commodity: string;
    buyTerminal: string;
    buyLocation: string;
    buyPrice: number;
    sellTerminal: string;
    sellLocation: string;
    sellPrice: number;
    profitPerScu: number;
    system: string;
  };

  const tradePairs: TradePair[] = [];

  for (const [buyTerminal, buyPrices] of terminalBuy.entries()) {
    for (const bp of buyPrices) {
      // Find best sell location for this commodity
      let bestSell: CommodityPrice | null = null;
      let bestProfit = 0;

      for (const [sellTerminal, sellPrices] of terminalSell.entries()) {
        if (sellTerminal === buyTerminal) continue;
        const sp = sellPrices.find(
          (s) => s.commodity_name === bp.commodity_name
        );
        if (sp && sp.price_sell - bp.price_buy > bestProfit) {
          bestSell = sp;
          bestProfit = sp.price_sell - bp.price_buy;
        }
      }

      if (bestSell && bestProfit > 0) {
        tradePairs.push({
          commodity: bp.commodity_name,
          buyTerminal,
          buyLocation: [bp.planet_name, bp.star_system_name]
            .filter(Boolean)
            .join(", "),
          buyPrice: bp.price_buy,
          sellTerminal: bestSell.terminal_name,
          sellLocation: [bestSell.planet_name, bestSell.star_system_name]
            .filter(Boolean)
            .join(", "),
          sellPrice: bestSell.price_sell,
          profitPerScu: bestProfit,
          system: bp.star_system_name || "Stanton",
        });
      }
    }
  }

  if (tradePairs.length === 0) return null;

  // Sort by profit per SCU descending
  tradePairs.sort((a, b) => b.profitPerScu - a.profitPerScu);

  // Greedy: pick the best non-overlapping hops
  const selectedHops: TradePair[] = [];
  const usedTerminals = new Set<string>();

  for (const pair of tradePairs) {
    if (selectedHops.length >= maxHops) break;
    // Avoid revisiting the same sell terminal as a buy terminal of a previous hop
    // But allow chaining: sell terminal of previous = buy terminal of next
    if (selectedHops.length > 0) {
      const lastSell =
        selectedHops[selectedHops.length - 1].sellTerminal;
      // Prefer routes that chain from the last sell location
      // But for simplicity, just pick the highest profit ones
    }
    if (
      !usedTerminals.has(pair.buyTerminal) ||
      selectedHops.length === 0
    ) {
      selectedHops.push(pair);
      usedTerminals.add(pair.buyTerminal);
      usedTerminals.add(pair.sellTerminal);
    }
  }

  if (selectedHops.length === 0) return null;

  // Build stop list
  const stops: RouteStop[] = [];
  let totalProfit = 0;
  let totalInvestment = 0;
  let step = 1;

  for (const hop of selectedHops) {
    const hopInvestment = hop.buyPrice * scu;
    const hopRevenue = hop.sellPrice * scu;
    const hopProfit = hopRevenue - hopInvestment;

    stops.push({
      step: step++,
      action: "buy",
      terminalName: hop.buyTerminal,
      location: hop.buyLocation,
      commodityName: hop.commodity,
      pricePerScu: hop.buyPrice,
      totalCost: hopInvestment,
    });

    stops.push({
      step: step++,
      action: "fly",
      terminalName: hop.sellTerminal,
      location: hop.sellLocation,
    });

    stops.push({
      step: step++,
      action: "sell",
      terminalName: hop.sellTerminal,
      location: hop.sellLocation,
      commodityName: hop.commodity,
      pricePerScu: hop.sellPrice,
      totalCost: hopRevenue,
      profit: hopProfit,
    });

    totalProfit += hopProfit;
    totalInvestment += hopInvestment;
  }

  return {
    stops,
    totalProfit,
    totalInvestment,
    scu,
    system: selectedHops[0].system,
  };
}
