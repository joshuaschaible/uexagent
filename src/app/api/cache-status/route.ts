import { getCacheAge, clearCache } from "@/lib/data/cache";
import { clearTradeDataCache } from "@/lib/trade-data";
import { clearRouteDistanceCache } from "@/lib/route-planner";
import { clearEquipmentCache } from "@/lib/equipment-client";
import { revalidateTag } from "next/cache";
import { assertSameOrigin, assertTrustedHost, cacheResetLimiter, requestErrorResponse } from "@/lib/request-security";

export async function GET(request: Request) {
  try {
    assertTrustedHost(request);
    const ageMs = getCacheAge();
    return Response.json({ ageMs, cachedAt: ageMs > 0 ? Date.now() - ageMs : null });
  } catch (error) {
    return requestErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  let release: (() => void) | undefined;
  try {
    assertSameOrigin(request);
    release = cacheResetLimiter.acquire();
    clearCache();
    clearTradeDataCache();
    clearRouteDistanceCache();
    clearEquipmentCache();
    revalidateTag("uex-data", { expire: 0 });
    return Response.json({ cleared: true });
  } catch (error) {
    return requestErrorResponse(error);
  } finally {
    release?.();
  }
}
