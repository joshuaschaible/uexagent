/**
 * Client for the Star Citizen Wiki (starcitizen.tools) MediaWiki API.
 * Fetches lore descriptions, images, and structured data for ships, systems, and manufacturers.
 */

const WIKI_BASE = "https://starcitizen.tools/api.php";

// In-memory cache with 1-hour TTL (wiki data is relatively static)
const wikiCache = new Map<string, { data: unknown; time: number }>();
const WIKI_CACHE_TTL = 60 * 60 * 1000;
const WIKI_CACHE_LIMIT = 256;

function getCached<T>(key: string): T | null {
  const entry = wikiCache.get(key);
  if (entry && Date.now() - entry.time < WIKI_CACHE_TTL) {
    // Refresh insertion order so eviction retains recently used entries.
    wikiCache.delete(key);
    wikiCache.set(key, entry);
    return entry.data as T;
  }
  if (entry) wikiCache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  const now = Date.now();
  for (const [cachedKey, entry] of wikiCache) {
    if (now - entry.time >= WIKI_CACHE_TTL) wikiCache.delete(cachedKey);
  }
  wikiCache.delete(key);
  while (wikiCache.size >= WIKI_CACHE_LIMIT) {
    const oldestKey = wikiCache.keys().next().value;
    if (oldestKey === undefined) break;
    wikiCache.delete(oldestKey);
  }
  wikiCache.set(key, { data, time: now });
}

async function wikiFetch(params: Record<string, string>): Promise<unknown> {
  const url = new URL(WIKI_BASE);
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*"); // CORS
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });

  if (!res.ok) {
    throw new Error(`Wiki API error: ${res.status}`);
  }

  return res.json();
}

// --- Page extract (lore/description) ---

export type WikiExtract = {
  title: string;
  extract: string;
  pageId: number;
};

/**
 * Get the introductory text extract for a wiki page.
 * Returns null if the page doesn't exist.
 */
export async function getPageExtract(title: string): Promise<WikiExtract | null> {
  const cacheKey = `extract:${title}`;
  const cached = getCached<WikiExtract>(cacheKey);
  if (cached) return cached;

  try {
    const data = (await wikiFetch({
      action: "query",
      titles: title,
      prop: "extracts",
      exintro: "true",
      explaintext: "true",
      redirects: "1",
    })) as {
      query?: {
        pages?: Record<string, { pageid: number; title: string; extract?: string; missing?: string }>;
      };
    };

    const pages = data.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    if (!page || page.missing !== undefined || !page.extract) return null;

    const result: WikiExtract = {
      title: page.title,
      extract: page.extract.trim(),
      pageId: page.pageid,
    };

    setCache(cacheKey, result);
    return result;
  } catch {
    console.warn("Wiki extract fetch failed");
    return null;
  }
}

// --- Image URL resolution ---

export type WikiImage = {
  url: string;
  width?: number;
  height?: number;
};

/**
 * Get the URL for a wiki image file.
 * @param filename - The filename (e.g., "600i_in_space_-_Isometric.jpg")
 */
export async function getImageUrl(filename: string): Promise<WikiImage | null> {
  const cacheKey = `image:${filename}`;
  const cached = getCached<WikiImage>(cacheKey);
  if (cached) return cached;

  try {
    const data = (await wikiFetch({
      action: "query",
      titles: `File:${filename}`,
      prop: "imageinfo",
      iiprop: "url|size",
    })) as {
      query?: {
        pages?: Record<string, {
          imageinfo?: Array<{ url: string; width?: number; height?: number }>;
          missing?: string;
        }>;
      };
    };

    const pages = data.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    if (!page || page.missing !== undefined || !page.imageinfo?.[0]) return null;

    const info = page.imageinfo[0];
    const result: WikiImage = {
      url: info.url,
      width: info.width,
      height: info.height,
    };

    setCache(cacheKey, result);
    return result;
  } catch {
    console.warn("Wiki image fetch failed");
    return null;
  }
}

// --- Parse wikitext for infobox data ---

type InfoboxData = Record<string, string>;

/**
 * Parse the raw wikitext of a page and extract key=value pairs from its first template block.
 * Handles {{Vehicle ...}}, {{Infobox ...}}, {{Star system ...}}, {{Company ...}}, etc.
 */
