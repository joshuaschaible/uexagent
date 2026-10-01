/** Version-scoped game data API, separate from the Wiki's MediaWiki page API. */
const BASE = "https://api.star-citizen.wiki/api/";
const cache = new Map<string, { expires: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export type Ingredient = { name?: string; quantity_scu?: number | null; quantity?: number | null; min_quality?: number | null };
export type RequirementGroup = Ingredient & { kind?: string; required_count?: number | null; children?: RequirementGroup[] };
export type Blueprint = {
  uuid: string; output_name?: string; game_version?: string; craft_time_label?: string;
  is_available_by_default?: boolean; ingredients?: Ingredient[]; requirement_groups?: RequirementGroup[];
  unlocking_missions?: { title?: string; web_url?: string }[];
};
export type Mission = {
  uuid: string; title?: string; mission_giver?: string; star_systems?: string[]; game_version?: string;
  illegal?: boolean; once_only?: boolean; shareable?: boolean; reward_min?: number; reward_max?: number;
  reputation_prerequisite?: { faction?: string; scope?: string; min_standing?: { name?: string; min_reputation?: number } } | null;
  prerequisite_groups?: { required_count?: number; required_tags?: { name?: string }[]; excluded_tags?: { name?: string }[]; missions?: { title?: string; uuid?: string }[] }[];
  blueprints?: { drop_chance_percent?: number; items?: { name?: string; blueprint_link?: string }[] }[];
};
type Page<T> = { data: T[]; meta?: { total?: number } };

async function request<T>(resource: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(resource, BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const key = url.toString();
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.value as T;
  if (pending.has(key)) return pending.get(key) as Promise<T>;
  const task = (async () => {
    const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "StarCitizenReference/0.1 (community reference application)" }, signal: AbortSignal.timeout(8000), cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error(`Game Wiki API error: ${response.status}`);
    const body = await response.text();
    if (body.length > 4_000_000) throw new Error("Game Wiki response too large");
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || !("data" in value)) throw new Error("Invalid Game Wiki response");
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { value, expires: Date.now() + 60 * 60 * 1000 });
    return value;
  })();
  pending.set(key, task);
  try { return await task as T; } finally { pending.delete(key); }
}
export function wikiId(url: string | undefined, resource: "missions" | "blueprints"): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.origin !== "https://api.star-citizen.wiki") return undefined;
    const match = parsed.pathname.match(new RegExp(`^/(?:api/)?${resource}/([^/]+)$`));
    return match && UUID.test(match[1]) ? match[1] : undefined;
  } catch { return undefined; }
}
export function searchBlueprints(name: string, version?: string) {
  return request<Page<Blueprint>>("blueprints", { "filter[query]": name, "page[size]": "30", ...(version ? { version } : {}) });
}
export function searchMissions(name: string, version?: string) {
  return request<Page<Mission>>("missions", { "filter[title]": name, "page[size]": "30", ...(version ? { version } : {}) });
}
export async function getBlueprint(id: string, version?: string): Promise<Blueprint> {
  if (!UUID.test(id)) throw new Error("Invalid blueprint identifier");
  return (await request<{ data: Blueprint }>(`blueprints/${id}`, version ? { version } : {})).data;
}
export async function getMission(id: string, version?: string): Promise<Mission> {
  if (!UUID.test(id)) throw new Error("Invalid mission identifier");
  return (await request<{ data: Mission }>(`missions/${id}`, version ? { version } : {})).data;
}
