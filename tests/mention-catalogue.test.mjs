import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");
const asUrl = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const fixture = JSON.parse(await read("tests/fixtures/mentions.json"));
const components = JSON.parse(await read("tests/fixtures/components.json"));
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const reference = {
 ...fixture,
 commodityMap: new Map(fixture.commodities.map(item => [normalize(item.name),item])),
 vehicleMap: new Map(fixture.vehicles.flatMap(item => [[normalize(item.name),item],[normalize(item.name_full || item.name),item]])),
 starSystemMap: new Map(fixture.starSystems.map(item => [normalize(item.name),item])),
};
globalThis.__mentionCatalogue = { reference, fixture, components };
const cacheSource = stripTypeScriptTypes(await read("src/lib/data/cache.ts")).replace(/^import[\s\S]*?from "[^"]+";/gm, "").replace("export async function getReferenceData(", "async function ignoredGetReferenceData(");
const cacheUrl = asUrl(cacheSource + "\nexport async function getReferenceData() { return globalThis.__mentionCatalogue.reference; }");
const geoUrl = asUrl(`export async function getMiningData() { return globalThis.__mentionCatalogue.fixture; }`);
const equipmentUrl = asUrl(`export async function getEquipmentSuggestions(query) { return globalThis.__mentionCatalogue.components.items.filter(item => item.name.toLowerCase().replace(/[^a-z0-9]/g,"").includes(query.toLowerCase().replace(/[^a-z0-9]/g,""))); }`);
const nextUrl = asUrl(`export const NextResponse = { json: value => new Response(JSON.stringify(value), {headers:{"Content-Type":"application/json"}}) };`);
const securityUrl = asUrl(`export const MAX_NAME_LENGTH=300; export function assertTrustedHost() {} export class RequestError extends Error {} export function requestErrorResponse(e) { throw e; }`);
const routeUrl = asUrl((await read("src/app/api/suggest/route.ts")).replaceAll('"next/server"',JSON.stringify(nextUrl)).replaceAll('"@/lib/data/cache"',JSON.stringify(cacheUrl)).replaceAll('"@/lib/data/mining"',JSON.stringify(geoUrl)).replaceAll('"@/lib/equipment-client"',JSON.stringify(equipmentUrl)).replaceAll('"@/lib/request-security"',JSON.stringify(securityUrl)));
const { GET } = await import(routeUrl);
const { filterMentionSuggestions, insertMention } = await import(asUrl(await read("src/lib/mention-input.ts")));
const cache = await import(cacheUrl);
const parserUrl = asUrl((await read("src/lib/query-parser.ts")).replaceAll('"@/lib/data/cache"',JSON.stringify(cacheUrl)).replaceAll('"@/lib/data/mining"',JSON.stringify(geoUrl)));
const { enrichQueryLocations } = await import(parserUrl);

const types = [
 ["commodity",fixture.commodities.filter(item => item.is_available)],
 ["ship",fixture.vehicles.map(item => ({...item,name:item.name_full || item.name}))],
 ["system",fixture.starSystems],
 ["station",fixture.terminals],
 ["planet",fixture.planets],
 ["moon",fixture.moons],
 ["orbit",fixture.orbits],
 ["poi",fixture.pointsOfInterest],
 ["item",components.items],
];

test("every eligible catalogue record is searchable and inserts into a draft without changing its name", async t => {
 const all = await (await GET(new Request("http://127.0.0.1:3000/api/suggest?q=*&typed=1"))).json();
 assert.equal(new Set(all.map(item => item.type+":"+item.name.toLowerCase())).size,all.length,"Duplicate typed suggestions");
 for (const [type,items] of types) {
  await t.test(type, async t => {
   for (const item of items) {
    await t.test(item.name+" ["+item.id+"]", () => {
     assert.ok(all.some(s => s.name.toLowerCase() === item.name.toLowerCase() && s.type === type),"Missing initial mention");
     for (const variant of new Set([item.name,item.name.toLowerCase(),item.name.replace(/-/g," "),item.name.replace(/[\s-]/g,"")])) {
      assert.ok(filterMentionSuggestions(all,variant).some(s => s.name.toLowerCase()===item.name.toLowerCase() && s.type===type),"Search missing: "+variant);
     }
     const inserted = item.name + (type === "orbit" ? " orbit" : type === "poi" ? " point of interest" : "");
     assert.equal(insertMention("Where can I find @query",item.name,type),"Where can I find "+inserted+" ");
     assert.equal(insertMention("@query",item.name,type),inserted+" ");
    });
   }
  });
 }
});

test("canonical commodity, ship, and system names resolve to a matching catalogue identity", () => {
 for (const item of fixture.commodities.filter(item=>item.is_available)) {
  const actual=cache.findCommodity(item.name,reference.commodityMap);
  assert.equal(normalize(actual?.name || ""),normalize(item.name));
 }
 for (const item of fixture.vehicles) {
  const actual=cache.findVehicle(item.name_full || item.name,reference.vehicleMap);
  assert.equal(normalize(actual?.name_full || actual?.name || ""),normalize(item.name_full || item.name));
 }
 for (const item of fixture.starSystems) assert.equal(cache.findStarSystem(item.name,reference.starSystemMap)?.id,item.id);
});

test("all canonical locations resolve or ask a clarification for shared catalogue names", async t => {
 for (const [type,items] of types.filter(([type])=>["planet","moon","orbit","poi","station"].includes(type))) {
  await t.test(type, async () => {
   for(const item of items) {
    const name = type === "orbit" ? item.name+" orbit" : type === "poi" ? item.name+" point of interest" : item.name;
    const result = await enrichQueryLocations({intent:"price_check",locationName:name,raw:"",modifiers:[]});
    if (result.locationError) {
     assert.match(result.locationError,/multiple (?:shops|locations)/,"Unresolved "+type+": "+item.name);
     continue;
    }
    const resolved = result.terminal?.name || result.planet?.planetName || result.moon?.moonName || result.orbit?.orbitName || result.poi?.poiName || result.station?.stationName || result.city?.cityName || result.starSystem?.name;
    assert.equal(normalize(resolved || ""),normalize(item.name),"Wrong location for "+type+": "+item.name);
   }
  });
 }
});

test("mentions keep duplicate types visible and preserve exact-name ranking", () => {
 const choices=[{name:"Example",type:"planet"},{name:"Example",type:"station"},{name:"Example Long",type:"station"}];
 assert.deepEqual(filterMentionSuggestions(choices,"Example").slice(0,2),choices.slice(0,2));
 assert.equal(insertMention("Tell me about @query","A Shop's (Station)"),"Tell me about A Shop's (Station) ");
 assert.deepEqual(filterMentionSuggestions(choices,"ImaginaryPlace999999"),[]);
});

test("duplicate points of interest require a parent instead of silently picking an ID", async () => {
 const ambiguous = await enrichQueryLocations({intent:"price_check",locationName:"Mining Base #XJZ-JR2 point of interest",raw:"",modifiers:[]});
 assert.match(ambiguous.locationError,/multiple locations/);
 const records=fixture.pointsOfInterest.filter(item=>item.name==="Mining Base #XJZ-JR2");
 for (const item of records) {
  const parent=fixture.orbits.find(orbit=>orbit.id===item.id_orbit);
  assert.ok(parent);
  const query=await enrichQueryLocations({intent:"price_check",locationName:item.name+" in "+parent.name+" point of interest",raw:"",modifiers:[]});
  assert.equal(query.poi?.poiId,item.id);
 }
});

test("selected orbit mentions retain their type when a planet shares the name", async () => {
 const inserted=insertMention("Tell me about @ArcCorp","ArcCorp","orbit");
 assert.equal(inserted,"Tell me about ArcCorp orbit ");
 const result=await enrichQueryLocations({intent:"location_info",raw:inserted,modifiers:[]});
 const orbit=fixture.orbits.find(item=>item.name==="ArcCorp");
 assert.equal(result.orbit?.orbitId,orbit.id);
 assert.equal(result.planet,undefined);
 const planet=await enrichQueryLocations({intent:"location_info",raw:insertMention("Tell me about @ArcCorp","ArcCorp","planet"),modifiers:[]});
 assert.equal(planet.planet?.planetId,fixture.planets.find(item=>item.name==="ArcCorp").id);
});
