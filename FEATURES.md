# UEX Agent — Features & Chat Examples

A real-time commodity trading assistant for Star Citizen, powered by UEX Corp API data and LLM-native response generation.

---

## Core Features

### Commodity Trading
Find the best places to buy and sell any commodity across all star systems.

| Example Query | What It Does |
|---|---|
| `Where should I sell Bexalite?` | Top 5 sell locations sorted by price |
| `Where can I buy Laranite?` | Cheapest buy locations with stock info |
| `Buy Laranite on Hurston` | Buy locations filtered to Hurston |
| `Sell Quantanium in Stanton` | Sell locations filtered to Stanton system |

### Trade Routes
Find the most profitable trade routes for any commodity.

| Example Query | What It Does |
|---|---|
| `Best trade route for Quantanium` | Top routes with buy/sell terminals and profit |
| `Best trade route for Laranite in Stanton` | Routes filtered to Stanton system |

### Price Check
Get current pricing info for any commodity.

| Example Query | What It Does |
|---|---|
| `What's the price of Agricium?` | Current buy/sell prices across terminals |
| `Price of Gold in Pyro` | Prices filtered to a specific system |

### Price History
View historical price trends with interactive charts.

| Example Query | What It Does |
|---|---|
| `Price history of Agricium` | Line chart showing buy/sell price trends |
| `Laranite price trends` | Historical pricing data |

### Commodity Info
Search for a commodity to see detailed info with buy/sell tables.

| Example Query | What It Does |
|---|---|
| `Tell me about Laranite` | Type, avg prices, tags + buy/sell location tables |
| `What is Bexalite?` | Commodity details with live pricing data |

### Commodity Rankings
Find the most profitable commodities.

| Example Query | What It Does |
|---|---|
| `What's the most profitable commodity?` | Ranked by profit margin |
| `Top commodities` | Sorted by profitability |

---

## Advanced Trading Features

### Budget-Aware Trading
Tell the bot your budget and it finds the best trades you can afford.

| Example Query | What It Does |
|---|---|
| `I have 50000 aUEC, what should I trade?` | Best trades within your budget |
| `50k budget, best trades` | Considers SCU capacity and investment needed |
| `I have 100000 credits to spend` | Shows commodity, buy/sell at, SCU, investment |

### Commodity Category Browsing
Browse commodities by type or category.

| Example Query | What It Does |
|---|---|
| `Show me all metals` | Lists all Metal type commodities |
| `What minerals are available?` | All Mineral commodities with prices |
| `Show me illegal commodities` | Contraband/illegal items |
| `List all raw commodities` | Raw/unprocessed materials |
| `What gas commodities exist?` | Gas type commodities |

### Price Comparison Across Systems
Compare commodity prices between two star systems side by side.

| Example Query | What It Does |
|---|---|
| `Compare Laranite prices in Stanton vs Pyro` | Side-by-side pricing comparison |
| `Compare Gold prices in Stanton and Pyro` | Avg buy/sell + detailed terminal lists |

### Location-Based Trading
Tell the bot where you are and it finds what to buy/sell there.

| Example Query | What It Does |
|---|---|
| `I'm at Port Tressler, what should I buy?` | Best commodities to buy at your location |
| `What should I trade at Lorville?` | Trading opportunities at a terminal |

### Fleet Trading
Get optimized trade recommendations for multiple ships at once.

| Example Query | What It Does |
|---|---|
| `Best trades for my C2 and Caterpillar` | Per-ship tables with profit/investment |
| `Fleet trades for Freelancer MAX and Hull C` | Separate recommendations per ship |

### Multi-Hop Route Planning
Plan multi-stop trade routes for maximum profit.

| Example Query | What It Does |
|---|---|
| `Plan a multi-hop route with 96 SCU` | 3-stop route with buy/sell at each hop |
| `Multi-stop route for C2` | Uses ship's SCU capacity automatically |

