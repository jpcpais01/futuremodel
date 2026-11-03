# Oazy Council

A council of Claude agents that tries to always hold the best portfolio it can find. Each week it reads every name in a 155-name universe, debates, attacks its own ideas, and decides what to hold until the next session. Every decision goes into a tamper-evident paper-trading record, measured against the S&P 500 (SPY) and the Nasdaq 100 (QQQ).

It has three parts:

- A **desktop app** for Windows (Electron) with a live view of the council chamber.
- A **phone app** for Android that runs the council on its own, with your API key pasted in the app.

The PC and the phone are one account: the same portfolio, ledger, sessions and settings on both, kept in sync through a private GitHub repository you own.
- A **command line** for running sessions from scripts or Task Scheduler.

## How a session works

1. **Data.** Free sources only: two years of daily prices (Yahoo, with CBOE as a fallback), SEC filings and fundamentals (EDGAR), company and macro news (RSS), FRED macro series, the CBOE volatility indexes, and Hyperliquid's list of tradable perps (shown for reference only).
2. **Analysts read every name.** Code only measures and formats the numbers. Batches of cheaper Claude calls write a dossier on **all 155 names**: the business, the numbers, the news and filings, the bull and bear cases, catalysts, red flags and a verdict. No name is ranked out or dropped by code.
3. **Scout** (High budget only). Searches the web for the past week's news and the next two weeks of catalysts.
4. **The market book.** The macro picture, the scout's briefing, the current portfolio, and every name's numbers and dossier go into one shared, cached document that every seat reads.
5. **Round 1.** Each seat proposes a portfolio on its own, without seeing the others. The seats are Atlas (macro), Nova (growth), Anchor (value and quality), Pulse (momentum), Raven (contrarian), Forge (tech and AI), Harbor (defensives and real assets) and Scout (events).
6. **Debate.** Each seat sees the others' proposals, challenges the weak arguments by name, and revises.
7. **Red team.** Vex attacks the consensus: crowding, correlation, stale theses and the scenario that would hurt the most. The seats then answer the attacks.
8. **Risk.** Sentinel can veto names, cap weights and raise the cash floor. These rulings bind the chair.
9. **Chair.** Arbiter decides: the holdings, their weights, a thesis for each, the exact condition that would make the council sell each one, and the dissent it overruled.
10. **Record.** Hard limits are enforced in code: 5 to 15 positions, at most 15% in one stock or 25% in one ETF, at most 40% in one sector, and at most 40% in cash. The decision is then written to the ledger.

The **daily watch** runs on weekdays after the close. It is one cheap call that checks each holding against its own sell condition and the latest news. If a thesis has broken, it can call an emergency session (this is off by default; by default it only notifies you).

## Budgets

The costs below are estimates per session at current API prices. The app shows the live cost while a session runs.

| Preset | Council | Debate | Analysts | Chair | Estimate |
|---|---|---|---|---|---|
| Low | 5 seats, Sonnet 5.5, low effort | none | Haiku 5.5 | Opus 5.5 | about $0.68 |
| Normal | 7 seats, Opus 5.5, medium effort | 1 round, red team | Haiku 5.5 | Opus 5.5, high effort | about $2.37 |
| High | 8 seats, Opus 5.5, high effort | 2 rounds, red team, rebuttals, web scout | Sonnet 5.5 | Opus 5.5, extra-high effort | about $9.35 |

A weekly Normal session plus the daily watch costs roughly $10 to $12 a month.

## Honesty about results

There is deliberately **no backtest**. A language model already knows what happened in the past, so a backtest of the council would be contaminated by hindsight and would prove nothing. The only evidence that counts is the **forward paper record**:

- Each decision is appended to `ledger.jsonl` with its timestamp, its target weights and a hash of the exact market book the council read. Every entry is chained to the previous one with SHA-256, so any later edit is detectable (Performance, then "Verify again").
- A decision fills at the **first regular-session open after it was made** (09:30 New York time), with a 0.1% cost on everything traded.
- Values use total-return (dividend-adjusted) prices, the same as the SPY and QQQ benchmarks.

A few weeks of results is noise. Judge it after several months, and preferably against QQQ, which is the hardest benchmark here.

## Setup (Windows)

