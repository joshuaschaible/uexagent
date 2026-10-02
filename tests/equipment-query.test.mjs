import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const asUrl = (source) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const gold = { id: 1, name: "Gold", code: "GOLD" };
const laranite = { id: 2, name: "Laranite", code: "LARA" };
const rmc = { id: 3, name: "Recycled Material Composite", code: "RMC" };
const scrap = { id: 4, name: "Scrap", code: "SCRA" };
const aluminum = { id: 5, name: "Aluminum", code: "ALUM" };
const aluminumOre = { id: 6, name: "Aluminum (Ore)", code: "ALUMORE", id_parent: 5 };
const vulture = { id: 1, name: "Vulture", name_full: "Drake Vulture" };
const reclaimer = { id: 2, name: "Reclaimer", name_full: "Aegis Reclaimer" };
const stanton = { id: 1, name: "Stanton" };
const pyro = { id: 2, name: "Pyro" };
const terminal = { id: 12, name: "TDD Area 18", code: "TDA18", planet_name: "ArcCorp", id_planet: 2, city_name: "Area 18", id_city: 3, star_system_name: "Stanton", id_star_system: 1, id_orbit: 5, is_available: 1 };
const reference = { commodities: [gold, laranite, rmc, scrap], commodityMap: new Map([["gold", gold], ["laranite", laranite], ["recycled material composite", rmc], ["rmc", rmc], ["scrap", scrap]]), starSystems: [stanton, pyro], starSystemMap: new Map([["stanton", stanton], ["pyro", pyro]]), terminals: [terminal], vehicles: [vulture, reclaimer], vehicleMap: new Map([["vulture", vulture], ["reclaimer", reclaimer]]) };
reference.commodities.push(aluminum, aluminumOre);
reference.commodityMap.set("aluminum", aluminum);
reference.commodityMap.set("aluminumore", aluminumOre);
reference.starSystemMap.set("min", {id:9,name:"Min"});
reference.terminals.push({id:99,name:"Buy and Fly - Ruin Station",star_system_name:"Pyro",id_star_system:2});
reference.terminals.push({id:100,name:"New Deal - Teasa Spaceport - Lorville",city_name:"Lorville",id_city:4,planet_name:"Hurston",id_planet:1,star_system_name:"Stanton",id_star_system:1});
const state = { reference, loads: 0 };
globalThis.__equipmentQueryFixture = state;
const cacheSource = stripTypeScriptTypes(await read("src/lib/data/cache.ts")).replace(/^import[\s\S]*?from "[^\"]+";/gm, "")
  .replace("export async function getReferenceData(", "async function ignoredGetReferenceData(");
const cacheUrl = asUrl(cacheSource + "\nexport const getReferenceData = async () => globalThis.__equipmentQueryFixture.reference;");
const geoUrl = asUrl(`export async function getMiningData() { globalThis.__equipmentQueryFixture.loads++; return { planets: [{id:3,name:'Vatra'}], moons: [{id:4,name:'Adir'}], orbits: [{id:5,name:'Aaron Halo',is_lagrange:0,is_asteroid:1}], pointsOfInterest: [{id:6,name:'Pyro Gateway',is_monitored:0}] }; }`);
const parserUrl = asUrl((await read("src/lib/query-parser.ts")).replaceAll('"@/lib/data/cache"', JSON.stringify(cacheUrl)).replaceAll('"@/lib/data/mining"', JSON.stringify(geoUrl)));
const { parseQuery, enrichQueryLocations } = await import(parserUrl);
const contextUrl = asUrl((await read("src/lib/context-resolver.ts")).replaceAll('"./query-parser"', JSON.stringify(parserUrl)));
const { resolveContext } = await import(contextUrl);
const parse = (text) => parseQuery(text, reference.commodityMap, reference.starSystemMap, reference.terminals, reference.vehicleMap);
const resolve = (text, history) => resolveContext(parse(text), history.map((text) => ({ role: "user", text })), parse);

