import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const asUrl = (source, name = "answer-builder-test-dependency") => `data:text/javascript;base64,${Buffer.from(`${source}\n//# sourceURL=${name}.mjs`).toString("base64")}`;
const readSource = async (name) => stripTypeScriptTypes(await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8"));
const fixtureKey = "__answerBuilderDataFixture";
const apiMethods = ["getCommodityPrices", "getCommodityPricesAll", "getGameVersions", "getCommodityRoutes", "getCommodityRawPrices", "getSpaceStations", "getCities", "getOutposts", "getRefineryYields", "getRefineryCapacities", "getVehiclePurchasePrices", "getVehiclePurchasePricesAll", "getVehicleRentalPrices", "getVehicleRentalPricesAll"];
const clientUrl = asUrl(apiMethods.map((name) => `export const ${name} = async (...args) => {
  const state = globalThis.${fixtureKey}; state.calls.push({ name: "${name}", args });
  const value = state.api["${name}"]; return typeof value === "function" ? value(...args) : value ?? [];
};`).join("\n"));
const cacheUrl = asUrl(`export const getReferenceData = async () => globalThis.${fixtureKey}.reference;
export const findMoon = () => undefined; export const findPlanet = () => undefined; export const findStarSystem = () => undefined;`);
const tradeUrl = asUrl((await readSource("trade-data")).replaceAll('"./uex-client"', JSON.stringify(clientUrl)).replaceAll('"./data/cache"', JSON.stringify(cacheUrl)));
const recommendationUrl = asUrl((await readSource("trade-recommendations")).replaceAll('"./trade-data"', JSON.stringify(tradeUrl)));
const vehicleUrl = asUrl(await readSource("vehicle-details"));
const freshnessUrl = asUrl(await readSource("data-freshness"));
const responseUrl = asUrl(`export const generateResponseText = async (_raw, context, fallback) => {
  globalThis.${fixtureKey}.contexts.push(context); return fallback;
};`);
const wikiUrl = asUrl(["getShipWikiData", "getManufacturerWikiData", "getShipHardpoints", "getSystemWikiData", "getPlanetWikiData", "getJumpPoints"].map((name) => `export const ${name} = async () => null;`).join("\n") + "\nexport const truncateLore = (value) => value;");
const unusedUrl = asUrl(["planMultiHopRoute", "buildPriceHistoryAnswer", "buildMarketAlertsAnswer", "buildEquipmentAnswer", "buildExtendedLocationAnswer", "buildMiningAnswer", "buildCraftingAnswer"].map((name) => `export const ${name} = () => { throw new Error("Unexpected unrelated handler: ${name}"); };`).join("\n"));
const modules = {
  "@/lib/uex-client": clientUrl, "@/lib/data/cache": cacheUrl,
  "@/lib/trade-data": tradeUrl, "@/lib/trade-recommendations": recommendationUrl,
  "@/lib/vehicle-details": vehicleUrl, "@/lib/data-freshness": freshnessUrl,
  "@/lib/response-generator": responseUrl, "@/lib/wiki-client": wikiUrl,
};
const builderSource = (await readSource("answer-builder")).replace(/from "(@\/lib\/[^\"]+)"/g, (_, name) => `from ${JSON.stringify(modules[name] ?? unusedUrl)}`);
const { buildAnswer } = await import(asUrl(builderSource, "answer-builder-under-test"));
const { clearTradeDataCache } = await import(tradeUrl);

const timestamp = Date.parse("2026-09-25T12:34:56Z") / 1000;
const commodity = { id: 47, name: "Laranite", is_raw: 0 };
const terminal = (id, extra = {}) => ({ id, name: `Terminal ${id}`, star_system_name: "Stanton", id_star_system: 68, planet_name: "Hurston", id_planet: 1, id_moon: 0, is_available: 1, is_available_live: 1, is_visible: 1, ...extra });
const ship = (extra = {}) => ({ id: 100, name: "C2 Hercules", name_full: "C2 Hercules", company_name: "Crusader", scu: 696, crew: "1,2", pad_type: "Large", is_concept: 0, mass: 1000, length: 20, width: 10, height: 10, fuel_quantum: 10, fuel_hydrogen: 10, ...extra });
const price = (idTerminal, buy, sell, extra = {}) => ({ id: idTerminal, id_commodity: commodity.id, commodity_name: commodity.name, id_terminal: idTerminal, terminal_name: `Terminal ${idTerminal}`, id_star_system: 68, star_system_name: "Stanton", id_planet: 1, planet_name: "Hurston", price_buy: buy, price_sell: sell, status_buy: buy > 0 ? 3 : 0, status_sell: sell > 0 ? 3 : 0, date_modified: timestamp, game_version: "4.10.1", ...extra });
const query = (intent, extra = {}) => ({ intent, raw: intent, modifiers: [], ...extra });
const cell = (table, row, header) => table.rows[row][table.headers.indexOf(header)];

test.beforeEach(() => {
  clearTradeDataCache();
  const terminals = [terminal(1), terminal(2), terminal(3, { star_system_name: "Pyro", id_star_system: 64, planet_name: "Pyro IV", id_planet: 243 })];
  globalThis[fixtureKey] = {
    calls: [], contexts: [], api: { getGameVersions: { live: "4.10.1", ptu: null } },
    reference: { terminals, terminalMap: new Map(terminals.map((item) => [item.id, item])), vehicles: [ship()], commodities: [commodity], starSystems: [], refineryMethods: [], fuelPrices: [] },
  };
});
test.after(() => delete globalThis[fixtureKey]);

test("reference assistant declines optimization without fetching trade data", async () => {
  for (const intent of ["trade_route", "profit_calc", "multi_hop", "budget_trade", "location_trade", "fleet_trade", "commodity_ranking"]) {
    const response = await buildAnswer(query(intent, {commodity, vehicle:ship()}));
    assert.match(response.text, /reference lookups/);
    assert.equal(response.table, undefined);
    assert.equal(response.profit, undefined);
    assert.equal(response.map, undefined);
  }
  assert.deepEqual(globalThis[fixtureKey].calls, []);
});

test("sell answers keep forecast demand separate from terminal inventory and show report date and patch", async () => {
  globalThis[fixtureKey].api.getCommodityPrices = [price(2, 0, 120, { scu_sell: 40, scu_sell_stock: 350 })];
  const response = await buildAnswer(query("sell", { commodity }));
  assert.equal(cell(response.table, 0, "Forecast Demand"), "40 SCU");
  assert.equal(cell(response.table, 0, "Terminal Inventory"), "350 SCU");
  assert.equal(cell(response.table, 0, "Reported (UTC)"), "2026-09-25 12:34:56 UTC");
  assert.equal(cell(response.table, 0, "Patch"), "4.10.1");
  assert.match(response.text, /Source game version: 4\.10\.1/);
});

test("vehicle answers preserve crew ranges and compare minimum crew numerically", async () => {
  const first = ship({ crew: "2,6" });
  const second = ship({ id: 101, name: "Other Ship", crew: "10,12" });
  const info = await buildAnswer(query("vehicle_info", { vehicle: first }));
  assert.match(info.text, /Crew: 2–6/);
  const comparison = await buildAnswer(query("vehicle_compare", { vehicle: first, vehicle2: second }));
  assert.deepEqual(comparison.table.rows.find((row) => row[0] === "Crew"), ["Crew", "**2–6**", "10–12"]);
});

test("refinery capacity keeps the provider's unspecified unit rather than inventing SCU", async () => {
  globalThis[fixtureKey].api.getRefineryYields = [{ id_commodity: 47, commodity_name: "Laranite", id_terminal: 1, terminal_name: "Terminal 1", value: 5, star_system_name: "Stanton", planet_name: "Hurston" }];
  globalThis[fixtureKey].api.getRefineryCapacities = [{ id_terminal: 1, value: 1234 }];
  const response = await buildAnswer(query("refinery_yields", { commodity }));
  assert.ok(response.table.headers.includes("Capacity (UEX value)"));
  assert.doesNotMatch(cell(response.table, 0, "Capacity (UEX value)"), /SCU/i);
  assert.match(response.text, /does not clearly specify the unit/);
});

test("Aluminum ore refinery lookup ranks reported yields and explains missing reports accurately", async () => {
  const ore = {id:6,name:"Aluminum (Ore)",id_parent:5};
  globalThis[fixtureKey].api.getRefineryYields = [
    {id_commodity:6,commodity_name:ore.name,id_terminal:1,terminal_name:"Refinery A",star_system_name:"Stanton",id_star_system:68,value:3},
    {id_commodity:6,commodity_name:ore.name,id_terminal:2,terminal_name:"Refinery B",star_system_name:"Stanton",id_star_system:68,value:8},
  ];
  const result = await buildAnswer(query("refinery_yields", {commodity:ore,raw:"Where is the best place to refine Aluminum (Ore)"}));
  assert.equal(result.table.rows[0][0], "Refinery B");
  assert.equal(cell(result.table,0,"Yield Bonus"), "+8%");
  globalThis[fixtureKey].api.getRefineryYields = [];
  const missing = await buildAnswer(query("refinery_yields", {commodity:ore}));
  assert.match(missing.text, /no reported refinery yield entries/);
  assert.doesNotMatch(missing.text, /not be refinable|in Min/);
});

test("combined buy and sell questions show shops for both directions", async () => {
  globalThis[fixtureKey].api.getCommodityPrices = [price(1,100,0),price(2,0,150),price(3,0,0)];
  const response = await buildAnswer(query("price_check",{commodity,raw:"Where can I buy and sell Laranite"}));
  assert.equal(response.table.rows.length,2);
  assert.deepEqual(response.table.rows.map(row=>row[0]),["Terminal 1","Terminal 2"]);
  assert.equal(cell(response.table,0,"Buy (aUEC/SCU)"),"100");
  assert.equal(cell(response.table,1,"Sell (aUEC/SCU)"),"150");
});

test("bulk ship purchase answers join terminal locations before choosing a vehicle's cheapest price", async () => {
  globalThis[fixtureKey].api.getVehiclePurchasePricesAll = [
    { id_vehicle: 100, vehicle_name: "C2 Hercules", id_terminal: 3, terminal_name: "Cheap Pyro Shipyard", price_buy: 100 },
    { id_vehicle: 100, vehicle_name: "C2 Hercules", id_terminal: 1, terminal_name: "Hurston Shipyard", price_buy: 500 },
  ];
  const response = await buildAnswer(query("vehicle_buy", { planet: { planetName: "Hurston", planetId: 1 } }));
  assert.deepEqual(response.table.rows, [["C2 Hercules", "500", "Hurston Shipyard"]]);
  assert.match(response.text, /on Hurston/);
  const shopResponse = await buildAnswer(query("vehicle_buy", {terminal: globalThis[fixtureKey].reference.terminals[0]}));
  assert.deepEqual(shopResponse.table.rows, [["C2 Hercules", "500", "Hurston Shipyard"]]);
  assert.match(shopResponse.text, /at Terminal 1/);
});
