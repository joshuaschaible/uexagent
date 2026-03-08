"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Trash2, Search, Plus, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import type { FleetShip } from "@/lib/fleet-store";

type Suggestion = {
  name: string;
  type: string;
};

type FleetSettingsProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fleet: FleetShip[];
  onAddShip: (ship: FleetShip) => void;
  onRemoveShip: (id: number) => void;
};

export function FleetSettings({
  open,
  onOpenChange,
  fleet,
  onAddShip,
  onRemoveShip,
}: FleetSettingsProps) {
  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Fetch ship suggestions
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/suggest?q=${encodeURIComponent(q)}&typed=1`
      );
      if (!res.ok) return;
      const data: Suggestion[] = await res.json();
      // Filter to ships only, exclude already added
      const ships = data.filter(
        (s) => s.type === "ship" && !fleet.some((f) => f.name === s.name || f.name_full === s.name)
      );
      setSuggestions(ships);
    } catch {
      // ignore
    }
  }, [fleet]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(search), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, fetchSuggestions]);

  // Reset search when sheet opens/closes
  useEffect(() => {
    if (!open) {
      setSearch("");
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }, [open]);

  async function handleAddShip(name: string) {
    setAdding(true);
    try {
      const res = await fetch(
        `/api/vehicle?name=${encodeURIComponent(name)}`
      );
      if (!res.ok) return;
      const ship: FleetShip = await res.json();
      if (ship) {
        onAddShip(ship);
        setSearch("");
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } catch {
      // ignore
    } finally {
      setAdding(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            My Fleet
          </SheetTitle>
        </SheetHeader>

        {/* Ship search */}
        <div className="px-6 pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              placeholder="Search ships to add..."
              className="w-full rounded-lg border border-border bg-muted/30 pl-9 pr-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground/60"
            />
            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-border bg-popover shadow-lg z-50 max-h-[200px] overflow-y-auto">
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors cursor-pointer"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleAddShip(s.name)}
                    disabled={adding}
                  >
                    <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <Separator />

        {/* Fleet list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {fleet.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Rocket className="h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                No ships in your fleet yet
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Search above to add ships
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {fleet.map((ship) => (
                <div
                  key={ship.id}
                  className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {ship.name_full || ship.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ship.company_name} · {ship.scu} SCU · {ship.pad_type} pad
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={() => onRemoveShip(ship.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