test("natural reference paraphrases preserve actions, names, sizes, and categories", () => {
  const cases = [
    ["Which shops sell S2 power plants?", "equipment_buy", "power plants", undefined, 2],
    ["Could you show me size two coolers?", "equipment_info", "coolers", undefined, 2],
    ["I need a quantum drive for a size-two slot. Where can I get one?", "equipment_buy", "quantum drives", undefined, 2],
    ["Which vendors carry XL1 quantum drive?", "equipment_buy", "quantum drives", "XL1", undefined],
    ["Please list S 2 shields", "equipment_info", "shield generators", undefined, 2],
    ["Where can I buy a quantum drive Imaginary888?", "equipment_buy", "quantum drives", "Imaginary888", undefined],
    ["What do I need to make an XL one quantum drive?", "craft_recipe", undefined, "XL-1", undefined],
    ["Materials required for an XL1 quantum drive", "craft_recipe", undefined, "XL-1", undefined],
    ["Which missions reward the XL1 blueprint?", "blueprint_unlock", undefined, "XL-1", undefined],
    ["Tell me about the Blackbox Retrieval mission", "mission_info", undefined, "Blackbox Retrieval", undefined],
  ];
  for (const [text, intent, category, item, size] of cases) {
    const result = parse(text);
    assert.deepEqual([result.intent, result.equipmentCategory, result.itemName, result.equipmentSize], [intent, category, item, size], text);
  }
  for (const text of ["Where would I find Aluminum deposits?", "Is Aluminum mineable on Hurston?"]) {
    const result = parse(text);
    assert.equal(result.intent, "mining_locations", text);
    assert.equal(result.commodity.id, aluminum.id, text);
  }
  const resetSubject = resolve("Show all size two quantum drives and where I can buy them", ["Tell me about quantum drive Atlas"]);
  assert.equal(resetSubject.itemName, undefined);
  assert.equal(resetSubject.equipmentSize, 2);
});

test("equipment size filters remain separate from item names and shopping intent", () => {
  for (const size of ["size two", "size 2", "S2"]) {
    const result = parse(`Show me all ${size} power plants and where I can buy them`);
    assert.equal(result.equipmentSize, 2);
    assert.equal(result.equipmentCategory, "power plants");
    assert.equal(result.intent, "equipment_buy");
    assert.equal(result.itemName, undefined);
  }
  const best = parse("What is the best size two quantum drive?");
  assert.equal(best.equipmentSize, 2);
  assert.equal(best.itemName, undefined);
  assert.equal(parse("Where can I buy a quantum drive XL-1?").equipmentSize, undefined);
  const followup = resolve("Where can I buy them?", ["Show size 2 power plants"]);
  assert.equal(followup.equipmentSize, 2);
  assert.equal(resolve("Show quantum drives", ["Show size 2 power plants"]).equipmentSize, undefined);
});

test("fresh reference questions do not inherit old commodity, ship or location constraints", () => {
  const history = ["Where can I sell Laranite in Pyro?", "Tell me about the Vulture"];
  for (const text of ["What ships can I buy?", "What space stations have a refinery?", "What are the refining methods?", "Show mining lasers"]) {
    const result = resolve(text, history);
    assert.equal(result.commodity, undefined, text);
    assert.equal(result.vehicle, undefined, text);
    assert.equal(result.starSystem, undefined, text);
  }
  const followUp = resolve("Where can I sell it?", ["Where can I buy Laranite in Pyro?"]);
  assert.equal(followUp.commodity.id, laranite.id);
  assert.equal(followUp.starSystem.id, pyro.id);
});

