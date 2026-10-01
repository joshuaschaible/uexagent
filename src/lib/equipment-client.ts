import { uexFetch } from "@/lib/uex-client";

export type EquipmentCategory = { id: number; type: string; section: string; name: string; is_mining?: number };
export type EquipmentItem = {
  id: number; id_category: number; name: string; category?: string | null; section?: string | null;
  company_name?: string | null; size?: string | null; slug?: string; wiki?: string | null;
  game_version?: string; date_modified?: number;
};
export type EquipmentAttribute = { id_item: number; attribute_name: string; value: string | null; unit?: string | null; date_modified?: number };
export type EquipmentPrice = {
  id_item: number; id_terminal: number; item_name: string; terminal_name: string;
  id_star_system?: number; id_planet?: number; id_moon?: number; id_orbit?: number; id_poi?: number; id_city?: number;
  star_system_name?: string | null; planet_name?: string | null; moon_name?: string | null; orbit_name?: string | null;
  city_name?: string | null; space_station_name?: string | null; outpost_name?: string | null;
  price_buy: number; price_buy_avg?: number; price_sell?: number; durability?: number | null;
  game_version?: string; date_modified?: number;
};

const TTL = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 36;
type CacheEntry = { expires: number; pending: Promise<unknown>; value?: unknown };
const cache = new Map<string, CacheEntry>();

export function clearEquipmentCache(): void { cache.clear(); }

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.pending as Promise<T>;
  cache.delete(key);
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  const pending = load().then((value) => { const entry = cache.get(key); if (entry?.pending === pending) entry.value = value; return value; })
    .catch((error) => { if (cache.get(key)?.pending === pending) cache.delete(key); throw error; });
  cache.set(key, { expires: Date.now() + TTL, pending });
  return pending;
}

export function getEquipmentCategories(): Promise<EquipmentCategory[]> {
  return cached("categories", async () => (await uexFetch<EquipmentCategory>("categories", { type: "item" }))
    .filter((category) => category.type === "item" && Number.isSafeInteger(category.id) && category.id > 0).slice(0, 200));
}

export function getEquipmentItems(categoryId: number): Promise<EquipmentItem[]> {
  return cached(`items:${categoryId}`, async () => (await uexFetch<EquipmentItem>("items", { id_category: categoryId }, { allowEmpty: true }))
    .filter((item) => Number.isSafeInteger(item.id) && typeof item.name === "string").slice(0, 5000));
}

export function getEquipmentAttributes(itemId: number): Promise<EquipmentAttribute[]> {
  return cached(`attributes:${itemId}`, () => uexFetch<EquipmentAttribute>("items_attributes", { id_item: itemId }));
}

export function getEquipmentCategoryAttributes(categoryId: number): Promise<EquipmentAttribute[]> {
  return cached(`attributes:category:${categoryId}`, () => uexFetch<EquipmentAttribute>("items_attributes", { id_category: categoryId }));
}

export function getEquipmentPrices(params: { id_item: number } | { id_category: number }): Promise<EquipmentPrice[]> {
  const key = "id_item" in params ? `prices:item:${params.id_item}` : `prices:category:${params.id_category}`;
  return cached(key, () => uexFetch<EquipmentPrice>("items_prices", params));
}

export function normalizeEquipmentName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .replace(/\bscrapper(s?)\b/g, "scraper$1")
    .replace(/\bready grip\b/g, "readygrip");
}

export function selectEquipmentCategories(categories: EquipmentCategory[], query?: string): EquipmentCategory[] {
  const input = normalizeEquipmentName(query || "");
  const normalized = /^(?:scrapers?|scraper modules?|scraper beams?|salvage modules?)$/.test(input)
    ? "scraper beams" : input === "salvage beam" ? "salvage beams" : input;
  const exact = categories.filter((category) => normalizeEquipmentName(category.name) === normalized
    || normalizeEquipmentName(`${category.section} ${category.name}`) === normalized);
  if (exact.length) return exact;
  const patterns: Record<string, RegExp> = {
    "mining lasers": /mining laser/i,
    "mining modules": /mining module/i,
    "mining gadgets": /gadgets/i,
    "ship components": /systems|avionics|propulsion/i,
    "vehicle weapons": /vehicle weapons/i,
    weapons: /weapons/i,
    armor: /armor|undersuits/i,
  };
  if (patterns[normalized]) return categories.filter((category) => patterns[normalized].test(`${category.section} ${category.name}`));
  if (normalized) return categories.filter((category) => normalizeEquipmentName(`${category.section} ${category.name}`).includes(normalized));
  // Bare names search only the three mining equipment categories, never the entire item catalogue.
  return categories.filter((category) => /mining laser|^mining modules$|^gadgets$/i.test(category.name)).slice(0, 3);
}

export function matchEquipmentItems(items: EquipmentItem[], name: string): EquipmentItem[] {
  const search = normalizeEquipmentName(name);
  if (!search) return [];
  const exact = items.filter((item) => normalizeEquipmentName(item.name) === search);
  if (exact.length) return exact;
  const compact = search.replace(/\s/g, "");
  const compactExact = items.filter((item) => normalizeEquipmentName(item.name).replace(/\s/g, "") === compact);
  if (compactExact.length) return compactExact;
  const tokens = search.split(" ");
  return items.filter((item) => {
    const words = normalizeEquipmentName(item.name).split(" ");
    return tokens.every((token) => words.includes(token));
  }).sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
}

/** Ship components are available before any equipment question has been asked. */
export async function getEquipmentSuggestions(query: string): Promise<EquipmentItem[]> {
  const components = await cached<EquipmentItem[]>("component-catalogue", async () => {
    const categories = selectEquipmentCategories(await getEquipmentCategories(), "ship components");
    const lists: EquipmentItem[][] = [];
    let next = 0;
    // Bound upstream concurrency; cache the complete catalogue for subsequent keystrokes.
    await Promise.all(Array.from({ length: Math.min(4, categories.length) }, async () => {
      while (next < categories.length) {
        const category = categories[next++];
        lists.push(await getEquipmentItems(category.id));
      }
    }));
    return [...new Map(lists.flat().map((item) => [item.id, item])).values()];
  });
  const visited = [...cache].flatMap(([key, entry]) =>
    key.startsWith("items:") && entry.expires > Date.now() && Array.isArray(entry.value)
      ? entry.value as EquipmentItem[] : []);
  const search = normalizeEquipmentName(query).replace(/\s/g, "");
  return [...new Map([...components, ...visited].map((item) => [item.id, item])).values()]
    .filter((item) => normalizeEquipmentName(item.name).replace(/\s/g, "").includes(search))
    .sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
}

/** Suggestions reuse only categories already visited by the user, with no new API fetches. */
export async function getCachedEquipmentSuggestions(query: string): Promise<EquipmentItem[]> {
  if (query.trim().length < 2) return [];
  const results: EquipmentItem[] = [];
  for (const [key, entry] of cache) {
    if (!key.startsWith("items:") || entry.expires <= Date.now() || !Array.isArray(entry.value)) continue;
    results.push(...matchEquipmentItems(entry.value as EquipmentItem[], query));
  }
  return [...new Map(results.map((item) => [item.id, item])).values()].slice(0, 12);
}
