import { ArrowRight } from "lucide-react";

type RouteInfo = {
  from: string;
  to: string;
  profit: number;
  commodity: string;
};

/** UEX reports route endpoints, not spatial coordinates for this view. */
export function SystemMap({
  system,
  routes = [],
  highlights = [],
}: {
  system: string;
  routes?: RouteInfo[];
  highlights?: string[];
}) {
  if (!routes.length && !highlights.length) return null;

  return (
    <section aria-label={`${system} route overview`} className="mt-3 rounded-lg border border-border overflow-hidden">
      <div className="px-3 py-2 bg-muted/30">
        <h3 className="text-sm font-medium">{system} · Route overview</h3>
        <p className="text-xs text-muted-foreground">Route sequence only; positions and distances are not to scale.</p>
      </div>
      {routes.length ? (
        <ol className="divide-y divide-border">
          {routes.map((route, index) => (
            <li key={`${route.from}-${route.to}-${route.commodity}-${index}`} className="px-3 py-3">
              <p className="mb-2 text-xs text-muted-foreground">{route.commodity}</p>
              <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center text-sm">
                <div className="min-w-0">
                  <span className="block text-xs text-muted-foreground mb-1">From</span>
                  <span className="break-words">{route.from}</span>
                </div>
                <ArrowRight aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <span className="block text-xs text-muted-foreground mb-1">To</span>
                  <span className="break-words">{route.to}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="px-3 py-3 space-y-2 text-sm">
          {highlights.map((location) => <li key={location}>{location}</li>)}
        </ul>
      )}
    </section>
  );
}
