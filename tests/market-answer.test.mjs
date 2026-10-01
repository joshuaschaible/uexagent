import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const source = async (path) => stripTypeScriptTypes(await readFile(new URL(`../src/lib/${path}.ts`, import.meta.url), "utf8"));
const fixtureKey = "__marketAnswerFixture";
const uexStub = moduleUrl(`
  const call = async (method, params) => {
    const state = globalThis.${fixtureKey};
    state.calls.push({ method, params });
    if (state.fail === method) throw new Error("private upstream details");
    return state[method];
  };
  export const getCommodityPriceHistory = (params) => call("history", params);
  export const getCommodityPrices = (params) => call("prices", params);
  export const getCommodityPricesAll = () => call("prices");
  export const getGameVersions = () => call("versions");
  export const getTerminals = () => call("terminals");
  export const uexFetch = (endpoint, params) => call("alerts", { endpoint, ...params });
`);
const freshnessUrl = moduleUrl(await source("data-freshness"));
const tradeUrl = moduleUrl((await source("trade-data"))
  .replaceAll('"./uex-client"', JSON.stringify(uexStub))
  .replaceAll('"./data/cache"', JSON.stringify(moduleUrl("export const getReferenceData = async () => ({ terminals: [] });"))));
const moduleSource = (await source("market-answer"))
  .replaceAll('"./uex-client"', JSON.stringify(uexStub))
  .replaceAll('"./trade-data"', JSON.stringify(tradeUrl))
  .replaceAll('"./data-freshness"', JSON.stringify(freshnessUrl));
const { buildPriceHistoryAnswer, buildMarketAlertsAnswer, createPriceHistoryResponse, createHistoryTerminalChoices, createMarketAlertsResponse } = await import(moduleUrl(moduleSource));
const { reportTimestampMs, formatReportTimestamp, summarizeDataFreshness } = await import(freshnessUrl);

const commodity = { id: 47, name: "Laranite" };
const terminal = { id: 10, name: "Area18 TDD", displayname: "Area18 TDD", id_star_system: 68, star_system_name: "Stanton", id_planet: 4, planet_name: "ArcCorp" };
const otherTerminal = { id: 11, name: "Pyro Terminal", id_star_system: 64, star_system_name: "Pyro", id_moon: 9, moon_name: "Test Moon", id_orbit: 20, orbit_name: "Test Orbit", id_poi: 30, poi_name: "Test POI" };
const terminals = [terminal, otherTerminal];
const start = Date.parse("2026-09-23T12:00:00Z");
const report = (overrides = {}) => ({
  id: 1, id_commodity: commodity.id, id_terminal: terminal.id,
  commodity_name: commodity.name, terminal_name: terminal.name,
  price_buy: 100, price_sell: 120, status_buy: 3, status_sell: 3,
  scu_buy: 100, scu_sell: 100, date_added: start / 1000, game_version: "4.10.1", ...overrides,
});
const query = (overrides = {}) => ({ intent: "price_history", commodity, terminal, modifiers: [], raw: "Price history of Laranite at Area18 TDD", ...overrides });

test.beforeEach(() => {
  globalThis[fixtureKey] = { calls: [], history: [report()], prices: [report()], alerts: [report()], terminals, versions: { live: "4.10.1", ptu: null } };
});
test.after(() => delete globalThis[fixtureKey]);

test("history uses chronological dated reports, with missing sides as null and separate stock statuses", () => {
  const response = createPriceHistoryResponse(query(), [
    report({ id: 3, date_added: start + 120_000, price_buy: 0 }),
    report({ id: 2, date_added: (start + 60_000) / 1000, price_sell: 0 }),
    report({ status_buy: 1, scu_buy: 0 }),
    report({ id: 4, date_added: 0 }),
    report({ id: 5, id_terminal: 999, price_buy: 999999 }),
  ], "4.10.1");
  assert.deepEqual(response.chart.data.map((row) => row.timestamp), [start, start + 60_000, start + 120_000]);
  assert.deepEqual(response.chart.data.map((row) => row.buyPrice), [100, 100, null]);
  assert.deepEqual(response.chart.data.map((row) => row.sellPrice), [120, null, 120]);
  assert.equal(response.chart.terminalName, terminal.name);
  assert.match(response.table.rows[0][2], /Out of stock/);
  assert.equal(response.table.rows.at(-1)[0], "Unknown");
  assert.match(response.text, /excluded from the chart/);
  assert.ok(response.chart.data.every((point) => !["Min", "Average", "Current", "Max"].includes(point.label)));
});

test("history handles one report, no reports, and undated reports without inventing trends", () => {
  assert.match(createPriceHistoryResponse(query(), [report()]).text, /cannot establish a price trend/);
  assert.equal(createPriceHistoryResponse(query(), []).chart, undefined);
  const unknown = createPriceHistoryResponse(query(), [report({ date_added: 0 })]);
  assert.equal(unknown.chart, undefined);
  assert.match(unknown.text, /No usable dated quotes/);
});

test("date and version filters preserve only matching reports and reject impossible ranges", () => {
  const response = createPriceHistoryResponse(query({ dateFrom: "2026-09-23", dateTo: "2026-09-23", gameVersion: "4.10.1" }), [
    report(), report({ date_added: Date.parse("2026-09-23T23:59:59Z") / 1000 }),
    report({ date_added: Date.parse("2026-09-24T00:00:00Z") / 1000 }), report({ game_version: "4.9" }),
  ]);
  assert.equal(response.chart.data.length, 2);
  assert.equal(response.chart.gameVersion, "4.10.1");
  for (const range of [{ dateFrom: "2026-02-30" }, { dateFrom: "2026-09-24", dateTo: "2026-09-23" }]) {
    assert.match(createPriceHistoryResponse(query(range), [report()]).text, /valid date range/);
  }
});

