# Star Citizen Reference Assistant — Feature Roadmap

Updated October 1, 2026.

## Purpose

Give players quick, trustworthy answers while their attention stays on the game. Replace repeated searches and page visits with one continuous chat for mining locations, ships, components, shops, reported prices, crafting recipes, and mission requirements.

The previous feature document is preserved in [the feature archive](docs/archive/FEATURES-2026-10-01.md). It describes the earlier scope and examples; it is not the current backlog.

## Working principles

- Put the useful answer first and keep the initial response short.
- Understand ordinary wording and spoken questions without requiring special commands.
- Fresh questions stand alone; explicit follow-ups may retain relevant context.
- Keep sources and game patches available. Missing or old data must not become a confident recommendation.
- Reported shop listings and prices do not guarantee current stock.
- Add one feature at a time and verify real chat questions before moving on.

## Existing foundation

These are implemented foundations, not new roadmap tasks:

- [x] One continuous chat with preserved history; sidebar and fleet controls removed.
- [x] Mining/refinery lookups, ship details and purchase/rental locations, equipment details and comparisons, location services, and reported commodity prices.
- [x] Component mentions independent of previous questions, with spaces and hyphens matched interchangeably.
- [x] Offline catalogue coverage for every eligible mention record, with shared insertion checks, canonical entity resolution, duplicate-name clarification, and parent-qualified points of interest.
- [x] Shared neutral mention and badge styling in both themes.
- [x] Equipment size filters: “size two,” “size 2,” and “S2,” joined to shop prices and locations.
- [x] Unqualified “best” equipment questions ask for a comparison criterion.
- [x] Base crafting recipes, blueprint unlock missions, named mission details, standing requirements, and immediate prerequisites from the Star Citizen Wiki API.

## Prioritized backlog

### 1. Natural question handling

Status: **Implemented first pass; continue improving from real questions.** Model classification and explicit parser safeguards separate shopping requests, names, categories, and sizes. Regression coverage includes paraphrases and fresh-question context isolation.

Goal: Players can ask in their own words without learning specific phrases.

Examples: “Which shops sell size-two power plants?” “I need a quantum drive for a size-two slot. Where can I get one?” “And where can I buy that one?”

Acceptance:

- [x] Separate the requested action, item/category, size, and location across varied wording.
- [x] Handle spoken numbers, punctuation, abbreviations, and common component names consistently.
- [x] Ask a short clarification for ambiguous items or locations.
- [x] Retain explicit follow-up context without carrying stale items, sizes, or locations into unrelated questions.
- [x] Verify reusable paraphrased chat tests across equipment, ships, mining, crafting, and missions.

### 2. Answer-first responses

Status: **Implemented first pass.** Named purchase and blueprint answers lead with a useful result. Long tables preview three rows, with expandable full results, secondary tables, and long cells; sorting and CSV exports retain the complete dataset.

Goal: Get the useful result at a glance, with supporting details underneath.

Examples: “Where can I buy an XL-1?” “Where can I mine Aluminum?” “What materials do I need to craft this?”

Acceptance:

- [x] Start with a short direct result or the single clarification needed to answer.
- [x] Use compact tables or ingredient lists; put long shop lists and mission variants in expandable details.
- [x] Keep material limitations, such as uncertain availability or old specifications, beside the result.
- [x] Make sources and patches readable without burying the answer.
- [x] Verify readability in both themes and on smaller screens.

### 3. Push-to-talk voice input

Status: **Planned; not implemented.**

Goal: Ask aloud while keeping attention on flying, then receive the transcript and answer in the same chat.

Acceptance:

- [ ] Explicit mic control to start/stop recording; no always-on recording.
- [ ] Clear recording, processing, error, and cancel states.
- [ ] Recognized question and answer appear in the existing continuous chat.
- [ ] Component names and size phrases work through the normal lookup pipeline.
- [ ] Microphone denial and transcription failures do not lose a typed draft.
- [ ] Verify actual spoken questions end to end.