test("ship inventories resolve shop short names and qualified location typos", async () => {
  for (const location of ["new deal", "New Deal in Lorville", "new deal in lorville"]) {
    const query = await enrichQueryLocations(parse(`What ships can I buy at ${location}`));
    assert.equal(query.intent, "vehicle_buy");
    assert.equal(query.terminal.id, 100);
    assert.equal(query.locationError, undefined);
  }
  const wrongCity = await enrichQueryLocations(parse("What ships can I buy at New Deal in Area 18"));
  assert.equal(wrongCity.terminal, undefined);
  assert.match(wrongCity.locationError, /couldn't match/);
  const duplicate = {...reference.terminals.at(-1),id:101,city_name:"Area 18",id_city:3};
  reference.terminals.push(duplicate);
  try {
    assert.match((await enrichQueryLocations(parse("What ships can I buy at New Deal"))).locationError, /multiple shops/);
    assert.equal((await enrichQueryLocations(parse("What ships can I buy at New Deal in Lorville"))).terminal.id, 100);
  } finally { reference.terminals.pop(); }
});

test("Aluminum questions cannot invent Min or Buy and Fly, and both trade directions are shown", () => {
  const trade = parse("Where can I buy and sell Aluminum");
  assert.equal(trade.intent, "price_check");
  assert.equal(trade.commodity.id, aluminum.id);
  assert.equal(trade.starSystem, undefined);
  assert.equal(trade.terminal, undefined);
  const refinery = resolve("Where is the best place to refine Aluminum (Ore)", ["Where can I buy and sell Aluminum"]);
  assert.equal(refinery.intent, "refinery_yields");
  assert.equal(refinery.commodity.id, aluminumOre.id);
  assert.equal(refinery.starSystem, undefined);
  assert.equal(refinery.terminal, undefined);
  assert.equal(resolve(refinery.raw, ["Where can I buy Gold in Pyro?"]).starSystem, undefined);
  assert.equal(parse("Where to refine Aluminum (Ore) in Min?").starSystem.name, "Min");
  assert.equal(parse("Can I sell Aluminum at Buy and Fly - Ruin Station?").terminal.id, 99);
});

test("LLM location entities must be whole names explicitly mentioned in the question", async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const sdkUrl = asUrl(`export default class OpenAI { chat = { completions: { create: async () => ({choices:[{message:{content:JSON.stringify({intent:'refinery_yields',confidence:0.99,entities:{commodity:'Aluminum (Ore)',star_system:'Min',location:'Min',terminal:'Buy and Fly - Ruin Station'}})}}]}) } }; }`);
  const classifierUrl = asUrl((await read("src/lib/llm-classifier.ts")).replaceAll('"openai"', JSON.stringify(sdkUrl))
    .replaceAll('"./query-parser"', JSON.stringify(parserUrl)).replaceAll('"./data/cache"', JSON.stringify(cacheUrl)));
  const { classifyWithLLM } = await import(classifierUrl);
  const result = await classifyWithLLM("Where is the best place to refine Aluminum (Ore)", reference);
  assert.equal(result.intent, "refinery_yields");
  assert.equal(result.commodity.id, aluminumOre.id);
  assert.equal(result.starSystem, undefined);
  assert.equal(result.locationName, undefined);
  assert.equal(result.terminal, undefined);
  const shopping = await enrichQueryLocations(await classifyWithLLM("What ships can I buy at new deal in lorville", reference));
  assert.equal(shopping.intent, "vehicle_buy");
  assert.equal(shopping.terminal.id, 100);
});

test("equipment queries preserve item names, compare targets, categories and shopping locations", () => {
  const comparison = parse("Compare Lancet MH2 vs Arbor MH1");
  assert.equal(comparison.intent, "equipment_compare");
  assert.equal(comparison.itemName, "Lancet MH2");
  assert.equal(comparison.itemName2, "Arbor MH1");
  const buy = parse("Where can I buy Lancet MH2 on Hurston?");
  assert.equal(buy.intent, "equipment_buy");
  assert.equal(buy.itemName, "Lancet MH2");
  assert.equal(buy.locationName, "Hurston");
  const category = parse("Mining laser heads on Hurston");
  assert.equal(category.itemName, undefined);
  assert.equal(category.equipmentCategory, "mining lasers");
  assert.equal(parse("Where to buy quantum drive Atlas?").itemName, "Atlas");
  assert.equal(parse("Show armor helmets").equipmentCategory, "helmets");
  assert.equal(parse("Show armor helmets").itemName, undefined);
  assert.equal(parse("Can I buy Lancet MH2?").itemName, "Lancet MH2");
  const commodityPurchase = parse("Can I buy Laranite at ArcCorp Mining Area 045?");
  assert.equal(commodityPurchase.intent, "buy");
  assert.equal(commodityPurchase.commodity.id, laranite.id);
});

test("equipment context can switch to shopping, change scope, and browse a different category", () => {
  const buy = resolve("Where can I buy it?", ["Lancet MH2 specs"]);
  assert.equal(buy.intent, "equipment_buy");
  assert.equal(buy.itemName, "Lancet MH2");
  const moved = resolve("What about on Vatra?", ["Where can I buy Lancet MH2 on Hurston?"]);
  assert.equal(moved.itemName, "Lancet MH2");
  assert.equal(moved.locationName, "Vatra");
  assert.equal(moved.planet, undefined);
  const category = resolve("Show mining modules", ["Lancet MH2 specs"]);
  assert.equal(category.itemName, undefined);
  assert.equal(category.equipmentCategory, "mining modules");
});

