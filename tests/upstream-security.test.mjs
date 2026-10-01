import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

let moduleId = 0;
const fixtureKey = "__uexUpstreamSecurityTest";
const asModuleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

async function loadModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  for (const [specifier, replacement] of Object.entries(imports)) {
    source = source.replaceAll(JSON.stringify(specifier), JSON.stringify(asModuleUrl(replacement)));
  }
  return import(asModuleUrl(`${source}\n// isolated test module ${moduleId++}`));
}

const sdkMock = `
export default class OpenAI {
  constructor(options) { globalThis.${fixtureKey}.options.push(options); }
  chat = { completions: { create: async () => {
    const state = globalThis.${fixtureKey};
    if (state.error) throw state.error;
    return state.completion;
  } } };
}`;
const resolverMock = ["findCommodity", "findStarSystem", "findPlanet", "findMoon", "findVehicle", "findTerminal"]
  .map((name) => `export function ${name}(name) { globalThis.${fixtureKey}.resolved.push(name); return undefined; }`)
  .join("\n");
const referenceData = { commodities: [], vehicles: [], starSystems: [], terminals: [], commodityMap: new Map(), vehicleMap: new Map(), starSystemMap: new Map() };
const parserMock = "export const parseCraftingQuery = () => null; export const extractModifiers = () => []; export const isMiningLocationQuery = () => false; export const parseMiningQuery = () => ({ intent: 'mining_locations' }); export const isEquipmentQuery = () => false; export const parseEquipmentQuery = () => ({intent:'equipment_info'}); export const parseTemporalFilters = () => ({}); export const extractMiningLocation = () => undefined; export const explicitCommodityTradeIntent = () => undefined; export const parseQuery = () => ({intent:'unknown'});";

function mockLLM(t) {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";
  const state = { options: [], resolved: [], completion: { choices: [] } };
  globalThis[fixtureKey] = state;
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    delete globalThis[fixtureKey];
  });
  return state;
}

test("classifier rejects malformed model entities before entity resolution", async (t) => {
  const state = mockLLM(t);
  const { classifyWithLLM } = await loadModule("src/lib/llm-classifier.ts", {
    openai: sdkMock,
    "./query-parser": parserMock,
    "./data/cache": resolverMock,
  });
  const valid = { intent: "buy", confidence: 0.9, entities: { commodity: "Gold", budget: 50000 } };
  const invalid = [
    null,
    { ...valid, confidence: "0.9" },
    { ...valid, confidence: 2 },
    { ...valid, entities: [] },
    { ...valid, entities: { commodity: ["Gold", 123] } },
    { ...valid, entities: { commodity: Array(9).fill("Gold") } },
    { ...valid, entities: { vehicle: { name: "C2" } } },
    { ...valid, entities: { terminal: "x".repeat(201) } },
    { ...valid, entities: { budget: -1 } },
    { ...valid, entities: { budget: Number.MAX_SAFE_INTEGER + 1 } },
    { ...valid, entities: { category: "arbitrary category" } },
    { ...valid, entities: { equipment_size: "2" } },
    { ...valid, entities: { equipment_size: -1 } },
    { ...valid, entities: { equipment_size: 10 } },
    { ...valid, entities: { equipment_size: 2.5 } },
  ];
  for (const value of invalid) {
    state.completion = { choices: [{ message: { content: JSON.stringify(value) } }] };
    assert.equal(await classifyWithLLM("buy Gold", referenceData), null);
  }
  assert.deepEqual(state.resolved, []);
  state.completion = { choices: [{ message: { content: JSON.stringify(valid) } }] };
  assert.equal((await classifyWithLLM("buy Gold", referenceData)).budget, 50000);
  assert.deepEqual(state.resolved, ["Gold"]);
  assert.ok(state.options.every((options) => options.timeout === 8000 && options.maxRetries === 0));
});

test("classifier logs do not contain user prompts or SDK error details", async (t) => {
  const state = mockLLM(t);
  const logs = [];
  t.mock.method(console, "warn", (...args) => logs.push(args.join(" ")));
  t.mock.method(console, "log", (...args) => logs.push(args.join(" ")));
  const { classifyWithLLM } = await loadModule("src/lib/llm-classifier.ts", {
    openai: sdkMock,
    "./query-parser": parserMock,
    "./data/cache": resolverMock,
  });
  state.error = new Error("secret-sdk-token");
  assert.equal(await classifyWithLLM("private-user-message", referenceData), null);
  assert.ok(logs.length > 0);
  assert.doesNotMatch(logs.join(" "), /private-user-message|secret-sdk-token/);
});