### Profit Calculator
Calculate exactly how much you'll make on a trade run.

| Example Query | What It Does |
|---|---|
| `How much profit with a C2 selling Laranite?` | Investment, revenue, profit, ROI% |
| `Calculate earnings trading Quantanium with Caterpillar` | Full profit breakdown card |

---

## Ship Features

### My Fleet
Save ships to your personal fleet and select an active ship to automatically inform all trade answers.

- **Fleet management** — Open from the sidebar's "My Fleet" button. Search for any ship by name and add it to your fleet with one click. Ships persist across sessions via localStorage.
- **Active ship selector** — A ship selector in the chat input toolbar lets you pick which ship you're currently flying. Shows as a compact pill (e.g., "Caterpillar · 576 SCU") when selected.
- **Context-aware answers** — When an active ship is set, all trade route, profit calculator, budget, and multi-hop answers automatically use your ship's cargo capacity instead of the default 96 SCU. No need to mention your ship in every question.
- **Explicit overrides** — Mentioning a ship by name (e.g., `@C2 Hercules`) always overrides the active ship for that query.

### Ship Info
Look up detailed specs for any ship or vehicle.

| Example Query | What It Does |
|---|---|
| `Tell me about the C2 Hercules` | Manufacturer, cargo, crew, dimensions, role |
| `How much cargo can a Caterpillar hold?` | SCU capacity and ship specs |
| `Freelancer MAX specs` | Full vehicle information |

### Ship Comparison
Compare two ships side by side.

| Example Query | What It Does |
|---|---|
| `Compare C2 vs Caterpillar` | Side-by-side spec comparison table |
| `C2 Hercules vs Hull C` | Cargo, crew, dimensions, pad size |

---

## Location Features

### Star System Info
Learn about star systems.

| Example Query | What It Does |
|---|---|
| `Tell me about Stanton` | System overview with planets and locations |
| `Tell me about Crusader` | Planet/location information |

### Space Stations
Find space stations in a system, with optional feature filtering.

| Example Query | What It Does |
|---|---|
| `Space stations in Stanton` | All stations with services (trade, refuel, repair, refinery, clinic) |
| `Stations in Pyro` | Space station list for a system |
| `What stations have refineries in Pyro?` | Filtered to only stations with refineries |
| `Stations with repair in Stanton` | Filtered to stations with repair services |

### Terminal Info
Look up details and live prices for a specific trade terminal.

| Example Query | What It Does |
|---|---|
| `Tell me about CRU-L1` | Terminal location, type, and commodity prices |
| `What's available at Lorville CBD?` | Buy/sell prices at a specific terminal |

### Cities
Find cities on a planet.

| Example Query | What It Does |
|---|---|
| `Cities on Hurston` | List of cities with trade terminals, cargo centers, refineries |
| `What cities are on ArcCorp?` | City information |

### Outposts
Find outposts on a planet or moon, with optional feature filtering.

| Example Query | What It Does |
|---|---|
| `Outposts on Hurston` | All outposts with services |
| `Mining outposts on MicroTech` | Outposts filtered by mining/refinery capability |
| `Outposts with clinics on Aberdeen` | Filtered to outposts with medical clinics |

---

## UI Features

### Chat Experience
- **Streaming responses** — Text appears word by word with cursor animation
- **LLM-native responses** — GPT-4o-mini generates natural, conversational answers from structured data (with template fallback)
- **Conversation memory** — Follow-up questions understand context (e.g., "What about in Pyro?" after asking about a commodity)
- **@ mentions with typeahead** — Type `@` to search commodities, ships, locations, and terminals inline
- **Keyboard shortcuts** — `Enter` to send, `Shift+Enter` for newline, `↑` to recall previous message

### Data Display
- **Sortable tables** — Click any column header to sort ascending/descending (numeric-aware sorting)
- **CSV export** — Download any table as a CSV file for spreadsheet use
- **UEX links** — Commodity and terminal names in tables link directly to their UEX Corp pages
- **Price charts** — Interactive line charts for price history (Recharts)
- **System maps** — SVG trade route visualizations
- **Profit cards** — Visual profit calculator display

