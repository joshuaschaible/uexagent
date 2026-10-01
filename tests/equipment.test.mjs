import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const state = { calls: [], failAttributes: false };
globalThis.__equipmentFixture = state;
const categories = [
  { id: 29, type: "item", section: "Utility", name: "Mining Laser Heads" },
  { id: 30, type: "item", section: "Utility", name: "Mining Modules" },
  { id: 28, type: "item", section: "Utility", name: "Gadgets" },
  { id: 31, type: "item", section: "Utility", name: "Scraper Beams" },
  { id: 110, type: "item", section: "Utility", name: "Salvage Beams" },
  ...["Quantum Drives", "Shield Generators", "Power Plants", "Coolers"].map((name, i) => ({ id: 20 + i, type: "item", section: "Systems", name })),
];
const items = [
  { id: 107, id_category: 29, name: "Lancet MH2 Mining Laser", category: "Mining Laser Heads", company_name: "Greycat", size: "2", game_version: "4.1" },
  { id: 108, id_category: 29, name: "Arbor MH1 Mining Laser", category: "Mining Laser Heads", company_name: "Greycat", size: "1", game_version: "4.1" },
  { id: 109, id_category: 29, name: "Lancet MH1 Mining Laser", category: "Mining Laser Heads", company_name: "Greycat", size: "1", game_version: "4.1" },
];
const scrapers = [
  {id:244,name:"Trawler Scraper Module",id_category:31,category:"Scraper Beams",game_version:"4.8.0"},
  {id:245,name:"Abrade Scraper Module",id_category:31,category:"Scraper Beams",game_version:"4.1.1"},
  {id:609,name:"Cinch Scraper Module",id_category:31,category:"Scraper Beams",game_version:"4.8.0"},
  {id:4021,name:"ReadyGrip Tractor Module",id_category:31,category:"Scraper Beams",game_version:"4.1.1"},
];
const components = [
  { id: 5001, id_category: 20, name: "XL-1", size: "2" },
  { id: 5002, id_category: 20, name: "TS-2", size: "3" },
  { id: 5003, id_category: 20, name: "Spectre", size: "1" },
  { id: 5004, id_category: 21, name: "FR-76" },
  { id: 5005, id_category: 22, name: "JS-400" },
  { id: 5006, id_category: 23, name: "Snowpack" },
];
const scraperAttributes = [
  {id_item:244,attribute_name:"Extraction Efficiency",value:"65",unit:"%",date_modified:1740771598},
  {id_item:244,attribute_name:"Extraction Speed",value:"0,05/0,15",unit:"",date_modified:1740771598},
  {id_item:244,attribute_name:"Radius",value:"6",unit:"m",date_modified:1740771598},
  {id_item:245,attribute_name:"Extraction Efficiency",value:"70",unit:"%",date_modified:1740771597},
  {id_item:245,attribute_name:"Extraction Speed",value:"0,15/0,45",unit:"",date_modified:1740771597},
  {id_item:245,attribute_name:"Radius",value:"3,5",unit:"m",date_modified:1740771597},
  {id_item:4021,attribute_name:"Extraction Efficiency",value:"",unit:null,date_modified:0},
];
const scraperPrices = scrapers.map(item => ({id_item:item.id,item_name:item.name,id_terminal:3,terminal_name:"Dumper's Depot - Area 18",id_planet:2,planet_name:"ArcCorp",star_system_name:"Stanton",price_buy:21250,game_version:"4.10.0",date_modified:1788018878}));
const prices = items.flatMap((item) => [
  { id_item: item.id, item_name: item.name, id_terminal: 1, terminal_name: "Hurston Shop", id_planet: 1, planet_name: "Hurston", star_system_name: "Stanton", price_buy: 100, price_buy_avg: 105, date_modified: 1789833037, game_version: "4.10.1", durability: 100 },
  { id_item: item.id, item_name: item.name, id_terminal: 2, terminal_name: "ArcCorp Shop", id_planet: 2, planet_name: "ArcCorp", star_system_name: "Stanton", price_buy: 50, date_modified: 1789833037, game_version: "4.10.0" },
]);
state.fetch = async (endpoint, params) => {
  state.calls.push({ endpoint, params });
  if (endpoint === "categories") return categories;
  if (endpoint === "items") return [...items, ...scrapers, ...components].filter((item) => item.id_category === params.id_category);
  if (endpoint === "items_prices") {
    const catalogue = params.id_category === 31 || scrapers.some(item => item.id === params.id_item) ? scraperPrices : prices;
    return params.id_item ? catalogue.filter((row) => row.id_item === params.id_item) : catalogue;
  }
  if (endpoint === "items_attributes") {
    if (state.failAttributes) throw new Error("Unavailable");
    if (params.id_category === 31) return scraperAttributes;
    if (scrapers.some(item => item.id === params.id_item)) return scraperAttributes.filter(row => row.id_item === params.id_item);
    return [{ id_item: params.id_item, attribute_name: "Maximum Range", value: params.id_item === 107 ? "135" : "120", unit: "m", date_modified: 1789833037 }];
  }
  throw new Error(`Unexpected endpoint: ${endpoint}`);
};
const apiUrl = moduleUrl("export const uexFetch = (...args) => globalThis.__equipmentFixture.fetch(...args);");
const clientUrl = moduleUrl((await readFile(new URL("../src/lib/equipment-client.ts", import.meta.url), "utf8")).replaceAll('"@/lib/uex-client"', JSON.stringify(apiUrl)));
const client = await import(clientUrl);
const answerUrl = moduleUrl((await readFile(new URL("../src/lib/equipment-answer.ts", import.meta.url), "utf8")).replaceAll('"@/lib/equipment-client"', JSON.stringify(clientUrl)));
const { buildEquipmentAnswer, filterEquipmentPrices } = await import(answerUrl);
const query = (fields = {}) => ({ intent: "equipment_info", itemName: "Lancet MH2", equipmentCategory: "mining lasers", modifiers: [], raw: "Lancet MH2", ...fields });
const reset = () => { client.clearEquipmentCache(); state.calls = []; state.failAttributes = false; };

