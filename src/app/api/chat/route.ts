import { NextResponse } from "next/server";
import { getReferenceData } from "@/lib/data/cache";
import { parseQuery } from "@/lib/query-parser";
import { buildAnswer } from "@/lib/answer-builder";

export async function POST(request: Request) {
  try {
    const { message } = await request.json();

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { text: "Please enter a question about Star Citizen commodities." },
        { status: 400 }
      );
    }

    const { commodityMap, starSystemMap, terminals } = await getReferenceData();
    const parsed = parseQuery(message, commodityMap, starSystemMap, terminals);
    const response = await buildAnswer(parsed);

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
