import type { ParsedQuery } from "@/lib/query-parser";
import type { ChatResponse, NamedTable } from "@/lib/types";
import {
  getEquipmentCategories, getEquipmentItems, getEquipmentAttributes, getEquipmentCategoryAttributes, getEquipmentPrices,
  matchEquipmentItems, normalizeEquipmentName, selectEquipmentCategories, getEquipmentSuggestions,
  type EquipmentItem, type EquipmentPrice, type EquipmentAttribute,
} from "@/lib/equipment-client";

const money = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const reported = (timestamp?: number) => timestamp && Number.isFinite(timestamp) && timestamp > 0 && timestamp < 253402300799
  ? new Date(timestamp * 1000).toISOString().slice(0, 10) : "Unknown";
const place = (row: EquipmentPrice) => [...new Set([row.city_name || row.space_station_name || row.outpost_name || row.moon_name, row.planet_name, row.star_system_name].filter(Boolean))].join(", ") || "Unknown";

export function filterEquipmentPrices(prices: EquipmentPrice[], query: ParsedQuery): EquipmentPrice[] {
  return prices.filter((row) => {
    if (!Number.isFinite(row.price_buy) || row.price_buy <= 0) return false;
    if (query.terminal && row.id_terminal !== query.terminal.id) return false;
    if (query.starSystem && row.id_star_system !== query.starSystem.id) return false;
    if (query.planet && row.id_planet !== query.planet.planetId) return false;
    if (query.moon && row.id_moon !== query.moon.moonId) return false;
    if (query.orbit && row.id_orbit !== query.orbit.orbitId) return false;
    if (query.poi && row.id_poi !== query.poi.poiId) return false;
    if (query.city && row.id_city !== query.city.cityId) return false;
    if (query.station && normalizeEquipmentName(row.space_station_name || "") !== normalizeEquipmentName(query.station.stationName)) return false;
    const hasResolvedLocation = query.terminal || query.starSystem || query.planet || query.moon || query.orbit || query.poi || query.city || query.station;
    if (query.locationName && !hasResolvedLocation) {
      const name = normalizeEquipmentName(query.locationName);
      const names = [row.terminal_name, row.star_system_name, row.planet_name, row.moon_name, row.orbit_name, row.city_name, row.space_station_name, row.outpost_name];
      if (!names.some((value) => value && normalizeEquipmentName(value) === name)) return false;
    }
    if (query.gameVersion && row.game_version !== query.gameVersion && !row.game_version?.startsWith(`${query.gameVersion}.`)) return false;
    const day = reported(row.date_modified);
    if ((query.dateFrom || query.dateTo) && day === "Unknown") return false;
    if (query.dateFrom && day < query.dateFrom) return false;
    if (query.dateTo && day > query.dateTo) return false;
    return true;
  }).sort((a, b) => a.price_buy - b.price_buy || a.terminal_name.localeCompare(b.terminal_name));
}

function catalogue(items: EquipmentItem[], title: string): NamedTable {
  return {
    title,
    headers: ["Item", "Category", "Manufacturer", "Size", "Reported patch"],
    rows: items.slice(0, 50).map((item) => [item.name, item.category || "Unknown", item.company_name || "Unknown", item.size || "Unknown", item.game_version || "Unknown"]),
  };
}

function pricesTable(prices: EquipmentPrice[], title: string): NamedTable {
  return {
    title,
    headers: ["Item", "Shop", "Location", "Buy (aUEC/unit)", "Average (aUEC/unit)", "Durability", "Reported", "Patch"],
    rows: prices.slice(0, 50).map((row) => [row.item_name, row.terminal_name, place(row), money(row.price_buy), row.price_buy_avg && Number.isFinite(row.price_buy_avg) ? money(row.price_buy_avg) : "Unknown", row.durability == null ? "Unknown" : `${row.durability}%`, reported(row.date_modified), row.game_version || "Unknown"]),
  };
}

function attributeValue(attribute?: EquipmentAttribute): string {
  if (!attribute || attribute.value == null || attribute.value === "") return "Not reported";
  return [attribute.value, attribute.unit].filter(Boolean).join(" ");
}

