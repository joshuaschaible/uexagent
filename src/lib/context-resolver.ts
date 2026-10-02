import type { ParsedQuery } from "./query-parser";
import { extractEquipmentLocation, extractMiningLocation, isMiningInventoryQuery } from "./query-parser";
import type { Commodity, StarSystem, Vehicle } from "./uex-client";

type HistoryMessage = { role: string; text: string };

export function isExplicitFollowUp(text: string): boolean {
  return /^(?:(?:what|how) about\b|and\b|same\b|(?:on|in|at|near|around)\b)|\b(?:it|its|them|there|those|where else|anywhere else|which one|that (?:one|mission|blueprint|item|equipment|location|ore|commodity|ship))\b/i.test(text);
}

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

  // Mining can look up an ore, a location's complete inventory, or a combination.
  // Resolve its follow-ups separately so changing locations cannot leave an old
  // moon/system constraint behind, and standalone inventory questions stay broad.
  const previousIndex = history.findLastIndex((message) => message.role === "user" && message.text !== current.raw);
  const previous = previousIndex >= 0 ? parsePrevious(history[previousIndex].text) : undefined;
  const miningFollowUp = /^(?:(?:what|how) about\b|and\b|same\b|(?:on|in|at|near|around)\b)|\b(?:where else|it|them|there|that (?:ore|commodity|location))\b/i.test(current.raw)
    && !/\b(?:sell(?:ing)?|buy(?:ing)?|purchase|rent(?:al)?|refin\w*|ships?|vehicles?|outposts?|prices?)\b/i.test(current.raw);
  const explicitFollowUp = isExplicitFollowUp(current.raw) || (["blueprint_progression", "mission_prerequisites"].includes(current.intent) && /\b(?:that|this|those)\b/i.test(current.raw));
  const prior = previous && (miningFollowUp || explicitFollowUp)
    ? resolveContext(previous, history.slice(0, previousIndex), parsePrevious)
    : previous;
  const previousIsMining = prior?.intent === "mining_locations";
  if (["craft_recipe", "blueprint_unlock", "blueprint_progression", "mission_info", "mission_prerequisites"].includes(current.intent)) {
    const inherited = (explicitFollowUp || /\b(?:that|this|those)\b/i.test(current.raw)) && prior && ["craft_recipe", "blueprint_unlock", "blueprint_progression", "mission_info", "mission_prerequisites", "equipment_info", "equipment_buy"].includes(prior.intent) ? prior : undefined;
    const lastAnswer = history.findLast(message => message.role === "bot" || message.role === "assistant")?.text || "";
    const blueprintSubject = /Source: Star Citizen Wiki API\{\{wiki:blueprints\//.test(lastAnswer)
      ? lastAnswer.match(/\*\*([^*\n]+) blueprint\*\*/)?.[1] || lastAnswer.match(/materials to craft \*\*([^*\n]+)\*\*/)?.[1] : undefined;
    const missionSubject = /Source: Star Citizen Wiki API\{\{wiki:missions\//.test(lastAnswer)
      ? lastAnswer.match(/^\*\*([^*\n]+)\*\*/)?.[1] : undefined;
    const answerSubject = explicitFollowUp && !current.itemName ? blueprintSubject || missionSubject : undefined;
    const blueprintFollowUp = current.intent === "mission_prerequisites" && !current.itemName
      && ((inherited && ["craft_recipe", "blueprint_unlock", "blueprint_progression"].includes(inherited.intent)) || (explicitFollowUp && blueprintSubject));
    return { ...current, intent: blueprintFollowUp ? "blueprint_progression" : current.intent,
      itemName: current.itemName || inherited?.itemName || answerSubject, gameVersion: current.gameVersion || inherited?.gameVersion };
  }


  const normalizedRaw = ` ${current.raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
  const mentioned = (name?: string) => name && normalizedRaw.includes(` ${name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `) ? name : undefined;
  const explicitLocation = (current.intent.startsWith("equipment_") ? extractEquipmentLocation(current.raw) : extractMiningLocation(current.raw)) || mentioned(current.locationName)
    || mentioned(current.moon?.moonName) || mentioned(current.planet?.planetName) || mentioned(current.starSystem?.name) || mentioned(current.terminal?.name);
  const inheritedLocation = explicitFollowUp && !explicitLocation ? prior : undefined;
  const locationFields = {
    locationName: explicitLocation || inheritedLocation?.locationName,
    planet: explicitLocation ? current.planet : inheritedLocation?.planet,
    moon: explicitLocation ? current.moon : inheritedLocation?.moon,
    orbit: explicitLocation ? current.orbit : inheritedLocation?.orbit,
    poi: explicitLocation ? current.poi : inheritedLocation?.poi,
    city: explicitLocation ? current.city : inheritedLocation?.city,
    station: explicitLocation ? current.station : inheritedLocation?.station,
    terminal: explicitLocation ? current.terminal : inheritedLocation?.terminal,
    starSystem: explicitLocation ? current.starSystem : inheritedLocation?.starSystem,
  };
  const canInheritEquipment = ["unknown", "buy", "price_check", "location_info", "terminal_info", "station_info", "city_info", "outpost_info"].includes(current.intent)
    && !current.commodity && !current.vehicle && !current.vehicle2 && !isMiningInventoryQuery(current.raw);
  if (current.intent.startsWith("equipment_") || (prior?.intent.startsWith("equipment_") && explicitFollowUp && canInheritEquipment)) {
    const newCategory = current.equipmentCategory && current.equipmentCategory !== prior?.equipmentCategory;
    const itemName = current.itemName && !/^(?:it|them|that item|there)$/i.test(current.itemName) ? current.itemName : undefined;
    const catalogueRequest = current.equipmentCategory && !itemName
      && /\b(?:all|list|show|size[\s-]*(?:\d|one|two|three|four)|s\s?\d)\b/i.test(current.raw)
      && !/\b(?:it|its|that item)\b/i.test(current.raw);
    let intent = current.intent;
    if (!intent.startsWith("equipment_")) intent = /\b(?:buy|purchase|prices?|cost)\b/i.test(current.raw) ? "equipment_buy" : prior?.intent || "equipment_info";
    return {
      ...current, ...locationFields, intent,
      itemName: itemName || (explicitFollowUp && !newCategory && !catalogueRequest ? prior?.itemName : undefined),
      itemName2: current.itemName2 || (explicitFollowUp && !newCategory && intent === "equipment_compare" ? prior?.itemName2 : undefined),
      equipmentCategory: current.equipmentCategory || (explicitFollowUp ? prior?.equipmentCategory : undefined),
      equipmentSize: current.equipmentSize ?? (explicitFollowUp && !newCategory ? prior?.equipmentSize : undefined),
      commodity: undefined, commodities: undefined, vehicle: undefined, vehicle2: undefined,
    };
  }
  const marketIntent = current.intent === "price_history" || current.intent === "market_alerts";
  if (marketIntent || (explicitFollowUp && prior && ["price_history", "market_alerts"].includes(prior.intent) && ["unknown", "location_info", "terminal_info", "find_commodity"].includes(current.intent))) {
    const directlyNamed = (current.commodities || (current.commodity ? [current.commodity] : []))
      .filter((commodity) => mentioned(commodity.name) || mentioned(commodity.code));
    const commodities = directlyNamed.length ? directlyNamed : explicitFollowUp ? prior?.commodities : undefined;
    const changedDates = current.dateFrom || current.dateTo;
    return {
      ...current, ...locationFields,
      intent: marketIntent ? current.intent : prior!.intent,
      commodity: commodities?.[0], commodities,
      gameVersion: current.gameVersion || (explicitFollowUp ? prior?.gameVersion : undefined),
      dateFrom: changedDates ? current.dateFrom : explicitFollowUp ? prior?.dateFrom : undefined,
      dateTo: changedDates ? current.dateTo : explicitFollowUp ? prior?.dateTo : undefined,
      vehicle: undefined, vehicle2: undefined,
    };
  }
  if (current.intent === "mining_locations" || (previousIsMining && miningFollowUp)) {
    const inventoryQuery = isMiningInventoryQuery(current.raw);
    const currentWords = ` ${current.raw.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
    const explicitCommodity = [current.commodity, ...(current.commodities || [])].find((candidate) => candidate &&
      [candidate.name, candidate.code, candidate.name.replace(/\s*\((?:raw|ore|unrefined)\)\s*$/i, "")]
        .some((name) => {
          const normalized = (name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          return normalized.length >= 3 && !["ore", "raw", "mining"].includes(normalized) && currentWords.includes(` ${normalized} `);
        }));
    const bareLocationFollowUp = !explicitCommodity && !current.vehicle
      ? current.raw.match(/^(?:what|how) about\s+(.+?)[?.!]*$/i)?.[1].trim()
      : undefined;
    const explicitLocation = extractMiningLocation(current.raw) || current.locationName
      || (bareLocationFollowUp && !/^(?:it|them|there|that (?:ore|commodity|location))$/i.test(bareLocationFollowUp) ? bareLocationFollowUp : undefined)
      || current.moon?.moonName || current.planet?.planetName || current.starSystem?.name;
    const commodity = inventoryQuery ? undefined : explicitCommodity || (miningFollowUp ? prior?.commodity : undefined);
    const inheritLocation = !explicitLocation && miningFollowUp
      && (previousIsMining || /\b(?:there|same location|that location)\b/i.test(current.raw));
    return {
      ...current,
      intent: "mining_locations",
      commodity,
      commodities: commodity ? [commodity] : undefined,
      locationName: explicitLocation || (inheritLocation ? prior?.locationName : undefined),
      planet: explicitLocation ? undefined : current.planet || (inheritLocation ? prior?.planet : undefined),
      moon: explicitLocation ? undefined : current.moon || (inheritLocation ? prior?.moon : undefined),
      starSystem: explicitLocation ? undefined : current.starSystem || (inheritLocation ? prior?.starSystem : undefined),
      terminal: explicitLocation ? undefined : current.terminal || (inheritLocation ? prior?.terminal : undefined),
      vehicle: undefined,
      vehicle2: undefined,
    };
  }

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
  // A complete question naming its commodity establishes a new scope. Words
  // such as "best place" alone do not carry a previous system or moon forward.
  if (!explicitFollowUp) return current;

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
    "refinery_yields", "mining_locations",
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
