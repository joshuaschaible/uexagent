import { getReferenceData, findVehicle } from "@/lib/data/cache";
import { parseQuery } from "@/lib/query-parser";
import { buildAnswer } from "@/lib/answer-builder";
import { resolveContext } from "@/lib/context-resolver";
import { classifyWithLLM, isLLMClassifierAvailable } from "@/lib/llm-classifier";

export async function POST(request: Request) {
  const { message, history, activeShip } = await request.json();

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return new Response(
      `data: ${JSON.stringify({ type: "text", content: "Please enter a question." })}\n\ndata: ${JSON.stringify({ type: "done" })}\n\n`,
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const referenceData = await getReferenceData();
        const { commodityMap, starSystemMap, terminals, vehicleMap } = referenceData;

        let parsed;
        let usedLLM = false;

        // Try LLM classifier first (fast, handles natural language)
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

        // Resolve conversation context
        if (history && Array.isArray(history) && history.length > 0) {
          parsed = resolveContext(parsed, history, (text: string) =>
            parseQuery(text, commodityMap, starSystemMap, terminals, vehicleMap)
          );
        }

        // Inject active ship when no explicit vehicle in query
        if (activeShip?.name && !parsed.vehicle) {
          const vehicle = findVehicle(activeShip.name, vehicleMap);
          if (vehicle) {
            parsed = { ...parsed, vehicle };
          }
        }

        const response = await buildAnswer(parsed);
        if (usedLLM) {
          response.isLLM = true;
        }

        // Stream text word by word
        const words = response.text.split(/(\s+)/);
        for (const word of words) {
          const chunk = `data: ${JSON.stringify({ type: "text", content: word })}\n\n`;
          controller.enqueue(encoder.encode(chunk));
          // Small delay for typing effect
          await new Promise((r) => setTimeout(r, 15));
        }

        // Send table as single chunk
        if (response.table) {
          const chunk = `data: ${JSON.stringify({ type: "table", content: response.table })}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }

        // Send chart as single chunk
        if (response.chart) {
          const chunk = `data: ${JSON.stringify({ type: "chart", content: response.chart })}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }

        // Send map as single chunk
        if (response.map) {
          const chunk = `data: ${JSON.stringify({ type: "map", content: response.map })}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }

        // Send profit data as single chunk
        if (response.profit) {
          const chunk = `data: ${JSON.stringify({ type: "profit", content: response.profit })}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }

        // Send tables as single chunk
        if (response.tables) {
          const chunk = `data: ${JSON.stringify({ type: "tables", content: response.tables })}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }

        // Send LLM flag
        if (response.isLLM) {
          const chunk = `data: ${JSON.stringify({ type: "meta", isLLM: true })}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        }

        // Done
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
      } catch (error) {
        console.error("Stream error:", error);
        const msg = error instanceof Error ? error.message : "";
        let userMessage: string;
        if (msg.includes("UEX API error")) {
          const statusMatch = msg.match(/UEX API error: (\d+)/);
          const status = statusMatch ? statusMatch[1] : "";
          if (status === "522" || status === "521" || status === "520") {
            userMessage = "The UEX data service is currently experiencing an outage. This is a known issue on their end — please try again in a few minutes.";
          } else if (status === "429") {
            userMessage = "We're making too many requests to the UEX data service. Please wait a moment and try again.";
          } else if (status.startsWith("5")) {
            userMessage = `The UEX data service returned an error (${status}). Their servers may be under heavy load — please try again shortly.`;
          } else {
            userMessage = `Couldn't fetch data from UEX (error ${status}). Please try again.`;
          }
        } else if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) {
          userMessage = "Couldn't reach the UEX data service. Check your connection or try again in a moment.";
        } else {
          userMessage = "Something went wrong. Please try again.";
        }
        const errorChunk = `data: ${JSON.stringify({ type: "error", content: userMessage })}\n\n`;
        controller.enqueue(encoder.encode(errorChunk));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
