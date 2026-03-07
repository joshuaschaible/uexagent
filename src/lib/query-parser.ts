import type { Commodity, StarSystem } from "@/lib/uex-client";
import type { Terminal } from "@/lib/uex-client";
import { findCommodity, findStarSystem, findPlanet } from "@/lib/data/cache";

export type Intent =
  | "sell"
  | "buy"
  | "trade_route"
  | "price_check"
  | "find_commodity"
  | "unknown";

export type ParsedQuery = {
  intent: Intent;
  commodity?: Commodity;
  starSystem?: StarSystem;
  planet?: { planetName: string; planetId: number };
  modifiers: string[];
  raw: string;
};

const SELL_KEYWORDS = ["sell", "selling", "offload", "dump", "unload", "get rid of"];
const BUY_KEYWORDS = ["buy", "buying", "purchase", "pick up", "acquire", "get", "find"];
const ROUTE_KEYWORDS = [
  "route",
  "trade route",
  "trading route",
  "most profitable",
  "best run",
  "money",
  "profit",
  "haul",
  "cargo run",
];
const PRICE_KEYWORDS = [
  "price",
  "cost",
  "worth",
  "value",
  "how much",
  "what does",
  "going for",
];
const MODIFIER_KEYWORDS = [
  "best",
  "cheapest",
  "highest",
  "lowest",
  "most",
  "top",
  "profitable",
];

function detectIntent(text: string): Intent {
  const lower = text.toLowerCase();

  // Check trade route first (more specific)
  for (const kw of ROUTE_KEYWORDS) {
    if (lower.includes(kw)) return "trade_route";
  }

  // Check price
  for (const kw of PRICE_KEYWORDS) {
    if (lower.includes(kw)) return "price_check";
  }

  // Check sell
  for (const kw of SELL_KEYWORDS) {
    if (lower.includes(kw)) return "sell";
  }

  // Check buy
  for (const kw of BUY_KEYWORDS) {
    if (lower.includes(kw)) return "buy";
  }

  return "unknown";
}

function extractModifiers(text: string): string[] {
  const lower = text.toLowerCase();
  return MODIFIER_KEYWORDS.filter((m) => lower.includes(m));
}

export function parseQuery(
  text: string,
  commodityMap: Map<string, Commodity>,
  starSystemMap: Map<string, StarSystem>,
  terminals: Terminal[]
): ParsedQuery {
  const lower = text.toLowerCase();
  let intent = detectIntent(lower);
  const modifiers = extractModifiers(lower);

  // Try to find a commodity name in the query
  // Strategy: try progressively smaller word windows
  const words = lower.replace(/[?!.,]/g, "").split(/\s+/);
  let commodity: Commodity | undefined;

  // Try multi-word matches first (up to 4 words), then single words
  for (let windowSize = 4; windowSize >= 1; windowSize--) {
    for (let i = 0; i <= words.length - windowSize; i++) {
      const phrase = words.slice(i, i + windowSize).join(" ");
      // Skip common non-commodity words
      if (isCommonWord(phrase)) continue;
      const found = findCommodity(phrase, commodityMap);
      if (found) {
        commodity = found;
        break;
      }
    }
    if (commodity) break;
  }

  // If we found a commodity but intent is unknown, infer from context
  if (commodity && intent === "unknown") {
    intent = "find_commodity";
  }

  // Try to find a star system
  let starSystem: StarSystem | undefined;
  const systemNames = ["stanton", "pyro", "nyx", "terra", "sol"];
  for (const sysName of systemNames) {
    if (lower.includes(sysName)) {
      starSystem = findStarSystem(sysName, starSystemMap);
      break;
    }
  }

  // Try to find a planet
  const planetNames = [
    "hurston",
    "arccorp",
    "arc corp",
    "crusader",
    "microtech",
    "micro tech",
  ];
  let planet: { planetName: string; planetId: number } | undefined;
  for (const pName of planetNames) {
    if (lower.includes(pName)) {
      planet = findPlanet(pName, terminals);
      break;
    }
  }

  return {
    intent,
    commodity,
    starSystem,
    planet,
    modifiers,
    raw: text,
  };
}

function isCommonWord(word: string): boolean {
  const common = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been",
    "in", "on", "at", "to", "for", "of", "with", "by", "from",
    "where", "what", "how", "which", "best", "most", "can", "i",
    "me", "my", "do", "does", "should", "would", "could",
    "sell", "buy", "trade", "find", "get", "place", "system",
  ]);
  return common.has(word);
}
