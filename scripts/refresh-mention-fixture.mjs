import { readFile, writeFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
const source = await readFile(new URL("../src/lib/uex-client.ts", import.meta.url), "utf8");
const api = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const endpoints = { commodities: api.getCommodities, vehicles: api.getVehicles, starSystems: api.getStarSystems, terminals: api.getTerminals, planets: api.getPlanets, moons: api.getMoons, orbits: api.getOrbits, pointsOfInterest: api.getPointsOfInterest };
const fixture = { source: "https://api.uexcorp.space/2.0", captured: new Date().toISOString().slice(0,10) };
const fields = new Set(["id", "name", "name_full", "code", "nickname", "displayname", "is_available", "planet_name", "moon_name", "city_name", "space_station_name", "star_system_name"]);
for (const [key, load] of Object.entries(endpoints)) {
 const rows = await load();
 if (!rows.length) throw new Error("Empty catalogue: " + key);
 fixture[key] = rows.map(row => Object.fromEntries(Object.entries(row).filter(([field]) => fields.has(field) || field.startsWith("id_"))));
 console.log(key + ": " + rows.length);
}
await writeFile(new URL("../tests/fixtures/mentions.json", import.meta.url), JSON.stringify(fixture,null,2)+"\n");
