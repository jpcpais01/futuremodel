# Oazy Research

One app that holds several portfolios, each judged against the S&P 500 and the Nasdaq-100.

| Portfolio | What it is | Where it trades |
|---|---|---|
| **Core v1.0** | A hand-built book of AI, regime and hedge positions with fixed rotation rules | Live, on Hyperliquid (read only: the app never trades) |
| **Council** | A council of Claude agents that reads 155 names every week, debates, and holds what it judges the best portfolio | A paper index in a hash-chained ledger, entered at the open of each decision's trading day |

Switch between them with the portfolio button next to the Oazy logo.

```
research/   Oazy Research for Windows (Electron): both portfolios, one window
council/    the council engine (shared), the Android app, the command line and the tests
```

- Run or build the desktop app: [`research/README.md`](research/README.md)
- How the council works, the phone app and account sync: [`council/README.md`](council/README.md)

This is a research tool and a paper-trading record, not financial advice.
