"use client";

import { Rocket, Check, Settings } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FleetShip } from "@/lib/fleet-store";
import { useState } from "react";

type ShipSelectorProps = {
  fleet: FleetShip[];
  activeShipId: number | null;
  onSelectShip: (id: number | null) => void;
  onOpenFleetSettings: () => void;
};

export function ShipSelector({
  fleet,
  activeShipId,
  onSelectShip,
  onOpenFleetSettings,
}: ShipSelectorProps) {
  const [open, setOpen] = useState(false);
  const activeShip = fleet.find((s) => s.id === activeShipId);

  // Empty fleet — icon button that opens fleet settings
  if (fleet.length === 0) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={onOpenFleetSettings}
        title="Set up your fleet"
      >
        <Rocket className="h-4 w-4" strokeWidth={3} />
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          activeShip ? (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
            />
          ) : (
            <button
              type="button"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "h-8 w-8 text-muted-foreground hover:text-foreground"
              )}
              title="Select active ship"
            />
          )
        }
      >
        {activeShip ? (
          <>
            <Rocket className="h-3 w-3 shrink-0" />
            <span className="truncate max-w-[140px]">
              {activeShip.name} · {activeShip.scu} SCU
            </span>
          </>
        ) : (
          <Rocket className="h-4 w-4" strokeWidth={3} />
        )}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-64 p-0"
      >
        <div className="px-3 py-2 border-b border-border/50">
          <p className="text-xs font-medium text-muted-foreground">Active Ship</p>
        </div>
        <div className="py-1 max-h-[240px] overflow-y-auto">
          {/* None option */}
          <button
            type="button"
            className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => {
              onSelectShip(null);
              setOpen(false);
            }}
          >
            <div className="w-4 h-4 flex items-center justify-center">
              {activeShipId === null && (
                <Check className="h-3.5 w-3.5 text-foreground" />
              )}
            </div>
            <span className="text-muted-foreground">None</span>
          </button>
          {/* Fleet ships */}
          {fleet.map((ship) => (
            <button
              key={ship.id}
              type="button"
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => {
                onSelectShip(ship.id);
                setOpen(false);
              }}
            >
              <div className="w-4 h-4 flex items-center justify-center">
                {activeShipId === ship.id && (
                  <Check className="h-3.5 w-3.5 text-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate font-medium">{ship.name}</p>
                <p className="text-xs text-muted-foreground">
                  {ship.scu} SCU · {ship.pad_type} pad
                </p>
              </div>
            </button>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-border/50">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={() => {
              setOpen(false);
              onOpenFleetSettings();
            }}
          >
            <Settings className="h-3 w-3" />
            Manage Fleet
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
