# futuremodel

A day-trading model for **QQQ** that makes one decision per trading day: at **10:30 New York time**
it says **LONG, SHORT or FLAT**, how big, how confident, and why. The position is held until the
**close** (market-on-close exit). Everything runs on **free data**.

```
========================================================================
 QQQ 10:30 SIGNAL  2026-11-03   (model: gated, trained through 2026-11-02)
========================================================================
 DECISION   LONG   size 0.42x   ->  enter now, exit market-on-close
 confidence P(QQQ closes above 10:30 price) = 55.8%
 expected   +9.4 bps to the close (cost 2 bps), signal +0.81 sd
 morning    QQQ 512.40: +0.61% since close (gap +0.25%, first hour +0.36%), VIX 15.9

 WHY (contribution to expected move, bps)
   first_hour         +6.10  ++++++++++++
   flows_calendar     +2.30  ++++
   vol_options        -1.20  --
 top inputs
   megacap breadth (first hour)                  +2.90   [first_hour]
   leveraged-ETF close rebalancing estimate      +1.80   [flows_calendar]
   ...
 regime gate  first_hour 24%  generalist 19%  vol_options 14% ...

 LIVE CONTEXT (not in the model yet: no free history to validate it)
   dealer gamma ~ $+1.9bn per 1% (positive gamma (dampening, mean-reverting)); flip 505.0
   news (63 headlines before 10:30, finbert): tone +0.08, 31% negative

 track record: holdout Sharpe ... (90% CI ...); status: PAPER TRADE ...
========================================================================
```
_(illustrative layout; real numbers come from your own `fm train` run)_

---

## Quick start

```bash
pip install -e ".[news,dev]"        # Python 3.10+
fm update                           # download every free source into ./data (5-10 min the first time)
fm train                            # walk-forward backtest -> reports/backtest.md, then fits models/latest.joblib
fm signal                           # run at/after 10:30 ET on a trading day
fm reconcile                        # after the close: fills in what actually happened, keeps a live record
```

No network yet? `fm demo` runs the entire pipeline (data -> features -> walk-forward -> report ->
final model) on synthetic prices, to prove everything works. Its numbers mean nothing.

### Daily routine (cron, New York time)

```cron
# refresh history every evening (keeps intraday history growing past Yahoo's 730-day window)
30 18 * * 1-5  cd ~/futuremodel && fm update >> logs/update.log 2>&1
# the decision
31 10 * * 1-5  cd ~/futuremodel && fm signal >> logs/signal.log 2>&1
# outcomes
15 16 * * 1-5  cd ~/futuremodel && fm reconcile >> logs/reconcile.log 2>&1
# retrain monthly
0 19 1 * *     cd ~/futuremodel && fm train >> logs/train.log 2>&1
```

`fm signal --json` prints machine-readable output; every signal is also saved to `signals/`.

---

## How the model works

```
                 10:30 ET feature row (90 features, nothing timestamped after 10:30)
                                              |
   +-------------+-------------+--------------+------------+-------------+-----------+------------+
   | first_hour  | vol_options | flows_calendar| context    | cross_asset | sentiment | generalist |
   | specialist  | specialist  | specialist    | specialist | specialist  | specialist| (all feats)|
   +------+------+------+------+-------+-------+-----+------+------+------+-----+-----+-----+------+
          \             \              |             |             |           /           /
           \______________\____________|_____________|_____________|__________/___________/
                                       v
           REGIME GATE   w = softmax(a + B . [VIX pct, realised-vol pct, trend, size of morning move])
                         forecast = s * sum_k w_k * expert_k + b        (fit only on out-of-fold forecasts)
                                       v
             (optional) QQQ residual specialist, used only if it wins in development
                                       v
       calibration -> P(up), expected bps, signal z  ->  decision: trade only if expected move > cost,
                                                         size 0..1x between 0.3 and 1.5 signal sd
```

**Multi-ticker pretraining.** Every expert is trained on the same 10:30 -> close problem across
38 liquid instruments (index and sector ETFs plus the largest Nasdaq stocks). Targets are in units
of each instrument's own daily volatility, so a 1% move in TSLA and a 1% move in XLP are not
treated the same. This gives the own-instrument patterns (first-hour shape, gap behaviour, volume,
trend) roughly 40 times more examples than QQQ alone. QQQ rows are up-weighted 4x and evaluation
is on QQQ only. The report also shows whether the signal holds up across the other tickers: an
effect that only exists in QQQ is treated as a red flag.

