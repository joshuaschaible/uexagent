import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const asUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
let source = stripTypeScriptTypes(await readFile(new URL("../src/lib/mining-answer.ts", import.meta.url), "utf8"));
source = source.replaceAll('"./data/cache"', JSON.stringify(asUrl('export const getReferenceData = async () => { throw new Error("private upstream detail"); };')))
  .replaceAll('"./data/mining"', JSON.stringify(asUrl("export const getMiningData = async () => ({});")));
const { createMiningResponse, parseMiningIds, buildMiningAnswer } = await import(asUrl(source));

const systems = [{ id: 68, name: "Stanton" }, { id: 64, name: "Pyro" }];
const refined = { id: 47, id_parent: 48, name: "Laranite", is_extractable: 1 };
const raw = { id: 48, id_parent: 47, name: "Laranite (Raw)", is_raw: 1, is_extractable: 1,
  ids_planets: "243", ids_moons: "50,74", ids_orbits: "334", ids_poi: null, ids_star_systems: "64,68" };
const agricium = { id: 2, id_parent: 1, name: "Agricium (Ore)", is_raw: 1, is_extractable: 1,
  ids_planets: "245", ids_moons: "25", ids_orbits: null, ids_poi: "270", ids_star_systems: "64,68" };
const commodities = [refined, raw, agricium, { id: 3, name: "Gold (Ore)", is_extractable: 1 }];
const data = {
  planets: [{ id: 243, name: "Pyro IV", id_star_system: 64 }, { id: 245, name: "Terminus", id_star_system: 64 },
    { id: 4, name: "ArcCorp", id_star_system: 68 }, { id: 1, name: "Hurston", id_star_system: 68 },
    { id: 240, name: "Monox", name_origin: "Pyro II", id_star_system: 64 }],
  moons: [{ id: 50, name: "Lyria", name_origin: "Stanton III a", id_planet: 4, planet_name: "ArcCorp", id_star_system: 68 },
    { id: 74, name: "Wala", id_planet: 4, planet_name: "ArcCorp", id_star_system: 68 },
    { id: 25, name: "Daymar", planet_name: "Crusader", id_star_system: 68 }],
  orbits: [{ id: 334, name: "Hurston Lagrange Point 1", name_origin: "HUR-L1", code: "HUR-L1", is_lagrange: 1, id_star_system: 68 }],
  pointsOfInterest: [{ id: 270, name: "Pyro Asteroid Clusters", nickname: "Pyro Clusters", is_mining_related: 1, id_star_system: 64 }],
};
const answer = (query, cs = commodities) => createMiningResponse({ intent: "mining_locations", modifiers: [], ...query }, cs, systems, data);

test("comma-separated IDs reject malformed input and deduplicate", () => {
  assert.deepEqual(parseMiningIds(" 50,74,50,0,-1,wat,1e3,Infinity,9007199254740992,,"), [50, 74]);
  assert.deepEqual(parseMiningIds(null), []);
  assert.deepEqual(parseMiningIds(undefined), []);
});

test("refined commodity lookup returns only linked ore occurrences", () => {
  const response = answer({ raw: "Where can I mine Laranite?", commodity: refined });
  assert.deepEqual(response.table.rows.map((r) => r[1]).sort(), ["HUR-L1", "Lyria", "Pyro IV", "Wala"]);
  assert.ok(response.table.rows.every((r) => r[0] === "Laranite (Raw)"));
  assert.match(response.text, /4 mining locations/);
});

test("planet occurrence is not inferred from its moons or Lagrange points", () => {
  for (const name of ["ArcCorp", "Hurston"]) {
    const response = answer({ raw: `Which ores are found on ${name}?`, locationName: name });
    assert.equal(response.table, undefined);
    assert.match(response.text, /no recorded mining locations/);
    assert.match(response.text, /does not confirm/);
  }
});

test("reverse moon lookup and ore plus location filtering preserve occurrence records", () => {
  const response = answer({ raw: "Which ores are found on Daymar?", locationName: "Daymar" });
  assert.deepEqual(response.table.rows, [["Agricium (Ore)", "Daymar", "Moon", "Stanton", "Crusader"]]);
  const mismatch = answer({ raw: "Can I mine Laranite on Daymar?", locationName: "Daymar", commodity: refined });
  assert.equal(mismatch.table, undefined);
  assert.match(mismatch.text, /does not confirm/);
});

test("planet names containing a system name do not broaden the query", () => {
  const response = answer({ raw: "What can I mine on Pyro IV?", locationName: "Pyro IV" });
  assert.deepEqual(response.table.rows.map((r) => r[1]), ["Pyro IV"]);
  const alias = answer({ raw: "Can I mine Laranite on Pyro II?", locationName: "Pyro II", commodity: refined });
  assert.equal(alias.table, undefined);
  assert.match(alias.text, /Monox/);
  const moonAlias = answer({ raw: "What can I mine on Stanton III a?", locationName: "Stanton III a" });
  assert.deepEqual(moonAlias.table.rows.map((r) => r[1]), ["Lyria"]);
});

test("Lagrange aliases and mining POIs resolve to their IDs", () => {
  for (const location of ["HUR-L1", "HUR L1", "Hurston Lagrange Point 1"]) {
    const response = answer({ raw: `Which ores at ${location}?`, locationName: location });
    assert.equal(response.table.rows.length, 1);
    assert.equal(response.table.rows[0][1], "HUR-L1");
  }
  const response = answer({ raw: "What can I mine in Pyro Clusters?", locationName: "Pyro Clusters" });
  assert.deepEqual(response.table.rows.map((r) => r[1]), ["Pyro Asteroid Clusters"]);
});

test("system filters include only locations in that system", () => {
  const response = answer({ raw: "Where can I mine Laranite in Stanton?", commodity: refined, locationName: "Stanton" });
  assert.equal(response.table.rows.length, 3);
  assert.ok(response.table.rows.every((r) => r[3] === "Stanton"));
});

test("unknown locations cannot silently produce worldwide results", () => {
  const response = answer({ raw: "Where can I mine Laranite on Mars?", locationName: "Mars", commodity: refined });
  assert.equal(response.table, undefined);
  assert.match(response.text, /couldn't match \*\*Mars\*\*/);
  const partiallyUnknown = answer({ raw: "Can I mine Laranite on Pyro 9?", locationName: "Pyro 9", commodity: refined });
  assert.equal(partiallyUnknown.table, undefined);
  assert.match(partiallyUnknown.text, /couldn't match/);
});

test("unmapped ore and system-only evidence do not invent detailed locations", () => {
  const unmapped = answer({ raw: "Where can I mine Gold?", commodity: commodities[3] });
  assert.equal(unmapped.table, undefined);
  assert.match(unmapped.text, /no recorded/);
  const systemOnly = { id: 99, name: "Unobtainium (Ore)", is_extractable: 1, ids_star_systems: "68" };
  const result = answer({ raw: "Where can I mine Unobtainium?", commodity: systemOnly }, [systemOnly]);
  assert.equal(result.table.rows[0][2], "Star system (area unspecified)");
});

test("missing subjects prompt for an ore or location and upstream failures stay safe", async () => {
  assert.match(answer({ raw: "Where can I mine?" }).text, /Tell me an ore or a mining location/);
  const response = await buildMiningAnswer({ raw: "Where can I mine Laranite?", commodity: refined });
  assert.match(response.text, /couldn't load UEX/);
  assert.doesNotMatch(response.text, /private upstream/);
});