function parseInfobox(wikitext: string): InfoboxData {
  const data: InfoboxData = {};

  // Match the first template block containing | key = value lines.
  // Template names vary: Vehicle, Infobox, Star system, Company, etc.
  const infoboxMatch = wikitext.match(/\{\{[A-Za-z][A-Za-z _]*\n(\s*\|[\s\S]*?)\n\}\}/);
  if (!infoboxMatch) return data;

  const body = infoboxMatch[1];
  // Parse each | key = value line
  const lines = body.split(/\n\s*\|/);
  for (const line of lines) {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim().toLowerCase();
    let value = line.slice(eqIdx + 1).trim();
    // Strip wiki markup: [[links]], {{templates}}, HTML tags
    value = value
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1") // [[Link|Display]] -> Display
      .replace(/\{\{[^}]*\}\}/g, "") // {{templates}}
      .replace(/<[^>]+>/g, "") // HTML tags
      .trim();
    if (key && value) {
      data[key] = value;
    }
  }

  return data;
}

/**
 * Get the raw wikitext of a page for infobox parsing.
 */
async function getPageWikitext(title: string): Promise<string | null> {
  const cacheKey = `wikitext:${title}`;
  const cached = getCached<string>(cacheKey);
  if (cached) return cached;

  try {
    const data = (await wikiFetch({
      action: "parse",
      page: title,
      prop: "wikitext",
    })) as {
      parse?: { wikitext?: { "*": string } };
      error?: { info: string };
    };

    if (!data.parse?.wikitext) return null;
    const text = data.parse.wikitext["*"];
    setCache(cacheKey, text);
    return text;
  } catch {
    console.warn("Wiki wikitext fetch failed");
    return null;
  }
}

// --- Ship data ---

export type WikiShipData = {
  lore: string | null;
  imageUrl: string | null;
  manufacturer: string | null;
  role: string | null;
  career: string | null;
  size: string | null;
  pledgeCost: string | null;
  productionState: string | null;
  series: string | null;
};

/**
 * Fetch comprehensive ship data from the wiki.
 * Looks up the ship page, gets the intro extract (lore), infobox data, and image.
 */
export async function getShipWikiData(shipName: string): Promise<WikiShipData> {
  const result: WikiShipData = {
    lore: null,
    imageUrl: null,
    manufacturer: null,
    role: null,
    career: null,
    size: null,
    pledgeCost: null,
    productionState: null,
    series: null,
  };

  // Try multiple title formats: exact name, with manufacturer prefix stripped
  const titles = buildShipTitleVariants(shipName);

  let extract: WikiExtract | null = null;
  let wikitext: string | null = null;

  for (const title of titles) {
    const [ext, wt] = await Promise.all([
      getPageExtract(title),
      getPageWikitext(title),
    ]);
    if (ext || wt) {
      extract = ext;
      wikitext = wt;
      break;
    }
  }

  if (extract?.extract) {
    result.lore = extract.extract;
  }

  if (wikitext) {
    const infobox = parseInfobox(wikitext);

    result.manufacturer = infobox["manufacturer"] || null;
    result.role = infobox["role"] || null;
    result.career = infobox["career"] || null;
    result.size = infobox["size"] || null;
    result.pledgeCost = infobox["pledgecost"] || infobox["pledge cost"] || null;
    result.productionState = infobox["productionstate"] || infobox["production state"] || null;
    result.series = infobox["series"] || null;

    // Try to get image from infobox
    const imageFile = infobox["image"] || infobox["img"];
    if (imageFile) {
      const img = await getImageUrl(imageFile);
      if (img) result.imageUrl = img.url;
    }
  }

  return result;
}

function buildShipTitleVariants(name: string): string[] {
  const variants = [name];

  // Common manufacturer prefixes to try stripping
  const prefixes = [
    "RSI", "MISC", "Drake", "Anvil", "Aegis", "Origin",
    "Crusader", "Argo", "Consolidated Outland", "Esperia",
    "Greycat", "Tumbril", "Aopoa", "Banu", "Gatac",
    "Kruger", "Musashi", "Mirai", "Roberts Space Industries",
  ];

  for (const prefix of prefixes) {
    if (name.toLowerCase().startsWith(prefix.toLowerCase() + " ")) {
      const stripped = name.slice(prefix.length).trim();
      if (stripped && !variants.includes(stripped)) {
        variants.push(stripped);
      }
    }
  }

  // Also try the full name with spaces replaced by underscores (wiki standard)
  return variants;
}

// --- Star system data ---

export type WikiSystemData = {
  lore: string | null;
  type: string | null;
  starType: string | null;
  size: string | null;
  discoveredBy: string | null;
  discoveredDate: string | null;
  affiliation: string | null;
};

/**
 * Fetch star system lore and infobox data from the wiki.
 */
