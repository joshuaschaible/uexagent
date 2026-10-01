import { NextResponse } from "next/server";
import { getReferenceData } from "@/lib/data/cache";
import { parseQuery, enrichQueryLocations, parseCraftingQuery } from "@/lib/query-parser";
import { buildAnswer } from "@/lib/answer-builder";
import { resolveContext } from "@/lib/context-resolver";
import { classifyWithLLM, isLLMClassifierAvailable } from "@/lib/llm-classifier";
import {
  assertSameOrigin,
  chatRequestLimiter,
  readJsonBody,
  RequestError,
  requestErrorResponse,
  validateChatInput,
} from "@/lib/request-security";

export async function POST(request: Request) {
  let release: (() => void) | undefined;
  try {
    assertSameOrigin(request);
    release = chatRequestLimiter.acquire();
    const { message, history } = validateChatInput(await readJsonBody(request));

    let parsed = parseCraftingQuery(message);
    let usedLLM = false;
    if (!parsed) {
      const referenceData = await getReferenceData();
      if (request.signal.aborted) throw new RequestError(408, "The request was interrupted.");
      const { commodityMap, starSystemMap, terminals, vehicleMap } = referenceData;

      // Try LLM classifier first
      if (isLLMClassifierAvailable()) {
        const llmParsed = await classifyWithLLM(message, referenceData);
        if (request.signal.aborted) throw new RequestError(408, "The request was interrupted.");
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

      parsed = await enrichQueryLocations(parsed);
    } else {
      parsed = resolveContext(parsed, history, (text: string) => parseCraftingQuery(text) || { intent: "unknown", modifiers: [], raw: text });
    }
    const response = await buildAnswer(parsed);
    if (usedLLM) {
      response.isLLM = true;
    }
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!(error instanceof RequestError)) {
      console.error("Chat API failed:", error instanceof Error ? error.name : "Unknown error");
    }
    return requestErrorResponse(error);
  } finally {
    release?.();
  }
}