### Chat Management
- **Persistent conversations** — Chat history saved to localStorage
- **Conversation sidebar** — Browse, switch between, and delete past conversations
- **New chat button** — Start a fresh conversation anytime
- **Copy responses** — Hover to copy bot responses (tables as TSV for spreadsheet paste)
- **Retry on error** — Retry failed messages with one click

### Fleet & Ship Management
- **Fleet settings drawer** — Add/remove ships with real-time search from the full UEX vehicle database
- **Active ship selector** — Compact popover in the input toolbar to pick your current ship
- **Persistent fleet** — Ships and active selection saved to localStorage across sessions

### Data & UX
- **Data freshness indicator** — Shows when data was last refreshed + manual refresh button
- **Categorized example prompts** — Welcome screen with Trading, Market Data, and Ships & Locations sections
- **Loading skeleton** — Smooth pulse animation while waiting for responses
- **Dark/light mode** — System-aware theme toggle
- **Mobile responsive** — Full mobile support with slide-out sidebar
- **Smart error handling** — UEX API outages show friendly messages with retry guidance
- **LLM classifier** — When the keyword parser can't understand a query, GPT-4o-mini interprets it (with circuit breaker for reliability)

---

## Technical Details

### Stack
- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS v4
- **UI Components**: base-ui (Button, Popover, Sheet, Tooltip, etc.)
- **Data**: UEX Corp API v2.0 (real-time Star Citizen commodity data)
- **Charts**: Recharts
- **LLM**: OpenAI GPT-4o-mini — dual use: intent classification and natural response generation
- **Persistence**: localStorage (conversations, fleet, active ship, theme)

### API Endpoints
| Endpoint | Method | Description |
|---|---|---|
| `/api/chat/stream` | POST | SSE streaming chat with active ship injection |
| `/api/suggest` | GET | Typeahead suggestions for @-mentions |
| `/api/vehicle` | GET | Vehicle lookup by name (returns fleet-ready data) |
| `/api/cache-status` | GET | Cache age info |
| `/api/cache-status` | DELETE | Clear data cache |

### Query Processing Pipeline
```
User message
  → LLM classifier (GPT-4o-mini, with circuit breaker)
  → Keyword parser fallback (17 intent types)
  → Context resolver (conversation history)
  → Active ship injection (fleet selection)
  → Answer builder (data fetch + handler)
  → Response generator (LLM-native text + fallback)
  → SSE stream (word-by-word with 15ms delay)
```

### Intent Types
The bot handles 19 distinct intents:

| Intent | Example |
|---|---|
| `sell` | "Where to sell Laranite?" |
| `buy` | "Where to buy Quantanium?" |
| `trade_route` | "Best trade route for Gold" |
| `price_check` | "Price of Agricium" |
| `price_history` | "Laranite price trends" |
| `commodity_ranking` | "Most profitable commodity" |
| `find_commodity` | "Tell me about Bexalite" |
| `commodity_category` | "Show me all metals" |
| `vehicle_info` | "C2 Hercules specs" |
| `vehicle_compare` | "Compare C2 vs Caterpillar" |
| `terminal_info` | "Tell me about CRU-L1" |
| `station_info` | "Space stations in Stanton" |
| `city_info` | "Cities on Hurston" |
| `outpost_info` | "Outposts on Aberdeen" |
| `location_info` | "Tell me about Stanton" |
| `budget_trade` | "50k budget, best trades" |
| `location_trade` | "What to trade at Lorville?" |
| `price_compare` | "Compare Gold in Stanton vs Pyro" |
| `fleet_trade` | "Trades for C2 and Caterpillar" |
| `profit_calc` | "Profit trading Laranite with C2?" |
| `multi_hop` | "Multi-hop route with 96 SCU" |
