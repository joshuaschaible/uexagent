import {
  getPlanets,
  getMoons,
  getOrbits,
  getPointsOfInterest,
  type Planet,
  type Moon,
  type Orbit,
  type PointOfInterest,
} from "@/lib/uex-client";

export type MiningData = {
  planets: Planet[];
  moons: Moon[];
  orbits: Orbit[];
  pointsOfInterest: PointOfInterest[];
};

const CACHE_TTL = 60 * 60 * 1000;
let cached: MiningData | null = null;
let cacheTime = 0;
let pendingLoad: Promise<MiningData> | null = null;
let cacheGeneration = 0;

export function clearMiningDataCache(): void {
  cached = null;
  cacheTime = 0;
  pendingLoad = null;
  cacheGeneration++;
}

// Only mining requests load these resources: an unavailable location endpoint
// must not stop trading queries from loading their reference data.
export async function getMiningData(): Promise<MiningData> {
  if (cached && Date.now() - cacheTime < CACHE_TTL) return cached;
  if (pendingLoad) return pendingLoad;

  const generation = cacheGeneration;
  const load = Promise.all([
    getPlanets(), getMoons(), getOrbits(), getPointsOfInterest(),
  ]).then(([planets, moons, orbits, pointsOfInterest]) => {
    const data: MiningData = { planets, moons, orbits, pointsOfInterest };
    // A cleared cache cannot be repopulated by a request already in flight.
    if (generation === cacheGeneration) {
      cached = data;
      cacheTime = Date.now();
    }
    return data;
  }).finally(() => {
    // A stale load must not release a newer generation's pending request.
    if (pendingLoad === load) pendingLoad = null;
  });
  pendingLoad = load;
  return load;
}