test("scraper modules resolve spelling variants, catalogue requests, named items, and comparisons", () => {
  for (const text of ["Show scraper modules", "Show scrapper modules", "List salvage modules", "Show scraper beams", "Show hull scraping modules"]) {
    const parsed = parse(text);
    assert.equal(parsed.intent, "equipment_info", text);
    assert.equal(parsed.equipmentCategory, "scraper beams", text);
    assert.equal(parsed.itemName, undefined, text);
    assert.equal(parsed.commodity, undefined, text);
  }
  for (const name of ["Abrade", "Cinch", "Trawler", "ReadyGrip", "Ready Grip"]) {
    const parsed = parse(`Tell me about ${name}`);
    assert.equal(parsed.intent, "equipment_info", name);
    assert.equal(parsed.equipmentCategory, "scraper beams", name);
    assert.equal(parsed.itemName, name);
  }
  const buy = parse("Where can I buy Abrade scrapper module in Orison?");
  assert.equal(buy.intent, "equipment_buy");
  assert.equal(buy.itemName, "Abrade");
  assert.equal(buy.locationName, "Orison");
  const comparison = parse("Compare Abrade scraper module vs Trawler scraper module");
  assert.equal(comparison.intent, "equipment_compare");
  assert.equal(comparison.itemName, "Abrade");
  assert.equal(comparison.itemName2, "Trawler");
  const beams = parse("Show salvage beams");
  assert.equal(beams.equipmentCategory, "salvage beams");
  assert.equal(beams.itemName, undefined);
  assert.notEqual(parse("Show salvage heads").equipmentCategory, "salvage beams");
});

test("scraper equipment follow-ups preserve item and location without swallowing salvage ships or commodities", () => {
  const buy = resolve("Where can I buy it?", ["Tell me about Abrade"]);
  assert.equal(buy.intent, "equipment_buy");
  assert.equal(buy.itemName, "Abrade");
  assert.equal(buy.equipmentCategory, "scraper beams");
  const moved = resolve("What about in Orison?", ["Where can I buy Cinch on Hurston?"]);
  assert.equal(moved.itemName, "Cinch");
  assert.equal(moved.locationName, "Orison");
  const category = resolve("What about mining modules?", ["Tell me about Abrade"]);
  assert.equal(category.equipmentCategory, "mining modules");
  assert.equal(category.itemName, undefined);
  for (const text of ["Tell me about Vulture", "What about the Reclaimer?", "What about salvage ships?"]) {
    const parsed = resolve(text, ["Tell me about Abrade"]);
    assert.equal(parsed.intent, "vehicle_info", text);
    assert.equal(parsed.equipmentCategory, undefined, text);
  }
  for (const [text, intent, id] of [["Where can I sell RMC?", "sell", rmc.id], ["Where can I buy Scrap?", "buy", scrap.id]]) {
    const parsed = resolve(text, ["Tell me about Abrade"]);
    assert.equal(parsed.intent, intent, text);
    assert.equal(parsed.commodity.id, id, text);
    assert.equal(parsed.equipmentCategory, undefined, text);
  }
});

test("equipment topic wording is not mistaken for an item or location", async () => {
  for (const text of ["Show me data on scrapper modules", "I don't see any data on scrapper modules", "What are scraper modules?", "Show scraper module stats"]) {
    const parsed = resolve(text, ["Tell me about Lancet MH2"]);
    assert.equal(parsed.intent, "equipment_info", text);
    assert.equal(parsed.equipmentCategory, "scraper beams", text);
    assert.equal(parsed.itemName, undefined, text);
    assert.equal(parsed.locationName, undefined, text);
    const enriched = await enrichQueryLocations(parsed);
    assert.equal(enriched.locationError, undefined, text);
    assert.equal(enriched.locationName, undefined, text);
  }
  const buy = parse("Where can I buy Cinch scraper modules?");
  assert.equal(buy.intent, "equipment_buy");
  assert.equal(buy.itemName, "Cinch");
  const located = parse("Show me data on scrapper modules in Orison");
  assert.equal(located.locationName, "Orison");
  assert.equal(located.itemName, undefined);
  const named = parse("Show me information about Abrade scraper module");
  assert.equal(named.itemName, "Abrade");
  assert.equal(named.locationName, undefined);
});