**Why specialists plus a gate?** Different information matters in different regimes. In a calm
uptrend the first hour tends to dominate; in a stressed market, volatility structure and credit
matter more. Separate small models per signal family keep each one simple and interpretable, and
the gate learns, from out-of-sample evidence only, how much to trust each family as the regime
changes. The gate is shrunk hard towards equal weights, because a few hundred days cannot support
a flexible combiner.

**Explanations.** Every forecast is decomposed exactly (TreeSHAP inside each expert, multiplied by
its gate weight) into per-feature and per-family contributions in basis points. That is the "WHY"
block of the signal.

### Feature families

| family | what it measures | free source |
|---|---|---|
| **first_hour** | gap, open -> 10:30 return, prev close -> 10:30, first-hour range, close location, relative volume, VWAP proxy, gap fill; QQQ/SPY/IWM/SMH mornings; megacap breadth, cap-weighted pulse of the top 10 holdings, megacap vs QQQ divergence, dispersion | Yahoo 60-min bars (history), 1-min bars (live) |
| **vol_options** | VIX level and 1-year percentile, VIX move since the close, VIX9D/VIX and VIX/VIX3M term structure, VVIX, CBOE SKEW, implied minus realised vol | Yahoo + CBOE CSVs |
| **flows_calendar** | leveraged-ETF rebalancing estimate (sum of L(L-1) x dollar volume of TQQQ/SQQQ/QLD/QID relative to QQQ, times the morning move), vol-targeting pressure, CTA-style trend score and whether today's move flips the 20-day trend; OPEX, quad witching, month-end, FOMC days, pre-holiday | Yahoo, rule-based calendar |
| **context** | 1/5/20/60/120/250-day trend (vol-scaled), distance to 50/200-day averages, drawdown, realised-vol ratio and percentile, yesterday's close location, recent afternoon and gap behaviour | Yahoo daily |
| **cross_asset** | prev close -> 10:30 moves in long bonds, 7-10y, dollar, high yield, IG credit, gold, oil, bitcoin, 10y yield (bps); high-yield and IG spreads, 2s10s, 3m10y, broad dollar, Chicago Fed NFCI (with publication lags) | Yahoo, FRED |
| **sentiment** | CNN Fear & Greed, AAII bull-bear spread, GDELT news tone and volume (all strictly before today) | CNN, AAII, GDELT |

**Live-only context (shown, archived, not traded yet):**
* **Dealer gamma (GEX)** from Yahoo's free QQQ option chain: total gamma per 1% move, gamma-flip
  level, call/put walls, 0DTE share. Real GEX history is paid data, so this cannot be backtested
  today. Each run saves the full chain to `data/options/`.
* **News / LLM sentiment** on headlines published before 10:30 (Yahoo Finance, CNBC, MarketWatch,
  Google News, Nasdaq RSS, Reddit). Saved to `data/news/`.

Once ~250 archived days exist, these can be added as a feature family and validated the same way
as everything else (add the columns in `features/build.py` and the family in `config.py`).

---

## Validation (and how to read the report)

`fm train` (or `fm backtest`) writes `reports/backtest.md`, `equity.png`, `gate_weights.png`,
`backtest_results.json` and `daily_record.csv`.

* **Strict walk-forward.** Expanding window, refit every 21 trading days, one-day embargo. The gate
  and calibration at each refit are fit only on out-of-fold forecasts from earlier refits. No number
  in the report is in-sample.
* **Development vs holdout.** The last 20% of days is a holdout. Choosing between variants (gated,
  equal-weight, generalist only, gated + QQQ specialist, ridge regression) uses the development
  period only, with a rule fixed in advance: highest development Sharpe, and a more complex variant
  must beat a simpler one by more than 0.25. The holdout is reported once.
* **Baselines on the same days and costs:** always long, always short, morning momentum, morning
  reversal, first-hour momentum, gap fade, previous-day intraday momentum, 20-day trend, plus a ridge
  regression on all features (is the boosting worth it?).
* **Uncertainty everywhere:** block-bootstrap 90% intervals on Sharpe, t-stats, cost sensitivity
  (0-10 bps), results by VIX regime, trend and size of the morning move, IC on QQQ and pooled across
  tickers, calibration of P(up), and an optional label-permutation test (`fm train --permutations 20`).
* **Costs:** 2 bps round trip by default (QQQ's spread is ~0.3 bps; the rest covers 10:30 slippage
  and MOC). Change with `--cost-bps`.
