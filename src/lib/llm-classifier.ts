import OpenAI from "openai";
import type { Intent, ParsedQuery } from "./query-parser";
import { extractModifiers, isMiningLocationQuery, parseMiningQuery, isEquipmentQuery, parseEquipmentQuery, parseTemporalFilters, extractMiningLocation, explicitCommodityTradeIntent, parseQuery, parseCraftingQuery } from "./query-parser";
import type { Commodity, StarSystem, Vehicle, Terminal } from "./uex-client";
import {
  findCommodity,
  findStarSystem,
  findPlanet,
  findMoon,
  findVehicle,
  findTerminal,
} from "./data/cache";

// --- Types ---

type ReferenceData = {
  commodities: Commodity[];
  terminals: Terminal[];
  starSystems: StarSystem[];
  vehicles: Vehicle[];
  commodityMap: Map<string, Commodity>;
  starSystemMap: Map<string, StarSystem>;
  vehicleMap: Map<string, Vehicle>;
};

type LLMClassification = {
  intent: Intent;
  entities: {
    commodity?: string | string[] | null;
    vehicle?: string | null;
    vehicle2?: string | null;
    star_system?: string | null;
    star_system2?: string | null;
    planet?: string | null;
    moon?: string | null;
    terminal?: string | null;
    location?: string | null;
    budget?: number | null;
    category?: string | null;
    item?: string | null;
    item2?: string | null;
    equipment_category?: string | null;
    equipment_size?: number | null;
  };
  confidence: number;
};

// --- System prompt cache ---

let cachedPrompt: string | null = null;
let promptCacheTime = 0;
const PROMPT_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const VALID_INTENTS = new Set<string>([
  "sell", "buy", "trade_route", "price_check", "price_history",
  "commodity_ranking", "find_commodity", "commodity_category",
  "vehicle_info", "vehicle_compare", "profit_calc", "multi_hop",
  "terminal_info", "station_info", "city_info", "outpost_info",
  "location_info", "budget_trade", "location_trade", "price_compare",
  "fleet_trade", "refinery_yields", "refinery_method", "fuel_prices",
  "mining_locations",
  "equipment_info", "equipment_buy", "equipment_compare", "market_alerts",
  "vehicle_buy", "vehicle_rent", "help", "unknown",
]);

const ENTITY_TEXT_FIELDS = [
  "vehicle", "vehicle2", "star_system", "star_system2", "planet", "moon",
  "terminal", "location", "category",
  "item", "item2", "equipment_category",
] as const;
const VALID_CATEGORIES = new Set([
  "Metal", "Mineral", "Agricultural", "Gas", "Drug", "Scrap", "Vice", "Medical",
  "_illegal", "_raw", "_extractable", "_harvestable",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntityName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200;
}

/** Treat model JSON as untrusted input before resolving entities or calculating trades. */
function isClassification(value: unknown): value is LLMClassification {
  if (!isRecord(value) || typeof value.intent !== "string" || !VALID_INTENTS.has(value.intent)) return false;
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) return false;
  if (!isRecord(value.entities)) return false;

  const entities = value.entities;
  const allowedFields = new Set<string>(["commodity", "budget", "equipment_size", ...ENTITY_TEXT_FIELDS]);
  if (Object.keys(entities).some((key) => !allowedFields.has(key))) return false;
  for (const field of ENTITY_TEXT_FIELDS) {
    if (entities[field] != null && !isEntityName(entities[field])) return false;
  }
  if (entities.category != null && !VALID_CATEGORIES.has(entities.category as string)) return false;
  if (entities.equipment_size != null && (!Number.isInteger(entities.equipment_size) || (entities.equipment_size as number) < 0 || (entities.equipment_size as number) > 9)) return false;
  const commodity = entities.commodity;
  if (commodity != null && !isEntityName(commodity)) {
    if (!Array.isArray(commodity) || commodity.length === 0 || commodity.length > 8 || !commodity.every(isEntityName)) return false;
  }
  if (entities.budget != null && (
    typeof entities.budget !== "number" || !Number.isFinite(entities.budget) ||
    entities.budget <= 0 || entities.budget > Number.MAX_SAFE_INTEGER
  )) return false;
  return true;
}

// --- Build system prompt ---

