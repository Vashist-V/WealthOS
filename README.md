# WealthOS

A personal investment and portfolio analytics platform: track holdings from a transaction ledger, see real returns and risk, follow the market, keep an investment journal, and test scenarios before acting on them.

WealthOS never places trades and does not connect to a broker. You record your own transactions; market data prices them.

## What's in it

| Area | Pages |
| --- | --- |
| Portfolio | Dashboard, Holdings, Transactions (CSV and broker tradebook import, export), Portfolios (multiple portfolios, public share links) |
| Analytics | Allocation and concentration, Risk (volatility, beta, Sharpe, drawdown, VaR/CVaR, variance, correlation heatmap, risk contribution), X-Ray, Dividends, Compare |
| Markets | Market dashboard (a market assistant you can ask anything, confidence scores for the market and every sector, indices, breadth, sectors, movers, market map, screener), stock pages (chart, ratios, financial statements, corporate actions), Watchlists, Corporate-actions calendar, Alerts |
| Lab | Trade check (a buy or sell run through every check, with a confidence score), What-if (growth plans and shocks), Monte Carlo, rule-based Backtesting with a visual rule builder, Paper trading |
| Record | Investment journal with thesis-versus-outcome review |
| Help | Hands-on lessons that point at each control and have you use it, a per-page guide behind the ? button, a stock assistant you can ask questions, and public docs at `/docs` |

Also: dark and light themes, installs as an app on phones and computers ("Get the app"), keyboard search (Ctrl/⌘ K), responsive down to phone widths.

## Architecture

```
React + TypeScript + Tailwind (Vite, PWA)          frontend/
        │  REST, bearer token
FastAPI                                            backend/app
        ├── routers/     HTTP endpoints
        ├── services/    portfolio valuation, analytics, sample data
        ├── quant/       ledger, returns (XIRR/TWR), risk, simulation, backtest
        ├── market/      Yahoo Finance data, cached in memory and on disk
        ├── store/       Supabase (PostgREST, row-level security) or local demo store
        └── web.py       serves the built frontend in a deployment, so one service runs everything
Supabase                                           supabase/migrations
        Auth + Postgres
```

Two things worth knowing:

- **The ledger is the source of truth.** Positions, average cost, realised and unrealised P&L, holding periods, XIRR and time-weighted returns are replayed from transactions on every request. Trades entered before a split or bonus are restated automatically. The `holdings` table is a cache the API rewrites when the ledger changes.
- **Row-level security is the access boundary.** The API calls Supabase as the signed-in user (their JWT), so a user can only ever read or write their own rows. The service-role key is optional and used only to mirror shared market data (`price_history`, `dividends`, `corporate_actions`) and to serve public share links.

## Run it

Requirements: Python 3.11+ and Node 20+.