* **Leakage tests** (`pytest`): perturbing any data after 10:30 on day D, or any later day, must leave
  D's features bit-for-bit unchanged; the live 1-minute path must reproduce the historical 60-minute
  feature row exactly; on pure-noise data the out-of-sample forecasts must be uninformative.

The model prints a **status** with every signal, taken from the holdout result:
`edge supported on holdout`, `PAPER TRADE: positive but not significant`, or `DO NOT TRADE`.

### Honest expectations

* One decision per day is a small sample. With ~350 out-of-sample days a Sharpe ratio has a standard
  error of about 0.8. On pure-noise synthetic data this exact pipeline produced out-of-sample Sharpes
  between roughly -2 and +1.5 just by chance. Do not read much into a single good backtest.
* Yahoo's free 60-minute history covers about **730 days** (~500 trading days). To go further back:
  * `fm backfill-av --key YOUR_FREE_KEY --tickers QQQ SPY` pulls 30-minute bars from Alpha Vantage's free
    tier, one month per call, 25 calls/day, resumable (put it in cron; QQQ back to 2005 takes ~3 weeks).
    Free-tier terms change; the command stops cleanly if the endpoint is no longer free.
  * `fm update` never deletes old data, so running it daily grows the history by itself.
* Intraday edges decay and crowd. Retrain monthly, watch `fm reconcile`, and treat the first months
  of live use as paper trading.

---

## Using the H200

The core model (LightGBM + a tiny gate) trains in minutes on a CPU and needs no GPU. The GPU is for
the news layer:

```bash
pip install -e ".[llm]"
export FM_LLM_MODEL=Qwen/Qwen2.5-32B-Instruct   # any HF instruct model; 72B fits an H200 in bf16
fm signal                                       # headlines before 10:30 scored for today's QQQ impact + event tags
```

Without `FM_LLM_MODEL` it uses FinBERT on CPU if `transformers` is installed, else a built-in finance
lexicon. Force one with `FM_NEWS_BACKEND=lexicon|finbert|llm`.

---

## Free data sources

| source | used for | limit |
|---|---|---|
| Yahoo Finance (`yfinance`) | daily history (decades), 60-min bars, live 1-min bars, option chains | 60-min: ~730 days; 5-min: 60 days (archived); 1-min: ~7 days; unofficial API, can rate-limit |
| CBOE CSVs | VIX, VIX9D, VIX3M, VVIX, SKEW full history (fills Yahoo gaps) | none |
| FRED | credit spreads, curve, yields, dollar, NFCI | daily/weekly, publication lags applied |
| CNN Fear & Greed | sentiment | ~2020 onwards |
| AAII survey | investor sentiment (weekly) | the site sometimes blocks scripts; optional |
| GDELT DOC API | news tone and volume | ~3 months back; archived daily so it grows |
| RSS feeds, Reddit | live headlines | live only, archived |
| Alpha Vantage (optional, free key) | deep intraday backfill | 25 calls/day |

Every source is optional except Yahoo. If one fails, its features become missing values, the
specialist for that family learns less, and the signal prints a coverage warning.

---

## Repository layout

```
futuremodel/
  config.py              universe, feature families, model / decision / backtest settings
  calendar.py            NYSE holidays, half days, OPEX, quad witching, FOMC dates
  data/                  yahoo, macro (FRED/CBOE), sentiment_sources, news, options (GEX), alphavantage, store
  features/intraday.py   first-hour aggregation and "price as of" lookups with the 10:30 cutoff
  features/build.py      the (date, ticker) feature panel and labels
  model/ensemble.py      specialists, regime gate, calibrator, decision rule, ridge, QQQ residual specialist
  model/bundle.py        final model: fit, explain, save/load
  backtest/              walk-forward engine, baselines, metrics, report
  live/signal.py         `fm signal`, output formatting, signal log, reconcile
  sentiment/llm.py       headline scoring (LLM on GPU / FinBERT / lexicon)
  pipeline.py, cli.py    jobs and the `fm` command
tests/                   leakage, live/historical consistency, end-to-end, calendar, parsers (synthetic data, no network)
```

Settings worth knowing (all in `config.py`): `TARGET_WEIGHT`/`target_weight` (QQQ up-weighting),
`DecisionConfig` (cost, dead zone, full-size threshold, max size), `BacktestConfig` (refit
frequency, holdout fraction), `TRAIN_UNIVERSE`, and the FOMC date list (extend it each year).

**Note:** FOMC dates are listed through 2026. Add the 2027 schedule to `calendar.py` when the Fed
publishes it; until then those flags are left missing rather than silently set to zero.

This is research software, not investment advice.
