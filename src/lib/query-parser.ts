import type { Commodity, StarSystem, Vehicle, Terminal } from "@/lib/uex-client";
import { findCommodity, findStarSystem, findPlanet, findMoon, findVehicle, findTerminal, findTerminalByAlias } from "@/lib/data/cache";

export type Intent =
  | "craft_recipe"
  | "blueprint_unlock"
  | "mission_info"
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
  | "mining_locations"
  | "equipment_info"
  | "equipment_buy"
  | "equipment_compare"
  | "market_alerts"
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
  orbit?: { orbitName: string; orbitId: number };
  poi?: { poiName: string; poiId: number };
  city?: { cityName: string; cityId: number };
  station?: { stationName: string; stationId: number };
  vehicle?: Vehicle;
  vehicle2?: Vehicle;
  terminal?: Terminal;
  locationName?: string;
  locationError?: string;
  itemName?: string;
  itemName2?: string;
  equipmentCategory?: string;
  equipmentSize?: number;
  gameVersion?: string;
  dateFrom?: string;
  dateTo?: string;
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

export const EQUIPMENT_CATEGORIES: [RegExp, string][] = [
  [/\b(?:(?:scrap{1,2}er|(?:hull\s+)?scraping)\s+(?:modules?|beams?)|salvag(?:e|ing)\s+modules?|abrade|cinch|trawler|ready\s*grip)\b/i, "scraper beams"],
  [/\bsalvage\s+beams?\b/i, "salvage beams"],
  [/\b(?:mining (?:lasers?|laser heads?|heads?)|lancet|arbor|hofstede|helix|klein|lawson|pitman|mh[12v])\b/i, "mining lasers"],
  [/\bmining modules?\b/i, "mining modules"],
  [/\b(?:mining gadgets?|gadgets?)\b/i, "mining gadgets"],
  [/\bquantum drives?\b/i, "quantum drives"],
  [/\b(?:shield generators?|shields?)\b/i, "shield generators"],
  [/\bpower plants?\b/i, "power plants"],
  [/\bcoolers?\b/i, "coolers"],
  [/\b(?:ship components?|equipment|components?)\b/i, "ship components"],
  [/\b(?:personal weapons?|rifles?|pistols?|firearms?)\b/i, "personal weapons"],
  [/\b(?:ship weapons?|vehicle weapons?|ship guns?|laser repeaters?|laser cannons?)\b/i, "vehicle weapons"],
  [/\bhelmets?\b/i, "helmets"],
  [/\bbackpacks?\b/i, "backpacks"],
  [/\bundersuits?\b/i, "undersuits"],
  [/\b(?:armou?r|helmets?|backpacks?|undersuits?)\b/i, "armor"],
  [/\bweapons?\b/i, "weapons"],
];

export function isEquipmentQuery(text: string): boolean {
  if (/\b(?:ship|vehicle)\s+(?:specs?|comparison|cargo)\b/i.test(text)) return false;
  return EQUIPMENT_CATEGORIES.some(([pattern]) => pattern.test(text));
}

/** A named commodity immediately after buy/sell is a trade, even at a mining shop. */
export function explicitCommodityTradeIntent(text: string, commodityMap: Map<string, Commodity>): "buy" | "sell" | undefined {
  const match = text.match(/\b(buy|buying|purchase|purchasing|sell|selling|offload|unload)\s+(.+)/i);
  if (!match) return undefined;
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = normalize(match[2]).replace(/^(?:some|the)\s+/, "").replace(/^\d+(?:\s+\d+)?\s*(?:scu|units?)?\s*(?:of\s+)?/, "");
  const namedCommodity = [...new Set(commodityMap.values())].some((commodity) => [commodity.name, commodity.code].some((name) => {
    const normalized = normalize(name || "");
    return normalized.length >= 3 && (target === normalized || target.startsWith(`${normalized} `));
  }));
  return namedCommodity ? /^(?:sell|selling|offload|unload)$/i.test(match[1]) ? "sell" : "buy" : undefined;
}

