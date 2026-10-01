import { NextResponse } from "next/server";
import { getReferenceData } from "@/lib/data/cache";
import { assertTrustedHost, MAX_NAME_LENGTH, RequestError, requestErrorResponse } from "@/lib/request-security";

export type Suggestion = {
  name: string;
  type: "commodity" | "ship" | "system" | "planet" | "moon" | "station" | "orbit" | "poi" | "item";
};

export async function GET(request: Request) {
  try {
    assertTrustedHost(request);
    const q = new URL(request.url).searchParams.get("q");
    if (q && q.length > MAX_NAME_LENGTH) {
      throw new RequestError(400, "The search query is too long.");
    }
    return await getSuggestions(request);
  } catch (error) {
    return requestErrorResponse(error);
  }
}

async function getSuggestions(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.toLowerCase().trim();
  const typed = searchParams.get("typed") === "1";

  if (!q || q.length < 1) {
    return NextResponse.json([]);
  }

  const { commodities, vehicles, starSystems, terminals } =
    await getReferenceData();

  const MAX = 8;
  const additional: Suggestion[] = [];
  if (q.length >= 2 || q === "*") {
    const [geographyResult, equipmentResult] = await Promise.allSettled([
      import("@/lib/data/mining").then(({ getMiningData }) => getMiningData()),
      import("@/lib/equipment-client").then(({ getEquipmentSuggestions }) => getEquipmentSuggestions(q === "*" ? "" : q)),
    ]);
    if (geographyResult.status === "fulfilled" && geographyResult.value) {
      const geography = geographyResult.value;
      for (const [rows, type] of [[geography.planets, "planet"], [geography.moons, "moon"], [geography.orbits, "orbit"], [geography.pointsOfInterest, "poi"]] as const) {
        for (const row of rows) if (q === "*" || row.name.toLowerCase().includes(q)) additional.push({ name: row.name, type });
      }
    }
    if (equipmentResult.status === "fulfilled") additional.push(...equipmentResult.value.map((item) => ({ name: item.name, type: "item" as const })));
  }

  if (typed) {
    // Return ALL matching suggestions for @ mentions, sorted by relevance
    const showAll = q.length < 2;
    const results: Suggestion[] = [...additional];

    for (const c of commodities) {
      if (c.is_available && (showAll || c.name.toLowerCase().includes(q))) {
        results.push({ name: c.name, type: "commodity" });
      }
    }

    for (const v of vehicles) {
      const name = v.name_full || v.name;
      if (showAll || name.toLowerCase().includes(q)) {
        results.push({ name, type: "ship" });
      }
    }

    for (const s of starSystems) {
      if (showAll || s.name.toLowerCase().includes(q)) {
        results.push({ name: s.name, type: "system" });
      }
    }

    const planets = new Set<string>();
    for (const t of terminals) {
      if (t.planet_name && !planets.has(t.planet_name)) {
        planets.add(t.planet_name);
        if (showAll || t.planet_name.toLowerCase().includes(q)) {
          results.push({ name: t.planet_name, type: "planet" });
        }
      }
    }

    const moons = new Set<string>();
    for (const t of terminals) {
      if (t.moon_name && !moons.has(t.moon_name)) {
        moons.add(t.moon_name);
        if (showAll || t.moon_name.toLowerCase().includes(q)) {
          results.push({ name: t.moon_name, type: "moon" });
        }
      }
    }

    const stations = new Set<string>();
    for (const t of terminals) {
      if (!stations.has(t.name) && (showAll || t.name.toLowerCase().includes(q))) {
        stations.add(t.name);
        results.push({ name: t.name, type: "station" });
      }
    }

    // Sort by relevance: exact match > starts-with > contains, then shorter names first
    if (!showAll) {
      results.sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aExact = aName === q ? 1 : 0;
        const bExact = bName === q ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        const aStarts = aName.startsWith(q) ? 1 : 0;
        const bStarts = bName.startsWith(q) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
        return aName.length - bName.length;
      });
    }

    return NextResponse.json([...new Map(results.map((result) => [`${result.type}:${result.name.toLowerCase()}`, result])).values()]);
  }

  // Plain string results (legacy typeahead)
  const plainResults: { name: string }[] = additional.map(({ name }) => ({ name }));

  for (const c of commodities) {
    if (c.is_available && c.name.toLowerCase().includes(q)) {
      plainResults.push({ name: c.name });
    }
  }

  for (const v of vehicles) {
    const name = v.name_full || v.name;
    if (name.toLowerCase().includes(q)) {
      plainResults.push({ name });
    }
  }

  for (const s of starSystems) {
    if (s.name.toLowerCase().includes(q)) {
      plainResults.push({ name: s.name });
    }
  }

  const planets = new Set<string>();
  for (const t of terminals) {
    if (t.planet_name && !planets.has(t.planet_name)) {
      planets.add(t.planet_name);
      if (t.planet_name.toLowerCase().includes(q)) {
        plainResults.push({ name: t.planet_name });
      }
    }
  }

  for (const t of terminals) {
    if (t.name.toLowerCase().includes(q)) {
      plainResults.push({ name: t.name });
    }
  }

  // Sort by relevance: exact match > starts-with > contains, then shorter names first
  plainResults.sort((a, b) => {
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();
    const aExact = aName === q ? 1 : 0;
    const bExact = bName === q ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    const aStarts = aName.startsWith(q) ? 1 : 0;
    const bStarts = bName.startsWith(q) ? 1 : 0;
    if (aStarts !== bStarts) return bStarts - aStarts;
    return aName.length - bName.length;
  });

  // Deduplicate and limit
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const r of plainResults) {
    if (!seen.has(r.name)) {
      seen.add(r.name);
      deduped.push(r.name);
      if (deduped.length >= MAX) break;
    }
  }

  return NextResponse.json(deduped);
}
