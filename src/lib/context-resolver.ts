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
    "what about",
    "how about",
    "and in",
    "and at",
    "what if",
    "same for",
    "same but",
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
    "that one",
    "that commodity",
    "that ship",
    "those",
    "there",
    "instead",
  ];

  // Don't inherit context when the query is about a specific terminal or location
  const isTerminalOrLocationQuery = current.terminal &&
    ["terminal_info", "location_trade"].includes(current.intent);

  const isFollowUp =
    !isTerminalOrLocationQuery && (
      followUpPatterns.some((p) => lower.includes(p)) ||
      (current.intent !== "unknown" && !current.commodity && !current.vehicle)
    );

  if (!isFollowUp) return current;

  // Find the most recent user message with entities
  const previousUserMessages = history
    .filter((m) => m.role === "user")
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

  return {
    ...current,
    commodity: current.commodity || (commodities ? commodities[0] : undefined),
    commodities,
    starSystem: current.starSystem || inheritedSystem,
    vehicle: current.vehicle || inheritedVehicle,
    moon: current.moon || inheritedMoon,
    intent: current.intent === "unknown" ? inheritedIntent : current.intent,
  };
}
