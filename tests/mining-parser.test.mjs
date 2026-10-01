import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const asUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
async function source(path) {
  return stripTypeScriptTypes(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}
// Exercise the real lookup functions without loading or calling upstream clients.
const cacheUrl = asUrl((await source("src/lib/data/cache.ts")).replace(/^import[\s\S]*?from "[^\"]+";/gm, ""));
const parserUrl = asUrl((await source("src/lib/query-parser.ts")).replaceAll('"@/lib/data/cache"', JSON.stringify(cacheUrl)));
const { parseQuery, parseMiningQuery } = await import(parserUrl);
const contextUrl = asUrl((await source("src/lib/context-resolver.ts")).replaceAll('"./query-parser"', JSON.stringify(parserUrl)));
const { resolveContext } = await import(contextUrl);

const gold = { id: 1, name: "Gold", code: "GOLD" };
const laranite = { id: 2, name: "Laranite", code: "LARA" };
const ironOre = { id: 3, name: "Iron (Ore)", code: "IRONORE" };
const commodities = [gold, laranite, ironOre];
const commodityMap = new Map(commodities.flatMap((value) => [[value.name.toLowerCase().replace(/[^a-z0-9]/g, ""), value], [value.code.toLowerCase(), value]]));
const stanton = { id: 1, name: "Stanton" };
const pyro = { id: 2, name: "Pyro" };
const starSystemMap = new Map([["stanton", stanton], ["pyro", pyro]]);
const terminals = [{ id: 10, name: "Example terminal", planet_name: "Hurston", id_planet: 1, moon_name: "Daymar", id_moon: 2 }];
const parse = (text) => parseQuery(text, commodityMap, starSystemMap, terminals, new Map());
const resolve = (text, messages) => resolveContext(parse(text), messages.map((text) => ({ role: "user", text })), parse);

test("mining questions route without an API key and preserve arbitrary explicit locations", () => {
  const cases = [
    ["Where can I mine Laranite?", laranite, undefined],
    ["Can I mine Gold on Daymar?", gold, "Daymar"],
    ["Where is Laranite found in Pyro?", laranite, "Pyro"],
    ["Mining locations for Gold around Aaron Halo?", gold, "Aaron Halo"],
    ["Can I mine Gold at Pyro Gateway?", gold, "Pyro Gateway"],
    ["Can I mine Gold on Unlisted Moon?", gold, "Unlisted Moon"],
    ["Where can I mine Iron (Ore) near Vatra?", ironOre, "Vatra"],
    ["Is Laranite found on Wala?", laranite, "Wala"],
    ["On Daymar, can I mine Gold?", gold, "Daymar"],
    ["Near Vatra can I mine Gold?", gold, "Vatra"],
    ["Where on Hurston can I mine Laranite?", laranite, "Hurston"],
    ["Can I mine on Hurston for Laranite?", laranite, "Hurston"],
  ];
  for (const [text, commodity, location] of cases) {
    const result = parse(text);
    assert.equal(result.intent, "mining_locations", text);
    assert.equal(result.commodity?.id, commodity.id, text);
    assert.equal(result.locationName, location, text);
  }
});

test("reverse location queries and generic mining words never become fuzzy commodities", () => {
  for (const text of ["Which ores are found on Hurston?", "What can I mine on Daymar?", "Ores in Pyro?", "Where can I mine ore?", "Mining on Unlisted Moon?"]) {
    const result = parse(text);
    assert.equal(result.intent, "mining_locations", text);
    assert.equal(result.commodity, undefined, text);
  }
  assert.equal(parseMiningQuery("Can I mine on Daymar?", commodityMap).commodity, undefined);
});

test("buy, sell, refinery, mining ship, and outpost requests retain their own intents", () => {
  for (const [text, intent] of [
    ["Where can I buy Iron ore?", "buy"],
    ["Where can I sell Iron ore?", "sell"],
    ["Where to refine Gold?", "refinery_yields"],
    ["What are the refining methods?", "refinery_method"],
    ["Tell me about mining ships", "vehicle_info"],
    ["Which ship is best for mining?", "vehicle_info"],
    ["Mining outposts on Hurston", "outpost_info"],
    ["Show me all mineable commodities", "commodity_category"],
    ["What's the price of Iron ore?", "price_check"],
  ]) assert.equal(parse(text).intent, intent, text);
});

test("mining follow-ups replace location scope and retain the ore", () => {
  const first = "Can I mine Laranite on Daymar?";
  const result = resolve("What about in Pyro?", [first]);
  assert.equal(result.intent, "mining_locations");
  assert.equal(result.commodity.id, laranite.id);
  assert.equal(result.locationName, "Pyro");
  assert.equal(result.moon, undefined);
  const unknown = resolve("What about on Unknown Moon?", [first]);
  assert.equal(unknown.locationName, "Unknown Moon");
  assert.equal(unknown.commodity.id, laranite.id);
  const chain = resolve("What about Gold?", [first, "What about in Pyro?"]);
  assert.equal(chain.commodity.id, gold.id);
  assert.equal(chain.locationName, "Pyro");
  const dynamic = resolve("What about Vatra?", [first]);
  assert.equal(dynamic.locationName, "Vatra");
  assert.equal(dynamic.commodity.id, laranite.id);
});

test("standalone mining requests clear stale commodity and location context", () => {
  const history = ["Can I mine Laranite on Daymar?"];
  const inventory = resolve("Which ores are found on Hurston?", history);
  assert.equal(inventory.commodity, undefined);
  assert.equal(inventory.locationName, "Hurston");
  assert.equal(inventory.moon, undefined);
  const global = resolve("Where can I mine Gold?", history);
  assert.equal(global.commodity.id, gold.id);
  assert.equal(global.locationName, undefined);
  const tradeToMining = resolve("Where can I mine it?", ["Where can I sell Gold in Pyro?"]);
  assert.equal(tradeToMining.commodity.id, gold.id);
  assert.equal(tradeToMining.starSystem, undefined);
});

test("reverse-location follow-ups inherit only location, not the earlier ore", () => {
  const result = resolve("Which ores are found there?", ["Can I mine Laranite on Daymar?"]);
  assert.equal(result.commodity, undefined);
  assert.equal(result.locationName, "Daymar");
});

test("LLM mining classifications preserve unresolved planet names without stale entities", async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const sdkUrl = asUrl(`export default class OpenAI { chat = { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ intent: "mining_locations", confidence: 0.99, entities: { commodity: "Laranite", planet: "Unlisted Moon", moon: "Daymar" } }) } }] }) } }; }`);
  const classifierUrl = asUrl((await source("src/lib/llm-classifier.ts"))
    .replaceAll('"openai"', JSON.stringify(sdkUrl))
    .replaceAll('"./query-parser"', JSON.stringify(parserUrl))
    .replaceAll('"./data/cache"', JSON.stringify(cacheUrl)));
  const { classifyWithLLM } = await import(classifierUrl);
  const data = { commodities, commodityMap, starSystemMap, starSystems: [stanton, pyro], terminals, vehicles: [], vehicleMap: new Map() };
  const result = await classifyWithLLM("Which ores are found on Unlisted Moon?", data);
  assert.equal(result.intent, "mining_locations");
  assert.equal(result.locationName, "Unlisted Moon");
  assert.equal(result.commodity, undefined);
  assert.equal(result.moon, undefined);
});
