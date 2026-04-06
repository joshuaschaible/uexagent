import type { ParsedQuery } from "./query-parser";
import type { Commodity, StarSystem, Vehicle } from "./uex-client";

type HistoryMessage = { role: string; text: string };

/**
 * Resolves conversation context by inheriting entities from previous messages
 * when the current query uses pronouns or follow-up phrases.
 */
export function resolveContext(
  current: ParsedQuery,
  history: HistoryMessage[],
  parsePrevious: (text: string) => ParsedQuery
): ParsedQuery {
  if (!history || history.length === 0) return current;

  // Check if current query looks like a follow-up
  const lower = current.raw.toLowerCase();
  const followUpPatterns = [
    // Explicit follow-up phrases
    "what about",
    "how about",
    "and in",
    "and at",
    "what if",
    "same for",
    "same but",
    "that one",
    "that commodity",
    "that ship",
    "those",
    "there",
    "instead",
    // Location-only follow-ups
    "in pyro",
    "in stanton",
    "on hurston",
    "on microtech",
    "on crusader",
    "on arccorp",
    "on cellin",
    "on daymar",
    "on yela",
    "on lyria",
    "on wala",
    "on aberdeen",
    "on arial",
    "on ita",
    "on magda",
    "on calliope",
    "on clio",
    "on euterpe",
    // Pronoun references
    "sell it",
    "buy it",
    "trade it",
    "about it",
    "for it",
    "with it",
    "sell them",
    "buy them",
    // Comparative / superlative follow-ups (no entity = referring to previous)
    "best price",
    "best place",
    "highest price",
    "lowest price",
    "cheapest",
    "most expensive",
    "most profit",
    "best route",
    "which one",
    "where else",
    "anywhere else",
    "any other",
  ];

  // Don't inherit context when the query is about a specific terminal or location
  const isTerminalOrLocationQuery = current.terminal &&
    ["terminal_info", "location_trade"].includes(current.intent);

  // Check if entities in the parsed query are actually mentioned in the raw message.
  // LLM classifiers can hallucinate entities from conversation context — strip those
  // so the context resolver properly inherits from history instead.
  const rawHasCommodity = current.commodity
    ? lower.includes(current.commodity.name.toLowerCase()) ||
      lower.includes(current.commodity.code.toLowerCase())
    : false;
  const rawHasVehicle = current.vehicle
    ? lower.includes(current.vehicle.name.toLowerCase()) ||
      (current.vehicle.name_full ? lower.includes(current.vehicle.name_full.toLowerCase()) : false)
    : false;

  // If the LLM hallucinated an entity not in the raw message, clear it
  if (current.commodity && !rawHasCommodity) {
    current = { ...current, commodity: undefined, commodities: undefined };
  }
  if (current.vehicle && !rawHasVehicle) {
    current = { ...current, vehicle: undefined };
  }

  // A query is a follow-up if:
  // 1. It matches a known follow-up pattern, OR
  // 2. It has a recognized intent but no commodity or vehicle (e.g. "sell" with no commodity), OR
  // 3. It has NO recognized entities at all — likely a vague reference to previous context
  const hasNoEntities = !current.commodity && !current.vehicle && !current.terminal
    && !current.starSystem && !current.planet && !current.moon;

  // vehicle_rent / vehicle_buy without a vehicle is valid (list all ships), not a follow-up
  const isSelfSufficientIntent = ["vehicle_rent", "vehicle_buy"].includes(current.intent) && !current.vehicle;

  const isFollowUp =
    !isTerminalOrLocationQuery && !isSelfSufficientIntent && (
      followUpPatterns.some((p) => lower.includes(p)) ||
      (current.intent !== "unknown" && !current.commodity && !current.vehicle) ||
      (current.intent === "unknown" && hasNoEntities)
    );

  if (!isFollowUp) return current;

  // Find the most recent user message with entities
  // Exclude the current message — some clients include it in history
  const previousUserMessages = history
    .filter((m) => m.role === "user" && m.text !== current.raw)
    .reverse();

  let inheritedCommodities: Commodity[] | undefined;
  let inheritedSystem: StarSystem | undefined;
  let inheritedVehicle: Vehicle | undefined;
  let inheritedMoon: { moonName: string; moonId: number } | undefined;
  let inheritedIntent = current.intent;

  for (const prev of previousUserMessages) {
    const parsed = parsePrevious(prev.text);

    if (!inheritedCommodities && parsed.commodities) {
      inheritedCommodities = parsed.commodities;
    }
    if (!inheritedSystem && parsed.starSystem) {
      inheritedSystem = parsed.starSystem;
    }
    if (!inheritedVehicle && parsed.vehicle) {
      inheritedVehicle = parsed.vehicle;
    }
    if (!inheritedMoon && parsed.moon) {
      inheritedMoon = parsed.moon;
    }
    if (inheritedIntent === "unknown" && parsed.intent !== "unknown") {
      inheritedIntent = parsed.intent;
    }

    // Stop once we have enough context
    if (inheritedCommodities || inheritedVehicle) break;
  }

  const commodities = current.commodities || inheritedCommodities;

  // Determine the best intent:
  // - If current intent is "unknown", use inherited intent
  // - If we're inheriting a commodity but the current intent doesn't use one
  //   (e.g. "commodity_ranking"), the inherited intent is more relevant
  const COMMODITY_INTENTS = new Set([
    "sell", "buy", "trade_route", "price_check", "price_history",
    "find_commodity", "profit_calc", "price_compare",
    "refinery_yields",
  ]);
  let resolvedIntent = current.intent;
  if (current.intent === "unknown") {
    resolvedIntent = inheritedIntent;
  } else if (
    hasNoEntities && inheritedCommodities &&
    !COMMODITY_INTENTS.has(current.intent) && COMMODITY_INTENTS.has(inheritedIntent)
  ) {
    // Follow-up has no entities and a generic intent (e.g. commodity_ranking),
    // but previous message had a specific commodity intent — keep the previous intent
    resolvedIntent = inheritedIntent;
  }

  return {
    ...current,
    commodity: current.commodity || (commodities ? commodities[0] : undefined),
    commodities,
    starSystem: current.starSystem || inheritedSystem,
    vehicle: current.vehicle || inheritedVehicle,
    moon: current.moon || inheritedMoon,
    intent: resolvedIntent,
  };
}
