import { getCacheAge, clearCache } from "@/lib/data/cache";

export async function GET() {
  const ageMs = getCacheAge();
  return Response.json({ ageMs, cachedAt: ageMs > 0 ? Date.now() - ageMs : null });
}

export async function DELETE() {
  clearCache();
  return Response.json({ cleared: true });
}
