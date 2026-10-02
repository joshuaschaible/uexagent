import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
const asUrl=source=>`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const patch="4.10.1";
const state={missions:new Map(),calls:[]};
globalThis.__progressionFixture=state;
const actualClient=await readFile(new URL("../src/lib/game-wiki-client.ts",import.meta.url),"utf8");
const wikiIdCode=actualClient.slice(actualClient.indexOf("export function wikiId"),actualClient.indexOf("export function searchBlueprints"));
const client=asUrl('const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;'+wikiIdCode+`export async function getMission(id,version) { globalThis.__progressionFixture.calls.push({id,version}); const m=globalThis.__progressionFixture.missions.get(id); if(!m) throw new Error("Missing");return m; }`);
const {missionProgression}=await import(asUrl((await readFile(new URL("../src/lib/mission-progression.ts",import.meta.url),"utf8")).replaceAll('"./game-wiki-client"',JSON.stringify(client))));
const m=(n,fields={})=>({uuid:id(n),title:"Mission "+n,game_version:patch,prerequisite_groups:[],...fields});
const ref=n=>({uuid:id(n),title:"Mission "+n});
function reset(missions){state.calls=[];state.missions=new Map(missions.map(m=>[m.uuid,m]));}

test("recursive prerequisites retain alternatives, variant branches, tags, exclusions and standing",async()=>{
 const root=m(1,{prerequisite_groups:[{required_count:1,required_tags:[{name:"Intro"}],excluded_tags:[{name:"AlreadyDone"}],missions:[{...ref(2),variants:[{uuid:id(3)}]},ref(4)]}]});
 const starter=m(2,{prerequisite_groups:[{required_count:1,missions:[ref(5)]}]});
 reset([starter,m(3),m(4),m(5,{reputation_prerequisite:{faction:"Guild",scope:"Hauling",min_standing:{name:"Member",min_reputation:800}}})]);
 const result=await missionProgression([root],patch);
 assert.ok(result.rows.find(r=>r[3].includes("Required count: 1")&&r[3].includes("Intro")&&r[3].includes("AlreadyDone")));
 assert.ok(result.rows.find(r=>r[0].includes("variant 2")&&r[1].includes("Mission 3")));
 assert.ok(result.rows.find(r=>r[1].includes("Mission 5")&&r[2].includes("Member (800")));
 assert.ok(result.rows.findIndex(r=>r[1].includes("Mission 5"))<result.rows.findIndex(r=>r[1].startsWith("Mission 2")));
 assert.equal(state.calls.length,4);
 assert.ok(state.calls.every(call=>call.version===patch));
 assert.match(result.text,/alternatives/);
});

test("cycles, unresolved tags, invalid links and patch mismatches cannot fabricate missing steps",async()=>{
 const root=m(1,{prerequisite_groups:[{required_count:1,missions:[ref(2)]},{required_count:1,required_tags:[{name:"UnresolvedTag"}]},{missions:[{title:"Broken",link:"https://evil.example/missions/"+id(4)}]}]});
 reset([m(2,{prerequisite_groups:[{missions:[ref(1),ref(3)]}]}),m(3,{game_version:"old-patch"})]);
 const result=await missionProgression([root],patch);
 assert.match(result.notes.join(" "),/cycle/);
 assert.match(result.notes.join(" "),/no linked missions/);
 assert.ok(result.rows.some(r=>r[3].includes("patch differs")));
 assert.ok(result.rows.some(r=>r[3].includes("link missing")));
 assert.equal(state.calls.filter(c=>c.id===id(1)).length,0);
});

test("shared prerequisites load once and request/display limits bound large graphs",async()=>{
 const refs=Array.from({length:100},(_,i)=>ref(i+2));
 const root=m(1,{prerequisite_groups:[{missions:refs},{missions:refs}]});
 reset(refs.map((_,i)=>m(i+2)));
 const result=await missionProgression([root],patch);
 assert.ok(state.calls.length<=47);
 assert.equal(new Set(state.calls.map(c=>c.id)).size,state.calls.length);
 assert.ok(result.rows.length<=200);
 assert.match(result.notes.join(" "),/limit/);
});

test("deep graphs stop explicitly and missing prerequisite data differs from an empty list",async()=>{
 const chain=Array.from({length:12},(_,i)=>m(i+1,{prerequisite_groups:[{missions:[ref(i+2)]}]}));
 reset(chain.slice(1));
 const result=await missionProgression([chain[0]],patch);
 assert.match(result.notes.join(" "),/Depth limit/);
 const missing=await missionProgression([m(30,{prerequisite_groups:undefined})],patch);
 assert.match(missing.notes.join(" "),/does not prove/);
 const empty=await missionProgression([m(31)],patch);
 assert.ok(empty.rows.some(r=>r[3].includes("No prerequisite missions listed")));
});
