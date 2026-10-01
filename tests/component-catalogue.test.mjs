import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

const fixture = JSON.parse(await readFile(new URL("./fixtures/components.json", import.meta.url), "utf8"));
const asUrl = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
globalThis.__componentCatalogue = fixture;
const api = asUrl(`export async function uexFetch(endpoint, params) {
 const fixture = globalThis.__componentCatalogue;
 if (endpoint === "categories") return fixture.categories;
 if (endpoint === "items") return fixture.items.filter(item => item.id_category === params.id_category);
 throw new Error("Unexpected endpoint: " + endpoint);
}`);
const client = await import(asUrl((await readFile(new URL("../src/lib/equipment-client.ts", import.meta.url), "utf8")).replaceAll('"@/lib/uex-client"', JSON.stringify(api))));

test("every captured component is available in a cold catalogue and resolves by its name variants", async t => {
  client.clearEquipmentCache();
  const catalogue = await client.getEquipmentSuggestions("");
  assert.ok(fixture.items.length > 0);
  assert.deepEqual(new Set(catalogue.map(item => item.id)), new Set(fixture.items.map(item => item.id)));
  for (const item of fixture.items) {
    await t.test(item.name + " [" + item.id + "]", async () => {
      const variants = new Set([item.name, item.name.toLowerCase(), item.name.replace(/-/g, " "), item.name.replace(/[\s-]/g, "")]);
      for (const name of variants) {
        assert.ok((await client.getEquipmentSuggestions(name)).some(match => match.id === item.id), "Suggestion missing: " + name);
        const exact = catalogue.filter(candidate => client.normalizeEquipmentName(candidate.name) === client.normalizeEquipmentName(name));
        const matches = client.matchEquipmentItems(catalogue, name);
        // A punctuation variant can itself be another canonical name (SNS-R7 / SNSR7).
        // Preserve explicit exact-name precedence rather than force the other identity.
        if (exact.length) assert.deepEqual(new Set(matches.map(match => match.id)), new Set(exact.map(match => match.id)), "Exact-name precedence: " + name);
        else assert.ok(matches.some(match => match.id === item.id), "Name variant missing: " + name);
      }
    });
  }
});

test("unknown names stay unmatched instead of selecting an unrelated component", async () => {
  const catalogue = await client.getEquipmentSuggestions("");
  assert.deepEqual(client.matchEquipmentItems(catalogue, "ImaginaryComponent999999"), []);
  assert.deepEqual(await client.getEquipmentSuggestions("ImaginaryComponent999999"), []);
});

test("punctuation collisions preserve canonical identities and expose ambiguous variants", () => {
  const compact = value => client.normalizeEquipmentName(value).replace(/\s/g, "");
  const groups = Map.groupBy(fixture.items, item => compact(item.name));
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const item of group) {
      const exact = fixture.items.filter(candidate => client.normalizeEquipmentName(candidate.name) === client.normalizeEquipmentName(item.name));
      assert.deepEqual(new Set(client.matchEquipmentItems(fixture.items, item.name).map(match => match.id)), new Set(exact.map(match => match.id)));
    }
    const variant = [...compact(group[0].name)].join(" ");
    assert.deepEqual(new Set(client.matchEquipmentItems(fixture.items, variant).map(match => match.id)), new Set(group.map(item => item.id)));
  }
});