You need [Node.js](https://nodejs.org) 20 or newer.

```powershell
cd C:\Users\jpcpa\Paizy\council
npm install
setx ANTHROPIC_API_KEY "your-key"      # once; then open a new terminal
npm start
```

The API key is read **only** from the `ANTHROPIC_API_KEY` environment variable. The app never writes it to disk. Create or rotate keys at https://console.anthropic.com/settings/keys.

Optional: set `SEC_CONTACT` (for example `"Your Name you@example.com"`), or fill in the field in Settings. The SEC asks automated clients to identify themselves.

To try it without a key, tick **Demo run**. Demo runs use scripted seats on real market data, cost nothing, and keep their own separate record (switch between them with Paper and Demo at the top).

### Build an installer

```powershell
npm run dist          # dist\Oazy Council Setup 1.0.0.exe and a portable .exe
```

### Schedule

While the app is running (it can stay in the tray), it convenes on its own every week (Sunday 20:00 local time by default) and runs the watch on weekdays at 22:30. If the computer was off at the time slot, it catches up within three days. Change all of this in Settings.

Without the app, you can use Task Scheduler with the command line:

```powershell
schtasks /Create /SC WEEKLY /D SUN /ST 20:00 /TN "Oazy Council" /TR "cmd /c cd /d C:\Users\jpcpa\Paizy\council && npm run session -- --preset normal"
```

## Phone app (Android)

The phone app does not need the PC. It runs the same council engine on the phone, with your own API key.

1. Install `OazyCouncil.apk`. Android will ask you to allow installs from your file manager or browser.
2. Open **Settings** in the app and paste your Anthropic API key. It is encrypted with the phone's keystore, never synced, and only sent to Anthropic.
3. Fill in the account (below) to share everything with the PC.

While a session runs, the phone keeps the screen on and shows a notification so Android does not stop it. The weekly session is run by whichever device is on at the time: the PC runs it on its own; if the PC was off, the phone shows "This week's session is due" with a button to convene it. The phone runs the cheap daily watch whenever it is open and the watch is owed.

## One account on the PC and the phone

Both apps keep the shared record in a private GitHub repository. Set it up once:

1. Create a **private** repository, for example `oazy-council-data`. Leave it empty.
2. Create a fine-grained token at github.com, Settings, Developer settings, Personal access tokens, Fine-grained tokens. Give it access to **only that repository**, with **Contents: Read and write**. Nothing else.
3. In the PC app (**Settings, Account sync**) and in the phone app (**Settings, Account**), enter `you/oazy-council-data` and paste the token.

What is shared: the ledger, the watch log, every session transcript, the shared settings (budget, schedule, watch, SEC contact) and a live status. What is never shared: API keys, the token itself, and the market-data caches. When one device is in session, the other shows "In session on ..." with the current step and will not start a second session; its result arrives when it ends. If both devices record a decision while apart, the ledger chains are joined, so nothing is lost and the hash chain still verifies.

The token is encrypted on each device (Windows protection on the PC, the keystore on the phone). If it leaks, delete it on GitHub and make a new one.

To rebuild the APK, you need the Android SDK (build-tools and a platform) and a JDK:

```bash
ANDROID_HOME=/path/to/sdk npm run apk      # writes dist/OazyCouncil.apk
```

Keep the signing keystore (`~/.oazy-council.keystore` by default, or `OC_KEYSTORE`). Phones can only update the app if it is signed with the same key.

## Command line

```bash
npm run session -- --preset low|normal|high   # convene now
npm run demo                                   # demo session, no API calls
npm run watch                                  # daily check of every holding
npm run status                                 # current holdings and record
npm run estimate                               # cost estimate for each preset
node engine/cli.js verify                      # check the ledger's hash chain
npm test                                       # offline tests
```

The app and the command line share one data folder: `%APPDATA%\Oazy Council\data` (or set `OAZY_COUNCIL_DATA`). Sessions, market books, the ledger, the watch log and the price cache are all plain JSON in that folder.

## Layout

```
main.js, preload.js     the desktop app: window, tray, scheduler
app/                    the desktop window (chamber, portfolio, record, sessions, settings)
mobile/                 the phone screens and core.bundle.js (the engine built for the phone)
phone/                  the phone's engine entry and its small Node shims; `node phone/build.js` rebuilds the bundle
android/                the Android shell and its build script
engine/                 data, metrics, prompts, the session, rules, ledger, watch, account sync (sync.js), the shared core (core.js), CLI
test/                   offline tests
```

This is a research tool and a paper-trading record, not financial advice.