test("unscoped history offers named terminal choices filtered by location, without a fake chart", () => {
  const response = createHistoryTerminalChoices(query({ terminal: undefined, starSystem: { id: 68, name: "Stanton" } }), [report(), report({ id_terminal: 11, terminal_name: "Pyro Terminal" }), report({ id_commodity: 99 })], terminals);
  assert.equal(response.chart, undefined);
  assert.equal(response.table.rows.length, 1);
  assert.match(response.table.rows[0][2], /Price history of Laranite at Area18 TDD/);
  assert.match(response.text, /historical coverage may differ/);
});

test("unknown locations stop history and alerts before fetching or broadening results", async () => {
  const unknown = query({ terminal: undefined, locationName: "Made Up Terminal" });
  for (const handler of [buildPriceHistoryAnswer, buildMarketAlertsAnswer]) {
    const response = await handler(unknown);
    assert.match(response.text, /couldn't match/);
    assert.equal(response.chart, undefined);
    assert.equal(response.table, undefined);
  }
  assert.equal(globalThis[fixtureKey].calls.length, 0);
});

test("explicit terminal history passes the requested game version; metadata failure preserves history", async () => {
  globalThis[fixtureKey].fail = "versions";
  const response = await buildPriceHistoryAnswer(query({ gameVersion: "4.10.1" }));
  assert.ok(response.chart);
  assert.deepEqual(globalThis[fixtureKey].calls.find((call) => call.method === "history").params, { id_commodity: 47, id_terminal: 10, game_version: "4.10.1" });
  assert.match(response.text, /LIVE version metadata is unavailable/);
});

test("alerts map inventory status correctly and suppress unavailable quotes without inventing changes", () => {
  const response = createMarketAlertsResponse(query({ intent: "market_alerts", terminal: undefined }), [
    report({ status_buy: 1, status_sell: 7 }), report({ date_added: (start + 60_000) / 1000, scu_buy: 0, scu_sell: 0 }),
  ], terminals, "4.10.1");
  assert.equal(response.table.rows.length, 2);
  assert.ok(response.table.rows.every((row) => row[3] === "—" && row[5] === "—"));
  assert.match(response.table.rows[1][4], /Out of stock/);
  assert.match(response.table.rows[1][6], /No demand/);
  assert.match(response.table.rows[0][4], /0 SCU stock/);
  assert.match(response.text, /no before\/after values/);
});

test("alerts apply location IDs via terminal references, commodity/date/version filters, and a 25-row cap", () => {
  const all = Array.from({ length: 30 }, (_, index) => report({ date_added: start / 1000 + index }));
  all.push(report({ id_terminal: 11 }), report({ id_commodity: 99 }), report({ game_version: "4.9" }));
  const response = createMarketAlertsResponse(query({ intent: "market_alerts", terminal: undefined, starSystem: { id: 68, name: "Stanton" }, dateFrom: "2026-09-23", gameVersion: "4.10.1" }), all, terminals);
  assert.equal(response.table.rows.length, 25);
  assert.match(response.text, /25 of 30/);
  assert.equal(response.table.rows[0][2], formatReportTimestamp(start + 29_000));
  for (const location of [{ moon: { moonId: 9, moonName: "Test Moon" } }, { orbit: { orbitId: 20, orbitName: "Test Orbit" } }, { poi: { poiId: 30, poiName: "Test POI" } }]) {
    const filtered = createMarketAlertsResponse(query({ terminal: undefined, ...location }), [report(), report({ id_terminal: 11, terminal_name: "Pyro Terminal" })], terminals);
    assert.equal(filtered.table.rows.length, 1);
    assert.equal(filtered.table.rows[0][1], "Pyro Terminal");
  }
});

test("alert wrapper scopes commodity requests and catches failures without exposing upstream details", async () => {
  const response = await buildMarketAlertsAnswer(query({ intent: "market_alerts" }));
  assert.ok(response.table);
  assert.deepEqual(globalThis[fixtureKey].calls.find((call) => call.method === "alerts").params, { endpoint: "commodities_alerts", id_commodity: 47 });
  globalThis[fixtureKey].fail = "alerts";
  const failed = await buildMarketAlertsAnswer(query());
  assert.match(failed.text, /couldn't load UEX/);
  assert.doesNotMatch(failed.text, /private upstream/);
});

test("freshness normalizes seconds/milliseconds, flags missing or older metadata, and never equates cache age to report age", () => {
  assert.equal(reportTimestampMs(start / 1000), start);
  assert.equal(reportTimestampMs(String(start)), start);
  for (const value of [0, -1, Infinity, NaN, null, undefined, "bad", ""]) assert.equal(reportTimestampMs(value), null);
  assert.equal(formatReportTimestamp(start), "2026-09-23 12:00:00 UTC");
  const summary = summarizeDataFreshness([report({ game_version: "4.9" }), report({ date_added: 0, game_version: null })], "4.10.1", start + 2 * 86_400_000);
  assert.match(summary, /newest 2d ago/);
  assert.match(summary, /over 24 hours old/);
  assert.match(summary, /no timestamp/);
  assert.match(summary, /no game version/);
  assert.match(summary, /differ from LIVE/);
  assert.match(summarizeDataFreshness([], null), /report time is unknown/);
});
