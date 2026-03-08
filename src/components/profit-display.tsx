"use client";

type ProfitDisplayProps = {
  shipName: string;
  commodityName: string;
  scu: number;
  buyPrice: number;
  sellPrice: number;
  buyTerminal: string;
  sellTerminal: string;
};

export function ProfitDisplay({
  shipName,
  commodityName,
  scu,
  buyPrice,
  sellPrice,
  buyTerminal,
  sellTerminal,
}: ProfitDisplayProps) {
  const investment = buyPrice * scu;
  const revenue = sellPrice * scu;
  const profit = revenue - investment;
  const roi = investment > 0 ? (profit / investment) * 100 : 0;

  return (
    <div className="mt-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold">{commodityName} Profit Calculator</p>
        <span className="text-xs text-muted-foreground">{shipName} ({scu} SCU)</span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Investment</p>
          <p className="text-lg font-semibold">{investment.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">aUEC</p>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Revenue</p>
          <p className="text-lg font-semibold">{revenue.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">aUEC</p>
        </div>
        <div className="rounded-lg bg-primary/10 p-3">
          <p className="text-[10px] text-primary uppercase tracking-wider mb-1">Profit / Run</p>
          <p className="text-lg font-semibold text-primary">{profit.toLocaleString()}</p>
          <p className="text-[10px] text-muted-foreground">aUEC</p>
        </div>
        <div className="rounded-lg bg-primary/10 p-3">
          <p className="text-[10px] text-primary uppercase tracking-wider mb-1">ROI</p>
          <p className="text-lg font-semibold text-primary">{roi.toFixed(1)}%</p>
          <p className="text-[10px] text-muted-foreground">per run</p>
        </div>
      </div>

      <div className="text-xs text-muted-foreground space-y-1">
        <p>Buy at <strong>{buyTerminal}</strong> ({buyPrice.toLocaleString()} aUEC/SCU)</p>
        <p>Sell at <strong>{sellTerminal}</strong> ({sellPrice.toLocaleString()} aUEC/SCU)</p>
      </div>
    </div>
  );
}