test("component mentions load every ship-system category from a cold cache and reuse it", async () => {
  reset();
  const [all, xl1] = await Promise.all([client.getEquipmentSuggestions(""), client.getEquipmentSuggestions("XL1")]);
  assert.deepEqual(new Set(all.map(item => item.id)), new Set(components.map(item => item.id)));
  assert.deepEqual(xl1.map(item => item.name), ["XL-1"]);
  assert.equal(state.calls.filter(call => call.endpoint === "items").length, 4);
  const count = state.calls.length;
  assert.deepEqual((await client.getEquipmentSuggestions("TS 2")).map(item => item.name), ["TS-2"]);
  assert.deepEqual((await client.getEquipmentSuggestions("Spectre")).map(item => item.name), ["Spectre"]);
  assert.deepEqual(client.matchEquipmentItems(components, "XL1").map(item => item.name), ["XL-1"]);
  assert.deepEqual(client.matchEquipmentItems(components, "TS 2").map(item => item.name), ["TS-2"]);
  assert.equal(state.calls.length, count);
});

test("size-filtered equipment shopping joins only matching offers and keeps unpriced items", async () => {
  reset();
  const original = state.fetch;
  state.fetch = async (endpoint, params) => {
    if (endpoint === "items_prices" && params.id_category === 20) return [
      { id_item: 5001, item_name: "XL-1", terminal_name: "Shop A", price_buy: 150, star_system_name: "Stanton", date_modified: 1789833037 },
      { id_item: 5001, item_name: "XL-1", terminal_name: "Shop B", price_buy: 100, star_system_name: "Pyro", date_modified: 1789833037 },
      { id_item: 5002, item_name: "TS-2", terminal_name: "Shop C", price_buy: 1 },
    ];
    return original(endpoint, params);
  };
  try {
    const result = await buildEquipmentAnswer(query({ intent: "equipment_buy", itemName: undefined, equipmentCategory: "quantum drives", equipmentSize: 2 }));
    assert.equal(result.table.rows.length, 1);
    assert.deepEqual(result.table.rows[0].slice(0, 4), ["XL-1", "2", "100", "Shop B (Pyro)"]);
    assert.match(result.table.rows[0][4], /Shop A/);
    assert.match(result.text, /do not confirm current stock/);
    const noOffer = await buildEquipmentAnswer(query({ intent: "equipment_buy", itemName: undefined, equipmentCategory: "quantum drives", equipmentSize: 1 }));
    assert.equal(noOffer.table.rows[0][0], "Spectre");
    assert.equal(noOffer.table.rows[0][2], "Not reported");
    const best = await buildEquipmentAnswer(query({ itemName: undefined, equipmentCategory: "quantum drives", equipmentSize: 2, raw: "What is the best size two quantum drive?" }));
    assert.match(best.text, /What should “best” mean/);
    assert.equal(best.tables[0].rows.length, 1);
  } finally { state.fetch = original; client.clearEquipmentCache(); }
});

