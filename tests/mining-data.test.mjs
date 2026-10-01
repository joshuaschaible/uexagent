import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const fixtureKey = "__miningDataTest";
const methods = ["getPlanets", "getMoons", "getOrbits", "getPointsOfInterest"];
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
let moduleId = 0;

async function loadModule(path, imports = {}) {
  let source = stripTypeScriptTypes(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
  for (const [name, replacement] of Object.entries(imports)) {
    source = source.replaceAll(JSON.stringify(name), JSON.stringify(moduleUrl(replacement)));
  }
  return import(moduleUrl(`${source}\n// isolated mining test ${moduleId++}`));
}

async function loadMining(t) {
  const state = { requests: [] };
  globalThis[fixtureKey] = state;
  t.after(() => delete globalThis[fixtureKey]);
  const exports = methods.map((name) => `export const ${name} = () => new Promise((resolve, reject) => globalThis.${fixtureKey}.requests.push({ name: '${name}', resolve, reject }));`).join("\n");
  const mining = await loadModule("src/lib/data/mining.ts", { "@/lib/uex-client": exports });
  return { ...mining, state };
}

function resolveBatch(state, start, marker) {
  state.requests.slice(start, start + 4).forEach((request) => request.resolve([{ id: marker, name: request.name }]));
}

test("mining data loads lazily, coalesces concurrent queries and refreshes after one hour", async (t) => {
  const { getMiningData, state } = await loadMining(t);
  let now = 10_000;
  t.mock.method(Date, "now", () => now);
  assert.equal(state.requests.length, 0);
  const first = getMiningData();
  const shared = getMiningData();
  assert.deepEqual(state.requests.map((request) => request.name), methods);
  resolveBatch(state, 0, 1);
  const data = await first;
  assert.equal(await shared, data);
  assert.equal(data.planets[0].name, "getPlanets");
  assert.equal(data.moons[0].name, "getMoons");
  assert.equal(data.orbits[0].name, "getOrbits");
  assert.equal(data.pointsOfInterest[0].name, "getPointsOfInterest");
  now += 3_599_999;
  assert.equal(await getMiningData(), data);
  assert.equal(state.requests.length, 4);
  now += 1;
  const refresh = getMiningData();
  assert.equal(state.requests.length, 8);
  resolveBatch(state, 4, 2);
  assert.equal((await refresh).planets[0].id, 2);
});

test("a failed mining lookup can be retried without caching partial data", async (t) => {
  const { getMiningData, state } = await loadMining(t);
  const first = getMiningData();
  const shared = getMiningData();
  state.requests[2].reject(new Error("orbits unavailable"));
  state.requests.filter((_, index) => index !== 2).forEach((request) => request.resolve([]));
  await Promise.all([
    assert.rejects(first, /orbits unavailable/),
    assert.rejects(shared, /orbits unavailable/),
  ]);
  const retry = getMiningData();
  assert.equal(state.requests.length, 8);
  resolveBatch(state, 4, 2);
  const data = await retry;
  assert.equal(data.orbits[0].id, 2);
  assert.equal(await getMiningData(), data);
});

test("clearing during a load prevents stale cache repopulation and preserves the new pending load", async (t) => {
  const { getMiningData, clearMiningDataCache, state } = await loadMining(t);
  const stale = getMiningData();
  clearMiningDataCache();
  const fresh = getMiningData();
  assert.equal(state.requests.length, 8);
  resolveBatch(state, 0, 1);
  assert.equal((await stale).planets[0].id, 1);
  const sharedFresh = getMiningData();
  assert.equal(state.requests.length, 8);
  resolveBatch(state, 4, 2);
  const data = await fresh;
  assert.equal(await sharedFresh, data);
  assert.equal((await getMiningData()).planets[0].id, 2);
});

test("clearing all reference data also clears mining without loading mining endpoints", async (t) => {
  const state = { clears: 0, calls: [] };
  globalThis[fixtureKey] = state;
  t.after(() => delete globalThis[fixtureKey]);
  const names = ["getCommodities", "getTerminals", "getStarSystems", "getVehicles", "getRefineryMethods", "getFuelPricesAll"];
  const exports = names.map((name) => `export const ${name} = async () => { globalThis.${fixtureKey}.calls.push('${name}'); return []; };`).join("\n");
  const { getReferenceData, clearCache } = await loadModule("src/lib/data/cache.ts", {
    "@/lib/uex-client": exports,
    "./mining": `export const clearMiningDataCache = () => { globalThis.${fixtureKey}.clears++; };`,
  });
  await getReferenceData();
  assert.deepEqual(state.calls, names);
  assert.equal(state.clears, 0);
  clearCache();
  assert.equal(state.clears, 1);
  assert.deepEqual(state.calls, names);
});