test("fallback accepts only supported function calls with bounded text arguments", async (t) => {
  const state = mockLLM(t);
  state.parseCalls = [];
  const { llmFallback } = await loadModule("src/lib/llm-fallback.ts", {
    openai: sdkMock,
    "./answer-builder": "export const buildAnswer = async () => ({ text: 'safe result' });",
    "./query-parser": `export const parseQuery = (query) => { globalThis.${fixtureKey}.parseCalls.push(query); return { intent: 'unknown' }; };`,
    "./data/cache": "export const getReferenceData = async () => ({});",
  });
  const functionCall = (query) => ({ type: "function", function: { name: "buy_commodity", arguments: JSON.stringify({ query }) } });
  for (const call of [
    { type: "custom", custom: { name: "unknown", input: "x" } },
    functionCall({ injected: true }),
    functionCall("x".repeat(2001)),
    functionCall(" "),
    { type: "function", function: { name: "unexpected", arguments: '{"query":"buy Gold"}' } },
  ]) {
    state.completion = { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [call] } }] };
    assert.equal(await llmFallback("buy Gold"), null);
  }
  assert.deepEqual(state.parseCalls, []);
  state.completion = { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [functionCall("buy Gold")] } }] };
  assert.equal((await llmFallback("buy Gold")).text, "safe result");
  assert.deepEqual(state.parseCalls, ["buy Gold"]);
  assert.ok(state.options.every((options) => options.timeout === 8000 && options.maxRetries === 0));
});

test("reference loads are coalesced and clear prevents stale repopulation", async (t) => {
  const state = { requests: [] };
  globalThis[fixtureKey] = state;
  t.after(() => delete globalThis[fixtureKey]);
  const names = ["getCommodities", "getTerminals", "getStarSystems", "getVehicles", "getRefineryMethods", "getFuelPricesAll"];
  const exports = names.map((name) => `export const ${name} = () => new Promise((resolve, reject) => globalThis.${fixtureKey}.requests.push({ name: '${name}', resolve, reject }));`).join("\n");
  const { getReferenceData, clearCache } = await loadModule("src/lib/data/cache.ts", {
    "@/lib/uex-client": exports,
    "./mining": "export const clearMiningDataCache = () => {};",
  });
  const first = getReferenceData();
  const sharedFirst = getReferenceData();
  assert.equal(state.requests.length, 6);
  clearCache();
  const second = getReferenceData();
  assert.equal(state.requests.length, 12);
  for (const request of state.requests.slice(0, 6)) request.resolve([]);
  await Promise.all([first, sharedFirst]);
  const sharedSecond = getReferenceData();
  assert.equal(state.requests.length, 12);
  for (const request of state.requests.slice(6)) request.resolve([]);
  const [data, sharedData] = await Promise.all([second, sharedSecond]);
  assert.equal(data, sharedData);
  assert.equal(await getReferenceData(), data);
  clearCache();
  const failing = getReferenceData();
  for (const request of state.requests.slice(12)) request.reject(new Error("upstream down"));
  await assert.rejects(failing, /upstream down/);
  const retry = getReferenceData();
  assert.equal(state.requests.length, 24);
  for (const request of state.requests.slice(18)) request.resolve([]);
  await retry;
});

test("UEX fetch bounds requests and rejects malformed response envelopes", async (t) => {
  let response = { status: "ok", data: [] };
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => response };
  });
  const { getCommodities, uexFetch } = await loadModule("src/lib/uex-client.ts");
  assert.deepEqual(await getCommodities(), []);
  response = { status: "ok", data: null };
  assert.deepEqual(await uexFetch("items", { id_category: 81 }, { allowEmpty: true }), []);
  await assert.rejects(getCommodities(), /invalid response/);
  response = { status: "error", message: "secret upstream message" };
  await assert.rejects(getCommodities(), { message: "UEX API returned an invalid response" });
  response = { status: "ok", data: {} };
  await assert.rejects(getCommodities(), /invalid response/);
});

test("wiki cache evicts old entries instead of growing without limit", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    requests++;
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ query: { pages: { 1: { pageid: 1, title: "Ship", extract: "Ship facts." } } } }) };
  });
  const { getPageExtract } = await loadModule("src/lib/wiki-client.ts");
  for (let i = 0; i < 257; i++) await getPageExtract(`Ship ${i}`);
  assert.equal(requests, 257);
  await getPageExtract("Ship 256");
  assert.equal(requests, 257);
  await getPageExtract("Ship 0");
  assert.equal(requests, 258);
});
