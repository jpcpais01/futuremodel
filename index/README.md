# Oazy Research · the indexes

Two paper portfolios, each entered at the 09:30 New York open of its decision day and marked on free daily closes, after 0.1% per trade. Compared with SPY and QQQ bought at the same open.

Updated 2026-11-04 00:13 UTC.

![Both indexes against SPY and QQQ](chart.svg)

| Portfolio | Value | Return | vs S&P 500 | vs Nasdaq-100 | Max drawdown | Since |
|---|---:|---:|---:|---:|---:|---|
| **Core v1.0** | $100,400 | +0.40% | +0.19% | +0.27% | 0.00% | 2026-11-03 |
| **Council** | $99,707 | -0.29% | -0.51% | -0.42% | -0.21% | 2026-11-03 |

## Core v1.0

A hand-built book of AI, regime and hedge positions with fixed rotation rules.

| Holding | Weight now | Since entry |
|---|---:|---:|
| MSFT Microsoft | 8.2% | +2.35% |
| LLY Eli Lilly | 8.0% | +0.70% |
| NVDA Nvidia | 7.9% | -0.61% |
| SPCX SpaceX | 7.2% | +2.68% |
| SMH VanEck Semiconductor ETF | 6.9% | -0.41% |
| CVX Chevron | 6.0% | +0.25% |
| XLE Energy Select Sector SPDR | 6.0% | +0.08% |
| TSM TSMC | 6.0% | -0.05% |
| AAPL Apple | 5.1% | +1.94% |
| SNDK Sandisk | 5.1% | +1.71% |
| EBAY eBay | 5.0% | -0.47% |
| MU Micron | 5.0% | -0.56% |
| XBI SPDR S&P Biotech | 4.0% | +1.31% |
| CPER Copper (US Copper Index Fund) | 4.0% | -0.36% |
| COST Costco | 3.9% | -1.16% |
| SOFI SoFi Technologies | 3.0% | +0.18% |
| ICE Intercontinental Exchange | 3.0% | -0.14% |
| Cash | 5.9% | |

## Council

A council of Claude agents that reads 155 names every week and holds what it judges the best portfolio.

> A barbell of cheap, accelerating, cash-generative tech (MSFT, GOOGL, ADBE, INTU, NVDA) and low-drawdown defensives (JNJ, ABBV, XLV, BRK-B, TMUS, JPM), with oil and duration hedges. Health care is capped at 18% and the AI-capex cluster at 21%. Cash is 21% to absorb midterm, semi read-through and Nov 17 event risk.

| Holding | Weight now | Since entry |
|---|---:|---:|
| MSFT Microsoft | 8.2% | +2.35% |
| JNJ Johnson & Johnson | 8.0% | -0.87% |
| BRK-B Berkshire Hathaway | 6.0% | +0.51% |
| JPM JPMorgan Chase | 6.0% | -0.59% |
| TMUS T-Mobile US | 5.8% | -3.25% |
| XLV Health Care Select ETF | 5.0% | +0.19% |
| XLE Energy Select ETF | 5.0% | +0.08% |
| GOOGL Alphabet | 5.0% | -0.07% |
| IEF 7-10 Year Treasury ETF | 5.0% | -0.23% |
| ABBV AbbVie | 5.0% | -0.93% |
| ADBE Adobe | 5.0% | -1.07% |
| AMZN Amazon | 4.0% | +0.84% |
| NVDA Nvidia | 4.0% | -0.61% |
| INTU Intuit | 4.0% | -1.64% |
| TXN Texas Instruments | 3.0% | +0.86% |
| Cash | 21.0% | |

Ledgers: [core](core/ledger.jsonl) · [council](council/ledger.jsonl). Each entry is hashed with the one before it, so nothing can be changed after the fact.
