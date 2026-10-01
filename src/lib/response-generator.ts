import OpenAI from "openai";
import { isLLMClassifierAvailable } from "./llm-classifier";

export type DataContext = {
  intent: string;
  dataDescription: string;
};

const SYSTEM_PROMPT = `You are a Star Citizen reference assistant. Given the user's question and the data found, write a concise, answer-first response.

Rules:
- ONLY state facts that appear in the provided data. NEVER add information from your own knowledge — no planet names, system names, manufacturer names, lore, or any other details unless they are explicitly in the data below.
- If the data doesn't include a fact (like which planet a moon orbits), do NOT guess — just omit it.
- Keep it to 1-3 sentences.
- Lead with the useful result: the named location, lowest/highest reported price, requested specification, or necessary clarification. Include one relevant top result when provided; do not enumerate table rows.
- Put essential uncertainty or availability limitations beside the result. Keep supporting detail in the tables.
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
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 5000, maxRetries: 0 });

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
      }
    );

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text || text.length > 10000) return fallbackText;

    return text;
  } catch {
    console.warn("Response generator unavailable, using fallback text");
    return fallbackText;
  }
}
