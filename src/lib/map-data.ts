export type MapNode = {
  id: string;
  name: string;
  type: "star" | "planet" | "moon" | "station" | "city";
  x: number;
  y: number;
  radius: number;
  parent?: string;
  orbitRadius?: number;
};

export type SystemLayout = {
  name: string;
  width: number;
  height: number;
  nodes: MapNode[];
};

// Stanton System layout — relative positions for SVG rendering
const stantonNodes: MapNode[] = [
  // Star
  { id: "stanton-star", name: "Stanton", type: "star", x: 400, y: 300, radius: 30 },

  // Hurston (inner orbit)
  { id: "hurston", name: "Hurston", type: "planet", x: 200, y: 200, radius: 14, orbitRadius: 150 },
  { id: "hurston-l1", name: "HUR-L1", type: "station", x: 175, y: 160, radius: 4, parent: "hurston" },
  { id: "hurston-l2", name: "HUR-L2", type: "station", x: 230, y: 170, radius: 4, parent: "hurston" },
  { id: "everus-harbor", name: "Everus Harbor", type: "station", x: 185, y: 210, radius: 5, parent: "hurston" },
  { id: "lorville", name: "Lorville", type: "city", x: 215, y: 215, radius: 5, parent: "hurston" },

  // Crusader (lower-left)
  { id: "crusader", name: "Crusader", type: "planet", x: 180, y: 420, radius: 16, orbitRadius: 200 },
  { id: "cru-l1", name: "CRU-L1", type: "station", x: 145, y: 395, radius: 4, parent: "crusader" },
  { id: "port-olisar", name: "Port Olisar", type: "station", x: 165, y: 435, radius: 5, parent: "crusader" },
  { id: "orison", name: "Orison", type: "city", x: 200, y: 440, radius: 5, parent: "crusader" },
  { id: "cellin", name: "Cellin", type: "moon", x: 155, y: 450, radius: 6, parent: "crusader" },
  { id: "daymar", name: "Daymar", type: "moon", x: 210, y: 455, radius: 6, parent: "crusader" },
  { id: "yela", name: "Yela", type: "moon", x: 150, y: 410, radius: 6, parent: "crusader" },

  // ArcCorp (right side)
  { id: "arccorp", name: "ArcCorp", type: "planet", x: 600, y: 220, radius: 14, orbitRadius: 250 },
  { id: "arc-l1", name: "ARC-L1", type: "station", x: 575, y: 185, radius: 4, parent: "arccorp" },
  { id: "baijini-point", name: "Baijini Point", type: "station", x: 615, y: 205, radius: 5, parent: "arccorp" },
  { id: "area18", name: "Area 18", type: "city", x: 620, y: 235, radius: 5, parent: "arccorp" },
  { id: "lyria", name: "Lyria", type: "moon", x: 635, y: 195, radius: 5, parent: "arccorp" },
  { id: "wala", name: "Wala", type: "moon", x: 575, y: 240, radius: 5, parent: "arccorp" },

  // MicroTech (upper right)
  { id: "microtech", name: "MicroTech", type: "planet", x: 600, y: 440, radius: 15, orbitRadius: 280 },
  { id: "mic-l1", name: "MIC-L1", type: "station", x: 575, y: 405, radius: 4, parent: "microtech" },
  { id: "port-tressler", name: "Port Tressler", type: "station", x: 620, y: 420, radius: 5, parent: "microtech" },
  { id: "new-babbage", name: "New Babbage", type: "city", x: 625, y: 455, radius: 5, parent: "microtech" },
  { id: "calliope", name: "Calliope", type: "moon", x: 565, y: 455, radius: 5, parent: "microtech" },
  { id: "clio", name: "Clio", type: "moon", x: 635, y: 465, radius: 5, parent: "microtech" },
  { id: "euterpe", name: "Euterpe", type: "moon", x: 580, y: 470, radius: 5, parent: "microtech" },
];

const pyroNodes: MapNode[] = [
  // Star
  { id: "pyro-star", name: "Pyro", type: "star", x: 400, y: 300, radius: 35 },

  // Pyro I
  { id: "pyro-i", name: "Pyro I", type: "planet", x: 250, y: 200, radius: 10, orbitRadius: 120 },

  // Pyro II
  { id: "pyro-ii", name: "Pyro II", type: "planet", x: 550, y: 180, radius: 12, orbitRadius: 180 },

  // Pyro III
  { id: "pyro-iii", name: "Pyro III", type: "planet", x: 200, y: 420, radius: 14, orbitRadius: 220 },

  // Pyro IV
  { id: "pyro-iv", name: "Pyro IV", type: "planet", x: 620, y: 400, radius: 13, orbitRadius: 260 },

  // Pyro V
  { id: "pyro-v", name: "Pyro V", type: "planet", x: 400, y: 500, radius: 11, orbitRadius: 200 },

  // Pyro VI
  { id: "pyro-vi", name: "Pyro VI", type: "planet", x: 150, y: 300, radius: 10, orbitRadius: 250 },

  // Ruin Station
  { id: "ruin-station", name: "Ruin Station", type: "station", x: 350, y: 250, radius: 5 },
];

export const SYSTEM_LAYOUTS: Record<string, SystemLayout> = {
  stanton: {
    name: "Stanton",
    width: 800,
    height: 600,
    nodes: stantonNodes,
  },
  pyro: {
    name: "Pyro",
    width: 800,
    height: 600,
    nodes: pyroNodes,
  },
};

/**
 * Try to find a map node by terminal/location name (fuzzy match)
 */
export function findMapNode(
  locationName: string,
  systemKey: string
): MapNode | undefined {
  const layout = SYSTEM_LAYOUTS[systemKey.toLowerCase()];
  if (!layout) return undefined;

  const lower = locationName.toLowerCase();
  return layout.nodes.find(
    (n) =>
      lower.includes(n.name.toLowerCase()) ||
      n.name.toLowerCase().includes(lower)
  );
}
