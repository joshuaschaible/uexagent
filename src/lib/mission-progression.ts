import { getMission, wikiId, type Mission, type MissionReference } from "./game-wiki-client";
const MAX_MISSIONS = 48, MAX_DEPTH = 8, MAX_ROWS = 200;
const clean = (value?: string) => value?.replace(/[{}*<>]/g, "").slice(0,240) || "Not reported";
export function prerequisiteChoices(ref: MissionReference): { id?: string; title?: string }[] {
  const id = wikiId(ref.link, "missions") || wikiId(`https://api.star-citizen.wiki/missions/${ref.uuid}`, "missions");
  return [{id,title:ref.title}, ...(ref.variants || []).map(variant => ({id:wikiId(variant.link,"missions") || wikiId(`https://api.star-citizen.wiki/missions/${variant.uuid}`,"missions"),title:ref.title}))];
}
export function missionStanding(m: Mission): string {
  const rep=m.reputation_prerequisite;
  if(!rep?.min_standing) return "Not reported";
  return `${clean(rep.faction)} / ${rep.scope?.startsWith("MissionProviderReputation_") ? "Mission standing" : clean(rep.scope)}: ${clean(rep.min_standing.name)}${typeof rep.min_standing.min_reputation === "number" ? ` (${rep.min_standing.min_reputation.toLocaleString("en-US")} reputation)` : ""}`;
}
export async function missionProgression(roots: Mission[], version?: string) {
  const nodes=new Map<string,Mission>(roots.map(m=>[m.uuid,m]));
  const failures=new Map<string,string>();
  const notes=new Set<string>();
  let frontier=roots, depth=0;
  while(frontier.length && depth++ < MAX_DEPTH) {
    const refs=frontier.flatMap(m => (m.prerequisite_groups || []).flatMap(g => (g.missions || []).flatMap(prerequisiteChoices)));
    const ids=[...new Set(refs.flatMap(ref=>ref.id && !nodes.has(ref.id) && !failures.has(ref.id) ? [ref.id] : []))];
    const allowed=ids.slice(0,Math.max(0,MAX_MISSIONS-nodes.size));
    if(allowed.length<ids.length) notes.add("Mission lookup limit reached; some prerequisites remain unresolved.");
    const next:Mission[]=[];
    for(let i=0;i<allowed.length;i+=4) {
      await Promise.all(allowed.slice(i,i+4).map(async id=>{
        try {
          const mission=await getMission(id,version);
          if(mission.uuid !== id || (version && mission.game_version !== version)) throw new Error("Patch mismatch");
          nodes.set(id,mission);next.push(mission);
        } catch { failures.set(id,"Details unavailable or game patch differs; progression stops here."); }
      }));
    }
    frontier=next;
  }
  if(frontier.length) notes.add("Depth limit reached; deeper prerequisites remain unresolved.");
  const rows:string[][]=[];
  const addRow=(row:string[]) => { if(rows.length<MAX_ROWS) rows.push(row); else notes.add("Display limit reached; this is a partial progression."); };
  function visit(ref:{id?:string;title?:string},path:string,ancestors:Set<string>,level:number) {
    if(rows.length>=MAX_ROWS) { notes.add("Display limit reached; this is a partial progression.");return; }
    const m=ref.id ? nodes.get(ref.id) : undefined;
    const label=clean(m?.title || ref.title)+(ref.id ? `{{wiki:missions/${ref.id}}}` : "");
    if(!ref.id || !m) {
      addRow([path,label,"Not reported",ref.id ? failures.get(ref.id) || "Not loaded; progression stops here." : "Mission link missing; progression stops here.","Not reported"]);
      notes.add("Some prerequisite records could not be resolved; no missing steps have been inferred.");return;
    }
    if(ancestors.has(ref.id)) { addRow([path,label,missionStanding(m),"Cycle detected; progression stops here.",clean(m.game_version)]);notes.add("A prerequisite cycle was detected.");return; }
    if(level>=MAX_DEPTH) { addRow([path,label,missionStanding(m),"Depth limit reached; prerequisites not expanded.",clean(m.game_version)]);return; }
    const nextAncestors=new Set([...ancestors,ref.id]);
    const groups=m.prerequisite_groups;
    if(!Array.isArray(groups)) notes.add("Some missions have no prerequisite data; this does not prove they have no requirements.");
    (groups || []).slice(0,20).forEach((group,groupIndex)=>{
      const groupPath=`${path} / group ${groupIndex+1}`;
      const tags=(group.required_tags || []).map(t=>clean(t.name));
      const excluded=(group.excluded_tags || []).map(t=>clean(t.name));
      const count=group.required_count;
      const requirement=`Required count: ${typeof count==="number" ? count : "not reported"}${tags.length ? `; completion tags: ${tags.join(", ")}` : ""}${excluded.length ? `; excluded tags: ${excluded.join(", ")}` : ""}`;
      addRow([groupPath,"Prerequisite group","—",requirement,clean(m.game_version)]);
      if(!(group.missions || []).length) {
        notes.add("Some completion tags have no linked missions; those steps cannot be expanded.");
        return;
      }
      (group.missions || []).slice(0,30).forEach((child,index)=>{
        prerequisiteChoices(child).forEach((variant,v)=>{
          visit(variant,`${groupPath} / choice ${index+1}${v ? ` variant ${v+1}` : ""}`,nextAncestors,level+1);
        });
      });
    });
    if(rows.length<MAX_ROWS) addRow([path,label,missionStanding(m),Array.isArray(groups) ? groups.length ? "Review the reported prerequisite groups before this mission; choices are branches, not a flat checklist." : "No prerequisite missions listed; other eligibility requirements may apply." : "Prerequisite data not reported.",clean(m.game_version)]);
  }
  roots.forEach((root,index)=>visit({id:root.uuid,title:root.title},`Option ${index+1}`,new Set(),0));
  return { rows, notes:[...notes], text:"Read each option separately, from its prerequisites toward the reward mission. Group counts apply to completion requirements; mission variants and choices are alternatives. Multiple groups are kept separate because their combined eligibility rules are not fully specified by this source." };
}