test("price history keeps explicit terminal, game version and ISO date range", () => {
  const result = parse("Laranite price history at TDD Area 18 from 2026-09-01 through 2026-09-20 patch 4.10.1");
  assert.equal(result.intent, "price_history");
  assert.equal(result.commodity.id, laranite.id);
  assert.equal(result.locationName, "TDD Area 18");
  assert.equal(result.gameVersion, "4.10.1");
  assert.equal(result.dateFrom, "2026-09-01");
  assert.equal(result.dateTo, "2026-09-20");
  const follow = resolve("What about patch 4.10.0?", [result.raw]);
  assert.equal(follow.intent, "price_history");
  assert.equal(follow.locationName, "TDD Area 18");
  assert.equal(follow.gameVersion, "4.10.0");
  assert.equal(parse("Market alerts for Gold in Pyro").intent, "market_alerts");
});

test("full geography resolution is lazy, supports orbits/POIs, and rejects unknown suffixes", async () => {
  state.loads = 0;
  await enrichQueryLocations(parse("Where can I buy Gold?"));
  assert.equal(state.loads, 0);
  assert.equal((await enrichQueryLocations(parse("Where can I buy Gold on Vatra?"))).planet.planetId, 3);
  assert.equal((await enrichQueryLocations(parse("Gold price near Aaron Halo orbit"))).orbit.orbitId, 5);
  assert.equal((await enrichQueryLocations(parse("Tell me about Pyro Gateway"))).poi.poiId, 6);
  const missing = await enrichQueryLocations(parse("Where can I buy Gold in Pyro 9?"));
  assert.match(missing.locationError, /Pyro 9/);
  assert.equal(missing.starSystem, undefined);
  const city = await enrichQueryLocations(parse("Tell me about Area 18"));
  assert.equal(city.intent, "city_info");
  assert.equal(city.city.cityId, 3);
});

test("LLM equipment names and categories resolve without converting them into ships or commodities", async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const sdkUrl = asUrl(`export default class OpenAI { chat = { completions: { create: async () => ({choices:[{message:{content:JSON.stringify({intent:'equipment_buy',confidence:0.99,entities:{item:'Atlas',equipment_category:'quantum drives'}})}}]}) } }; }`);
  const classifierUrl = asUrl((await read("src/lib/llm-classifier.ts")).replaceAll('"openai"', JSON.stringify(sdkUrl))
    .replaceAll('"./query-parser"', JSON.stringify(parserUrl)).replaceAll('"./data/cache"', JSON.stringify(cacheUrl)));
  const { classifyWithLLM } = await import(classifierUrl);
  const result = await classifyWithLLM("Where can I buy Atlas?", reference);
  assert.equal(result.intent, "equipment_buy");
  assert.equal(result.itemName, "Atlas");
  assert.equal(result.equipmentCategory, "quantum drives");
  assert.equal(result.commodity, undefined);
});

test("explicit scraper queries recover from an incorrect LLM scrap-commodity classification", async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const sdkUrl = asUrl(`export default class OpenAI { chat = { completions: { create: async () => ({choices:[{message:{content:JSON.stringify({intent:'commodity_category',confidence:0.99,entities:{category:'Scrap'}})}}]}) } }; }`);
  const classifierUrl = asUrl((await read("src/lib/llm-classifier.ts")).replaceAll('"openai"', JSON.stringify(sdkUrl))
    .replaceAll('"./query-parser"', JSON.stringify(parserUrl)).replaceAll('"./data/cache"', JSON.stringify(cacheUrl)));
  const { classifyWithLLM } = await import(classifierUrl);
  const catalogue = await classifyWithLLM("Show scrapper modules", reference);
  assert.equal(catalogue.intent, "equipment_info");
  assert.equal(catalogue.equipmentCategory, "scraper beams");
  assert.equal(catalogue.itemName, undefined);
  assert.equal(catalogue.commodity, undefined);
  const comparison = await classifyWithLLM("Compare Abrade vs Cinch", reference);
  assert.equal(comparison.intent, "equipment_compare");
  assert.equal(comparison.itemName, "Abrade");
  assert.equal(comparison.itemName2, "Cinch");
});

