import { NextResponse } from "next/server";
import { getReferenceData } from "@/lib/data/cache";
import { parseQuery } from "@/lib/query-parser";
import { buildAnswer } from "@/lib/answer-builder";
import { resolveContext } from "@/lib/context-resolver";
import { classifyWithLLM, isLLMClassifierAvailable } from "@/lib/llm-classifier";

export async function POST(request: Request) {
  try {
    const { message, history } = await request.json();

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { text: "Please enter a question about Star Citizen commodities." },
        { status: 400 }
      );
    }

    const referenceData = await getReferenceData();
    const { commodityMap, starSystemMap, terminals, vehicleMap } = referenceData;

    let parsed;
    let usedLLM = false;

    // Try LLM classifier first
    if (isLLMClassifierAvailable()) {
      const llmParsed = await classifyWithLLM(message, referenceData);
      if (llmParsed && llmParsed.intent !== "unknown") {
        parsed = llmParsed;
        usedLLM = true;
      }
    }

    // Fall back to keyword parser
    if (!parsed) {
      parsed = parseQuery(message, commodityMap, starSystemMap, terminals, vehicleMap);
    }

    // Resolve conversation context from history
    if (history && Array.isArray(history) && history.length > 0) {
      parsed = resolveContext(parsed, history, (text: string) =>
        parseQuery(text, commodityMap, starSystemMap, terminals, vehicleMap)
      );
    }

    const response = await buildAnswer(parsed);
    if (usedLLM) {
      response.isLLM = true;
    }
    return NextResponse.json(response);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      {
        text: "Something went wrong while processing your question. Please try again.",
      },
      { status: 500 }
    );
  }
}