export async function getSystemWikiData(systemName: string): Promise<WikiSystemData> {
  const result: WikiSystemData = {
    lore: null,
    type: null,
    starType: null,
    size: null,
    discoveredBy: null,
    discoveredDate: null,
    affiliation: null,
  };

  // System pages are typically just the system name (e.g., "Stanton (star system)" or just "Stanton")
  const titles = [
    systemName,
    `${systemName} system`,
    `${systemName} (star system)`,
  ];

  let extract: WikiExtract | null = null;
  let wikitext: string | null = null;

  for (const title of titles) {
    const [ext, wt] = await Promise.all([
      getPageExtract(title),
      getPageWikitext(title),
    ]);
    if (ext || wt) {
      extract = ext;
      wikitext = wt;
      break;
    }
  }

  if (extract?.extract) {
    result.lore = extract.extract;
  }

  if (wikitext) {
    const infobox = parseInfobox(wikitext);
    result.type = infobox["type"] || null;
    result.starType = infobox["star type"] || infobox["startype"] || infobox["spectral type"] || null;
    result.size = infobox["size"] || null;
    result.discoveredBy = infobox["discoveredby"] || infobox["discovered by"] || null;
    result.discoveredDate = infobox["discoveredin"] || infobox["discovered"] || infobox["discovered date"] || null;
    result.affiliation = infobox["affiliation"] || infobox["controlled by"] || null;
  }

  return result;
}

// --- Planet data ---

export type WikiPlanetData = {
  lore: string | null;
  type: string | null;
  habitable: string | null;
  affiliation: string | null;
  senator: string | null;
};

/**
 * Fetch planet lore from the wiki.
 */
export async function getPlanetWikiData(planetName: string, systemName?: string): Promise<WikiPlanetData> {
  const result: WikiPlanetData = {
    lore: null,
    type: null,
    habitable: null,
    affiliation: null,
    senator: null,
  };

  const titles = [planetName];
  if (systemName) {
    titles.push(`${planetName} (${systemName})`);
  }

  let extract: WikiExtract | null = null;
  let wikitext: string | null = null;

  for (const title of titles) {
    const [ext, wt] = await Promise.all([
      getPageExtract(title),
      getPageWikitext(title),
    ]);
    if (ext || wt) {
      extract = ext;
      wikitext = wt;
      break;
    }
  }

  if (extract?.extract) {
    result.lore = extract.extract;
  }

  if (wikitext) {
    const infobox = parseInfobox(wikitext);
    result.type = infobox["type"] || null;
    result.habitable = infobox["habitable"] || null;
    result.affiliation = infobox["affiliation"] || null;
    result.senator = infobox["senator"] || null;
  }

  return result;
}

// --- Jump points ---

export type JumpPoint = {
  from: string;
  to: string;
  size: string | null;
  status: string | null;
};

/**
 * Search for jump point connections for a given system.
 * Jump point pages are typically titled "SystemA – SystemB" or "SystemA - SystemB".
 */