Optional follow-on:

- [ ] Explore short spoken summaries with mute/stop controls. Full tables and sources remain in chat.

### 4. Component comparisons and recommendations

Status: **Partially implemented.** Named comparisons and size-filtered catalogs exist; criterion-based category rankings do not.

Goal: Answer “best for what?” using reported specifications and clear tradeoffs.

Examples: “What is the fastest size-two quantum drive?” “Which size-two drive uses the least fuel?” “Compare the XL-1 and Crossfield.”

Acceptance:

- [ ] Filter category and size before comparing.
- [ ] Rank by an explicit supported criterion, without inventing a universal best item.
- [ ] Show a small comparison with relevant values, units, and tradeoffs.
- [ ] Exclude unknown values from rankings and disclose incomplete coverage.
- [ ] Show specification dates/patches separately from shop-price reports.
- [ ] Include purchase locations when requested.
- [ ] Verify ties, missing data, and inconsistent units through chat tests.

### 5. Blueprint progression

Status: **Implemented bounded first pass.** Recursive mission prerequisites, standing, alternative paths, reward-pool limitations, and recipe-to-progression follow-ups are available. Large or unresolved graphs are explicitly partial.

Goal: Explain the steps toward a blueprint in a short, useful sequence.

Examples: “How do I unlock the XL-1 blueprint?” “Which missions do I need before that one?” “Is that guaranteed or a possible reward?”

Acceptance:

- [x] Trace available prerequisite missions into an understandable sequence.
- [x] Show faction standing and preserve alternative prerequisite paths.
- [x] Distinguish mission variants and alternative unlock routes from required mission chains.
- [x] Distinguish guaranteed rewards, reward pools, and unknown individual drop chances.
- [x] Stop and explain missing or unresolved prerequisite data.
- [x] Include source links and the game patch.
- [x] Verify recipe-to-unlock-to-prerequisite follow-ups in chat.

Limits: answers load at most 20 reward-mission variants, 48 mission records, eight prerequisite levels, and 200 progression rows. Missing links, cycles, and patch conflicts stop the affected branch. Completion tags without linked missions cannot be expanded. The source does not fully specify how multiple prerequisite groups combine, so the answer preserves them separately. A pool chance does not establish the chance of receiving a particular blueprint; no unsupported guarantee is inferred. Personalized mission completion tracking is not implemented.

## Sharing with friends: authentication

Status: **Planned; required before opening access to friends.** Not part of the current local-only implementation work.

Preferred starting option: Discord sign-in for the initial group, paired with invite-only access. Discord identifies the person; the app still decides who may use it. Evaluate the implementation before committing to a provider.

- [ ] Choose a sign-in method and an invite/access policy for the initial group.
- [ ] Require authentication on chat and data endpoints, not just the interface.
- [ ] Keep each person's conversation history private and separate.
- [ ] Apply per-user request and cost limits; keep provider keys on the server.
- [ ] Support signing out and revoking access.
- [ ] Verify that anonymous requests and one user accessing another user's data are rejected before sharing.

## Outside the current scope

Route-profit optimization, budget trading plans, multi-stop trade routes, fleet management, multiple-chat navigation, and invented star-map positioning are outside this roadmap. Existing price history and market alerts remain optional reference features; they are not current priorities.

## Verification notes

October 1: 3,418 automated tests (including catalogue coverage for all nine mention types), lint, and production build pass. Live chat checks cover equipment shopping, recipes, unlock missions, mining, and ship inventories. Live recipe → unlock → prerequisite follow-ups and a fresh named mission were also verified. Browser checks cover compact previews, expansion, keyboard sorting, light/dark themes, and a 390px viewport. Natural-language coverage is ongoing; these checks do not imply that every possible wording is supported. Shop stock remains unverified, and upstream security limitations remain documented in SECURITY.md.

## Completion rule

Update each feature's status and checklist only after implementation and relevant chat tests pass. Record limitations that affect how players should interpret an answer.
