import OpenAI from "openai";
import { isLLMClassifierAvailable } from "./llm-classifier";

export type DataContext = {
  intent: string;
  dataDescription: string;
};

const SYSTEM_PROMPT = `You are a Star Citizen trade assistant chatbot. Given the user's question and the data found, write a concise, natural response.

Rules:
- Keep it to 1-3 sentences.
- Do NOT list individual prices, terminals, or table rows in your text — a detailed table is shown separately below your response.
- Use **bold** for commodity names, terminal names, and key numbers.
- If the data says "yes" or "no" to a question, lead with that directly.
- Match the tone to the question: casual questions get casual answers, specific questions get specific answers.
- Don't say "I found" or "Based on the data" — just state the answer naturally.
- If the data mentions a count (e.g. "24 locations"), include it.
- If the data mentions a best/top price, highlight it.
- End with a colon (:) if a table follows, otherwise end with a period.`;

export async function generateResponseText(
  userMessage: string,
  dataContext: DataContext,
  fallbackText: string
): Promise<string> {
  if (!isLLMClassifierAvailable()) return fallbackText;

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const completion = await client.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `User question: "${userMessage}"\n\nData found:\n${dataContext.dataDescription}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 200,
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return fallbackText;

    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("Response generator timed out, using fallback text");
    } else {
      console.warn("Response generator error, using fallback text:", (error as Error).message || error);
    }
    return fallbackText;
  }
}
