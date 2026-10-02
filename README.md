# Star Citizen Reference Assistant

A local Star Citizen reference assistant built with Next.js 16, React 19, TypeScript, and Tailwind CSS. It combines UEX market data with optional OpenAI classification and response generation. One continuous chat is stored in the browser's localStorage. Older conversations remain preserved, but the chat sidebar and fleet controls have been removed.

For mining location lookups, try `Where can I mine Laranite?` or `Which ores are found on Hurston?`. Results use UEX occurrence mappings and support filtering by system, planet, moon, Lagrange region, or point of interest. These records describe general locations; coordinates, abundance, and guaranteed spawns are unavailable. An unlisted location does not establish that an ore is absent. See the archived [Mining Locations](docs/archive/FEATURES-2026-10-01.md#mining-locations) section for more examples and scope.

The assistant supports ship purchase and rental locations, equipment shopping and comparisons, location services, terminal-specific price history, market alerts, and source report dates and patch versions. Try `Where can I buy Lancet MH2?`, `What ships can I buy at New Deal in Lorville?`, or `Where should I sell Laranite?`. Reported prices and stock do not guarantee availability when you arrive. Route planning, projected profit, cargo optimization and fleet recommendations are disabled. Fresh questions stand alone; explicit follow-ups can retain context. Voice remains planned. [API_DATA_AUDIT.md](API_DATA_AUDIT.md) records the source audit.

## Run locally

Use Node 24 LTS (`.nvmrc` pins the tested release). With nvm installed:

```sh
nvm install
nvm use
npm ci
```

Create `.env.local` from `.env.example` only if you do not already have it, then configure `UEX_API_TOKEN` and optionally `OPENAI_API_KEY`. Without an OpenAI key, keyword parsing and template responses remain available. Keys stay on the server; do not prefix them with `NEXT_PUBLIC_`.

```sh
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Both development and production start commands bind to loopback by default.

For a production build:

```sh
npm run build
npm start
```

## Checks and updates

```sh
npm run typecheck
npm run lint
npm test
npm audit
npm outdated
```

Commit both `package.json` and `package-lock.json` when upgrading. Use `npm ci` for reproducible installs. Shadcn and the application dependencies use current compatible releases. ESLint remains on 9.39.5 because the React, accessibility and import plugins do not yet support ESLint 10. TypeScript remains on 6.0.3 because TypeScript ESLint requires TypeScript below 6.1; its newer major cannot yet be used with this lint setup. Node types target the Node 24 LTS runtime.

See [FEATURES.md](FEATURES.md) for the prioritized roadmap, the [feature archive](docs/archive/FEATURES-2026-10-01.md) for earlier examples, and [SECURITY.md](SECURITY.md) for request limits, deployment requirements, and the outstanding upstream security release.

### Crafting and mission references

Blueprint recipes and mission unlock requirements use the public Star Citizen Wiki game-data API (`api.star-citizen.wiki`), separately from the existing MediaWiki page enrichment. These questions do not require UEX to be available:

- “What materials do I need to craft an XL-1 quantum drive?”
- “How do I unlock the XL-1 blueprint?”
- “Tell me about the Blackbox Retrieval mission”
- “Which missions do I need before that one?”
- “Show prerequisites for Idea for Isaac mission”

Answers preserve SCU versus discrete item quantities, minimum material quality, alternative requirement groups, required standing, recursive mission prerequisites, and the source game patch. Progression keeps alternative paths and mission variants separate; missing links, cycles, and patch conflicts stop the affected branch. Large graphs are marked partial (up to 20 reward variants, 48 missions, eight levels, and 200 rows). Blueprint pool drop chances are not represented as a guarantee of receiving a particular item. Ambiguous item names or mission variants require a more specific selection. Results include source links; missing fields and upstream failures do not generate guessed requirements. Recipes show the base recipe; tier-specific crafting and personalized mission progress are not implemented.

### Component catalogue regression checks

Run `npm run test:components` to check every captured UEX ship component through the real suggestion and name-matching code. The offline fixture contains 415 records from ten categories, captured October 1, 2026. Tests cover original names, case, spaces, hyphens, unknown names, and collisions such as SNS-R7 versus SNSR7. Exact canonical names take precedence; ambiguous compact variants retain every matching record.

Refresh deliberately with `npm run test:components:refresh`, then review the fixture diff and rerun tests. Refresh uses the existing local UEX credentials but stores only catalogue fields; ordinary tests require no network or credentials. These catalogue checks verify entity lookup, while the separate chat tests cover routing, sizes, locations, and conversational context.

### Complete mention catalogue checks

Run `npm run test:mentions` to check all nine mention types against captured UEX catalogues: commodities, ships, systems, terminals/shops, planets, moons, orbits, points of interest, and components. Each eligible record is checked in the initial mention list, with case and punctuation variations, and through the same insertion helper used by chat. Resolver tests cover canonical commodity/ship/system names and all location names, including clarification for duplicate shops and parent-qualified points of interest. Equivalent names within a type are deduplicated; different types remain separate. Selected orbits and points of interest include a short type qualifier in the question so names shared with planets resolve correctly.

Run `npm run test:mentions:refresh` to deliberately refresh the non-component snapshot, then review changes and rerun tests. The component snapshot has its own refresh command above. Both snapshots use public catalogue fields and contain no credentials. The tests run offline; they verify lookup and mention behavior, not the accuracy of upstream prices or every possible natural-language question.
