import { readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
const asUrl = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const api = asUrl(await readFile(new URL("../src/lib/uex-client.ts", import.meta.url), "utf8"));
const client = await import(asUrl((await readFile(new URL("../src/lib/equipment-client.ts", import.meta.url), "utf8")).replaceAll('"@/lib/uex-client"', JSON.stringify(api))));
const categories = client.selectEquipmentCategories(await client.getEquipmentCategories(), "ship components");
const items = await client.getEquipmentSuggestions("");
if (!categories.length || !items.length) throw new Error("Refusing to replace the fixture with an empty catalogue");
const fixture = {
  source: "https://api.uexcorp.space/2.0",
  captured: new Date().toISOString().slice(0, 10),
  categories: categories.map(({id, type, section, name}) => ({id, type, section, name})),
  items: items.map(({id, id_category, name, size, game_version}) => ({id, id_category, name, size, game_version})),
};
await writeFile(new URL("../tests/fixtures/components.json", import.meta.url), JSON.stringify(fixture, null, 2) + "\n");
console.log(`Saved ${items.length} components across ${categories.length} categories. No credentials are stored in the fixture.`);