export async function getJumpPoints(systemName: string): Promise<JumpPoint[]> {
  const cacheKey = `jumps:${systemName}`;
  const cached = getCached<JumpPoint[]>(cacheKey);
  if (cached) return cached;

  try {
    // Search for pages that mention jump points with this system
    const data = (await wikiFetch({
      action: "query",
      list: "search",
      srsearch: `${systemName} jump point`,
      srnamespace: "0",
      srlimit: "20",
    })) as {
      query?: { search?: Array<{ title: string; snippet: string }> };
    };

    const results = data.query?.search || [];
    const jumpPoints: JumpPoint[] = [];

    for (const r of results) {
      // Jump point pages are usually titled like "Stanton - Pyro jump point" or
      // contain both system names with a separator
      const title = r.title;

      // Try to extract the two system names from the title
      const separators = [" – ", " - ", "–", "-"];
      for (const sep of separators) {
        if (title.includes(sep)) {
          const parts = title.split(sep).map((p) => p.replace(/jump\s*point/i, "").trim());
          if (parts.length === 2 && parts[0] && parts[1]) {
            const from = parts[0];
            const to = parts[1];
            // Only include if one side matches our system
            if (
              from.toLowerCase() === systemName.toLowerCase() ||
              to.toLowerCase() === systemName.toLowerCase()
            ) {
              // Try to get size from snippet
              const sizeMatch = r.snippet.match(/size[:\s]*(small|medium|large)/i);
              const statusMatch = r.snippet.match(/status[:\s]*(active|inactive|unknown)/i);

              jumpPoints.push({
                from,
                to,
                size: sizeMatch ? sizeMatch[1] : null,
                status: statusMatch ? statusMatch[1] : null,
              });
            }
            break;
          }
        }
      }
    }

    // Deduplicate
    const seen = new Set<string>();
    const unique = jumpPoints.filter((jp) => {
      const key = [jp.from, jp.to].sort().join("-");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    setCache(cacheKey, unique);
    return unique;
  } catch {
    console.warn("Wiki jump point search failed");
    return [];
  }
}

// --- Manufacturer data ---

export type WikiManufacturerData = {
  lore: string | null;
  industry: string | null;
  headquarters: string | null;
  founder: string | null;
  ceo: string | null;
  founded: string | null;
};

/**
 * Fetch manufacturer/company data from the wiki.
 */
export async function getManufacturerWikiData(companyName: string): Promise<WikiManufacturerData> {
  const result: WikiManufacturerData = {
    lore: null,
    industry: null,
    headquarters: null,
    founder: null,
    ceo: null,
    founded: null,
  };

  // Handle common abbreviations and name variants
  const nameMap: Record<string, string> = {
    RSI: "Roberts Space Industries",
    MISC: "Musashi Industrial and Starflight Concern",
    CNOU: "Consolidated Outland",
  };

  const lookupName = nameMap[companyName] || companyName;
  const titles = [lookupName];

  // Try with & replaced by "and" (wiki convention)
  if (lookupName.includes("&")) {
    titles.push(lookupName.replace(/&/g, "and"));
  }

  // Also try the abbreviation directly as a page title
  if (nameMap[companyName]) {
    titles.push(companyName);
  }

  let extract: WikiExtract | null = null;
  let wikitext: string | null = null;

  for (const title of titles) {
    const [ext, wt] = await Promise.all([
      getPageExtract(title),
      getPageWikitext(title),
    ]);
    if (ext || wt) {
      extract = ext;
      wikitext = wt;
      break;
    }
  }

  if (extract?.extract) {
    result.lore = extract.extract;
  }

  if (wikitext) {
    const infobox = parseInfobox(wikitext);
    result.industry = infobox["industry"] || null;
    result.headquarters = infobox["headquarters"] || infobox["hq"] || null;
    result.founder = infobox["founder"] || infobox["founded by"] || null;
    result.ceo = infobox["ceo"] || infobox["current ceo"] || infobox["key people"] || null;
    result.founded = infobox["founded"] || null;
  }

  return result;
}

// --- Hardpoint / component data ---

export type WikiHardpointData = {
  summary: string | null; // Textual summary extracted from the page
};

/**
 * Extract hardpoint information from a ship's wiki page.
 * Hardpoints are rendered via Lua templates, so we parse the page HTML instead.
 */
export async function getShipHardpoints(shipName: string): Promise<WikiHardpointData> {
  const result: WikiHardpointData = { summary: null };

  const titles = buildShipTitleVariants(shipName);

  for (const title of titles) {
    try {
      const data = (await wikiFetch({
        action: "parse",
        page: title,
        prop: "text",
        section: "", // all sections
      })) as {
        parse?: { text?: { "*": string } };
        error?: { info: string };
      };

      if (!data.parse?.text) continue;

      const html = data.parse.text["*"];

      // Look for hardpoint/loadout section in the rendered HTML
      // Extract text content from the hardpoint table if present
      const hardpointSection = extractHardpointSection(html);
      if (hardpointSection) {
        result.summary = hardpointSection;
        break;
      }
    } catch {
      continue;
    }
  }

  return result;
}

/**
 * Parse hardpoint information from rendered wiki HTML.
 * Looks for the vehicle hardpoint table and extracts a text summary.
 */
function extractHardpointSection(html: string): string | null {
  // Look for headings related to hardpoints/loadout
  const sectionPattern = /<h[23][^>]*id="(?:Hardpoints?|Loadout|Default_loadout|Ship_components?)"[^>]*>[\s\S]*?(?=<h[23]|$)/i;
  const sectionMatch = html.match(sectionPattern);
  if (!sectionMatch) {
    // Try by heading text content
    const altPattern = /<h[23][^>]*>(?:<[^>]+>)*(?:Hardpoints?|Default [Ll]oadout|Ship [Cc]omponents?)(?:<[^>]+>)*<\/h[23]>([\s\S]*?)(?=<h[23]|$)/i;
    const altMatch = html.match(altPattern);
    if (!altMatch) return null;
    return parseHardpointHtml(altMatch[1]);
  }

  return parseHardpointHtml(sectionMatch[0]);
}

function parseHardpointHtml(html: string): string | null {
  // Extract table rows from the hardpoint table
  const rows: string[] = [];
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let cellMatch;

    while ((cellMatch = cellPattern.exec(rowMatch[1])) !== null) {
      // Strip HTML tags from cell content
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .trim();
      if (text) cells.push(text);
    }

    if (cells.length >= 2) {
      rows.push(cells.join(" | "));
    }
  }

  if (rows.length === 0) return null;

  // Limit to first 20 rows to keep summary manageable
  return rows.slice(0, 20).join("\n");
}

/**
 * Truncate lore text to a reasonable length for the data context.
 * Keeps the first 2-3 sentences.
 */
export function truncateLore(text: string, maxSentences = 3): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return text.slice(0, 300);
  return sentences.slice(0, maxSentences).join("").trim();
}
