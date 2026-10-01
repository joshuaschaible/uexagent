import OpenAI from "openai";
import type { ChatResponse } from "./types";
import { buildAnswer } from "./answer-builder";
import { parseQuery, type Intent } from "./query-parser";
import { getReferenceData } from "./data/cache";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `You are a Star Citizen game reference assistant. You have access to UEX Corp trade data.

You can call these functions to get live data:
- sell_commodity: Find best places to sell a commodity
- buy_commodity: Find cheapest places to buy a commodity
- price_check: Get current prices for a commodity
- price_history: Get price averages and volatility
- find_commodity: Get commodity details
- mining_locations: Find reported ore deposits by commodity or location, including planets, moons, orbits, asteroid fields, and points of interest. Preserve the user's exact location name.
- equipment_info / equipment_buy / equipment_compare: Look up equipment catalogues, item attributes, purchase locations, or compare two named items. Keep exact item names and category (mining lasers/modules/gadgets, ship components, weapons or armor).
- market_alerts: Inspect current price, inventory and report anomalies. This does not create background notifications.
- vehicle_info: Get ship specs and cargo capacity
- station_info: List space stations
- city_info: List cities
- outpost_info: List outposts
- location_info: Get location overview

When the user asks about trading, commodities, ships, or locations in Star Citizen, call the appropriate function.
For general chat or questions you can't answer with data, respond conversationally.
Keep responses concise and helpful.`;

const TOOLS: OpenAI.ChatCompletionTool[] = [
  ...(["equipment_info", "equipment_buy", "equipment_compare", "market_alerts"] as const).map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: name === "market_alerts" ? "Inspect current market alerts and anomalies" : "Look up equipment specifications, shopping locations, or compare named equipment items",
      parameters: { type: "object", properties: { query: { type: "string", description: "Full user question, preserving exact item names, equipment category, locations, game version and date filters" } }, required: ["query"] },
    },
  })),
  {
    type: "function",
    function: {
      name: "mining_locations",
      description: "Find where an ore can be mined, which ores occur at a location, or whether an ore is found there. Not ship equipment, trade prices, or refining.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "The full mining question with exact commodity and location names, e.g. 'Can I mine Gold on Daymar?'" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "sell_commodity",
      description: "Find the best places to sell a commodity",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "e.g. 'sell Bexalite'" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buy_commodity",
      description: "Find cheapest places to buy a commodity",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "e.g. 'buy Laranite'" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "price_check",
      description: "Get current price info for a commodity",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "e.g. 'price of Agricium'" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "vehicle_info",
      description: "Get ship specs, cargo capacity, crew size",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "e.g. 'C2 Hercules specs'" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "station_info",
      description: "List space stations in a system or near a planet",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "e.g. 'stations in Stanton'" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "general_query",
      description: "Handle any other Star Citizen data query",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "The user's question" } },
        required: ["query"],
      },
    },
  },
];

export async function llmFallback(
  message: string,
  history?: { role: string; text: string }[]
): Promise<ChatResponse | null> {
  if (!OPENAI_API_KEY) return null;

  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 8000, maxRetries: 0 });

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    // Add conversation history
    if (history) {
      for (const h of history.slice(-4)) {
        messages.push({
          role: h.role === "user" ? "user" : "assistant",
          content: h.text,
        });
      }
    }

    messages.push({ role: "user", content: message });

    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.3,
      max_tokens: 500,
    });

    const choice = completion.choices[0];
    if (!choice) return null;

    // If OpenAI wants to call a function, execute it with our handlers
    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      const toolCall = choice.message.tool_calls[0];
      if (!toolCall || toolCall.type !== "function") return null;
      if (!TOOLS.some((tool) => tool.type === "function" && tool.function.name === toolCall.function.name)) return null;
      if (toolCall.function.arguments.length > 10000) return null;
      const args: unknown = JSON.parse(toolCall.function.arguments);
      if (!args || typeof args !== "object" || Array.isArray(args) || !("query" in args)) return null;
      if (typeof args.query !== "string" || args.query.trim().length === 0 || args.query.length > 2000) return null;
      const queryText = args.query.trim();

      // Parse and execute via our existing pipeline
      const { commodityMap, starSystemMap, terminals, vehicleMap } =
        await getReferenceData();
      const parsed = parseQuery(
        queryText,
        commodityMap,
        starSystemMap,
        terminals,
        vehicleMap
      );

      // Override intent if the function name gives us a better one
      const intentMap: Partial<Record<string, Intent>> = {
        sell_commodity: "sell",
        buy_commodity: "buy",
        price_check: "price_check",
        mining_locations: "mining_locations",
        equipment_info: "equipment_info",
        equipment_buy: "equipment_buy",
        equipment_compare: "equipment_compare",
        market_alerts: "market_alerts",
        vehicle_info: "vehicle_info",
        station_info: "station_info",
      };

      const overrideIntent = intentMap[toolCall.function.name];
      if (overrideIntent) {
        parsed.intent = overrideIntent;
      }

      const result = await buildAnswer(parsed);
      return { ...result, isLLM: true };
    }

    // Plain text response
    const text = choice.message.content || "I'm not sure how to help with that.";
    if (text.length > 10000) return null;
    return { text, isLLM: true };
  } catch {
    console.warn("LLM fallback unavailable");
    return null;
  }
}

export function isLLMAvailable(): boolean {
  return !!OPENAI_API_KEY;
}
