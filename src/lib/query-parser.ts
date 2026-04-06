import type { Commodity, StarSystem, Vehicle, Terminal } from "@/lib/uex-client";
import { findCommodity, findStarSystem, findPlanet, findMoon, findVehicle, findTerminal } from "@/lib/data/cache";

export type Intent =
  | "sell"
  | "buy"
  | "trade_route"
  | "price_check"
  | "price_history"
  | "commodity_ranking"
  | "find_commodity"
  | "commodity_category"
  | "vehicle_info"
  | "vehicle_compare"
  | "profit_calc"
  | "multi_hop"
  | "terminal_info"
  | "station_info"
  | "city_info"
  | "outpost_info"
  | "location_info"
  | "budget_trade"
  | "location_trade"
  | "price_compare"
  | "fleet_trade"
  | "refinery_yields"
  | "refinery_method"
  | "fuel_prices"
  | "vehicle_buy"
  | "vehicle_rent"
  | "help"
  | "unknown";

export type ParsedQuery = {
  intent: Intent;
  commodity?: Commodity;
  commodities?: Commodity[];
  starSystem?: StarSystem;
  starSystem2?: StarSystem;
  planet?: { planetName: string; planetId: number };
  moon?: { moonName: string; moonId: number };
  vehicle?: Vehicle;
  vehicle2?: Vehicle;
  terminal?: Terminal;
  locationName?: string;
  budget?: number;
  category?: string;
  modifiers: string[];
  raw: string;
};

const SELL_KEYWORDS = ["sell", "selling", "offload", "dump", "unload", "get rid of"];
const BUY_KEYWORDS = ["buy", "buying", "purchase", "pick up", "acquire"];
const ROUTE_KEYWORDS = [
  "route", "trade route", "trading route", "most profitable",
  "best run", "money", "profit", "haul", "cargo run",
];
const PRICE_KEYWORDS = [
  "price", "cost", "worth", "value", "how much", "what does", "going for",
];
const HISTORY_KEYWORDS = [
  "history", "trend", "trending", "changed", "over time", "historical",
  "price history", "fluctuat",
];
const RANKING_KEYWORDS = [
  "ranking", "ranked", "most profitable", "best commodity",
  "top commodit", "most money", "highest profit",
  "what should i trade", "what to trade",
];
const VEHICLE_KEYWORDS = [
  "ship", "vehicle", "cargo capacity", "how much cargo", "scu capacity",
  "crew size",
];
const STATION_KEYWORDS = [
  "station", "space station", "services at", "what does .* have",
  "facilities",
];
const CITY_KEYWORDS = ["city", "lorville", "new babbage", "area 18", "orison"];
const OUTPOST_KEYWORDS = ["outpost", "outposts on", "mining outpost"];
const COMPARE_KEYWORDS = [
  "compare", "vs", "versus", "or the", "difference between",
];
const PROFIT_KEYWORDS = [
  "profit", "how much can i make", "how much will i make",
  "calculate earnings", "earning", "roi",
  "how much money",
];
const MULTI_HOP_KEYWORDS = [
  "multi-hop", "multi hop", "multihop", "multi stop", "multi-stop",
  "route plan", "plan a route", "best route with", "cargo run plan",
  "multi leg", "multi-leg",
];
const LOCATION_KEYWORDS = [
  "what's at", "whats at", "tell me about", "info about", "information about",
];
const BUDGET_KEYWORDS = [
  "i have", "with budget", "budget of", "spend", "invest",
  "auec to spend", "auec budget", "credits to spend",
];
const LOCATION_TRADE_KEYWORDS = [
  "i'm at", "im at", "i am at", "currently at", "docked at",
  "what should i buy at", "what should i sell at",
  "what to buy at", "what to sell at",
];
const CATEGORY_KEYWORDS = [
  "show me all", "list all", "what are the", "all the",
  "show me", "list",
];
const COMMODITY_CATEGORIES: Record<string, string> = {
  metal: "Metal", metals: "Metal",
  mineral: "Mineral", minerals: "Mineral",
  agricultural: "Agricultural", agriculture: "Agricultural", food: "Agricultural",
  gas: "Gas", gases: "Gas",
  drug: "Drug", drugs: "Drug", narcotics: "Drug",
  scrap: "Scrap",
  vice: "Vice",
  medical: "Medical",
  illegal: "_illegal",
  raw: "_raw",
  mineable: "_extractable",
  harvestable: "_harvestable",
};
const FLEET_KEYWORDS = [
  "fleet", "my ships", "both ships", "all my ships",
];
const PRICE_COMPARE_KEYWORDS = [
  "compare prices", "price comparison", "prices in .* vs",
  "compare .* in .* and",
];