test("equipment lookup uses category endpoints and caches repeats without downloading the full catalogue", async () => {
  reset();
  const first = await buildEquipmentAnswer(query());
  assert.match(first.text, /Lancet MH2/);
  assert.ok(first.tables.some((table) => table.rows.some((row) => row.includes("135 m"))));
  assert.equal(state.calls.filter((call) => call.endpoint === "items").length, 1);
  assert.deepEqual(state.calls.find((call) => call.endpoint === "items").params, { id_category: 29 });
  const count = state.calls.length;
  await buildEquipmentAnswer(query());
  assert.equal(state.calls.length, count);
  const suggestions = await client.getCachedEquipmentSuggestions("Lancet");
  assert.equal(suggestions.length, 2);
  assert.equal(state.calls.length, count);
});

test("equipment comparison aligns reported attributes with their units", async () => {
  reset();
  const result = await buildEquipmentAnswer(query({ intent: "equipment_compare", itemName2: "Arbor MH1" }));
  const comparison = result.tables[0];
  assert.deepEqual(comparison.rows.find((row) => row[0] === "Maximum Range"), ["Maximum Range", "135 m", "120 m"]);
  assert.equal(comparison.headers.length, 3);
});

test("ambiguous or unknown items ask for choices instead of inventing item specifications", async () => {
  reset();
  const ambiguous = await buildEquipmentAnswer(query({ itemName: "Lancet" }));
  assert.match(ambiguous.text, /matches 2 items/);
  assert.equal(ambiguous.tables[0].rows.length, 2);
  assert.equal(state.calls.filter((call) => call.endpoint === "items_attributes").length, 0);
  const unknown = await buildEquipmentAnswer(query({ itemName: "Unknown item" }));
  assert.match(unknown.text, /couldn't find/);
});

test("broad category requests ask for a narrower category before fetching large catalogues", async () => {
  reset();
  const result = await buildEquipmentAnswer(query({ itemName: undefined, equipmentCategory: "ship components" }));
  assert.match(result.text, /more specific equipment category/);
  assert.equal(state.calls.filter((call) => call.endpoint === "items").length, 0);
});

test("equipment prices honor resolved geography, unknown places, patch filters and per-item units", async () => {
  reset();
  const result = await buildEquipmentAnswer(query({ intent: "equipment_buy", locationName: "Hurston", planet: { planetName: "Hurston", planetId: 1 } }));
  const table = result.tables.find((table) => table.title.includes("purchase locations"));
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0][1], "Hurston Shop");
  assert.ok(table.headers.includes("Buy (aUEC/unit)"));
  assert.equal(filterEquipmentPrices(prices, query({ locationName: "Unknown Moon" })).length, 0);
  assert.equal(filterEquipmentPrices(prices, query({ gameVersion: "4.10.1" })).length, 3);
});

test("temporary attributes failure preserves independently available shop prices", async () => {
  reset(); state.failAttributes = true;
  const result = await buildEquipmentAnswer(query());
  assert.match(result.text, /attributes are temporarily unavailable/);
  assert.ok(result.tables.some((table) => table.title.includes("purchase locations")));
});

test("clearing equipment cache prevents pending old results from replacing a newer load", async () => {
  reset();
  const original = state.fetch;
  const deferred = [];
  state.fetch = (endpoint, params) => endpoint === "items" ? new Promise((resolve) => deferred.push(resolve)) : original(endpoint, params);
  try {
    const old = client.getEquipmentItems(29);
    client.clearEquipmentCache();
    const fresh = client.getEquipmentItems(29);
    deferred[0]([items[0]]); await old;
    assert.deepEqual(await client.getCachedEquipmentSuggestions("Lancet"), []);
    deferred[1]([items[2]]); await fresh;
    assert.equal((await client.getEquipmentItems(29))[0].id, 109);
  } finally { state.fetch = original; client.clearEquipmentCache(); }
});


