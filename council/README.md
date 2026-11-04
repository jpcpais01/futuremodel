# Oazy Council

A council of Claude agents that tries to always hold the best portfolio it can find. Each week it reads every name in a 155-name universe, debates, attacks its own ideas, and decides what to hold until the next session. Every decision goes into a tamper-evident paper index in this repository ([`../index/council`](../index/council)), measured against the S&P 500 (SPY) and the Nasdaq 100 (QQQ).

It meets on GitHub every Monday before the US open ([`../.github/workflows/council.yml`](../.github/workflows/council.yml)). The Oazy Research apps on Windows and Android only show the result.

## How a session works

1. **Data.** Free sources only: two years of daily prices (Yahoo, with CBOE as a fallback), SEC filings and fundamentals (EDGAR), company and macro news (RSS), FRED macro series and the CBOE volatility indexes.
2. **Analysts read every name.** Code only measures and formats the numbers. Batches of cheaper Claude calls write a dossier on **all 155 names**: the business, the numbers, the news and filings, the bull and bear cases, catalysts, red flags and a verdict. No name is ranked out or dropped by code.
3. **Scout** (High budget only). Searches the web for the past week's news and the next two weeks of catalysts.
4. **The market book.** The macro picture, the scout's briefing, the current portfolio, and every name's numbers and dossier go into one shared, cached document that every seat reads.
5. **Round 1.** Each seat proposes a portfolio on its own, without seeing the others. The seats are Atlas (macro), Nova (growth), Anchor (value and quality), Pulse (momentum), Raven (contrarian), Forge (tech and AI), Harbor (defensives and real assets) and Scout (events).
6. **Debate.** Each seat sees the others' proposals, challenges the weak arguments by name, and revises.
7. **Red team.** Vex attacks the consensus: crowding, correlation, stale theses and the scenario that would hurt the most. The seats then answer the attacks.
8. **Risk.** Sentinel can veto names, cap weights and raise the cash floor. These rulings bind the chair.
9. **Chair.** Arbiter decides: the holdings, their weights, a thesis for each, the exact condition that would make the council sell each one, and the dissent it overruled.
10. **Record.** Hard limits are enforced in code: 5 to 15 positions, at most 15% in one stock or 25% in one ETF, at most 40% in one sector, and at most 40% in cash. The decision is then written to the ledger.

## Budgets

The costs below are estimates per session at current API prices. The app shows the live cost while a session runs.

| Preset | Council | Debate | Analysts | Chair | Estimate |
|---|---|---|---|---|---|
| Low | 5 seats, Sonnet 5.5, low effort | none | Haiku 5.5 | Opus 5.5 | about $0.68 |
| Normal | 7 seats, Opus 5.5, medium effort | 1 round, red team | Haiku 5.5 | Opus 5.5, high effort | about $2.37 |
| High | 8 seats, Opus 5.5, high effort | 2 rounds, red team, rebuttals, web scout | Sonnet 5.5 | Opus 5.5, extra-high effort | about $9.35 |

One Normal session a week costs roughly $10 a month.

## Honesty about results

There is deliberately **no backtest**. A language model already knows what happened in the past, so a backtest of the council would be contaminated by hindsight and would prove nothing. The only evidence that counts is the **forward paper record**:

- Each decision is appended to `ledger.jsonl` with its timestamp, its target weights and a hash of the exact market book the council read. Every entry is chained to the previous one with SHA-256, so any later edit is detectable (`node engine/cli.js verify`, and the apps show whether the chain is intact).
- The record is an index, not a broker account: a decision **enters at the open of its own New York trading day** (09:30), or the next open on a weekend or holiday, with a 0.1% cost on everything traded. A decision made during or after the session gets up to one day of hindsight; that is the price of an index that starts on the day it is decided.
- Values use total-return (dividend-adjusted) prices, the same as the SPY and QQQ benchmarks.

A few weeks of results is noise. Judge it after several months, and preferably against QQQ, which is the hardest benchmark here.

## Running it

The meeting needs your Anthropic API key once, as a repository secret: Settings, Secrets and variables, Actions, New repository secret, named `ANTHROPIC_API_KEY`. Create or rotate keys at https://console.anthropic.com/settings/keys. The key stays in GitHub's secret store and is only sent to Anthropic. Optional: a secret named `SEC_CONTACT` (for example `Your Name you@example.com`), which the SEC asks of automated clients.

Without the secret, the Monday job skips the meeting and says so. To meet outside the schedule, open the Actions tab, pick "Council meeting", then "Run workflow", and choose a budget.

## Command line

```bash
npm run update                                 # rebuild both indexes in ../index from their ledgers and fresh prices
npm run session -- --preset low|normal|high   # convene now (needs ANTHROPIC_API_KEY in the environment)
npm run demo                                   # demo session, no API calls
npm run status                                 # current holdings and record
npm run estimate                               # cost estimate for each preset
node engine/cli.js verify                      # check the ledger's hash chain
npm test                                       # offline tests
```

Sessions write into `../index/council` (or into `OAZY_COUNCIL_DATA` if you set it). Core's index is in `../index/core`: edit `book.json` to rotate it.

## Android app

`release/OazyResearch.apk` shows both indexes, read from this repository. To rebuild it you need the Android SDK (build-tools and a platform) and a JDK:

```bash
ANDROID_HOME=/path/to/sdk npm run apk      # writes dist/OazyResearch.apk
```

Keep the signing keystore (`~/.oazy-council.keystore` by default, or `OC_KEYSTORE`). Phones can only update the app if it is signed with the same key.

## Layout

```
engine/       data, metrics, prompts, the session, rules, the ledger, the index updater (indexer.js) and the CLI
mobile/       the Android app's screens
android/      the Android shell and its build script
release/      the signed APK
test/         offline tests
```

This is a research tool and a paper-trading record, not financial advice.