test("the LLM cannot reintroduce a scraper category as an item in a missing-data report", async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const sdkUrl = asUrl(`export default class OpenAI { chat = { completions: { create: async () => ({choices:[{message:{content:JSON.stringify({intent:'equipment_info',confidence:0.99,entities:{item:'scrapper modules',equipment_category:'scraper beams'}})}}]}) } }; }`);
  const classifierUrl = asUrl((await read("src/lib/llm-classifier.ts")).replaceAll('"openai"', JSON.stringify(sdkUrl))
    .replaceAll('"./query-parser"', JSON.stringify(parserUrl)).replaceAll('"./data/cache"', JSON.stringify(cacheUrl)));
  const { classifyWithLLM } = await import(classifierUrl);
  const parsed = await classifyWithLLM("I don't see any data on scrapper modules", reference);
  assert.equal(parsed.intent, "equipment_info");
  assert.equal(parsed.equipmentCategory, "scraper beams");
  assert.equal(parsed.itemName, undefined);
  assert.equal(parsed.locationName, undefined);
});

test("an incorrect LLM equipment intent cannot override an explicit commodity purchase at a mining terminal", async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const sdkUrl = asUrl(`export default class OpenAI { chat = { completions: { create: async () => ({choices:[{message:{content:JSON.stringify({intent:'equipment_buy',confidence:0.99,entities:{item:'Can I Laranite',location:'ArcCorp Mining Area 045'}})}}]}) } }; }`);
  const classifierUrl = asUrl((await read("src/lib/llm-classifier.ts")).replaceAll('"openai"', JSON.stringify(sdkUrl))
    .replaceAll('"./query-parser"', JSON.stringify(parserUrl)).replaceAll('"./data/cache"', JSON.stringify(cacheUrl)));
  const { classifyWithLLM } = await import(classifierUrl);
  const result = await classifyWithLLM("Can I buy Laranite at ArcCorp Mining Area 045?", reference);
  assert.equal(result.intent, "buy");
  assert.equal(result.commodity.id, laranite.id);
  assert.equal(result.itemName, undefined);
  const sell = await classifyWithLLM("Can I sell Gold at ArcCorp Mining Area 045?", reference);
  assert.equal(sell.intent, "sell");
  assert.equal(sell.commodity.id, gold.id);
});

test("extended location details preserve unknown flags and associate terminals by ID", async () => {
  const locationUrl = asUrl((await read("src/lib/location-answer.ts")).replaceAll('"@/lib/data/mining"', JSON.stringify(geoUrl)).replaceAll('"@/lib/data/cache"', JSON.stringify(cacheUrl)));
  const { buildExtendedLocationAnswer } = await import(locationUrl);
  const result = await buildExtendedLocationAnswer({ intent: "location_info", orbit: { orbitName: "Aaron Halo", orbitId: 5 }, raw: "Aaron Halo", modifiers: [] });
  assert.equal(result.tables[0].rows.find((row) => row[0] === "Lagrange point")[1], "No");
  assert.equal(result.tables[0].rows.find((row) => row[0] === "Asteroid region")[1], "Yes");
  assert.equal(result.tables[0].rows.find((row) => row[0] === "Available in game")[1], "Not reported");
  assert.equal(result.tables[1].rows[0][0], "TDD Area 18");
});

test('crafting and blueprint unlock questions take precedence over equipment buying', () => {
  for (const text of ['What materials do I need to craft an XL one quantum drive?', 'What ingredients do I need for XL1?']) {
    const parsed = parseQuery(text, reference.commodityMap, reference.starSystemMap, reference.terminals, reference.vehicleMap);
    assert.equal(parsed.intent, 'craft_recipe');
    assert.equal(parsed.itemName, 'XL-1');
  }
  const parsed = parseQuery('What missions do I need to complete to unlock the XL1 blueprint?', reference.commodityMap, reference.starSystemMap, reference.terminals, reference.vehicleMap);
  assert.equal(parsed.intent, 'blueprint_unlock');
  assert.equal(parsed.itemName, 'XL-1');
});

test('blueprint follow-up inherits the explicitly referenced recipe, but fresh recipe does not', () => {
  const parse = text => parseQuery(text, reference.commodityMap, reference.starSystemMap, reference.terminals, reference.vehicleMap);
  const history = [{role:'user', text:'What materials do I need to craft an XL1?' }];
  assert.equal(resolveContext(parse('How do I unlock its blueprint?'),history,parse).itemName,'XL-1');
  assert.equal(resolveContext(parse('What materials do I need to craft an Abrade Scraper Module?'),history,parse).itemName,'Abrade Scraper Module');
});

