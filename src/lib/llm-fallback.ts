import OpenAI from "openai";
import type { ChatResponse } from "./types";
import { buildAnswer } from "./answer-builder";
import { parseQuery } from "./query-parser";
import { getReferenceData } from "./data/cache";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SYSTEM_PROMPT = `You are a Star Citizen trading assistant. You have access to UEX Corp trade data.

You can call these functions to get live data:
- sell_commodity: Find best places to sell a commodity
- buy_commodity: Find cheapest places to buy a commodity
- trade_route: Find profitable trade routes
- price_check: Get current prices for a commodity
- price_history: Get price averages and volatility
- commodity_ranking: Get most profitable commodities
- find_commodity: Get commodity details
- vehicle_info: Get ship specs and cargo capacity
- station_info: List space stations
- city_info: List cities
- outpost_info: List outposts
- location_info: Get location overview

When the user asks about trading, commodities, ships, or locations in Star Citizen, call the appropriate function.
For general chat or questions you can't answer with data, respond conversationally.
Keep responses concise and helpful.`;

const TOOLS: OpenAI.ChatCompletionTool[] = [
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
      name: "trade_route",
      description: "Find profitable trade routes for a commodity",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "e.g. 'trade route for Quantanium'" } },
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
      name: "commodity_ranking",
      description: "Get the most profitable commodities ranked",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "e.g. 'most profitable commodity'" } },
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
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

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

    // If OpenAI wants to call a function, execute it with our handlers
    if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
      const toolCall = choice.message.tool_calls[0];
      const args = JSON.parse(toolCall.function.arguments);
      const queryText = args.query || message;

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
      const intentMap: Record<string, string> = {
        sell_commodity: "sell",
        buy_commodity: "buy",
        trade_route: "trade_route",
        price_check: "price_check",
        commodity_ranking: "commodity_ranking",
        vehicle_info: "vehicle_info",
        station_info: "station_info",
      };

      const overrideIntent = intentMap[toolCall.function.name];
      if (overrideIntent) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parsed as any).intent = overrideIntent;
      }

      const result = await buildAnswer(parsed);
      return { ...result, isLLM: true };
    }

    // Plain text response
    const text = choice.message.content || "I'm not sure how to help with that.";
    return { text, isLLM: true };
  } catch (error) {
    console.error("LLM fallback error:", error);
    return null;
  }
}

export function isLLMAvailable(): boolean {
  return !!OPENAI_API_KEY;
}