**Backend**

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env          # macOS/Linux: cp .env.example .env
uvicorn app.main:app --port 8000
```

**Frontend**

```bash
cd frontend
npm install
copy .env.example .env
npm run dev                     # http://localhost:3000
```

The first start downloads ten years of daily prices for about 130 instruments and caches them in `backend/.cache`; later starts are instant.

### Demo workspace

With no Supabase settings, or by choosing "Explore the demo workspace" on the sign-in page, the app runs against a local store seeded with four sample portfolios priced from real market history. Demo data lives in `backend/.data` and is tied to the browser that created it.

Sample data can be removed at any time from the banner on the dashboard or from Settings. Removal deletes only untouched samples: a sample portfolio you have added your own trades to, or renamed, is kept.

### Stock assistant

Every stock page has an assistant. For each question the server assembles a briefing for that stock and that user (price and trend, fundamentals, their position and trades, their journal entry, corporate events, recent headlines) and answers against it.

- **Without an AI key** the suggested questions are answered directly from the briefing, with no language model involved.
- **With `GEMINI_API_KEY` set** in `backend/.env`, answers come from Google Gemini, streamed to the chat. The default model is `gemini-2.5-flash`, whose free tier includes Google Search grounding, so the assistant can read recent news. If that model is out of quota or unavailable the request steps down: the same model without search, then `ASSISTANT_GEMINI_FALLBACK`. Google's search-suggestion chips are shown under grounded answers, as its terms require.
- **With `ANTHROPIC_API_KEY` set**, answers come from Claude (`claude-opus-5-5` by default). Claude's web search is billed per search. The request opts into Anthropic's server-side fallback, so a question a safety classifier declines is retried on the recommended fallback model.

`ASSISTANT_PROVIDER=auto` uses Gemini when its key is set and Claude otherwise; set it to `gemini` or `anthropic` to force one. `ASSISTANT_WEB_SEARCH=false` turns web search off for either.

The briefing sent to the model contains the user's position, trades and journal notes for that stock. On Gemini's free tier, Google's terms allow prompts to be used to improve its products; use a paid tier or Claude if that matters.

The assistant explains and gives context. It is instructed not to give price targets or make buy and sell decisions for the user.

### Trade check

Lab → Trade check takes a trade the user is thinking about ("buy 30 HEROMOTOCO in Long-Term") and runs it through a fixed set of checks in six groups: trend, valuation, the business, risk, fit with the portfolio, and timing. Each check supports the trade, goes against it, is neutral, or is a note that is not scored. A sale reads the same facts the other way round.

- **The confidence score is arithmetic, not a model's opinion.** It starts at 50 and moves by the share of check weight on each side, so the same inputs always give the same score (`backend/app/services/tradecheck.py`, covered by `tests/test_tradecheck.py`). With too little data it gives no score rather than a weak one.
- **"In plain words" explains the result.** With an AI key it is written by the same model as the stock assistant, from the checks plus the stock briefing and recent news. Without one, or if the model is unavailable, it is written straight from the checks.
- It shows what the trade does to the holding and its sector, what one-year holding periods have looked like in the stock's own history, and what the checks cannot see. It never places an order; from the result the user can record the trade once made, or take it to a paper account.

The stock page, the Add transaction dialog and the docs all link into it, and `/lab/trade-check?symbol=…&side=BUY&qty=30` runs a check directly.

### Market assistant and confidence scores

The Market page has an ask bar and a chat. It takes questions in the user's own words: what happened today and why, which sectors did well, whether it is a good time for a sector in the short or long term, or where a sum of money could go ("I have ₹50,000, which sector and which five companies?").

- **The market pulse** (`backend/app/services/pulse.py`) scores the market as a whole (the "market mood"), each sector and each tracked company from 0 to 100. A company gets the trade check's trend, valuation, business and risk checks, so the two agree. A sector and the market have checks of their own (how many companies are above their averages, returns against the index, new highs against lows, India VIX, growth, profitability, price). Company and sector scores come in a short-term reading (price checks only) and a long-term one (which adds the business). The snapshot is shared by all users and rebuilt about once a minute while the market is open; `GET /api/market/pulse` serves the scoreboard.
- **Every answer carries the app's own figures.** The server reads the question for a sector, a company, a sum of money and a horizon (`market_assistant.resolve`, which also reads follow-ups such as "what about pharma?" in the light of the conversation) and sends a card of scores for it before any words: the mood, the sector scoreboard, one sector, one company, a ranking, or ideas for a sum of money with what it buys of each company. A language model never produces a score.
- **The words** come from the same model as the stock assistant, given the whole pulse, recent market headlines and which sectors the user already holds. It can search the news for the why. Without an AI key, or if the model is busy, the answer is written from the data and says so.
- A ranking for a sum of money leads with the highest-scoring sector that has at least five tracked companies, lists only companies the sum can buy a share of, and links each one to Trade check. It is presented as a ranking of today's evidence, not a recommendation.

### Guide and docs

- **Hands-on lessons** (`frontend/src/lib/lessons.ts`): seven short lessons. Each step names a control by its `data-tour` attribute, says what it is for and, where it has a task, waits for the user to do it before moving on. The page stays fully usable throughout. Lessons are offered on the first visit, live under "Take the tour", and can be started by link: `/?guide=trade-check`.
- **Page guide** (`frontend/src/lib/guide.ts`): the ? button explains whichever page is open.
- **Docs** (`/docs`): public, no account needed. It is built from the same guide entries and lessons, so it cannot drift from the app. Links into the app send a signed-out visitor through sign-in and land them on the page they asked for.

### Logo

The artwork is `frontend/brand/wealthos-logo.png`. Every icon is cut from it by one script, so replacing the artwork and re-running the script updates them all:

```bash
cd frontend
python brand/make_assets.py        # needs Pillow
```

| File in `frontend/public/` | Used for |
| --- | --- |
| `logo-mark.png` | The mark inside the app: sidebar, login, docs, shared pages, loading screen |
| `favicon.ico`, `favicon-32.png` | Browser tab |
| `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png` | Installed app on Android and desktop, and alert notifications |
| `apple-touch-icon.png` | iOS home screen |
| `og-image.png` | The picture shown when a link to the app is shared |

The name beside the mark is type, not an image (`Brand` in `frontend/src/components/layout/AppShell.tsx`): "Wealth" takes the theme's text colour and "OS" the logo's teal-to-green (`--brand-from`, `--brand-to` in `frontend/src/index.css`). Link previews need a full address for the picture, so once the app has a public URL, put it in front of `/og-image.png` in `frontend/index.html`.

### Accounts (Supabase)

1. Create a Supabase project.
2. Run `supabase/migrations/0001_wealthos_schema.sql` in the SQL editor. It creates the tables, indexes, triggers and row-level-security policies, and is safe to re-run.
3. Put the project URL and publishable (anon) key in `backend/.env` and `frontend/.env`. Optionally add the service-role key to `backend/.env` only.
4. Restart both servers. Sign-up and sign-in now appear on the login page.

The dev server uses port 3000 because that is Supabase's default Site URL, so confirmation and password-reset emails link back to it. For any other address, set the Site URL under Authentication → URL Configuration.

### Get the app

WealthOS installs from the site itself, as a progressive web app: no app store, and one codebase for every device.

- **Android, and Chrome or Edge on a computer:** the "Get the app" button starts the install, using the prompt the browser hands the page. It then waits for the device to confirm before saying "installed": a computer's browser reports it itself, and an Android phone (which builds the app in the background for up to a minute, and can fail to) is asked through `getInstalledRelatedApps`. If no confirmation comes, the button shows what to check instead of claiming success. A confirmed install is remembered, so the button is not offered again on that device.
- **iPhone and iPad:** Apple gives a website no way to install itself, so the button shows the steps instead (Share, then Add to Home Screen).
- **Anything else:** the button shows the steps for that device, and for the others.

The button is on the sign-in page, in the sidebar, in Settings and in the docs (`/docs#install`); it disappears inside the installed app. The logic is in `frontend/src/lib/install.ts` and `frontend/src/components/InstallApp.tsx`. A browser only offers to install a site served over HTTPS (or from `localhost`), and not from Vite's dev server, so try it on a deployment or on the single-service run below.

