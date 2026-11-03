# Reports

`fm train` (or `fm backtest`) writes the walk-forward report here: `backtest.md`, `equity.png`,
`gate_weights.png`, `backtest_results.json`, `daily_record.csv`.

## First real-data run (2026-11-03)

Data: free Yahoo hourly bars for 38 pooled tickers, 2023-12-05 -> 2026-11-02 (722 days; Yahoo only
serves ~730 days of hourly history), daily history back to 1999, CBOE vol indices, 7 FRED series,
AAII. CNN Fear & Greed and Reddit refuse automated clients and GDELT only covers ~3 months, so the
sentiment family is thin (30% coverage).

**Verdict: no tradable edge. Do not trade this model.**

| QQQ, net of 2 bps | days | Sharpe | 90% CI | bps/day | hit % |
|---|---|---|---|---|---|
| chosen variant (`generalist_only`), development | 364 | +1.06 | [-0.06, +2.52] | +3.6 | 60.3 |
| chosen variant, **holdout** (2026-04-08 -> 2026-11-02) | 145 | **-3.01** | **[-4.33, -1.47]** | -6.5 | 36.2 |
| always long 10:30 -> close, holdout | 145 | -0.04 | [-2.12, +2.54] | -0.2 | 53.1 |
| best simple baseline on holdout (morning momentum) | 145 | +1.36 | [-0.15, +3.27] | +6.2 | 52.4 |

Why: the model's skill came from a **gap-fade / morning-reversal pattern** that held from late 2024
to early 2026 (out-of-sample IC +0.14 to +0.30 per quarter) and then **reversed** from 2026Q2
(IC -0.12, -0.17, -0.35). The same flip is visible in the raw data and in the `gap_fade` baseline
(dev Sharpe +1.60, holdout -3.81). Much of the development P&L also came from the April 2025
tariff-shock days. With under three years of intraday history the model has seen only one or two
intraday regimes, so it cannot know which one it is in.

The most useful next step is more history: `fm backfill-av` (free Alpha Vantage key) extends the
intraday data back to 2005, so the model can be trained and tested across many regimes.

Changes made after the first run (so this holdout is no longer untouched; the verdict did not
change: first-run holdout Sharpe was -3.06, CI [-4.43, -1.50]):
* the "expected bps" is now calibrated on past out-of-fold forecasts (it was the raw tree output),
* live signals use Yahoo's 60-minute bars when available, so live features match training exactly,
* FRED downloads fixed (its firewall stalls custom User-Agent strings), report wording fixed.