export function parseTemporalFilters(text: string): Pick<ParsedQuery, "gameVersion" | "dateFrom" | "dateTo"> {
  const gameVersion = text.match(/\b(?:game\s+version|version|patch|in)\s+v?(\d+\.\d+(?:\.\d+)?)(?![\d.])/i)?.[1];
  const validDate = (value?: string) => value && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value ? value : undefined;
  return {
    gameVersion,
    dateFrom: validDate(text.match(/\b(?:from|since|after)\s+(\d{4}-\d{2}-\d{2})\b/i)?.[1]),
    dateTo: validDate(text.match(/\b(?:to|until|before|through)\s+(\d{4}-\d{2}-\d{2})\b/i)?.[1]),
  };
}

function equipmentSubject(text: string): string {
  // "Data on scraper modules" names a topic; "modules on Hurston" names a place.
  return text.replace(/\b(?:data|information|info|details?|stats?|statistics|specs?|specifications)\s+(?:on|about|for)\s+/gi, "");
}

export function extractEquipmentLocation(text: string): string | undefined {
  return extractMiningLocation(equipmentSubject(text));
}

export function parseEquipmentQuery(text: string): ParsedQuery {
  const sizePattern = /\b(?:size[\s-]*(zero|one|two|three|four|five|six|seven|eight|nine|[0-9])|s\s?([0-9]))\b/i;
  const sizeMatch = text.match(sizePattern);
  const sizeToken = sizeMatch?.[1] || sizeMatch?.[2];
  const sizeWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const equipmentSize = sizeToken ? (/^\d$/.test(sizeToken) ? Number(sizeToken) : sizeWords.indexOf(sizeToken.toLowerCase())) : undefined;
  const locationName = extractEquipmentLocation(text);
  const equipmentCategory = EQUIPMENT_CATEGORIES.find(([pattern]) => pattern.test(text))?.[1];
  let cleaned = equipmentSubject(text);
  if (locationName) {
    const index = cleaned.toLowerCase().indexOf(locationName.toLowerCase());
    cleaned = cleaned.slice(0, index).replace(/\b(?:on|in|at|near|around)\s*$/i, "") + cleaned.slice(index + locationName.length);
  }
  const cleanName = (value: string) => value
    .replace(sizePattern, " ")
    .replace(/^(?:i|we)\s+(?:don['’]t|do not|can['’]t|cannot)\s+(?:see|find)\s+(?:any\s+)?/i, "")
    .replace(/^(?:what|how) about\s+/i, "")
    .replace(/^(?:can|could|should|do)\s+(?:i|we)\s+/i, "")
    .replace(/^how much\s+(?:does|is)?\s*/i, "")
    .replace(/^(?:(?:where|how|what|which)\s+(?:(?:can|do|does|should|is|are)\s*(?:i|we|the)?\s*|to\s+))/i, "")
    .replace(/\b(?:compare|tell me about|show me|show|list|find|buy|purchase|sold|costs?|prices?|specs?|specifications|details|information|info|data|stats?|statistics|best|cheapest|all|available|of|for|the)\b/gi, " ")
    .replace(/\b(?:(?:scrap{1,2}er|(?:hull\s+)?scraping|salvag(?:e|ing))\s+(?:modules?|beams?))\b/gi, " ")
    .replace(/\b(?:mining\s+(?:laser\s+heads?|lasers?|heads?|modules?|gadgets?)|quantum\s+drives?|shield\s+generators?|shields?|power\s+plants?|coolers?|ship\s+components?|personal\s+weapons?|vehicle\s+weapons?|ship\s+weapons?|armou?r|helmets?|backpacks?|undersuits?|equipment)\b/gi, " ")
    .replace(/\b(?:hey|hi|please|can|could|would|you|i|we|they|need|want|looking|look|which|what|where|how|do|does|is|are|shops?|stores?|vendors?|sellers?|sell|selling|stock|stocks|stocking|carry|carries|carrying|get|a|an|some|one|ones|them|it|that|slot|slots|to)\b/gi, " ")
    .replace(/[?!."'@]/g, " ").replace(/\s+/g, " ").trim();
  const comparing = /\b(?:compare|vs|versus|difference between)\b/i.test(text);
  const parts = cleaned.replace(/\bdifference between\b/i, "").split(/\s+(?:vs\.?|versus|and)\s+/i);
  const itemName = cleanName(parts[0] || "");
  const itemName2 = comparing ? cleanName(parts[1] || "") : undefined;
  return {
    intent: comparing ? "equipment_compare" : /\b(?:buy|purchase|prices?|cost|where|shops?|stores?|vendors?|sellers?|stock|stocks|stocking|carry|carries|carrying|sell|selling)\b/i.test(text) || locationName ? "equipment_buy" : "equipment_info",
    itemName: itemName || undefined,
    itemName2: itemName2 || undefined,
    equipmentCategory,
    equipmentSize,
    locationName,
    modifiers: extractModifiers(text),
    raw: text,
    ...parseTemporalFilters(text),
  };
}

/** Mining deposits are separate from trading ore, refining, and mining equipment. */
export function isMiningLocationQuery(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\b(?:sell(?:ing)?|buy(?:ing)?|purchase|rent(?:al)?|refin\w*|outposts?|prices?|cost|worth|profit|history|trends?)\b/.test(lower)) return false;
  if (/\bmining\s+(?:ships?|vehicles?|lasers?|equipment|tools?|modules?|gadgets?)\b/.test(lower)) return false;
  if (/\b(?:ships?|vehicles?|lasers?|equipment|tools?|modules?|gadgets?)\b.*\b(?:mining|mine)\b/.test(lower)) return false;
  if (/\b(?:mineable|minable)\s+commodities\b/.test(lower) && !/\b(?:on|in|at|near|around)\b/.test(lower)) return false;
  return /\b(?:mine|mining|deposits?|mineable|minable)\b/.test(lower)
    || /\b(?:ores?|minerals?|resources)\b.*\b(?:found|on|in|at|near|around)\b/.test(lower)
    || /\b(?:where|which locations?)\b.*\b(?:ores?|found|occurs?|extract)\b/.test(lower)
    || /\b(?:is|are)\b.+\b(?:found|present)\b/.test(lower);
}

/** Preserve names outside the trade-terminal catalogue for dynamic mining lookup. */
export function extractMiningLocation(text: string): string | undefined {
  const match = text.match(/\b(?:on|in|at|around|near|within)\s+(.+?)(?:[,?!;]|$)/i);
  if (!match) return undefined;
  const location = match[1]
    .replace(/\s+(?:with|using|for|but|on|in|at)\b.*$/i, "")
    .replace(/\s+(?:(?:can|could|would|should)\s+(?:i|we|you)|is|are|where)\b.*$/i, "")
    .replace(/^(?:the|@)\s*/i, "")
    .replace(/[.,]+$/, "")
    .trim();
  if (!location || /^(?:there|here|it|that|this|them|my ship)$/i.test(location)) return undefined;
  return location;
}

export function isMiningInventoryQuery(text: string): boolean {
  return /\b(?:what|which)\s+(?:ores?|minerals?|materials?|commodities|resources)\b/i.test(text)
    || /\b(?:what|which)\s+(?:can|could)\s+i\s+mine\b/i.test(text)
    || /^(?:(?:show|list)(?:\s+me)?(?:\s+all)?\s+)?(?:ores?|minerals?|resources)\s+(?:on|in|at|near|around)\b/i.test(text.trim());
}

/** Match actual commodity names/codes, never fuzzy fragments such as "ore" or "on". */
export function parseMiningQuery(text: string, commodityMap: Map<string, Commodity>): ParsedQuery {
  const locationName = extractMiningLocation(text);
  const locationIndex = locationName ? text.toLowerCase().indexOf(locationName.toLowerCase()) : -1;
  const commodityText = locationIndex >= 0
    ? text.slice(0, locationIndex) + " " + text.slice(locationIndex + locationName!.length)
    : text;
  const normalized = ` ${commodityText.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const candidates = [...new Set(commodityMap.values())].flatMap((commodity) => {
    const names = [commodity.name, commodity.code, commodity.name.replace(/\s*\((?:raw|ore|unrefined)\)\s*$/i, "")];
    const lengths = names.map((name) => (name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
      .filter((name) => name.length >= 3 && !COMMON_WORDS.has(name) && normalized.includes(` ${name} `))
      .map((name) => name.length);
    return lengths.length ? [{ commodity, length: Math.max(...lengths) }] : [];
  }).sort((a, b) => b.length - a.length);
  const commodity = isMiningInventoryQuery(text) ? undefined : candidates[0]?.commodity;
  return {
    intent: "mining_locations",
    commodity,
    commodities: commodity ? [commodity] : undefined,
    locationName,
    modifiers: extractModifiers(text),
    raw: text,
  };
}

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
  if (/\brefin(?:e|ing)\b/.test(lower)) return "refinery_yields";
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
  if (/\b(?:ships?|vehicles?)\b/.test(lower) && /\b(?:buy|purchase)\b/.test(lower) && !isEquipmentQuery(text)) return "vehicle_buy";
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

/** Reference requests take precedence over equipment shopping and trading. */
export function parseCraftingQuery(text: string): ParsedQuery | null {
  const recipe = /\b(?:craft(?:ing)?|recipe|ingredients?|materials?\s+(?:do|to|for|needed|required)|need\s+to\s+(?:make|build))\b/i.test(text);
  const blueprint = /\bblueprints?\b/i.test(text);
  const mission = /\bmissions?\b/i.test(text);
  const unlock = /\b(?:unlock|earn|obtain|reward|drop|complete|completion|get)\b/i.test(text);
  if (!recipe && !blueprint && !mission) return null;
  let intent: Intent = mission && !blueprint && !/\bunlock\b/i.test(text) ? "mission_info" : blueprint && (unlock || mission) ? "blueprint_unlock" : recipe ? "craft_recipe" : "blueprint_unlock";
  if (mission && /\bunlock\b/i.test(text)) intent = "blueprint_unlock";
  let name = text.trim().replace(/[?!.,]+$/, "");
  if (intent === "craft_recipe") {
    name = name.replace(/^.*?\b(?:craft(?:ing)?|recipe\s+for|(?:ingredients?|materials?)\s+(?:(?:needed|required)\s+)?for|need\s+(?:for|to\s+(?:craft|make|build)))\s+/i, "");
  } else if (intent === "blueprint_unlock") {
    name = name.replace(/^.*?\b(?:unlock|earn|obtain|get|reward|drop)\s+/i, "").replace(/^.*?\bblueprints?\s+(?:for|of)\s+/i, "");
    if (name === text.trim().replace(/[?!.,]+$/, "")) name = name.replace(/^.*?\b(?:for|rewarding)\s+/i, "");
  } else {
    name = name.replace(/^(?:tell me about|show me|what (?:is|are)|details (?:on|about)|requirements for|how (?:do i|to) (?:unlock|start|complete))\s+/i, "").replace(/^missions?\s+(?:called|named|for)\s+/i, "");
  }
  name = name.replace(/^(?:(?:a|an|the)\s+)+/i, "").replace(/^blueprint\s+(?:for\s+)?/i, "").replace(/\s+(?:blueprints?|missions?)$/i, "").replace(/\s+quantum drive$/i, "").replace(/\bXL[ -]?(?:one|1)\b/ig, "XL-1").trim();
  if (/^(?:it|its|that|that blueprint|its blueprint|missions?|blueprints?|what|how|which|all|show blueprints)$/i.test(name) || name.length > 160 || name === text.trim()) name = "";
  return { intent, itemName: name || undefined, modifiers: [], raw: text };
}

export function parseQuery(
  text: string,
  commodityMap: Map<string, Commodity>,
  starSystemMap: Map<string, StarSystem>,
  terminals: Terminal[],
  vehicleMap: Map<string, Vehicle>
): ParsedQuery {
  const crafting = parseCraftingQuery(text);
  if (crafting) return crafting;
  const commodityTradeIntent = explicitCommodityTradeIntent(text, commodityMap);
  if (isEquipmentQuery(text) && !commodityTradeIntent) return parseEquipmentQuery(text);
  if (isMiningLocationQuery(text)) return parseMiningQuery(text, commodityMap);
  const lower = text.toLowerCase();
  let intent = commodityTradeIntent || detectIntent(lower);
  if (/\b(?:buy\s+and\s+sell|sell\s+and\s+buy)\b/i.test(text)) intent = "price_check";
  if (/\b(?:market|trade|price|stock|inventory)\s+(?:alerts?|anomalies|changes|updates)\b|\b(?:alerts?|anomalies)\s+(?:for|on|in|about)\b/i.test(text)) intent = "market_alerts";
  else if (/\b(?:history|historical|trends?)\b|over time/i.test(text)) intent = "price_history";
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
        if (isCommonWord(phrase)) continue;
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

  const temporal = parseTemporalFilters(text);
  if (["price_history", "market_alerts"].includes(intent)) {
    const explicit = extractMiningLocation(text);
    if (explicit && explicit !== temporal.gameVersion) locationName = explicit.replace(/\s+(?:from|since|after|until|through|before|patch|version)\b.*$/i, "").trim();
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
    ...temporal,
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
  "mine", "mining", "ore", "ores", "mineral", "minerals", "found", "locations", "deposits",
]);

function isCommonWord(word: string): boolean {
  return word.split(/\s+/).every((part) => COMMON_WORDS.has(part));
}

/** Resolve full UEX geography only for requests that actually name a location. */
export async function enrichQueryLocations(query: ParsedQuery): Promise<ParsedQuery> {
  if (query.intent === "price_compare" && query.starSystem && query.starSystem2) return query;
  const locationIntents = new Set<Intent>(["buy", "sell", "trade_route", "price_check", "price_history", "market_alerts", "profit_calc", "multi_hop", "budget_trade", "fleet_trade", "price_compare", "terminal_info", "station_info", "city_info", "outpost_info", "location_info", "location_trade", "refinery_yields", "fuel_prices", "vehicle_buy", "vehicle_rent", "equipment_info", "equipment_buy", "equipment_compare"]);
  if (!locationIntents.has(query.intent)) return query;
  let requested = query.locationName || (query.intent.startsWith("equipment_") ? extractEquipmentLocation(query.raw) : extractMiningLocation(query.raw));
  if (["vehicle_buy", "vehicle_rent"].includes(query.intent)) {
    requested = query.raw.match(/\b(?:at|in|on|near)\s+(.+?)(?:[?!;]|$)/i)?.[1].trim() || requested;
  }
  if (!requested && query.intent === "trade_route") requested = query.raw.match(/\bfrom\s+(.+?)(?:\s+to\s+|[?!]|$)/i)?.[1].trim();
  if (!requested && query.intent === "location_info") requested = query.raw.replace(/^(?:tell me about|what is|what's|info on|info about)\s+/i, "").replace(/[?!]+$/, "").trim();
  requested = requested?.replace(/\s+(?:from|since|after|until|through|before|patch|version)\b.*$/i, "").trim();
  if (!requested || requested === query.gameVersion || /^(?:game|game version|auec|\d+(?:\.\d+)*|\d{4}-\d{2}-\d{2})$/i.test(requested)) return query;
  if (/^(?:it|them|there|here|that location)$/i.test(requested)) return query;

  const normalize = (name: string) => name.toLowerCase().replace(/[’']s\b/g, "").replace(/[^a-z0-9]/g, "");
  const qualified = /\borbit\b/i.test(requested) ? "orbit" : /\b(?:poi|point of interest|asteroid (?:field|belt))\b/i.test(requested) ? "poi" : undefined;
  const stripped = requested.replace(/\b(?:orbit|poi|point of interest|asteroid field|asteroid belt)\b/gi, "").replace(/[’']s\b/g, "").trim();
  const search = normalize(stripped || requested);
  type Candidate = { kind: "planet" | "moon" | "orbit" | "poi" | "system" | "terminal" | "city" | "station"; id: number; name: string; aliases?: (string | null | undefined)[]; value?: Terminal | StarSystem };
  try {
    const [{ getMiningData }, { getReferenceData }] = await Promise.all([import("@/lib/data/mining"), import("@/lib/data/cache")]);
    const [geography, reference] = await Promise.all([getMiningData(), getReferenceData()]);
    const candidates: Candidate[] = [
      ...geography.planets.map((row) => ({ kind: "planet" as const, id: row.id, name: row.name })),
      ...geography.moons.map((row) => ({ kind: "moon" as const, id: row.id, name: row.name })),
      ...geography.orbits.map((row) => ({ kind: "orbit" as const, id: row.id, name: row.name })),
      ...geography.pointsOfInterest.map((row) => ({ kind: "poi" as const, id: row.id, name: row.name })),
      ...reference.starSystems.map((row) => ({ kind: "system" as const, id: row.id, name: row.name, value: row })),
      ...reference.terminals.map((row) => ({ kind: "terminal" as const, id: row.id, name: row.name, aliases: [row.nickname, row.displayname, row.code], value: row })),
      ...reference.terminals.filter((row) => row.city_name && row.id_city).map((row) => ({ kind: "city" as const, id: row.id_city, name: row.city_name! })),
      ...reference.terminals.filter((row) => row.space_station_name && row.id_space_station).map((row) => ({ kind: "station" as const, id: row.id_space_station, name: row.space_station_name! })),
    ];
    const matches = candidates.filter((candidate) => [candidate.name, ...(candidate.aliases || [])].some((name) => name && normalize(name) === search));
    const priority = [qualified, "moon", "planet", "city", "station", "system", "poi", "orbit", "terminal"].filter(Boolean);
    matches.sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind));
    const shops = reference.terminals.filter(terminal => findTerminalByAlias(requested!, [terminal]));
    const shop = shops.length === 1 ? shops[0] : undefined;
    const selected = shop ? { kind: "terminal" as const, id: shop.id, name: shop.name, value: shop } : matches[0];
    const cleared = { ...query, locationName: requested, locationError: undefined, planet: undefined, moon: undefined, orbit: undefined, poi: undefined, city: undefined, station: undefined, terminal: undefined, starSystem: undefined };
    if (shops.length > 1) return { ...cleared, locationError: `I found multiple shops matching “${requested}”: ${shops.map(shop => shop.name).join("; ")}. Which location do you mean?` };
    if (!selected) return { ...cleared, locationError: `I couldn't match “${requested}” to a UEX location. Please use a full planet, moon, orbit, point-of-interest, city, station, or terminal name.` };
    switch (selected.kind) {
      case "planet": return { ...cleared, planet: { planetName: selected.name, planetId: selected.id } };
      case "moon": return { ...cleared, moon: { moonName: selected.name, moonId: selected.id } };
      case "orbit": return { ...cleared, orbit: { orbitName: selected.name, orbitId: selected.id } };
      case "poi": return { ...cleared, poi: { poiName: selected.name, poiId: selected.id } };
      case "city": return { ...cleared, intent: query.intent === "location_info" ? "city_info" : query.intent, city: { cityName: selected.name, cityId: selected.id } };
      case "station": return { ...cleared, intent: query.intent === "location_info" ? "station_info" : query.intent, station: { stationName: selected.name, stationId: selected.id } };
      case "system": return { ...cleared, starSystem: selected.value as StarSystem };
      case "terminal": return { ...cleared, terminal: selected.value as Terminal };
    }
  } catch {
    if (query.planet || query.moon || query.terminal || query.starSystem) return query;
    return { ...query, locationName: requested, locationError: `I couldn't verify the location “${requested}” because location data is temporarily unavailable. Please try again shortly.` };
  }
}