## Deploy

One service runs everything. The `Dockerfile` builds the web app and puts it beside the API, which then serves both from one address: `/api/...` is the API and every other address is the app. One address means no CORS to set up, and with the host's HTTPS it is all "Get the app" needs.

### On Render

1. Put the project on GitHub.
2. In Render choose **New → Blueprint** and pick the repository. `render.yaml` describes the service.
3. Fill in the values it asks for: `SUPABASE_URL` and `SUPABASE_ANON_KEY` for accounts, and `GEMINI_API_KEY` for AI answers. They are the same values as in `backend/.env`, and are entered once: the API tells the web app the Supabase values when it loads (`/config.js`), so there are no `VITE_` copies to keep in step. Anything else from the Configuration table, such as `SUPABASE_SERVICE_ROLE_KEY` for share links, can be added later under the service's Environment tab.
4. When it is live, copy its address into Supabase under **Authentication → URL Configuration → Site URL**, so confirmation and password-reset emails link to it.

By default Render redeploys on every push to the repository.

### Anywhere else that runs a container

```bash
docker build -t wealthos .
docker run -p 8000:8000 --env-file backend/.env -v wealthos-data:/data wealthos
```

The service listens on `PORT` (default 8000). Set `PUBLIC_URL` to the address people will use, so link previews can find the share picture (Render supplies this itself). Health check: `/api/health`. The API's own reference is at `/api/docs`.

To try the same arrangement without Docker:

```bash
cd frontend && npm run build        # with VITE_API_URL unset or empty
cd ../backend && WEB_DIR=../frontend/dist uvicorn app.main:app --port 8000
```

### What to know before going public