export async function buildEquipmentAnswer(query: ParsedQuery): Promise<ChatResponse> {
  if (query.locationError) return { text: query.locationError };
  try {
    const categories = await getEquipmentCategories();
    let selected = selectEquipmentCategories(categories, query.equipmentCategory);
    if (query.itemName && (!query.equipmentCategory || selected.length > 3)) {
      const matching = matchEquipmentItems(await getEquipmentSuggestions(query.itemName), query.itemName);
      if (matching.length) {
        const ids = new Set(matching.map((item) => item.id_category));
        selected = (query.equipmentCategory ? selected : categories).filter((category) => ids.has(category.id));
      }
    }
    if (selected.length === 0 || selected.length > 3) {
      const choices = (selected.length ? selected : categories.filter((category) => /mining|scraper|salvage|gadgets|systems|weapons|armor/i.test(`${category.section} ${category.name}`))).slice(0, 30);
      return {
        text: "Choose a more specific equipment category so I can search its catalogue. For example: “quantum drive Atlas”, “mining laser Lancet MH2”, or “armor helmets”.",
        table: { headers: ["Section", "Category"], rows: choices.map((category) => [category.section, category.name]) },
      };
    }
    const lists = await Promise.all(selected.map((category) => getEquipmentItems(category.id)));
    const items = [...new Map(lists.flat().map((item) => [item.id, item])).values()]
      .filter((item) => query.equipmentSize === undefined || (item.size != null && String(item.size).trim() !== "" && Number(item.size) === query.equipmentSize));
    const sizeLabel = query.equipmentSize === undefined ? "" : `size ${query.equipmentSize} `;
    if (items.length === 0) return { text: `No ${sizeLabel}items are reported in ${selected.map((category) => category.name).join(", ")}. Items with an unknown size are excluded from size-filtered results.` };
    if (!query.itemName) {
      if (/\bbest\b/i.test(query.raw)) return {
        text: `What should “best” mean for ${sizeLabel}${selected.map((category) => category.name).join(", ")}? Specify the attribute you want to compare, or name two items.`,
        tables: [catalogue(items, "Matching equipment")],
      };
      if (query.intent === "equipment_compare") return { text: "Name two items to compare, such as “Compare Lancet MH2 vs Arbor MH1”.", tables: [catalogue(items, "Items in this category")] };
      if (query.intent === "equipment_buy") {
        const allPrices = (await Promise.all(selected.map((category) => getEquipmentPrices({ id_category: category.id })))).flat();
        const matchingIds = new Set(items.map((item) => item.id));
        const prices = filterEquipmentPrices(allPrices, query).filter((row) => matchingIds.has(row.id_item));
        const scope = query.locationName ? ` at ${query.locationName}` : "";
        if (query.equipmentSize !== undefined) {
          const rows = items.slice(0, 50).map((item) => {
            const offers = prices.filter((row) => row.id_item === item.id);
            const cheapest = offers[0];
            return [item.name, String(item.size), cheapest ? money(cheapest.price_buy) : "Not reported",
              cheapest ? `${cheapest.terminal_name} (${place(cheapest)})` : "No reported purchase location",
              [...new Set(offers.slice(1).map((row) => `${row.terminal_name} (${place(row)})`))].join("; ") || "—",
              cheapest ? reported(cheapest.date_modified) : "Unknown", cheapest?.game_version || "Unknown"];
          });
          return {
            text: `Found ${items.length} ${sizeLabel}${selected.map((category) => category.name).join(", ")} items${scope}. Showing ${rows.length}. Lowest reported prices and purchase locations are listed for each item; missing offers remain visible. Shop reports do not confirm current stock.`,
            table: { headers: ["Item", "Size", "Lowest buy (aUEC/unit)", "Lowest-price shop / location", "Other reported shops / locations", "Price reported", "Price patch"], rows },
          };
        }
        return prices.length
          ? { text: `Found ${prices.length} reported equipment offers${scope}, sorted by purchase price. Showing ${Math.min(prices.length, 50)}. Prices are per item.`, tables: [pricesTable(prices, "Equipment purchase locations")] }
          : { text: `No reported purchase prices found${scope} for ${selected.map((category) => category.name).join(", ")}.`, tables: [catalogue(items, "Catalogue items (availability not confirmed)")] };
      }
      const tables = [catalogue(items, "Equipment catalogue")];
      let specificationNote = "";
      // A single category request exposes the scraper overview without fetching every item separately.
      if (selected.length === 1 && normalizeEquipmentName(selected[0].name) === "scraper beams") {
        try {
          const attributes = await getEquipmentCategoryAttributes(selected[0].id);
          const shown = items.slice(0, 50);
          const properties = ["Extraction Efficiency", "Extraction Speed", "Radius", "Volume"];
          tables.push({
            title: "Reported scraper specifications",
            headers: ["Item", ...properties, "Specification report dates"],
            rows: shown.map((item) => {
              const itemAttributes = attributes.filter((attribute) => attribute.id_item === item.id);
              const dates = [...new Set(itemAttributes.map((attribute) => reported(attribute.date_modified)))];
              return [item.name, ...properties.map((name) => attributeValue(itemAttributes.find((attribute) => attribute.attribute_name === name))), dates.join(", ") || "Unknown"];
            }),
          });
          specificationNote = " Specifications retain UEX's values and units; missing values are not reported. Check specification dates and item patches separately from shop-price reports.";
        } catch {
          specificationNote = " Scraper specifications are temporarily unavailable; the catalogue is still shown.";
        }
      }
      return { text: `Found ${items.length} items in ${selected.map((category) => category.name).join(", ")}. Showing ${Math.min(items.length, 50)}. Ask about a name for attributes and purchase locations.${specificationNote}`, tables };
    }

    if (query.intent === "equipment_compare" && !query.itemName2) return { text: "Name a second item to compare, such as “Compare Lancet MH2 vs Arbor MH1”." };
    const requestedNames = [query.itemName, ...(query.intent === "equipment_compare" && query.itemName2 ? [query.itemName2] : [])];
    const matches = requestedNames.map((name) => matchEquipmentItems(items, name));
    for (let index = 0; index < matches.length; index++) {
      if (matches[index].length !== 1) {
        const options = matches[index].length ? matches[index] : items;
        return {
          text: matches[index].length
            ? `“${requestedNames[index]}” matches ${matches[index].length} items. Choose an exact name below.`
            : `I couldn't find “${requestedNames[index]}” in ${selected.map((category) => category.name).join(", ")}. Try an exact item name below or specify another equipment category.`,
          tables: [catalogue(options, matches[index].length ? "Matching items" : "Items in the searched categories")],
        };
      }
    }
    const found = matches.map((result) => result[0]);
    const details = await Promise.all(found.map(async (item) => {
      const [attributesResult, pricesResult] = await Promise.allSettled([getEquipmentAttributes(item.id), getEquipmentPrices({ id_item: item.id })]);
      return {
        item,
        attributes: attributesResult.status === "fulfilled" ? attributesResult.value : [],
        prices: pricesResult.status === "fulfilled" ? filterEquipmentPrices(pricesResult.value, query) : [],
        attributesUnavailable: attributesResult.status === "rejected",
        pricesUnavailable: pricesResult.status === "rejected",
      };
    }));
    const tables: NamedTable[] = [];
    if (query.intent === "equipment_compare") {
      const attributes = [...new Set(details.flatMap((detail) => detail.attributes.map((attribute) => attribute.attribute_name)))].sort();
      tables.push({
        title: "Equipment comparison",
        headers: ["Property", ...found.map((item) => item.name)],
        rows: [
          ["Manufacturer", ...found.map((item) => item.company_name || "Unknown")],
          ["Category", ...found.map((item) => item.category || "Unknown")],
          ["Size", ...found.map((item) => item.size || "Unknown")],
          ["Reported item patch", ...found.map((item) => item.game_version || "Unknown")],
          ["Specification report dates", ...details.map((detail) => [...new Set(detail.attributes.map((attribute) => reported(attribute.date_modified)))].join(", ") || "Unknown")],
          ["Lowest reported purchase price", ...details.map((detail) => detail.prices[0] ? `${money(detail.prices[0].price_buy)} aUEC` : "Not reported")],
          ...attributes.slice(0, 60).map((name) => [name, ...details.map((detail) => attributeValue(detail.attributes.find((attribute) => attribute.attribute_name === name)))]),
        ],
      });
    } else {
      tables.push(catalogue(found, "Item details"));
      const attributes = details[0].attributes;
      if (attributes.length && query.intent === "equipment_info") tables.push({ title: "Reported attributes", headers: ["Attribute", "Value", "Reported"], rows: attributes.slice(0, 60).map((attribute) => [attribute.attribute_name, attributeValue(attribute), reported(attribute.date_modified)]) });
    }
    for (const detail of details) if (detail.prices.length) tables.push(pricesTable(detail.prices, `${detail.item.name} — purchase locations (${detail.prices.length})`));
    const notes = details.flatMap((detail) => {
      const messages: string[] = [];
      if (detail.attributesUnavailable) messages.push(`${detail.item.name}: attributes are temporarily unavailable.`);
      if (detail.pricesUnavailable) messages.push(`${detail.item.name}: shop prices are temporarily unavailable.`);
      else if (!detail.prices.length) messages.push(`${detail.item.name}: no reported purchase prices${query.locationName ? ` at ${query.locationName}` : ""} match these filters.`);
      return messages;
    });
    const first = details[0];
    const cheapest = first.prices[0];
    const lead = query.intent === "equipment_buy" && cheapest
      ? `**${first.item.name}**: lowest reported price is **${money(cheapest.price_buy)} aUEC** at **${cheapest.terminal_name}** (${place(cheapest)}). Shop reports do not confirm current stock.`
      : query.intent === "equipment_compare"
        ? `**${found.map((item) => item.name).join(" vs ")}** — compare reported specifications below.`
        : `**${first.item.name}** — ${first.item.category || selected[0].name}${first.item.size ? `, size ${first.item.size}` : ""}.`;
    return { text: `${lead}${notes.length ? `\n\n${notes.join(" ")}` : ""}`, tables };
  } catch {
    return { text: "Equipment data is temporarily unavailable. Please try again shortly." };
  }
}
