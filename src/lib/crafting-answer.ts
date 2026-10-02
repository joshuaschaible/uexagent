import type { ParsedQuery } from "./query-parser";
import { missionProgression } from "./mission-progression";
import type { ChatResponse } from "./types";
import { searchBlueprints, searchMissions, getBlueprint, getMission, wikiId, type Blueprint, type Mission, type RequirementGroup } from "./game-wiki-client";

const clean = (value: unknown): string => typeof value === "string" ? value.replace(/[{}*<>]/g, "").slice(0, 240) : "Not reported";
const number = (value: unknown): string => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "Not reported";
const normal = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const source = (kind: "blueprints" | "missions", id: string, version?: string) => `Source: Star Citizen Wiki API{{wiki:${kind}/${id}}}. Game patch: ${clean(version)}.`;
const quantity = (item: RequirementGroup) => typeof item.quantity_scu === "number" ? `${number(item.quantity_scu)} SCU` : typeof item.quantity === "number" ? `${number(item.quantity)} items` : "Not reported";
const standing = (m: Mission) => {
  const rep = m.reputation_prerequisite;
  return rep?.min_standing ? `${clean(rep.faction)} / ${(rep.scope?.startsWith("MissionProviderReputation_") ? "Mission standing" : clean(rep.scope))}: ${clean(rep.min_standing.name)}${typeof rep.min_standing.min_reputation === "number" ? ` (${number(rep.min_standing.min_reputation)} reputation)` : ""}` : "Not reported";
};
function prerequisites(m: Mission): string {
  const groups = m.prerequisite_groups;
  if (!groups?.length) return "No prerequisite missions listed";
  return groups.map(g => {
    const names = (g.missions || []).map(x => clean(x.title));
    const tags = (g.required_tags || []).map(x => clean(x.name));
    const exclude = (g.excluded_tags || []).map(x => clean(x.name));
    return `${names.length ? `Complete ${g.required_count ?? "reported"} of: ${names.join("; ")}` : tags.length ? `Required completion tags: ${tags.join("; ")}` : "Requirements not named"}${exclude.length ? `; excluded tags: ${exclude.join("; ")}` : ""}`;
  }).join(" | ");
}
function poolDescription(m: Mission, bp?: Blueprint): string {
  const pools = (m.blueprints || []).filter(p => !bp || p.items?.some(i => wikiId(i.blueprint_link, "blueprints") === bp.uuid || normal(i.name || "") === normal(bp.output_name || "")));
  if (!pools.length) return "Reward pool not reported";
  return pools.map(p => `${typeof p.drop_chance_percent === "number" ? `${number(p.drop_chance_percent)}% reported pool drop chance` : "Pool chance not reported"}; ${p.items?.length ?? "unknown"} possible blueprints${(p.items?.length || 0) > 1 ? "; specific blueprint not guaranteed" : "; selection mechanics not reported"}`).join(" | ");
}
function recipe(bp: Blueprint): ChatResponse {
  const rows: string[][] = [];
  function visit(group: RequirementGroup, label: string) {
    if (group.children?.length) {
      const next = `${label ? `${label} / ` : ""}${clean(group.name || "Materials")}${group.children.length > 1 ? ` (choose ${group.required_count ?? "reported count"} of ${group.children.length})` : ""}`;
      group.children.forEach(child => visit(child, next));
    } else rows.push([clean(group.name), quantity(group), typeof group.min_quality === "number" ? number(group.min_quality) : "Not reported", label || "Recipe"]);
  }
  if (bp.requirement_groups?.length) bp.requirement_groups.forEach(g => visit(g, ""));
  else (bp.ingredients || []).forEach(i => visit(i, ""));
  return {
    text: `Base recipe materials to craft **${clean(bp.output_name)}**.${bp.craft_time_label ? ` Craft time: ${clean(bp.craft_time_label)}.` : ""}\n\n${bp.is_available_by_default === true ? "Blueprint is reported as available by default." : "Ask how to unlock its blueprint for mission rewards and requirements."}\n\n${rows.some(r => r[3].includes("choose")) ? "Groups marked ‘choose’ contain alternatives; do not add all options together.\n\n" : ""}${source("blueprints", bp.uuid, bp.game_version)}`,
    table: rows.length ? { headers: ["Material", "Quantity", "Minimum quality", "Requirement group"], rows } : undefined,
  };
}
async function unlock(bp: Blueprint, progressionFirst = false): Promise<ChatResponse> {
  if (bp.is_available_by_default === true) return { text: `**${clean(bp.output_name)} blueprint** is reported as available by default; a mission unlock is not required.\n\n${source("blueprints", bp.uuid, bp.game_version)}` };
  const refs = (bp.unlocking_missions || []).map(m => ({ ...m, id: wikiId(m.web_url, "missions") })).filter(m => m.id);
  const selected = refs.slice(0, 20);
  const missions: (Mission | null)[] = [];
  // Keep concurrency and request count bounded; preserve the source version.
  for (let i = 0; i < selected.length; i += 4) {
    missions.push(...await Promise.all(selected.slice(i, i + 4).map(m => getMission(m.id!, bp.game_version).then(mission => mission.uuid === m.id && (!bp.game_version || mission.game_version === bp.game_version) ? mission : null).catch(() => null))));
  }
  const variantRows = selected.map((ref, i) => {
    const m = missions[i];
    return [clean(m?.title || ref.title) + `{{wiki:missions/${ref.id}}}`, m?.star_systems?.map(clean).join(", ") || "Not reported", m ? standing(m) : "Details unavailable", m ? prerequisites(m) : "Details unavailable", m ? poolDescription(m, bp) : "Reward pool unavailable"];
  });
  const grouped = new Map<string, { row: string[]; count: number }>();
  variantRows.forEach((row, i) => {
    const key = JSON.stringify([clean(missions[i]?.title || selected[i].title), ...row.slice(1)]);
    const existing = grouped.get(key);
    if (existing) existing.count++;
    else grouped.set(key, { row, count: 1 });
  });
  const rows = [...grouped.values()].map(({row, count}) => [row[0] + (count > 1 ? ` (${count} variants)` : ""), ...row.slice(1)]);
  const progression = await missionProgression(missions.filter((m): m is Mission => m !== null), bp.game_version);
  const example = missions.find((m): m is Mission => m !== null);
  const quickAnswer = example && progressionFirst ? `First listed option: **${clean(example.title)}**{{wiki:missions/${example.uuid}}} — ${prerequisites(example)}. Required standing: ${standing(example)}. ${poolDescription(example, bp)}.\n\n` : example ? `One listed option for **${clean(bp.output_name)} blueprint**: **${clean(example.title)}**{{wiki:missions/${example.uuid}}} in ${example.star_systems?.map(clean).join(", ") || "an unreported system"}. Required standing: ${standing(example)}. ${poolDescription(example, bp)}.\n\n` : "";
  return { text: `${quickAnswer}**${clean(bp.output_name)} blueprint**: ${refs.length ? `listed in ${refs.length} mission variants. Variants with identical reported requirements are grouped. The missions below are alternatives, not a chain you must complete in full. A pool drop chance is not the chance of receiving this specific blueprint.` : "no unlocking missions are listed by this source. This does not establish that it cannot be obtained."}${refs.length > selected.length ? ` Showing ${selected.length} variants; see the source for all missions.` : ""}${missions.some(m => !m) ? " Some mission details could not be fetched." : ""}${(bp.unlocking_missions?.length || 0) > refs.length ? " Some unlocking missions have no valid API link and cannot be traced." : ""}\n\n${progression.text} ${progression.notes.join(" ")}\n\n${source("blueprints", bp.uuid, bp.game_version)}`, table: progressionFirst && progression.rows.length ? { headers: ["Path / branch", "Mission / requirement", "Required standing", "How to proceed", "Game patch"], rows: progression.rows } : rows.length ? { headers: ["Mission", "Systems", "Required standing", "Immediate prerequisites", "Blueprint reward"], rows } : undefined, tables: progression.rows.length ? [{ title: progressionFirst ? "Alternative reward missions" : "Progression steps (each option is separate)", headers: progressionFirst ? ["Mission", "Systems", "Required standing", "Immediate prerequisites", "Blueprint reward"] : ["Path / branch", "Mission / requirement", "Required standing", "How to proceed", "Game patch"], rows: progressionFirst ? rows : progression.rows }] : undefined };
}
async function missionAnswer(m: Mission, progressionFirst = false): Promise<ChatResponse> {
  const progression = await missionProgression([m], m.game_version);
  const lead = progressionFirst ? `**${clean(m.title)}**: ${prerequisites(m)}. Required standing: ${standing(m)}.` : `**${clean(m.title)}** — ${clean(m.mission_giver)}. Systems: ${m.star_systems?.map(clean).join(", ") || "Not reported"}.`;
  const pools = (m.blueprints || []).flatMap(p => (p.items || []).map(i => [clean(i.name), typeof p.drop_chance_percent === "number" ? `${number(p.drop_chance_percent)}%` : "Not reported", String(p.items?.length || 0)]));
  return { text: `${lead}\n\nRequired standing: ${standing(m)}.\n\nImmediate prerequisites: ${prerequisites(m)}. ${progression.text} ${progression.notes.join(" ")}\n\n${pools.length ? "Blueprint rewards below belong to reward pools. Pool chance does not guarantee a specific blueprint." : "No blueprint rewards listed."}\n\n${source("missions", m.uuid, m.game_version)}`, table: progressionFirst ? { headers: ["Path / branch", "Mission / requirement", "Required standing", "How to proceed", "Game patch"], rows: progression.rows } : pools.length ? { headers: ["Blueprint", "Reported pool drop chance", "Blueprints in pool"], rows: pools } : undefined, tables: progressionFirst ? (pools.length ? [{title: "Blueprint reward pools", headers: ["Blueprint", "Reported pool drop chance", "Blueprints in pool"], rows:pools}] : undefined) : progression.rows.length ? [{ title: "Prerequisite progression", headers: ["Path / branch", "Mission / requirement", "Required standing", "How to proceed", "Game patch"], rows: progression.rows }] : undefined };
}
export async function buildCraftingAnswer(query: ParsedQuery): Promise<ChatResponse> {
  if (!query.itemName) return { text: ["mission_info", "mission_prerequisites"].includes(query.intent) ? 'Which mission? Try “Tell me about the Blackbox Retrieval mission”.' : 'Which item? Try “What materials do I need to craft an XL-1 quantum drive?” or “How do I unlock the XL-1 blueprint?”' };
  try {
    if (["mission_info", "mission_prerequisites"].includes(query.intent)) {
      const found = await searchMissions(query.itemName, query.gameVersion);
      const matches = found.data.filter(m => normal(m.title || "") === normal(query.itemName!));
      if (query.intent === "mission_prerequisites" && matches.length > 1) {
        const selected = matches.slice(0, 20);
        const version = query.gameVersion || selected[0].game_version;
        const missions: Mission[] = [];
        for (let i = 0; i < selected.length; i += 4) {
          const loaded = await Promise.all(selected.slice(i, i + 4).map(m => getMission(m.uuid, version).catch(() => null)));
          missions.push(...loaded.filter((m): m is Mission => m !== null && (!version || m.game_version === version)));
        }
        const progression = await missionProgression(missions, version);
        return { text: `**${clean(query.itemName)}**: prerequisite paths for ${missions.length} fetched mission variants. These variants are alternatives, not missions you must all complete. ${progression.text} ${progression.notes.join(" ")}${missions.length < selected.length ? " Some mission variants could not be verified." : ""}${matches.length > selected.length ? " Showing only the first 20 variants." : ""}`,
          table: progression.rows.length ? { headers: ["Path / branch", "Mission / requirement", "Required standing", "How to proceed", "Game patch"], rows: progression.rows } : undefined };
      }
      if (matches.length === 1 || found.data.length === 1) {
        const m = matches[0] || found.data[0];
        return await missionAnswer(await getMission(m.uuid, m.game_version), query.intent === "mission_prerequisites");
      }
      return { text: found.data.length ? `Found ${found.meta?.total ?? found.data.length} mission variants. Choose a more specific mission title; similarly named variants may have different requirements. Source: Star Citizen Wiki API.` : `No mission matches **${clean(query.itemName)}** in the Wiki API's selected game version.`, table: found.data.length ? { headers: ["Mission", "Giver", "Systems", "Game patch"], rows: found.data.map(m => [clean(m.title) + `{{wiki:missions/${m.uuid}}}`, clean(m.mission_giver), m.star_systems?.map(clean).join(", ") || "Not reported", clean(m.game_version)]) } : undefined };
    }
    const found = await searchBlueprints(query.itemName, query.gameVersion);
    const exact = found.data.filter(bp => normal(bp.output_name || "") === normal(query.itemName!));
    if (exact.length !== 1 && found.data.length !== 1) return { text: found.data.length ? `Found ${found.meta?.total ?? found.data.length} blueprints matching **${clean(query.itemName)}**. Specify an exact item name. Showing up to 30 matches from Star Citizen Wiki API.` : `No blueprint matches **${clean(query.itemName)}** in the Wiki API's selected game version. It may be unlisted or not craftable in that version.`, table: found.data.length ? { headers: ["Crafted item", "Game patch"], rows: found.data.map(bp => [clean(bp.output_name) + `{{wiki:blueprints/${bp.uuid}}}`, clean(bp.game_version)]) } : undefined };
    const match = exact[0] || found.data[0];
    const bp = await getBlueprint(match.uuid, query.gameVersion || match.game_version);
    return query.intent === "craft_recipe" ? recipe(bp) : await unlock(bp, query.intent === "blueprint_progression");
  } catch {
    return { text: "Couldn't retrieve blueprint or mission data from the Star Citizen Wiki API. Please try again shortly. No recipe or unlock requirements have been inferred." };
  }
}
