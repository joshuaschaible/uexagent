import type { CommodityPrice, Terminal, Vehicle } from "./uex-client";
import { availableTradeScu, getCargoConstraint, isBuyable, isSellable } from "./trade-data";

export type TradeOpportunity = {
  name: string;
  buy: CommodityPrice;
  sell: CommodityPrice;
  scu: number;
  investment: number;
  revenue: number;
  profit: number;
  profitPerScu: number;
  assumptions: string[];
};

/** Compare complete buy/sell pairs; input order must never lose sell-only records. */
export function findTradeOpportunities(
  prices: CommodityPrice[],
  terminals: Terminal[],
  capacity: number,
  budget?: number,
  vehicle?: Vehicle,
  originId?: number,
): TradeOpportunity[] {
  if (getCargoConstraint(vehicle, undefined)) return [];
  const terminalMap = new Map(terminals.map((t) => [t.id, t]));
  const groups = new Map<number, { buys: CommodityPrice[]; sells: CommodityPrice[] }>();
  for (const price of prices) {
    const terminal = terminalMap.get(price.id_terminal);
    if (terminal?.is_available === 0 || terminal?.is_available_live === 0 || terminal?.is_visible === 0) continue;
    if (getCargoConstraint(vehicle, terminal)) continue;
    const group = groups.get(price.id_commodity) || { buys: [], sells: [] };
    if (isBuyable(price) && (originId === undefined || originId === price.id_terminal)) group.buys.push(price);
    if (isSellable(price)) group.sells.push(price);
    groups.set(price.id_commodity, group);
  }
  const trades: TradeOpportunity[] = [];
  for (const { buys, sells } of groups.values()) {
    let best: TradeOpportunity | undefined;
    for (const buy of buys) for (const sell of sells) {
      if (buy.id_terminal === sell.id_terminal) continue;
      const spread = sell.price_sell - buy.price_buy;
      if (!Number.isFinite(spread) || spread <= 0) continue;
      const scu = availableTradeScu(buy, sell, capacity, budget);
      if (scu <= 0) continue;
      const profit = spread * scu;
      if (best && best.profit >= profit) continue;
      const assumptions: string[] = [];
      if (buy.scu_buy == null) assumptions.push("Supply not reported");
      if (sell.scu_sell == null) assumptions.push("Demand not reported");
      if (!terminalMap.has(buy.id_terminal) || !terminalMap.has(sell.id_terminal)) assumptions.push("Terminal compatibility unknown");
      best = { name: buy.commodity_name, buy, sell, scu, investment: buy.price_buy * scu,
        revenue: sell.price_sell * scu, profit, profitPerScu: spread, assumptions };
    }
    if (best) trades.push(best);
  }
  return trades.sort((a, b) => b.profit - a.profit || a.investment - b.investment);
}

export const TRADE_ESTIMATE_NOTE = "Estimated gross profit before fuel, fees, and travel costs. Quantities respect reported supply and forecast demand where available; forecasts are not guaranteed.";
