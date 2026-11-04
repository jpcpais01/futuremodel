# Oazy Research

Two portfolios, kept as **paper indexes** in this repository and judged against the S&P 500 (SPY) and the Nasdaq-100 (QQQ).

| Portfolio | What it is |
|---|---|
| **Core v1.0** | A hand-built book of AI, regime and hedge positions. Its holdings are in [`index/core/book.json`](index/core/book.json). |
| **Council** | A council of Claude agents that reads 155 names every week, debates, and holds what it judges the best portfolio. |

Both entered at the 09:30 New York open on 3 November 2026. Nothing here trades or checks a broker account.

**See how they are doing now: [`index/`](index)** (a table and a chart, rebuilt by GitHub).

## How it runs

Everything happens here on GitHub, so no computer needs to stay on.

- **Update the indexes** ([`.github/workflows/index.yml`](.github/workflows/index.yml)): every hour while the US market is open and twice after the close, GitHub fetches free prices, values both indexes and commits the result to `index/`.
- **Council meeting** ([`.github/workflows/council.yml`](.github/workflows/council.yml)): every Monday before the open, the council meets and its decision enters at that day's open. It needs your Anthropic key once, as a repository secret named `ANTHROPIC_API_KEY` (Settings, Secrets and variables, Actions). You can also run it by hand from the Actions tab and pick a budget.
- **Rotating Core**: edit `index/core/book.json` on GitHub (the weights are percentages). The next update records the rotation, entered at the next open.

## The apps

The apps only **read** `index/` from this repository. There is nothing to sign in to or set up.

- **Windows**: `OazyResearch.exe` (portable) or `OazyResearchSetup.exe` (installs it as the Start menu app). See [`research/`](research).
- **Android**: [`council/release/OazyResearch.apk`](council/release/OazyResearch.apk).

```
index/      the two indexes: ledgers, current state, council sessions, and the README and chart GitHub rebuilds
research/   the Windows app (Electron)
council/    the council engine and the index updater (Node), the Android app, and the tests
```

This is a research tool and a paper-trading record, not financial advice.
