import { getReferenceData } from "@/lib/data/cache";
import { parseQuery, enrichQueryLocations, parseCraftingQuery } from "@/lib/query-parser";
import { buildAnswer } from "@/lib/answer-builder";
import { resolveContext, isExplicitFollowUp } from "@/lib/context-resolver";
import { classifyWithLLM, isLLMClassifierAvailable } from "@/lib/llm-classifier";
import {
  assertSameOrigin,
  chatRequestLimiter,
  readJsonBody,
  requestErrorResponse,
  validateChatInput,
} from "@/lib/request-security";

export async function POST(request: Request) {
  let release: (() => void) | undefined;
  let input;
  try {
    assertSameOrigin(request);
    release = chatRequestLimiter.acquire();
    input = validateChatInput(await readJsonBody(request));
  } catch (error) {
    release?.();
    return requestErrorResponse(error);
  }

  const { message, history } = input;
  const encoder = new TextEncoder();
  let cancelled = request.signal.aborted;
  let closed = false;
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let resumeTyping: (() => void) | undefined;
  const stopTyping = () => {
    clearTimeout(typingTimer);
    resumeTyping?.();
    resumeTyping = undefined;
  };
  const pauseTyping = () => new Promise<void>((resolve) => {
    resumeTyping = resolve;
    typingTimer = setTimeout(() => {
      resumeTyping = undefined;
      resolve();
    }, 15);
  });

  const stream = new ReadableStream({
    async start(controller) {
      const stop = () => {
        cancelled = true;
        stopTyping();
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      const send = (event: Record<string, unknown>) => {
        if (!cancelled && !closed) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      };
      request.signal.addEventListener("abort", stop, { once: true });
      try {
        if (cancelled) return;
        let parsed = parseCraftingQuery(message);
        let usedLLM = false;
        if (!parsed) {
          const referenceData = await getReferenceData();
          if (cancelled) return;
          const { commodityMap, starSystemMap, terminals, vehicleMap } = referenceData;

          if (isLLMClassifierAvailable()) {
            const previousUserMessages = history.filter((m) => m.role === "user" && m.text !== message);
            const lastUserMessage = previousUserMessages.length > 0
              ? previousUserMessages[previousUserMessages.length - 1].text
              : undefined;
            const llmParsed = await classifyWithLLM(message, referenceData, isExplicitFollowUp(message) ? lastUserMessage : undefined);
            if (cancelled) return;
            if (llmParsed && llmParsed.intent !== "unknown") {
              parsed = llmParsed;
              usedLLM = true;
            }
          }

          if (!parsed) {
            parsed = parseQuery(message, commodityMap, starSystemMap, terminals, vehicleMap);
          }

          if (history.length > 0) {
            parsed = resolveContext(parsed, history, (text: string) =>
              parseQuery(text, commodityMap, starSystemMap, terminals, vehicleMap)
            );
          }

          parsed = await enrichQueryLocations(parsed);
        } else {
          parsed = resolveContext(parsed, history, (text: string) => parseCraftingQuery(text) || { intent: "unknown", modifiers: [], raw: text });
        }
        const response = await buildAnswer(parsed);
        if (cancelled) return;
        if (usedLLM) response.isLLM = true;

        // Preserve the typing effect, but stop timers promptly on disconnect
        // and send any remaining text together after a bounded animation.
        const words = response.text.split(/(\s+)/);
        const animationDeadline = Date.now() + 3_000;
        for (let index = 0; index < words.length; index += 1) {
          if (cancelled) return;
          if (index >= 200 || Date.now() >= animationDeadline) {
            send({ type: "text", content: words.slice(index).join("") });
            break;
          }
          send({ type: "text", content: words[index] });
          if (index < words.length - 1) await pauseTyping();
        }
        if (cancelled) return;
        for (const type of ["table", "chart", "map", "profit", "image", "tables"] as const) {
          if (response[type]) send({ type, content: response[type] });
        }
        if (response.isLLM) send({ type: "meta", isLLM: true });
        send({ type: "done" });
      } catch (error) {
        if (cancelled) return;
        console.error("Chat stream failed:", error instanceof Error ? error.name : "Unknown error");
        const msg = error instanceof Error ? error.message : "";
        let userMessage: string;
        if (msg.includes("UEX API error")) {
          const statusMatch = msg.match(/UEX API error: (\d+)/);
          const status = statusMatch ? statusMatch[1] : "";
          if (status === "522" || status === "521" || status === "520") {
            userMessage = "The UEX data service is currently experiencing an outage. Please try again in a few minutes.";
          } else if (status === "429") {
            userMessage = "We're making too many requests to the UEX data service. Please wait a moment and try again.";
          } else if (status.startsWith("5")) {
            userMessage = `The UEX data service returned an error (${status}). Please try again shortly.`;
          } else {
            userMessage = "Couldn't fetch data from UEX. Please try again.";
          }
        } else if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) {
          userMessage = "Couldn't reach the UEX data service. Check your connection or try again in a moment.";
        } else {
          userMessage = "Something went wrong. Please try again.";
        }
        send({ type: "error", content: userMessage });
        send({ type: "done" });
      } finally {
        stopTyping();
        request.signal.removeEventListener("abort", stop);
        if (!closed) {
          closed = true;
          controller.close();
        }
        // Retain the slot until outstanding work settles, even on disconnect.
        release?.();
      }
    },
    cancel() {
      cancelled = true;
      closed = true;
      stopTyping();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