function buildSystemPrompt(data: ReferenceData): string {
  const commodityNames = data.commodities
    .filter((c) => c.is_available)
    .map((c) => c.name)
    .join(", ");

  const vehicleNames = data.vehicles
    .map((v) => v.name_full || v.name)
    .join(", ");

  const systemNames = data.starSystems.map((s) => s.name).join(", ");

  return `You are a Star Citizen reference query classifier. Given a user message, identify the requested lookup and extract entities from natural wording.

Return JSON with this exact structure:
{
  "intent": "<intent_name>",
  "entities": {
    "commodity": "<name or [name1, name2] or null>",
    "vehicle": "<name or null>",
    "vehicle2": "<name or null>",
    "star_system": "<name or null>",
    "star_system2": "<name or null>",
    "planet": "<name or null>",
    "moon": "<name or null>",
    "terminal": "<name or null>",
    "location": "<name or null>",
    "budget": <number or null>,
    "category": "<category or null>",
    "item": "<equipment item name or null>",
    "item2": "<second equipment item name or null>",
    "equipment_category": "<equipment category or null>",
    "equipment_size": <integer 0-9 or null>
  },
  "confidence": <0.0-1.0>
}

## Intents
- sell: User wants to find where to SELL a commodity. Needs: commodity
- buy: User wants to find where to BUY a commodity. Needs: commodity
- trade_route: User wants profitable trade routes for a commodity or ship. Optional: commodity, vehicle, star_system
- price_check: User wants current prices of a commodity. Needs: commodity
- price_history: User wants historical price trends/averages. Needs: commodity
- commodity_ranking: User wants most profitable commodities ranked. No entities needed.
- find_commodity: User asks about a specific commodity's details. Needs: commodity
- commodity_category: User wants to browse/list commodities by category (metals, gases, etc). Needs: category
- vehicle_info: User asks about a ship's specs, cargo capacity, crew. Needs: vehicle
- vehicle_compare: User wants to compare two ships. Needs: vehicle + vehicle2
- profit_calc: User wants to calculate profit for a commodity with a ship. Needs: commodity. Optional: vehicle
- multi_hop: User wants a multi-stop trade route plan. Optional: vehicle, star_system
- terminal_info: User asks about a specific trade terminal/shop. Needs: terminal
- station_info: User asks about space stations in a system or near a planet. Optional: star_system, planet
- city_info: User asks about cities. Optional: planet
- outpost_info: User asks about outposts on a planet or moon. Optional: planet, moon, star_system
- location_info: User asks general info about a location (planet, moon, system). Needs: location or planet or moon
- budget_trade: User has a budget (aUEC) and wants trade recommendations. Needs: budget. Optional: vehicle
- location_trade: User is at a location and wants trades nearby. Needs: terminal or location
- price_compare: User wants to compare a commodity's prices across two star systems. Needs: commodity + star_system + star_system2
- fleet_trade: User has multiple ships and wants trade recommendations for their fleet. Needs: vehicle + vehicle2
- refinery_yields: User wants refinery yield bonuses for a commodity (where to refine). Optional: commodity, star_system
- refinery_method: User asks about refining methods (Dinyx Solventation, Ferron Exchange, Cormack, etc.)
- mining_locations: User asks where a commodity can be mined, which ores occur at a location, or whether an ore is found there. Optional: commodity, location. Examples: "Where can I mine Laranite?", "Which ores are found on Hurston?", "Can I mine Gold on Daymar?". Mining ships, buying/selling ore, mining outposts, and refining use their own intents.
- equipment_info: User asks about an equipment item's specifications, attributes, or catalogue. Optional: item, equipment_category. Mining laser heads (Lancet MH2, Arbor MH1), mining modules/gadgets, scraper modules (Abrade, Cinch, Trawler), ship components, weapons and armor are equipment, not ships or commodities.
- equipment_buy: User asks where to purchase equipment or its price. Optional: item, equipment_category, location.
- equipment_compare: User compares two equipment items. Needs: item, item2. Optional: equipment_category.
- market_alerts: User asks for current market/price/inventory alerts or anomalies. Optional: commodity, location. This returns observations, not a background notification subscription.
- fuel_prices: User wants fuel prices (hydrogen or quantum). Optional: star_system, planet
- vehicle_buy: User wants to buy a ship in-game with aUEC (not pledge store). Optional: vehicle (if no vehicle, list all buyable ships)
- vehicle_rent: User wants to rent a ship in-game. Optional: vehicle (if no vehicle, list all rentable ships)
- help: User asks what you can do, your features, or how to use you
- unknown: Cannot determine intent.

## Important rules
- Separate an equipment category, size filter, named item, and location. A request for shops stocking a size-two component has equipment_size 2 and item null unless an actual item name is stated. Never use question words or filters as item names.
- Classify purchase-location questions by meaning, including shops that sell, vendors that carry, or where someone can get an item. A generic list or specifications question is equipment_info.
- Size can be expressed as size two, size-2, S2, or a size-two slot. Preserve the original item name when identifying actual components.
- "Crusader" as a ship manufacturer (e.g. "Crusader C2 Hercules") is NOT the planet Crusader
- "Drake" as a ship manufacturer (e.g. "Drake Caterpillar") is NOT an entity on its own
- If user mentions a ship by manufacturer + model, extract only the FULL ship name as vehicle
- For budget queries, extract the numeric amount in aUEC (convert "50k" to 50000)
- If the user mentions multiple commodities (e.g. "sell Slam and Neon"), return commodity as an array: ["Slam", "Neon"]
- Mining locations include systems, planets, moons, orbits, asteroid fields, and points of interest. Preserve the exact location name in location even if it is absent from reference data. Do not invent a replacement or drop an unknown location.
- Preserve exact location names for all queries, including equipment shops and price history. A price history query can specify a terminal, game version, and date range; do not change it to a generic price lookup. Extract equipment categories such as mining lasers, mining modules, mining gadgets, scraper beams, salvage beams, quantum drives, shield generators, power plants, coolers, personal weapons, vehicle weapons, helmets, and armor.
- Scraper/scrapper/salvage modules (Abrade, Cinch, Trawler) use equipment_category "scraper beams". Explicit "salvage beams" is a different category containing tractor beams; do not treat salvage heads as that category. Salvage ships such as Vulture and Reclaimer remain vehicles. Scrap and RMC (Recycled Material Composite) remain commodities.
- For mining, extract only entities explicitly present in the current message; the application resolves follow-up context. "Which ores are found on Hurston?" requests all ores there, not a commodity mentioned earlier. A new explicit location replaces previous location constraints.
- **Follow-ups**: If a previous user message is shown, the current message may be a follow-up. When the current message is vague/short and doesn't mention specific entities, ALWAYS inherit entities from the previous message. Do NOT invent or guess new entities. Examples:
  - Previous: "Where can I sell Iron (Ore)?" + Current: "What gives me the best price?" → intent: sell, commodity: "Iron (Ore)"
  - Previous: "Where can I sell Laranite?" + Current: "What about in Pyro?" → intent: sell, commodity: "Laranite", star_system: "Pyro"
  - Previous: "Best trade route for Gold" + Current: "How about with a Caterpillar?" → intent: trade_route, commodity: "Gold", vehicle: "Caterpillar"

## Categories
Metal, Mineral, Agricultural, Gas, Drug, Scrap, Vice, Medical
Special: _illegal (illegal commodities), _raw (raw/unrefined), _extractable (mineable), _harvestable

## Reference data
Commodities: ${commodityNames}
Vehicles: ${vehicleNames}
Systems: ${systemNames}
Planets: Hurston, ArcCorp, Crusader, microTech
Moons: Cellin, Daymar, Yela (Crusader), Lyria, Wala (ArcCorp), Aberdeen, Arial, Ita, Magda (Hurston), Calliope, Clio, Euterpe (microTech)`;
}