test("scraper aliases select Scraper Beams without substituting salvage tractor beams or mining modules", () => {
  for (const alias of ["scraper beams", "scraper module", "scraper modules", "scrapper modules", "scrapers", "salvage modules"]) {
    assert.deepEqual(client.selectEquipmentCategories(categories, alias).map(c => c.id), [31]);
  }
  assert.deepEqual(client.selectEquipmentCategories(categories, "salvage beams").map(c => c.id), [110]);
  assert.deepEqual(client.matchEquipmentItems(scrapers, "Abrade Scrapper Module").map(item => item.id), [245]);
  assert.deepEqual(client.matchEquipmentItems(scrapers, "Ready Grip Tractor Module").map(item => item.id), [4021]);
});

test("scraper catalogue shows source specs in one bounded category request and preserves missing values", async () => {
  reset();
  const response = await buildEquipmentAnswer(query({itemName:undefined,equipmentCategory:"scrapper modules",raw:"Show scrapper modules"}));
  assert.equal(response.tables[0].rows.length, 4);
  const specs = response.tables.find(table => table.title === "Reported scraper specifications");
  assert.equal(specs.rows.length, 4);
  assert.deepEqual(specs.rows.find(row => row[0] === "Abrade Scraper Module").slice(1,4), ["70 %", "0,15/0,45", "3,5 m"]);
  assert.ok(specs.rows.find(row => row[0] === "ReadyGrip Tractor Module").slice(1,5).every(value => value === "Not reported"));
  assert.match(specs.rows[0].at(-1), /2025/);
  assert.deepEqual(state.calls.filter(call => call.endpoint === "items_attributes"), [{endpoint:"items_attributes",params:{id_category:31}}]);
  assert.deepEqual(state.calls.filter(call => call.endpoint === "items").map(call => call.params), [{id_category:31}]);
});

test("scraper details and comparisons expose attributes and purchase locations without inventing extraction units", async () => {
  reset();
  const info = await buildEquipmentAnswer(query({itemName:"Abrade",equipmentCategory:"scraper beams",raw:"Tell me about Abrade"}));
  assert.ok(info.tables.some(table => table.rows.some(row => row.includes("3,5 m"))));
  assert.ok(info.tables.some(table => table.rows.some(row => row.includes("Dumper's Depot - Area 18"))));
  const comparison = await buildEquipmentAnswer(query({intent:"equipment_compare",itemName:"Abrade",itemName2:"Trawler",equipmentCategory:"scraper beams"}));
  assert.deepEqual(comparison.tables[0].rows.find(row => row[0] === "Extraction Speed"), ["Extraction Speed", "0,15/0,45", "0,05/0,15"]);
  assert.match(comparison.tables[0].rows.find(row => row[0] === "Specification report dates")[1], /2025/);
});

test("a failed scraper specification fetch still returns the catalogue", async () => {
  reset();state.failAttributes = true;
  const response = await buildEquipmentAnswer(query({itemName:undefined,equipmentCategory:"scraper beams"}));
  assert.match(response.text,/specifications are temporarily unavailable/);
  assert.equal(response.tables[0].rows.length,4);
  state.failAttributes = false;
});

test("named purchases answer with the cheapest reported shop before supporting details", async () => {
  reset();
  const result = await buildEquipmentAnswer(query({ intent: "equipment_buy" }));
  assert.match(result.text, /^\*\*Lancet MH2 Mining Laser\*\*: lowest reported price is/);
  assert.match(result.text.split("\n")[0], /50 aUEC.*ArcCorp Shop/);
  assert.match(result.text, /do not confirm current stock/);
});

test("bare component names infer their catalogue without unrelated category rows", async () => {
  reset();
  const result = await buildEquipmentAnswer(query({ itemName: "XL1", equipmentCategory: undefined }));
  assert.match(result.text, /XL-1/);
  assert.doesNotMatch(result.text, /more specific equipment category/);
  assert.equal(result.tables[0].rows[0][0], "XL-1");
});