const REFINERY_YIELDS_KEYWORDS = [
  "refinery yield", "refinery bonus", "best refinery for",
  "refinery for", "refine yield", "refining yield",
  "yield bonus", "where to refine", "which refinery",
  "refinery in", "refineries in",
];
const REFINERY_METHOD_KEYWORDS = [
  "refining method", "refinery method", "refining methods", "refinery methods",
  "dinyx", "electrostarolysis", "ferron exchange", "gaskin process",
  "kazen winnowing", "pyrometric", "thermonatic", "xcr reaction", "cormack method",
];
const FUEL_KEYWORDS_INTENT = [
  "fuel price", "fuel cost", "cheapest fuel", "hydrogen fuel",
  "quantum fuel", "where to refuel", "refuel at", "fuel at",
  "hydrogen price", "quantum price",
];
const VEHICLE_BUY_KEYWORDS = [
  "buy a ship", "buy the ship", "purchase a ship", "purchase the ship",
  "buy in-game", "buy ingame", "buy in game",
  "auec price", "in-game price", "ingame price",
  "ship price", "ship cost", "how much does the",
];
const VEHICLE_RENT_KEYWORDS = [
  "rent a", "rent the", "rental price", "rental cost",
  "where can i rent", "can i rent", "ships can i rent",
  "ship rental", "ships for rent", "available for rent",
];
const HELP_KEYWORDS = [
  "what can you do", "what do you do", "what can you help",
  "what can i ask", "how can you help", "how do i use",
  "what are your features", "what features", "show me what you can do",
  "help me", "what are you", "what is this",
];
const MODIFIER_KEYWORDS = [
  "best", "cheapest", "highest", "lowest", "most", "top", "profitable", "both", "all",
];

