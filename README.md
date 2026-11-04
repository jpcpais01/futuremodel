# Oazy Research

A council of Claude agents that holds what it judges the best portfolio it can, kept as a **paper portfolio** in this repository and judged against the S&P 500 (SPY) and the Nasdaq-100 (QQQ). Nothing here trades or touches a broker account.

**See how it is doing: [`index/`](index)** (a table and a chart, rebuilt by GitHub).

## The council

Eight seats with their own mandates (macro, growth, value, momentum, contrarian, tech and AI, defensives, catalysts) each propose a portfolio from 155 stocks and funds. They debate over as many rounds as you choose, in different formats: open floor, cross-examination, devil's advocate, duels, pre-mortem, steelman and closing arguments. Then Vex (red team) attacks the plan, every seat answers, Sentinel (risk manager) sets binding limits, and Arbiter (the chair) decides.

Every level (Low, Normal, High) runs exactly the same meeting. The level only picks the models and how hard they think. The app shows the expected cost before you start.

- **Meetings happen only when you start one**, in the app. Nothing meets on a schedule.
- When the chair has decided, you choose: **apply now** (at that moment's prices), **at the next open**, **on a date**, or keep it as a record only.
- After a decision enters, the weights drift with prices until the next meeting.
- Every decision goes into [`index/council/ledger.jsonl`](index/council/ledger.jsonl), each entry hashed with the one before it, so nothing can be changed after the fact. Every meeting is kept whole in `index/council/sessions/`, so the app can replay it.

## The app

One app, **Oazy Research**, for Windows and Android. Viewing needs nothing: it reads this public repository.

- **Your Anthropic key** is pasted when you convene the council. It is used for that meeting only and never saved anywhere.
- **A GitHub token** is only needed to save meetings: a fine-grained token for this repository with Contents set to Read and write. The app keeps it on the device, locked by the system.
- **Rehearse for free** plays a whole meeting with stand-in answers: no AI, no cost, nothing saved.

Windows: `OazyResearch.exe` (portable) or `OazyResearchSetup.exe` (installs the Start menu app). Android: [`release/OazyResearch.apk`](release/OazyResearch.apk).

## How it runs

- **Update the council portfolio** ([`.github/workflows/index.yml`](.github/workflows/index.yml)): every hour while the US market is open and after the close, GitHub fetches free prices, values the portfolio and commits the result to `index/`. It never holds a meeting.

```
app/        the app's screens and the council show (shared by Windows and Android)
engine/     the council: data, prompts, the meeting, rules, ledger and index (Node and the app)
desktop/    the Windows shell (Electron)
android/    the Android shell, built with the plain SDK tools (android/build.sh)
index/      the portfolio: ledger, current state, meetings, and the README and chart GitHub rebuilds
test/       npm test
```

Build: `npm run bundle` (engine into the app), `npm run exe` (Windows), `npm run apk` (Android).

This is a research tool and a paper-trading record, not financial advice.
