import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const securityUrl = moduleUrl(await readFile(new URL("../src/lib/request-security.ts", import.meta.url), "utf8"));
const fixtureKey = "__cacheResetCalls";
const resetMethods = ["clearCache", "clearTradeDataCache", "clearRouteDistanceCache", "clearEquipmentCache"];
const stubUrl = moduleUrl(`
  export const getCacheAge = () => 1000;
  ${resetMethods.map((name) => `export const ${name} = () => globalThis.${fixtureKey}.push("${name}");`).join("\n")}
  export const revalidateTag = (...args) => globalThis.${fixtureKey}.push({ revalidateTag: args });
`);
const routeSource = await readFile(new URL("../src/app/api/cache-status/route.ts", import.meta.url), "utf8");
const route = await import(moduleUrl(routeSource.replace(/from "(@\/lib\/[^\"]+|next\/cache)"/g, (_, name) =>
  `from ${JSON.stringify(name === "@/lib/request-security" ? securityUrl : stubUrl)}`)));

test.beforeEach(() => {
  globalThis[fixtureKey] = [];
  const state = globalThis.tradeBotRequestLimitState.cache;
  state.active = 0;
  state.timestamps = [];
});
test.after(() => delete globalThis[fixtureKey]);
const request = (headers = {}) => new Request("http://127.0.0.1:3000/api/cache-status", {
  method: "DELETE", headers: { Origin: "http://127.0.0.1:3000", ...headers },
});

test("authorized reset clears every app cache and releases its request slot", async () => {
  const response = await route.DELETE(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { cleared: true });
  assert.deepEqual(globalThis[fixtureKey], [...resetMethods, { revalidateTag: ["uex-data", { expire: 0 }] }]);
  assert.equal(globalThis.tradeBotRequestLimitState.cache.active, 0);
});

test("cross-origin reset cannot clear any cache", async () => {
  const response = await route.DELETE(request({ Origin: "https://attacker.invalid" }));
  assert.equal(response.status, 403);
  assert.deepEqual(globalThis[fixtureKey], []);
});

test("rate-limited reset cannot clear caches again", async () => {
  await route.DELETE(request());
  await route.DELETE(request());
  const response = await route.DELETE(request());
  assert.equal(response.status, 429);
  assert.ok(response.headers.has("retry-after"));
  assert.equal(globalThis[fixtureKey].length, (resetMethods.length + 1) * 2);
  assert.equal(globalThis.tradeBotRequestLimitState.cache.active, 0);
});
