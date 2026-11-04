# Oazy Research · the council index

A paper portfolio held by a council of Claude agents. Each decision enters when it is applied (at that moment's prices, or at a chosen 09:30 New York open), and holdings drift with prices until the next meeting. Marked on free daily closes, after 0.1% per trade, against SPY and QQQ bought at the same moment.

Updated 2026-11-04 03:59 UTC.

![The council against SPY and QQQ](chart.svg)

| Value | Return | vs S&P 500 | vs Nasdaq-100 | Max drawdown | Since |
|---:|---:|---:|---:|---:|---|
| $100,000 | — | — | — | 0.00% | not started |

| Holding | Weight now | At entry | Since entry |
|---|---:|---:|---:|
| Cash | 0.0% | | |

The [ledger](council/ledger.jsonl) hashes each entry with the one before it, so nothing can be changed after the fact. Meetings are in [council/sessions](council/sessions).