function getSystemPrompt(data: ReferenceData): string {
  if (cachedPrompt && Date.now() - promptCacheTime < PROMPT_CACHE_TTL) {
    return cachedPrompt;
  }
  cachedPrompt = buildSystemPrompt(data);
  promptCacheTime = Date.now();
  return cachedPrompt;
}

// --- Entity resolution ---

function resolveEntities(
  classification: LLMClassification,
  data: ReferenceData,
  rawMessage: string
): ParsedQuery {
  const { commodityMap, starSystemMap, terminals, vehicleMap } = data;
  const ent = classification.entities;
  const explicitlyMentioned = (name?: string | null) => {
    if (!name) return undefined;
    const words = ` ${rawMessage.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    const entity = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return entity && words.includes(` ${entity} `) ? name : undefined;
  };

  // Location names such as "ArcCorp Mining Area 045" must not turn a named
  // commodity purchase into equipment shopping, even if the model says so.
  if (explicitCommodityTradeIntent(rawMessage, commodityMap) || /\b(?:buy\s+and\s+sell|sell\s+and\s+buy)\b/i.test(rawMessage)) {
    return parseQuery(rawMessage, commodityMap, starSystemMap, terminals, vehicleMap);
  }

  if (/\b(?:what|which)\s+(?:ships?|vehicles?)\b/i.test(rawMessage) && /\b(?:buy|purchase)\b/i.test(rawMessage) && !isEquipmentQuery(rawMessage)) {
    return parseQuery(rawMessage, commodityMap, starSystemMap, terminals, vehicleMap);
  }

  if (classification.intent.startsWith("equipment_") || isEquipmentQuery(rawMessage)) {
    const parsed = parseEquipmentQuery(rawMessage);
    const normalizeEntity = (value: string) => value.toLowerCase().replace(/\bxl[ -]?one\b/g, "xl1").replace(/[^a-z0-9]/g, "");
    const explicit = (name?: string | null) => name && normalizeEntity(rawMessage).includes(normalizeEntity(name)) ? name : undefined;
    const explicitItem = (name?: string | null) => {
      const candidate = explicit(name);
      // Models sometimes label the requested category itself as an item. Apply
      // the same category cleanup used by the parser before accepting that name.
      return candidate ? parseEquipmentQuery(candidate).itemName : undefined;
    };
    const modelItem = explicitItem(ent.item);
    const itemName = parsed.equipmentSize !== undefined && !parsed.itemName ? undefined
      : modelItem || (ent.item == null && ent.equipment_category && !parsed.equipmentCategory ? undefined : parsed.itemName);
    return {
      ...parsed,
      intent: parsed.intent === "equipment_buy" || parsed.intent === "equipment_compare" ? parsed.intent
        : classification.intent.startsWith("equipment_") ? classification.intent : parsed.intent,
      itemName,
      itemName2: explicitItem(ent.item2) || parsed.itemName2,
      equipmentCategory: parsed.equipmentCategory || ent.equipment_category || undefined,
      equipmentSize: parsed.equipmentSize ?? ent.equipment_size ?? undefined,
      locationName: parsed.locationName || explicit(ent.location) || explicit(ent.moon) || explicit(ent.planet) || explicit(ent.terminal) || explicit(ent.star_system),
    };
  }

  if (classification.intent === "mining_locations" || isMiningLocationQuery(rawMessage)) {
    const parsed = parseMiningQuery(rawMessage, commodityMap);
    // Model output can retain names that the terminal catalogue cannot resolve.
    // Only accept names actually present in this message, not inherited guesses.
    const explicitLocation = [ent.location, ent.moon, ent.planet, ent.terminal, ent.star_system]
      .find((name) => name && rawMessage.toLowerCase().includes(name.toLowerCase()));
    return { ...parsed, locationName: parsed.locationName || explicitLocation || undefined };
  }

  // Normalize commodity to array and resolve each
  const commodityNames = ent.commodity
    ? Array.isArray(ent.commodity) ? ent.commodity : [ent.commodity]
    : [];
  const commodities = commodityNames
    .map((name) => findCommodity(name, commodityMap))
    .filter((c): c is Commodity => !!c);
  const commodity = commodities[0];

  const vehicle = ent.vehicle
    ? findVehicle(ent.vehicle, vehicleMap)
    : undefined;

  const vehicle2 = ent.vehicle2
    ? findVehicle(ent.vehicle2, vehicleMap)
    : undefined;

  const starSystem = ent.star_system && explicitlyMentioned(ent.star_system)
    ? findStarSystem(ent.star_system, starSystemMap)
    : undefined;

  const starSystem2 = ent.star_system2 && explicitlyMentioned(ent.star_system2)
    ? findStarSystem(ent.star_system2, starSystemMap)
    : undefined;

  const planet = ent.planet && explicitlyMentioned(ent.planet)
    ? findPlanet(ent.planet, terminals)
    : undefined;

  const moon = ent.moon && explicitlyMentioned(ent.moon)
    ? findMoon(ent.moon, terminals)
    : undefined;

  const terminal = ent.terminal && explicitlyMentioned(ent.terminal)
    ? findTerminal(ent.terminal, terminals)
    : undefined;

  // Fallback: if LLM put a name in "location" but didn't fill moon/planet/star_system,
  // try to resolve the location string as one of those entity types
  let resolvedMoon = moon;
  let resolvedPlanet = planet;
  let resolvedStarSystem = starSystem;
  if (ent.location && explicitlyMentioned(ent.location) && !moon && !planet && !starSystem) {
    resolvedMoon = findMoon(ent.location, terminals);
    if (!resolvedMoon) {
      resolvedPlanet = findPlanet(ent.location, terminals);
    }
    if (!resolvedMoon && !resolvedPlanet) {
      resolvedStarSystem = findStarSystem(ent.location, starSystemMap);
    }
  }

  return {
    intent: classification.intent,
    commodity,
    commodities: commodities.length > 0 ? commodities : undefined,
    vehicle,
    vehicle2,
    starSystem: resolvedStarSystem,
    starSystem2,
    planet: resolvedPlanet,
    moon: resolvedMoon,
    terminal,
    locationName: ([ent.location, ent.moon, ent.planet, ent.terminal, ent.star_system].find((name) => explicitlyMentioned(name))) ?? undefined,
    budget: ent.budget ?? undefined,
    category: ent.category ?? undefined,
    modifiers: extractModifiers(rawMessage),
    raw: rawMessage,
    ...parseTemporalFilters(rawMessage),
  };
}

// --- Post-processing safety net ---

function hasRentKeyword(text: string): boolean {
  return text.includes("rent") || text.includes("rental");
}

function hasBuyKeyword(text: string): boolean {
  return /\bbuy\b/.test(text) || text.includes("purchase") || text.includes("cost") || /\bprice\b/.test(text);
}

function postProcess(parsed: ParsedQuery): ParsedQuery {
  let { intent } = parsed;
  const lower = parsed.raw.toLowerCase();

  // Asking which ships a shop sells is ship shopping, even without a model name.
  if (!parsed.commodity && !isEquipmentQuery(parsed.raw) && /\b(?:ships?|vehicles?)\b/.test(lower) && /\b(?:buy|purchase)\b/.test(lower)) {
    intent = "vehicle_buy";
  }

  if (!intent.startsWith("equipment_")) {
    if (/\b(?:market|trade|price|stock|inventory)\s+(?:alerts?|anomalies|changes|updates)\b|\b(?:alerts?|anomalies)\s+(?:for|on|in|about)\b/i.test(parsed.raw)) intent = "market_alerts";
    else if (/\b(?:history|historical|trends?)\b|over time/i.test(parsed.raw)) intent = "price_history";
  }
  if (["price_history", "market_alerts"].includes(intent)) {
    const location = extractMiningLocation(parsed.raw);
    parsed = { ...parsed, locationName: location && location !== parsed.gameVersion ? location.replace(/\s+(?:from|since|after|until|through|before|patch|version)\b.*$/i, "").trim() : parsed.locationName };
  }

  // 2 vehicles + trade-ish intent → fleet_trade
  // But if the user wants to buy/rent the ships themselves (no commodity), keep vehicle_buy/vehicle_rent
  if (
    parsed.vehicle && parsed.vehicle2 &&
    ["sell", "buy", "trade_route", "find_commodity", "unknown"].includes(intent)
  ) {
    const hasCommodity = !!parsed.commodity;
    if (!hasCommodity && hasRentKeyword(lower)) {
      intent = "vehicle_rent";
    } else if (!hasCommodity && hasBuyKeyword(lower)) {
      intent = "vehicle_buy";
    } else {
      intent = "fleet_trade";
    }
  }

  // Commodity found but unknown → find_commodity
  if (parsed.commodity && intent === "unknown") {
    intent = "find_commodity";
  }

  // Vehicle compare with < 2 vehicles → vehicle_info
  if (intent === "vehicle_compare" && !parsed.vehicle2) {
    intent = parsed.vehicle ? "vehicle_info" : "unknown";
  }

  // Vehicle found but unknown → check for buy/rent keywords, else vehicle_info
  if (parsed.vehicle && intent === "unknown") {
    if (hasRentKeyword(lower)) {
      intent = "vehicle_rent";
    } else if (hasBuyKeyword(lower)) {
      intent = "vehicle_buy";
    } else {
      intent = "vehicle_info";
    }
  }

  // No vehicle but rent/buy keywords with help/unknown → vehicle_rent/vehicle_buy (list all)
  if (!parsed.vehicle && ["help", "unknown"].includes(intent)) {
    if (hasRentKeyword(lower)) {
      intent = "vehicle_rent";
    } else if (hasBuyKeyword(lower) && (lower.includes("ship") || lower.includes("vehicle"))) {
      intent = "vehicle_buy";
    }
  }

  // Terminal found but unknown/location_info → terminal_info
  if (
    parsed.terminal &&
    ["unknown", "location_info", "station_info"].includes(intent)
  ) {
    intent = "terminal_info";
  }

  // "What can I sell/buy at [terminal]" → terminal_info (asking about inventory, not a commodity)
  // Preserve direction as modifier so answer builder can filter tables.
  // Also catch location_trade with a terminal but no commodity — the user is asking about
  // the terminal's inventory, not requesting trade recommendations.
  if (parsed.terminal && !parsed.commodity && (intent === "sell" || intent === "buy" || intent === "location_trade")) {
    const mods = parsed.modifiers || [];
    if (intent === "location_trade") {
      if (lower.includes("sell")) { if (!mods.includes("sell")) mods.push("sell"); }
      else if (lower.includes("buy")) { if (!mods.includes("buy")) mods.push("buy"); }
    } else {
      if (!mods.includes(intent)) mods.push(intent);
    }
    parsed = { ...parsed, modifiers: mods };
    intent = "terminal_info";
  }

  return { ...parsed, intent };
}

// --- Circuit breaker ---
// After repeated failures, temporarily disable the LLM classifier
// to avoid adding latency and spamming logs on every request.

let consecutiveFailures = 0;
let disabledUntil = 0;
const MAX_FAILURES = 3;
const BACKOFF_MS = 5 * 60 * 1000; // 5 minutes

// --- Main classifier ---

export function isLLMClassifierAvailable(): boolean {
  if (!process.env.OPENAI_API_KEY) return false;
  if (Date.now() < disabledUntil) return false;
  return true;
}

export async function classifyWithLLM(
  message: string,
  referenceData: ReferenceData,
  previousUserMessage?: string
): Promise<ParsedQuery | null> {
  const crafting = parseCraftingQuery(message);
  if (crafting) return crafting;
  if (!isLLMClassifierAvailable()) return null;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 8000, maxRetries: 0 });
    const systemPrompt = getSystemPrompt(referenceData);

    // Build messages — include previous user message as context for follow-ups
    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      { role: "system", content: systemPrompt },
    ];
    if (previousUserMessage) {
      messages.push(
        { role: "user", content: previousUserMessage },
        { role: "assistant", content: "(previous query handled)" },
      );
    }
    messages.push({ role: "user", content: message });

    const completion = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages,
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 300,
      }
    );

    const content = completion.choices[0]?.message?.content;
    if (!content || content.length > 10000) return null;

    const classification: unknown = JSON.parse(content);

    if (!isClassification(classification)) return null;

    // Low confidence → fall back
    if (classification.confidence < 0.5) {
      return null;
    }

    // Resolve entity names to actual objects
    let parsed = resolveEntities(classification, referenceData, message);
    // A bare component name can be mistaken for a ship. Correct that only
    // when the live catalogue confirms an exact name and no ship was resolved.
    if (parsed.intent === "vehicle_buy" && !parsed.vehicle && !/\b(?:ships?|vehicles?)\b/i.test(message)) {
      const equipment = parseEquipmentQuery(message);
      if (equipment.itemName) {
        const { getEquipmentSuggestions } = await import("./equipment-client");
        const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
        const matches = await getEquipmentSuggestions(equipment.itemName);
        if (matches.some(item => compact(item.name) === compact(equipment.itemName!))) parsed = equipment;
      }
    }

    // Apply safety-net heuristics
    const result = postProcess(parsed);

    // Success — reset circuit breaker
    consecutiveFailures = 0;

    return result;
  } catch {
    consecutiveFailures++;
    console.warn(`LLM classifier unavailable (failure ${consecutiveFailures}/${MAX_FAILURES})`);

    // Trip circuit breaker after repeated failures
    if (consecutiveFailures >= MAX_FAILURES) {
      disabledUntil = Date.now() + BACKOFF_MS;
      console.warn(`LLM classifier disabled for ${BACKOFF_MS / 1000}s after ${consecutiveFailures} consecutive failures`);
    }

    return null;
  }
}