function detectIntent(text: string): Intent {
  const lower = text.toLowerCase();

  // Check help (very specific, check first)
  for (const kw of HELP_KEYWORDS) {
    if (lower.includes(kw)) return "help";
  }

  // Check fleet (very specific - "best trades for my C2 and Caterpillar")
  for (const kw of FLEET_KEYWORDS) {
    if (lower.includes(kw)) return "fleet_trade";
  }

  // Check price comparison across systems
  for (const kw of PRICE_COMPARE_KEYWORDS) {
    if (new RegExp(kw).test(lower)) return "price_compare";
  }

  // Check budget-aware trading ("I have 50000 aUEC")
  for (const kw of BUDGET_KEYWORDS) {
    if (lower.includes(kw)) return "budget_trade";
  }

  // Check location-based trading ("I'm at Port Tressler")
  for (const kw of LOCATION_TRADE_KEYWORDS) {
    if (lower.includes(kw)) return "location_trade";
  }

  // Check refinery methods (specific method names take priority)
  for (const kw of REFINERY_METHOD_KEYWORDS) {
    if (lower.includes(kw)) return "refinery_method";
  }

  // Check refinery yields
  for (const kw of REFINERY_YIELDS_KEYWORDS) {
    if (lower.includes(kw)) return "refinery_yields";
  }

  // Check fuel prices
  for (const kw of FUEL_KEYWORDS_INTENT) {
    if (lower.includes(kw)) return "fuel_prices";
  }

  // Check vehicle rent (before buy, since "rent" is more specific)
  for (const kw of VEHICLE_RENT_KEYWORDS) {
    if (lower.includes(kw)) return "vehicle_rent";
  }

  // Check vehicle buy (before generic vehicle_info)
  for (const kw of VEHICLE_BUY_KEYWORDS) {
    if (lower.includes(kw)) return "vehicle_buy";
  }

  // Check compare (very specific)
  for (const kw of COMPARE_KEYWORDS) {
    if (lower.includes(kw)) return "vehicle_compare";
  }

  // Check ranking before profit (ranking keywords like "most profitable" are
  // more specific than the generic "profit" keyword)
  for (const kw of RANKING_KEYWORDS) {
    if (lower.includes(kw)) return "commodity_ranking";
  }

  // Check profit calculator
  for (const kw of PROFIT_KEYWORDS) {
    if (lower.includes(kw)) return "profit_calc";
  }

  // Check history
  for (const kw of HISTORY_KEYWORDS) {
    if (lower.includes(kw)) return "price_history";
  }

  // Check multi-hop route
  for (const kw of MULTI_HOP_KEYWORDS) {
    if (lower.includes(kw)) return "multi_hop";
  }

  // Check trade route
  for (const kw of ROUTE_KEYWORDS) {
    if (lower.includes(kw)) return "trade_route";
  }

  // Check vehicle
  for (const kw of VEHICLE_KEYWORDS) {
    if (lower.includes(kw)) return "vehicle_info";
  }

  // Check station
  for (const kw of STATION_KEYWORDS) {
    if (lower.includes(kw)) return "station_info";
  }

  // Check outpost
  for (const kw of OUTPOST_KEYWORDS) {
    if (lower.includes(kw)) return "outpost_info";
  }

  // Check city
  for (const kw of CITY_KEYWORDS) {
    if (lower.includes(kw)) return "city_info";
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

  // Check location info (generic)
  for (const kw of LOCATION_KEYWORDS) {
    if (lower.includes(kw)) return "location_info";
  }

  // Check commodity category ("show me all metals", "illegal commodities")
  for (const cat of Object.keys(COMMODITY_CATEGORIES)) {
    if (lower.includes(cat)) {
      for (const kw of CATEGORY_KEYWORDS) {
        if (lower.includes(kw)) return "commodity_category";
      }
      // Also match "<category> commodities" pattern
      if (lower.includes("commodit")) return "commodity_category";
    }
  }

  return "unknown";
}

export function extractModifiers(text: string): string[] {
  const lower = text.toLowerCase();
  return MODIFIER_KEYWORDS.filter((m) => lower.includes(m));
}

export function parseQuery(
  text: string,
  commodityMap: Map<string, Commodity>,
  starSystemMap: Map<string, StarSystem>,
  terminals: Terminal[],
  vehicleMap: Map<string, Vehicle>
): ParsedQuery {
  const lower = text.toLowerCase();
  let intent = detectIntent(lower);
  const modifiers = extractModifiers(lower);

  // Try to find commodity name(s) in the query, tracking consumed word indices
  // so parts of a multi-word commodity name don't accidentally match another.
  const words = lower.replace(/[?!.,]/g, "").split(/\s+/);
  const commodityMatches: { commodity: Commodity; startIndex: number }[] = [];
  const usedCommodityIndices = new Set<number>();
  for (let windowSize = 4; windowSize >= 1; windowSize--) {
    for (let i = 0; i <= words.length - windowSize; i++) {
      const indices = Array.from({ length: windowSize }, (_, j) => i + j);
      if (indices.some((idx) => usedCommodityIndices.has(idx))) continue;
      const phrase = words.slice(i, i + windowSize).join(" ");
      if (isCommonWord(phrase)) continue;
      const found = findCommodity(phrase, commodityMap);
      if (found && !commodityMatches.some((m) => m.commodity.id === found.id)) {
        // Verify the match is tight — prevent large windows from spuriously
        // matching a commodity that's only a substring of the phrase
        // (e.g. "slam neon and astatine" matching just "Astatine")
        const phraseLen = phrase.replace(/[^a-z0-9]/g, "").length;
        const nameLen = found.name.toLowerCase().replace(/[^a-z0-9]/g, "").length;
        if (phraseLen <= nameLen * 1.5) {
          commodityMatches.push({ commodity: found, startIndex: i });
          indices.forEach((idx) => usedCommodityIndices.add(idx));
        }
      }
    }
  }
  // Sort by order of appearance in query
  commodityMatches.sort((a, b) => a.startIndex - b.startIndex);
  let foundCommodities = commodityMatches.map((m) => m.commodity);
  let commodity: Commodity | undefined = foundCommodities[0];
  let commodities: Commodity[] | undefined = foundCommodities.length > 0 ? foundCommodities : undefined;

  // Try to find vehicle name(s), tracking consumed word indices so that
  // parts of an already-matched name (e.g. manufacturer "Drake") don't
  // accidentally match a second vehicle.
  let vehicle: Vehicle | undefined;
  let vehicle2: Vehicle | undefined;
  const foundVehicles: Vehicle[] = [];
  const usedVehicleIndices = new Set<number>();
  for (let windowSize = 4; windowSize >= 1; windowSize--) {
    for (let i = 0; i <= words.length - windowSize; i++) {
      // Skip if any word in this window was already consumed by a previous match
      const indices = Array.from({ length: windowSize }, (_, j) => i + j);
      if (indices.some((idx) => usedVehicleIndices.has(idx))) continue;
      const phrase = words.slice(i, i + windowSize).join(" ");
      if (isCommonWord(phrase)) continue;
      const found = findVehicle(phrase, vehicleMap);
      if (found && !foundVehicles.some((v) => v.id === found.id)) {
        foundVehicles.push(found);
        indices.forEach((idx) => usedVehicleIndices.add(idx));
        if (foundVehicles.length >= 2) break;
      }
    }
    if (foundVehicles.length >= 2) break;
  }
  if (foundVehicles.length >= 1) vehicle = foundVehicles[0];
  if (foundVehicles.length >= 2) vehicle2 = foundVehicles[1];

  // Upgrade to fleet_trade if 2 vehicles detected and intent is trade-related or unknown
  if (
    foundVehicles.length >= 2 &&
    ["sell", "buy", "trade_route", "best_trade", "find_commodity", "unknown"].includes(intent)
  ) {
    intent = "fleet_trade";
  }

  // If we found a commodity but intent is unknown, infer
  if (commodity && intent === "unknown") {
    intent = "find_commodity";
  }

  // If we found 2 vehicles with compare intent, keep it
  if (intent === "vehicle_compare" && foundVehicles.length < 2) {
    // Not enough vehicles for compare, fall back to vehicle_info
    if (vehicle) intent = "vehicle_info";
  }

  // If we found a vehicle but intent is unknown or generic, set to vehicle_info
  if (vehicle && (intent === "unknown" || intent === "location_info")) {
    intent = "vehicle_info";
  }

  // Create a cleaned query for location matching (strip matched vehicle names
  // to avoid manufacturer names like "Crusader" being mistaken for planets)
  let locationQuery = lower;
  for (const v of foundVehicles) {
    if (v.name_full) locationQuery = locationQuery.replace(v.name_full.toLowerCase(), " ");
    locationQuery = locationQuery.replace(v.name.toLowerCase(), " ");
  }

  // Try to find a star system — check each query word against all known systems
  let starSystem: StarSystem | undefined;
  const locationWords = locationQuery.replace(/[?!.,]/g, "").split(/\s+/);
  for (let windowSize = 2; windowSize >= 1; windowSize--) {
    for (let i = 0; i <= locationWords.length - windowSize; i++) {
      const phrase = locationWords.slice(i, i + windowSize).join(" ");
      if (isCommonWord(phrase)) continue;
      const found = findStarSystem(phrase, starSystemMap);
      if (found) {
        starSystem = found;
        break;
      }
    }
    if (starSystem) break;
  }

  // Disambiguate: if a star system was found and the commodity was a fuzzy match
  // of similar text, the system wins (e.g. "Taranis" system vs "Taranite" commodity).
  // Drop the commodity if its name doesn't appear verbatim in the query.
  if (starSystem && commodity) {
    const commodityNorm = commodity.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    const queryNorm = lower.replace(/[^a-z0-9 ]/g, "");
    if (!queryNorm.includes(commodityNorm)) {
      foundCommodities = foundCommodities.filter((c) => c.id !== commodity!.id);
      commodity = foundCommodities[0];
      commodities = foundCommodities.length > 0 ? foundCommodities : undefined;
    }
  }

  // Try to find a planet
  const planetNames = [
    "hurston", "arccorp", "arc corp", "crusader", "microtech", "micro tech",
  ];
  let planet: { planetName: string; planetId: number } | undefined;
  for (const pName of planetNames) {
    if (locationQuery.includes(pName)) {
      planet = findPlanet(pName, terminals);
      break;
    }
  }

  // Resolve planet-vs-vehicle manufacturer conflicts:
  // "Crusader" alone = planet, "Crusader C2 Hercules" = vehicle
  // Planet names like Crusader, Hurston match ship manufacturers via substring.
  if (planet && vehicle && intent === "vehicle_info") {
    for (const pName of planetNames) {
      if (lower.includes(pName)) {
        // Check if query has vehicle-model words beyond the planet/manufacturer name
        const vehicleNorm = (vehicle.name_full || vehicle.name).toLowerCase().replace(/[^a-z0-9]/g, "");
        const planetNorm = pName.replace(/[^a-z0-9]/g, "");
        const vehicleModelPart = vehicleNorm.replace(planetNorm, "");
        const queryWords = words.filter((w) => !isCommonWord(w) && w !== pName);
        const hasVehicleModel = vehicleModelPart.length > 0 && queryWords.some(
          (w) => vehicleModelPart.includes(w.replace(/[^a-z0-9]/g, ""))
        );
        const hasVehicleKeyword = VEHICLE_KEYWORDS.some((kw) => lower.includes(kw));

        if (!hasVehicleModel && !hasVehicleKeyword) {
          vehicle = undefined;
          intent = "location_info";
          break;
        }
      }
    }
  }

  // Try to find a moon
  const moonNames = [
    "cellin", "daymar", "yela", "lyria", "wala",
    "aberdeen", "arial", "ita", "magda",
    "calliope", "clio", "euterpe",
  ];
  let moon: { moonName: string; moonId: number } | undefined;
  for (const mName of moonNames) {
    if (locationQuery.includes(mName)) {
      moon = findMoon(mName, terminals);
      break;
    }
  }

  // Try to find a terminal/station name in the query
  // Use sliding window on the full query (terminal names can be long, e.g. "Refinery Shop - CRU-L1")
  let terminal: Terminal | undefined;
  // First try matching the entire query (minus common prefixes) as a terminal name
  const strippedQuery = lower
    .replace(/^(what'?s at|whats at|tell me about|info about|info on|what does|what is|show me)\s+/i, "")
    .replace(/\?$/, "")
    .trim();
  terminal = findTerminal(strippedQuery, terminals);
  // If that didn't work, try sliding window approach
  if (!terminal) {
    for (let windowSize = Math.min(8, words.length); windowSize >= 2; windowSize--) {
      for (let i = 0; i <= words.length - windowSize; i++) {
        const phrase = words.slice(i, i + windowSize).join(" ");
        const found = findTerminal(phrase, terminals);
        if (found) {
          terminal = found;
          break;
        }
      }
      if (terminal) break;
    }
  }

  // If we found a terminal and no specific trade intent, show terminal info
  // Don't override location_info when a planet was explicitly resolved (e.g. "Crusader" = planet, not terminal)
  if (terminal && (intent === "unknown" || intent === "find_commodity" || intent === "station_info" || (intent === "location_info" && !planet))) {
    intent = "terminal_info";
  }

  // Extract budget amount (e.g., "I have 50000 aUEC", "50k budget")
  let budget: number | undefined;
  const budgetMatch = lower.match(/(\d+[\d,]*\.?\d*)\s*k?\s*(?:auec|credits|cr|uec|budget|to spend|to invest)/);
  if (budgetMatch) {
    let amount = parseFloat(budgetMatch[1].replace(/,/g, ""));
    if (lower.includes(budgetMatch[1] + "k")) amount *= 1000;
    budget = amount;
  }
  // Also try "I have Xk" pattern
  if (!budget) {
    const budgetMatch2 = lower.match(/(?:i have|budget of|with)\s+(\d+[\d,]*\.?\d*)k?\s*/);
    if (budgetMatch2) {
      let amount = parseFloat(budgetMatch2[1].replace(/,/g, ""));
      if (lower.includes(budgetMatch2[1] + "k")) amount *= 1000;
      if (amount > 100) budget = amount; // Only treat as budget if > 100
    }
  }

  // Extract commodity category
  let category: string | undefined;
  for (const [key, value] of Object.entries(COMMODITY_CATEGORIES)) {
    if (lower.includes(key)) {
      category = value;
      break;
    }
  }

  // Try to find a second star system for price comparison ("Iron in Stanton vs Pyro")
  let starSystem2: StarSystem | undefined;
  if (intent === "price_compare" && starSystem) {
    for (let i = 0; i <= locationWords.length - 1; i++) {
      const word = locationWords[i];
      if (isCommonWord(word)) continue;
      const found = findStarSystem(word, starSystemMap);
      if (found && found.id !== starSystem.id) {
        starSystem2 = found;
        break;
      }
    }
  }

  // "What can I sell/buy at [terminal]" = terminal_info, not sell/buy
  // The user is asking about the terminal's inventory, not about a specific commodity.
  // Preserve the original direction as a modifier so the answer builder can filter tables.
  if (terminal && !commodity && (intent === "sell" || intent === "buy")) {
    if (!modifiers.includes(intent)) modifiers.push(intent);
    intent = "terminal_info";
  }

  // If we found a location but intent is still unknown, infer location_info
  if ((starSystem || planet || moon) && intent === "unknown") {
    intent = "location_info";
  }

  // Extract a location name for generic location queries
  let locationName: string | undefined;
  const locationPatterns = [
    /(?:what'?s at|whats at|tell me about|info about|services at|facilities at)\s+(.+?)(?:\?|$)/i,
    /(?:outposts on|outposts at)\s+(.+?)(?:\?|$)/i,
  ];
  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match) {
      locationName = match[1].trim();
      break;
    }
  }

  return {
    intent,
    commodity,
    commodities,
    starSystem,
    starSystem2,
    planet,
    moon,
    vehicle,
    vehicle2,
    terminal,
    locationName,
    budget,
    category,
    modifiers,
    raw: text,
  };
}

const COMMON_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been",
  "in", "on", "at", "to", "for", "of", "with", "by", "from",
  "where", "what", "how", "which", "best", "most", "can", "i",
  "me", "my", "do", "does", "should", "would", "could",
  "sell", "buy", "trade", "trades", "trading", "find", "get", "place", "system",
  "ship", "ships", "about", "tell", "info", "much", "cargo",
  "compare", "price", "prices", "vs", "show", "all", "list",
  "have", "budget", "spend", "invest", "and", "or",
]);

function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word);
}
