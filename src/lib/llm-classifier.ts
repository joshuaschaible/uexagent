import OpenAI from "openai";
import type { Intent, ParsedQuery } from "./query-parser";
import { extractModifiers } from "./query-parser";
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
  "vehicle_buy", "vehicle_rent", "unknown",
]);

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

  return `You are a Star Citizen trade query classifier. Given a user message, identify the intent and extract entities.

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
    "category": "<category or null>"
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
- fuel_prices: User wants fuel prices (hydrogen or quantum). Optional: star_system, planet
- vehicle_buy: User wants to buy a ship in-game with aUEC (not pledge store). Needs: vehicle
- vehicle_rent: User wants to rent a ship in-game. Needs: vehicle
- unknown: Cannot determine intent.

## Important rules
- "Crusader" as a ship manufacturer (e.g. "Crusader C2 Hercules") is NOT the planet Crusader
- "Drake" as a ship manufacturer (e.g. "Drake Caterpillar") is NOT an entity on its own
- If user mentions a ship by manufacturer + model, extract only the FULL ship name as vehicle
- For budget queries, extract the numeric amount in aUEC (convert "50k" to 50000)
- If the user mentions multiple commodities (e.g. "sell Slam and Neon"), return commodity as an array: ["Slam", "Neon"]
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

  const starSystem = ent.star_system
    ? findStarSystem(ent.star_system, starSystemMap)
    : undefined;

  const starSystem2 = ent.star_system2
    ? findStarSystem(ent.star_system2, starSystemMap)
    : undefined;

  const planet = ent.planet
    ? findPlanet(ent.planet, terminals)
    : undefined;

  const moon = ent.moon
    ? findMoon(ent.moon, terminals)
    : undefined;

  const terminal = ent.terminal
    ? findTerminal(ent.terminal, terminals)
    : undefined;

  return {
    intent: classification.intent,
    commodity,
    commodities: commodities.length > 0 ? commodities : undefined,
    vehicle,
    vehicle2,
    starSystem,
    starSystem2,
    planet,
    moon,
    terminal,
    locationName: ent.location ?? undefined,
    budget: ent.budget ?? undefined,
    category: ent.category ?? undefined,
    modifiers: extractModifiers(rawMessage),
    raw: rawMessage,
  };
}

// --- Post-processing safety net ---

function postProcess(parsed: ParsedQuery): ParsedQuery {
  let { intent } = parsed;

  // 2 vehicles + trade-ish intent → fleet_trade
  // But if the user wants to buy/rent the ships themselves (no commodity), keep vehicle_buy/vehicle_rent
  if (
    parsed.vehicle && parsed.vehicle2 &&
    ["sell", "buy", "trade_route", "find_commodity", "unknown"].includes(intent)
  ) {
    const lower = parsed.raw.toLowerCase();
    const hasCommodity = !!parsed.commodity;
    if (!hasCommodity && (lower.includes("rent") || lower.includes("rental"))) {
      intent = "vehicle_rent";
    } else if (!hasCommodity && (/\bbuy\b/.test(lower) || lower.includes("purchase"))) {
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
    const lower = parsed.raw.toLowerCase();
    if (lower.includes("rent") || lower.includes("rental")) {
      intent = "vehicle_rent";
    } else if (lower.includes("buy") || lower.includes("purchase") || lower.includes("cost") || lower.includes("price")) {
      intent = "vehicle_buy";
    } else {
      intent = "vehicle_info";
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
    // Detect sell/buy direction from the raw query for location_trade reclassifications
    if (intent === "location_trade") {
      const lower = parsed.raw.toLowerCase();
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
  if (!isLLMClassifierAvailable()) return null;

  const startTime = Date.now();

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const systemPrompt = getSystemPrompt(referenceData);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

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
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    const classification: LLMClassification = JSON.parse(content);

    // Validate intent
    if (!VALID_INTENTS.has(classification.intent)) {
      console.warn(`LLM returned invalid intent: ${classification.intent}`);
      return null;
    }

    // Low confidence → fall back
    if (classification.confidence < 0.5) {
      console.log(`LLM low confidence (${classification.confidence}) for: "${message}"`);
      return null;
    }

    // Resolve entity names to actual objects
    const parsed = resolveEntities(classification, referenceData, message);

    // Apply safety-net heuristics
    const result = postProcess(parsed);

    // Success — reset circuit breaker
    consecutiveFailures = 0;

    const elapsed = Date.now() - startTime;
    console.log(
      `LLM classified "${message.substring(0, 50)}..." → ${result.intent} (${classification.confidence}, ${elapsed}ms)`
    );

    return result;
  } catch (error) {
    consecutiveFailures++;
    const elapsed = Date.now() - startTime;

    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`LLM classifier timed out after ${elapsed}ms} (failure ${consecutiveFailures}/${MAX_FAILURES})`);
    } else {
      console.warn(`LLM classifier error (failure ${consecutiveFailures}/${MAX_FAILURES}):`, (error as Error).message || error);
    }

    // Trip circuit breaker after repeated failures
    if (consecutiveFailures >= MAX_FAILURES) {
      disabledUntil = Date.now() + BACKOFF_MS;
      console.warn(`LLM classifier disabled for ${BACKOFF_MS / 1000}s after ${consecutiveFailures} consecutive failures`);
    }

    return null;
  }
}
