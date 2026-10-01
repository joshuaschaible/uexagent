import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
}

const securityUrl = moduleUrl(await readFile(new URL("../src/lib/request-security.ts", import.meta.url), "utf8"));
const security = await import(securityUrl);
const referenceData = { commodityMap: new Map(), starSystemMap: new Map(), terminals: [], vehicleMap: new Map() };
const dependencies = {
  getReferenceData: async () => referenceData,
  findVehicle: () => undefined,
  enrichQueryLocations: async (query) => query,
  parseCraftingQuery: () => null,
  parseQuery: () => ({ raw: "hello", intent: "unknown" }),
  buildAnswer: async () => ({ text: "Hello there!" }),
  resolveContext: (query) => query,
  isExplicitFollowUp: () => false,
  classifyWithLLM: async () => null,
  isLLMClassifierAvailable: () => false,
};
const dependencyKey = Symbol.for("trade-bot.stream-security-test-dependencies");
globalThis[dependencyKey] = dependencies;
const stubs = moduleUrl(`const dependencies = globalThis[Symbol.for("trade-bot.stream-security-test-dependencies")];
${Object.keys(dependencies).map((name) => `export const ${name} = (...args) => dependencies.${name}(...args);`).join("\n")}`);
const routeSource = await readFile(new URL("../src/app/api/chat/stream/route.ts", import.meta.url), "utf8");
const route = await import(moduleUrl(routeSource.replace(/from "(@\/lib\/[^\"]+)"/g, (_, name) =>
  `from ${JSON.stringify(name === "@/lib/request-security" ? securityUrl : stubs)}`)));

function request(signal) {
  return new Request("http://127.0.0.1:3000/api/chat/stream", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "hello" }), signal,
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

function resetDependencies() {
  dependencies.getReferenceData = async () => referenceData;
  dependencies.buildAnswer = async () => ({ text: "Hello there!" });
}

function assertAllSlotsAvailable() {
  const releases = [];
  try {
    for (let index = 0; index < 4; index += 1) releases.push(security.chatRequestLimiter.acquire());
  } finally {
    releases.forEach((release) => release());
  }
}

test("consumer cancellation during data fetch stops the pipeline and holds its slot until work settles", async () => {
  resetDependencies();
  const pending = deferred();
  let answerCalls = 0;
  dependencies.getReferenceData = () => pending.promise;
  dependencies.buildAnswer = async () => { answerCalls += 1; return { text: "Unexpected" }; };
  const response = await route.POST(request());
  const reader = response.body.getReader();
  await reader.cancel();

  const held = [];
  try {
    for (let index = 0; index < 3; index += 1) held.push(security.chatRequestLimiter.acquire());
    assert.throws(() => security.chatRequestLimiter.acquire(), (error) => error.status === 429);
  } finally {
    held.forEach((release) => release());
    pending.resolve(referenceData);
  }
  await settled();
  assert.equal(answerCalls, 0);
  assertAllSlotsAvailable();
});

test("an upstream failure after cancellation does not enqueue or close an already cancelled controller", async () => {
  resetDependencies();
  const pending = deferred();
  dependencies.buildAnswer = () => pending.promise;
  const response = await route.POST(request());
  await settled();
  await response.body.cancel();
  pending.reject(new Error("Simulated upstream failure after disconnect"));
  await settled();
  assertAllSlotsAvailable();
});

test("request abort closes the readable side while reference work finishes", async () => {
  resetDependencies();
  const pending = deferred();
  const controller = new AbortController();
  dependencies.getReferenceData = () => pending.promise;
  const response = await route.POST(request(controller.signal));
  const reader = response.body.getReader();
  controller.abort();
  assert.equal((await reader.read()).done, true);
  pending.resolve(referenceData);
  await settled();
  assertAllSlotsAvailable();
});

test("cancelling during the typing pause releases the timer and concurrency slot", async () => {
  resetDependencies();
  const response = await route.POST(request());
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);
  await reader.cancel();
  await settled();
  assertAllSlotsAvailable();
});

test("a complete answer retains text, structured data, and the final SSE event", async () => {
  resetDependencies();
  dependencies.buildAnswer = async () => ({ text: "Hello there!", table: { columns: ["Name"], rows: [["Laranite"]] }, isLLM: true });
  const response = await route.POST(request());
  const events = (await response.text()).trim().split("\n\n").map((line) => JSON.parse(line.slice(6)));
  assert.equal(events.filter((event) => event.type === "text").map((event) => event.content).join(""), "Hello there!");
  assert.ok(events.filter((event) => event.type === "text").length > 1);
  assert.equal(events.find((event) => event.type === "table").content.rows[0][0], "Laranite");
  assert.equal(events.find((event) => event.type === "meta").isLLM, true);
  assert.equal(events.at(-1).type, "done");
});

test('Wiki crafting requests work without loading UEX reference data', async () => {
  resetDependencies();
  dependencies.parseCraftingQuery = text => ({intent:'craft_recipe', itemName:'XL-1', raw:text, modifiers:[]});
  dependencies.getReferenceData = async () => { throw new Error('UEX must not be requested'); };
  try {
    const response = await route.POST(request());
    const events = (await response.text()).split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    assert.equal(events.filter(event => event.type === "text").map(event => event.content).join(""), "Hello there!");
  } finally {
    dependencies.parseCraftingQuery = () => null;
    resetDependencies();
  }
  assertAllSlotsAvailable();
});
