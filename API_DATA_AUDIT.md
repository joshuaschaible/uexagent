# UEX API data audit

Reviewed September 25, 2026, after the mining-location implementation.

**Implementation update (September 25, 2026):** The correctness fixes and recommended public-data phases below are now implemented: terminal joins, inventory/demand/status handling, price spread and crew range corrections, cautious refinery units, actual dated history, source freshness/patch context, equipment catalogues/specs/prices/comparisons, market alerts, connected distance-aware multi-hop routing, cargo constraints, and broader geography. Routes also honor a starting location and budget. See [FEATURES.md](FEATURES.md) for current behavior and examples. The endpoint counts, code line references, and “current gap” descriptions below preserve the pre-implementation audit snapshot.

History can be sparse, alerts can be empty, and distance/ship metadata can be incomplete. Account integrations, marketplace features, data-monitor authentication, and exact fuel/time/refinery-job cost models remain outside this implementation. Deprecated ranking data was not connected.

The [official API index](https://uexcorp.space/api/documentation/) lists **77 GET, 8 POST, and 4 DELETE resources**. This app has **27 GET wrappers, 24 connected to features, and 3 unused wrappers**. Counts describe endpoint coverage, not completeness or product value: many remaining endpoints concern UEX accounts and its marketplace.

This audit compared local callers, official schemas, and selected public live responses. Account-specific endpoints were reviewed through documentation only. Application code and the running server were not changed by this audit. Live counts and examples are observations, not fixtures guaranteed to remain unchanged.

## Correctness fixes to do first

| Finding | Evidence and impact | Recommended correction |
|---|---|---|
| Bulk prices need a terminal join | The sampled `commodities_prices_all` response had 2,596 rows and no geography fields. It identifies terminals by ID. [The multi-hop planner](/Users/joshuaschaible/Documents/Projects/star-citizen-trade-bot/src/lib/route-planner.ts:46) filters these rows by `star_system_name`, so a system constraint can eliminate every result. Budget/fleet location information is affected too. | Model the summary response separately and join to cached terminals before filtering, presenting locations, or planning routes. |
| Profit per SCU uses the wrong field | [The route handler](/Users/joshuaschaible/Documents/Projects/star-citizen-trade-bot/src/lib/answer-builder.ts:599) presents `price_margin` as aUEC/SCU. A live example returned buy 7,047, sell 8,700, margin 19; the actual spread is 1,653 aUEC/SCU. The margin appears percentage-based in that record. [Route schema](https://uexcorp.space/api/documentation/id/get_commodities_routes/). | Compute sell minus buy for the displayed spread. Keep ROI, margin, and total profit separately labeled. |
| Stock is presented as demand | UEX distinguishes reported destination inventory (`scu_sell_stock`) from forecast demand (`scu_sell`). The app displays the former as demand. A live Laranite row had inventory 147 versus forecast demand 1,029. [Price schema](https://uexcorp.space/api/documentation/id/get_commodities_prices/). | Expose inventory and estimated demand separately; distinguish zero from unknown and constrain cargo recommendations where reliable. |
| Any positive sell status is accepted | Live `commodities_status` includes sell status 7, “Maximum Inventory (No Demand).” The app's `status_sell > 0` rule accepts it. [Inventory status schema](https://uexcorp.space/api/documentation/id/get_commodities_status/). | Resolve the separate buy/sell status dictionaries and handle no-demand states explicitly. |
| Refinery capacity has an unsupported unit | UEX describes estimated percentages; [the UI labels them Capacity (SCU)](/Users/joshuaschaible/Documents/Projects/star-citizen-trade-bot/src/lib/answer-builder.ts:2218). The documentation mixes capacity and yield terminology, and sampled values exceed 100, so precise meaning needs confirmation. [Capacity schema](https://uexcorp.space/api/documentation/id/get_refineries_capacities/). | Verify semantics before assigning a definite unit; do not assert SCU or an ordinary percentage range from the current evidence. |
| Ship crew is typed as a number | [Vehicle.crew](/Users/joshuaschaible/Documents/Projects/star-citizen-trade-bot/src/lib/uex-client.ts:292) is a number in the app, but live data and [documentation](https://uexcorp.space/api/documentation/id/get_vehicles/) use a CSV string. | Parse minimum/maximum crew explicitly for comparisons; preserve range display. |

## Highest-value additional data

| Opportunity | Available data and current gap | Example feature |
|---|---|---|
| Actual dated price history | `commodities_prices_history` already has a wrapper, but no caller. It returns observations for a commodity and terminal, up to 500 records, with timestamps and game version. A live sample returned two current-version records. The existing chart uses Min/Average/Current/Max from averages. [History schema](https://uexcorp.space/api/documentation/id/get_commodities_prices_history/). | “Show Laranite price history at Area 18.” Requires a terminal choice and honest handling of sparse observations. |
| Equipment shopping and comparison | `categories`, `items`, `items_attributes`, and `items_prices` cover components, weapons, armor, and mining equipment. Only an unused item-price wrapper exists. A live mining-head sample contained 17 items, 324 attribute rows, and 190 item/location price rows. [Items](https://uexcorp.space/api/documentation/id/get_items/), [attributes](https://uexcorp.space/api/documentation/id/get_items_attributes/), [prices](https://uexcorp.space/api/documentation/id/get_items_prices/). | “Where can I buy a Lancet MH2?”; “Compare these mining heads.” Item attributes may lag game balance changes: sampled item metadata still said 4.1 while prices said 4.10.0. |
| Market alerts and stock conditions | `commodities_alerts` provides recent price/inventory signals; `commodities_status` supplies human-readable stock states. Neither is used. [Alerts](https://uexcorp.space/api/documentation/id/get_commodities_alerts/). | Recent commodity opportunities, stock/demand labels, and explanations for temporarily unattractive destinations. |
| Distances and jump connections | `terminals_distances`, `orbits_distances`, and `jump_points` are absent from the client. Live orbital data returned 810 Stanton records, and jump data returned six connections. The current planner ignores distance; general jump information comes from Wiki. [Terminal distances](https://uexcorp.space/api/documentation/id/get_terminals_distances/), [orbital distances](https://uexcorp.space/api/documentation/id/get_orbits_distances/), [jump points](https://uexcorp.space/api/documentation/id/get_jump_points/). | Compare route distance and build connected itineraries. Distance is not sufficient for exact travel time or fuel cost. Some sampled distances were associated with older game versions. |
| Price freshness and game-version context | Existing price records carry timestamps and patch data. `game_versions` supplies UEX's live/PTU versions; authenticated `data_monitor` tracks terminal report coverage and age. The UI currently reports local cache age. [Versions](https://uexcorp.space/api/documentation/id/get_game_versions/), [monitor](https://uexcorp.space/api/documentation/id/get_data_monitor/). | “Reported 3 days ago, patch 4.x” next to a price, with a stale-data indication independent of cache refresh time. |
| Ship and cargo compatibility | Existing vehicle/route/terminal payloads include concept status, container sizes, docking/loading requirements and facility capabilities that are mostly omitted or ignored. `vehicles_loaners` adds ship-to-loaner mappings. [Vehicles](https://uexcorp.space/api/documentation/id/get_vehicles/), [loaners](https://uexcorp.space/api/documentation/id/get_vehicles_loaners/). | Qualify Hull-series trade destinations, show supported container sizes, exclude concept ships from practical recommendations, and explain loaners. |
| Cargo properties and warnings | `/commodities` has quantum/time volatility, explosive and known-bug flags, plus refinable/pure states and weight per SCU. Current types omit most of these. [Commodities](https://uexcorp.space/api/documentation/id/get_commodities/). | Add source-based handling notes to commodity profiles and route results. No timers or risk probabilities should be invented from Boolean flags. |
| Broader location lookup | Full planet/moon/orbit/POI data is now loaded for mining, but general parsing still hardcodes Stanton names and suggestions derive geography from terminals. POIs also provide quantum-marker, monitoring, armistice, services, and related location metadata. [POIs](https://uexcorp.space/api/documentation/id/get_poi/). | Discover locations without trade terminals; display how an area is marked and which services UEX records there. Extend general queries and autocomplete using the mining catalogs. |
| Refinery and fuel comparisons | Week/month refinery values are already fetched but unused. Detailed `fuel_prices` adds price ranges and report metadata beyond the bulk summary. [Refinery yields](https://uexcorp.space/api/documentation/id/get_refineries_yields/), [fuel](https://uexcorp.space/api/documentation/id/get_fuel_prices/). | Compare current versus recent refinery conditions and fuel prices with correct units and freshness. |
| Player marketplace | UEX provides active advertisements, marketplace averages, trends, and dated listing-price snapshots. These are distinct from in-game terminal prices. [Listings](https://uexcorp.space/api/documentation/id/get_marketplace_listings/), [history](https://uexcorp.space/api/documentation/id/get_marketplace_prices_history/). | Browse player offers and show item-market price ranges, with currency/quality/version filters. No automatic purchases or contacting sellers is implied. |
| Personal UEX history and fleet | `fleet`, `user_trades`, and `user_refineries_jobs` expose a user's saved ships, recorded transactions, and refining jobs. They require account-specific authorization and a secret-key header, beyond the current local fleet list. [Fleet](https://uexcorp.space/api/documentation/id/get_fleet/), [trades](https://uexcorp.space/api/documentation/id/get_user_trades/), [refining jobs](https://uexcorp.space/api/documentation/id/get_user_refineries_jobs/). | Import a UEX fleet, display recorded trading results, and show refinery-job completion information after explicit account setup. |

## Availability and integration cautions

- Do not connect the unused `commodities_ranking` wrapper as a new dependency: UEX marks it deprecated and recommends `commodities_averages.cax_score`. The replacement requires bearer authorization. The app's current commodity ranking calculates raw price spreads. [Deprecation notice](https://uexcorp.space/api/documentation/id/get_commodities_ranking/).
- `refineries_audits` contains cost/time/output observations, but the live sample had only three records from 4.0.1/4.1.1. That is insufficient support for a general current-patch refining calculator. [Audit schema](https://uexcorp.space/api/documentation/id/get_refineries_audits/).
- Exact fuel-cost estimates remain limited: only four of 282 sampled vehicles had positive fuel-capacity fields. Missing values must not become zero fuel use.
- The current fetch helper accepts array-valued `data` only. Live `game_versions`, `commodities_status`, and `terminals_distances` return objects. Add endpoint-specific validation instead of casting them to array types.
- Runtime values can differ from TypeScript declarations or documentation: sampled distances were strings, crew was CSV, and live jump-point name keys used a different word order from the documentation. Validate and normalize at the client boundary.
- Commodity/item versions, timestamps, and live availability should inform filtering. A recent local cache fetch does not establish recent upstream data.

## Suggested order

1. Correct bulk-price joins, profit/demand/status interpretation, and schema/units.
2. Add real price history, data freshness, and cargo compatibility to existing answers.
3. Add equipment lookup/comparison and market alert queries.
4. Improve distance-based planning and general geography.
5. Consider player marketplace and account-linked records as separate product additions.

## Current wrapper coverage

Connected: `commodities`, `terminals`, `star_systems`, `vehicles`, `refineries_methods`, `fuel_prices_all`, `commodities_prices_all`, `commodities_prices`, `commodities_routes`, `commodities_averages`, `commodities_raw_prices`, `space_stations`, `cities`, `outposts`, `refineries_yields`, `refineries_capacities`, `vehicles_purchases_prices`, `vehicles_purchases_prices_all`, `vehicles_rentals_prices`, `vehicles_rentals_prices_all`, `planets`, `moons`, `orbits`, `poi`.

Defined but unused: `commodities_prices_history`, `items_prices`, and deprecated `commodities_ranking`.

The inventory below lists remaining GET resources, including account/community features whose product value is lower for a local trade bot. Listed does not mean live-tested or recommended for implementation.

- [categories](https://uexcorp.space/api/documentation/id/get_categories/)
- [categories_attributes](https://uexcorp.space/api/documentation/id/get_categories_attributes/)
- [commodities_alerts](https://uexcorp.space/api/documentation/id/get_commodities_alerts/)
- [commodities_raw_averages](https://uexcorp.space/api/documentation/id/get_commodities_raw_averages/)
- [commodities_raw_prices_all](https://uexcorp.space/api/documentation/id/get_commodities_raw_prices_all/)
- [commodities_status](https://uexcorp.space/api/documentation/id/get_commodities_status/)
- [companies](https://uexcorp.space/api/documentation/id/get_companies/)
- [contacts](https://uexcorp.space/api/documentation/id/get_contacts/)
- [contracts](https://uexcorp.space/api/documentation/id/get_contracts/)
- [crew](https://uexcorp.space/api/documentation/id/get_crew/)
- [currencies_index](https://uexcorp.space/api/documentation/id/get_currencies_index/)
- [currencies_index_history](https://uexcorp.space/api/documentation/id/get_currencies_index_history/)
- [data_extract](https://uexcorp.space/api/documentation/id/get_data_extract/)
- [data_info](https://uexcorp.space/api/documentation/id/get_data_info/)
- [data_monitor](https://uexcorp.space/api/documentation/id/get_data_monitor/)
- [data_parameters](https://uexcorp.space/api/documentation/id/get_data_parameters/)
- [factions](https://uexcorp.space/api/documentation/id/get_factions/)
- [fleet](https://uexcorp.space/api/documentation/id/get_fleet/)
- [fuel_prices](https://uexcorp.space/api/documentation/id/get_fuel_prices/)
- [game_versions](https://uexcorp.space/api/documentation/id/get_game_versions/)
- [game_versions_all](https://uexcorp.space/api/documentation/id/get_game_versions_all/)
- [items](https://uexcorp.space/api/documentation/id/get_items/)
- [items_attributes](https://uexcorp.space/api/documentation/id/get_items_attributes/)
- [items_prices_all](https://uexcorp.space/api/documentation/id/get_items_prices_all/)
- [jump_points](https://uexcorp.space/api/documentation/id/get_jump_points/)
- [jurisdictions](https://uexcorp.space/api/documentation/id/get_jurisdictions/)
- [marketplace_averages](https://uexcorp.space/api/documentation/id/get_marketplace_averages/)
- [marketplace_averages_all](https://uexcorp.space/api/documentation/id/get_marketplace_averages_all/)
- [marketplace_favorites](https://uexcorp.space/api/documentation/id/get_marketplace_favorites/)
- [marketplace_listings](https://uexcorp.space/api/documentation/id/get_marketplace_listings/)
- [marketplace_negotiations](https://uexcorp.space/api/documentation/id/get_marketplace_negotiations/)
- [marketplace_negotiations_messages](https://uexcorp.space/api/documentation/id/get_marketplace_negotiations_messages/)
- [marketplace_prices_averages](https://uexcorp.space/api/documentation/id/get_marketplace_prices_averages/)
- [marketplace_prices_averages_all](https://uexcorp.space/api/documentation/id/get_marketplace_prices_averages_all/)
- [marketplace_prices_history](https://uexcorp.space/api/documentation/id/get_marketplace_prices_history/)
- [marketplace_trends](https://uexcorp.space/api/documentation/id/get_marketplace_trends/)
- [orbits_distances](https://uexcorp.space/api/documentation/id/get_orbits_distances/)
- [organizations](https://uexcorp.space/api/documentation/id/get_organizations/)
- [polls](https://uexcorp.space/api/documentation/id/get_polls/)
- [polls_audit](https://uexcorp.space/api/documentation/id/get_polls_audit/)
- [refineries_audits](https://uexcorp.space/api/documentation/id/get_refineries_audits/)
- [release_notes](https://uexcorp.space/api/documentation/id/get_release_notes/)
- [terminals_distances](https://uexcorp.space/api/documentation/id/get_terminals_distances/)
- [user](https://uexcorp.space/api/documentation/id/get_user/)
- [user_notifications](https://uexcorp.space/api/documentation/id/get_user_notifications/)
- [user_refineries_jobs](https://uexcorp.space/api/documentation/id/get_user_refineries_jobs/)
- [user_trades](https://uexcorp.space/api/documentation/id/get_user_trades/)
- [vehicles_loaners](https://uexcorp.space/api/documentation/id/get_vehicles_loaners/)
- [vehicles_prices](https://uexcorp.space/api/documentation/id/get_vehicles_prices/)
- [wallet_balance](https://uexcorp.space/api/documentation/id/get_wallet_balance/)
