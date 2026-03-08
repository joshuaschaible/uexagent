export type FleetShip = {
  id: number;
  name: string;
  name_full: string;
  scu: number;
  pad_type: string;
  company_name: string;
};

const FLEET_KEY = "uex-fleet";
const ACTIVE_SHIP_KEY = "uex-active-ship";

export function loadFleet(): FleetShip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FLEET_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FleetShip[];
  } catch {
    return [];
  }
}

export function saveFleet(fleet: FleetShip[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FLEET_KEY, JSON.stringify(fleet));
  } catch {
    // localStorage full or unavailable
  }
}

export function loadActiveShipId(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_SHIP_KEY);
    if (!raw) return null;
    const id = parseInt(raw, 10);
    return isNaN(id) ? null : id;
  } catch {
    return null;
  }
}

export function saveActiveShipId(id: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id === null) {
      localStorage.removeItem(ACTIVE_SHIP_KEY);
    } else {
      localStorage.setItem(ACTIVE_SHIP_KEY, String(id));
    }
  } catch {
    // ignore
  }
}