- **One process only.** Prices are held in memory and refreshed on background threads, so run a single instance with a single worker.
- **Disk.** Downloaded market history and demo workspaces are kept under `/data`. Without a disk mounted there, each restart downloads the history again, so the first visits afterwards are slow, and demo workspaces start afresh. Accounts and their portfolios live in Supabase and are not affected.
- **Free instances sleep.** Render's free plan stops the service after 15 quiet minutes, so the next visitor waits for it to start and for the history to download. A paid instance with a disk avoids both.
- **Memory.** The API peaked at about 300 MB in development on Windows, so a 512 MB instance should be enough; it has not been measured on a hosted Linux instance.
- **Market data.** Yahoo Finance is meant for personal use and sometimes refuses requests from hosting providers. For a public product, replace `backend/app/market/provider.py` with a licensed feed.
- **AI keys.** The assistant endpoints have no per-visitor limit, and the demo workspace needs no account. With a paid key, set a spending cap with the provider, or set `DEMO_ENABLED=false`.
- **Separate hosts.** To put the web app on a static host instead, build it with `VITE_API_URL` set to the API's address (and the two `VITE_SUPABASE_` values), and add the site's address to the API's `CORS_ORIGINS`.

## Configuration

`backend/.env`

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Enables accounts. Leave blank for demo-only mode. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional. Persists market data to Supabase and enables share links for account portfolios. Never expose it to the browser. |
| `CORS_ORIGINS` | Comma-separated origins allowed to call the API. |
| `DEMO_ENABLED` | Set `false` to turn the demo workspace off. |
| `WEB_DIR` | Deployment: the folder holding the built frontend. When set, the API serves the web app too. The `Dockerfile` sets it. |
| `PUBLIC_URL` | Deployment: the address people reach the app at, used to give link previews the share picture's full address. |
| `DATA_DIR`, `CACHE_DIR` | Where demo workspaces and downloaded market history are kept (default `backend/.data` and `backend/.cache`; `/data/...` in the image). |
| `RISK_FREE_RATE` | Annual rate used for Sharpe, Sortino and alpha (default `0.065`). |
| `BENCHMARK` | Default benchmark symbol (default `^NSEI`). |
| `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` | Turns on AI answers in the stock assistant. Without either it answers from data only. |
| `ASSISTANT_PROVIDER` | `auto` (Gemini if its key is set, else Claude), `gemini` or `anthropic`. |
| `ASSISTANT_GEMINI_MODEL`, `ASSISTANT_GEMINI_FALLBACK` | Gemini model (default `gemini-2.5-flash`) and the one to step down to (default `gemini-3.5-flash`). |
| `ASSISTANT_MODEL`, `ASSISTANT_EFFORT` | Claude model (default `claude-opus-5-5`) and reasoning effort (`low`, `medium`, `high`; default `medium`). |
| `ASSISTANT_WEB_SEARCH` | `true` lets the assistant search the web for news (default). |

`frontend/.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`. These are for development and for a web app hosted apart from the API; a single-service deployment needs none of them.

## Tests

```bash
cd backend
python -m pytest                 # ledger, returns, risk, simulation, backtest, stores, assistants, trade check, market pulse and serving the web app (offline)
python -m tests.smoke_api        # every endpoint against live market data
```

```bash
cd frontend
npm run build                    # type-check and production build
```

## How the numbers are calculated

- **Cost and P&L** use the average-cost method; open lots are tracked first-in-first-out for holding periods. Fees are added to cost on buys and deducted from proceeds on sells.
- **XIRR** is the money-weighted annual return of your actual cash flows plus today's value.
- **CAGR** and the return charts are time-weighted: deposits and withdrawals are removed so the figure is comparable with a benchmark.
- **Risk** replays today's holdings at today's weights over the chosen lookback. Volatility is annualised over 252 sessions; VaR and CVaR are one-day figures from the historical distribution.
- **Dividends** are estimated from the shares held on each ex-date; actual credits can differ.
- **Backtests** read signals on the close and fill at the next session's open. They ignore slippage, taxes and liquidity.
- **Monte Carlo** draws monthly returns from a log-normal distribution, or bootstraps them from history.

## Market data

Prices, fundamentals, statements and corporate actions come from Yahoo Finance through `yfinance`, are delayed by a few minutes, and are suitable for personal use. Headlines for the assistant come from the Google News RSS feed. The provider is isolated in `backend/app/market/provider.py`; a licensed feed can replace it without touching the rest of the app.

## What's not here yet

From the proposal's infrastructure list, these were left for deployment time rather than built in: Redis and Celery (refreshes run on in-process background threads), AWS and CI/CD. There is one Docker image, described under Deploy. The app installs from the site as a progressive web app; it is not listed in the App Store or Google Play. Board-meeting dates are not in the corporate-actions calendar because the data source does not publish them. Alerts are evaluated while the app is open; there is no server-side push.