test("model category recognition cannot discard an explicit shopping request", async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const sdkUrl = asUrl(`export default class OpenAI { chat = { completions: { create: async () => ({choices:[{message:{content:JSON.stringify({intent:'equipment_info',confidence:0.99,entities:{item:null,equipment_category:'power plants',equipment_size:2}})}}]}) } }; }`);
  const classifierUrl = asUrl((await read("src/lib/llm-classifier.ts")).replaceAll('"openai"', JSON.stringify(sdkUrl))
    .replaceAll('"./query-parser"', JSON.stringify(parserUrl)).replaceAll('"./data/cache"', JSON.stringify(cacheUrl)));
  const { classifyWithLLM } = await import(classifierUrl);
  const result = await classifyWithLLM("Which vendors carry size two power plants?", reference);
  assert.equal(result.intent, "equipment_buy");
  assert.equal(result.equipmentSize, 2);
  assert.equal(result.itemName, undefined);
});

test("exact catalogue matches correct bare components mistaken for ship shopping", async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const sdkUrl = asUrl(`export default class OpenAI { chat = { completions: { create: async () => ({choices:[{message:{content:JSON.stringify({intent:'vehicle_buy',confidence:0.99,entities:{}})}}]}) } }; }`);
  const equipmentUrl = asUrl(`export async function getEquipmentSuggestions(name) { return name === 'XL1' ? [{name:'XL-1'}] : []; }`);
  const classifierUrl = asUrl((await read("src/lib/llm-classifier.ts")).replaceAll('"openai"', JSON.stringify(sdkUrl))
    .replaceAll('"./equipment-client"', JSON.stringify(equipmentUrl))
    .replaceAll('"./query-parser"', JSON.stringify(parserUrl)).replaceAll('"./data/cache"', JSON.stringify(cacheUrl)));
  const { classifyWithLLM } = await import(classifierUrl);
  const result = await classifyWithLLM("Where can I buy an XL1?", reference);
  assert.equal(result.intent, "equipment_buy");
  assert.equal(result.itemName, "XL1");
  const unknown = await classifyWithLLM("Where can I buy Imaginary888?", reference);
  assert.equal(unknown.intent, "vehicle_buy");
});

test("blueprint progression follow-ups keep the recipe subject and fresh subjects reset it", () => {
  const history=["What materials do I need to craft an XL1?", "How do I unlock its blueprint?"];
  const before=resolve("Which missions do I need before that one?",history);
  assert.equal(before.intent,"blueprint_progression");
  assert.equal(before.itemName,"XL-1");
  assert.equal(parse("Is the XL1 blueprint guaranteed?").itemName,"XL-1");
  const guaranteed=resolve("Is that guaranteed?",history);
  assert.equal(guaranteed.intent,"blueprint_progression");
  assert.equal(guaranteed.itemName,"XL-1");
  const fresh=resolve("Show prerequisites for Idea for Isaac mission",history);
  assert.equal(fresh.intent,"mission_prerequisites");
  assert.equal(fresh.itemName,"Idea for Isaac");
  const other=resolve("Show progression for the Abrade Scraper Module blueprint",history);
  assert.equal(other.intent,"blueprint_progression");
  assert.equal(other.itemName,"Abrade Scraper Module");
  assert.equal(parse("Price history of Laranite before patch 4.9").intent,"price_history");
});

test("a sourced blueprint answer keeps explicit follow-ups when the original recipe has left recent history", () => {
 const bot="One listed option for **XL-1 blueprint**. Source: Star Citizen Wiki API{{wiki:blueprints/e55162ea-cd69-4ace-a519-ffd40bfb78a9}}.";
 const history=[{role:"user",text:"How do I unlock its blueprint?"},{role:"bot",text:bot},{role:"user",text:"Which missions do I need before that one?"},{role:"bot",text:bot}];
 const result=resolveContext(parse("Is that guaranteed?"),history,parse);
 assert.equal(result.intent,"blueprint_progression");assert.equal(result.itemName,"XL-1");
 const fresh=resolveContext(parse("Show prerequisites for Idea for Isaac mission"),history,parse);
 assert.equal(fresh.itemName,"Idea for Isaac");
 const stale=resolveContext(parse("Is that guaranteed?"),[{role:"bot",text:"A commodity price report"}],parse);
 assert.equal(stale.itemName,undefined);
});
