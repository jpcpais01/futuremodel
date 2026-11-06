# Glass walls test (Nov 2026)

**Idea (João):** price levels act like panes of glass. Random walks fired from
the current price bounce off or pass through them depending on the wall's
strength, the incoming slope and how densely walls are packed. If more "light"
ends above the start than below, that is the preferred direction.

**Verdict: no edge.** The walls did not predict the next 60 minutes, and
nothing survives fees.

## What was tested
- Data: 2 years of free 5 min candles for BTC, ETH and SOL (Binance public
  data, Nov 2024 to Nov 2026, 210k candles each). Year 1 to tune, year 2 to test.
- Walls at each moment, from the last 24h: swing highs/lows (strength from
  touches), round numbers, daily and 24h VWAP, prior day high/low and today's
  open, high volume nodes. Close walls merge into thicker glass.
- 1,000 random walks per moment, scaled to current volatility, 12 steps (60 min).
  At a wall a walk passes with probability `exp(-beta * strength / energy)`,
  where energy is its slope relative to normal (weekly) volatility, so slow
  drifts bounce more. Otherwise it reflects and loses half its momentum.
  Optional density factor makes packed walls stronger.
- Baseline: the same walks with no walls (always 50/50).
- Out of sample: 26,280 non-overlapping hours in year 2.

## Results (year 2, all coins)
| | Result |
|---|---|
| Best setting on year 1 | the weakest walls tested; every stronger setting was worse than no walls |
| Forecast skill vs no walls | -0.35% (worse) |
| Direction hit rate | 49.0% |
| Biggest 20% of tilts | 48.5% hit, -0.6 bps per trade before costs |
| After costs (4 / 10 bps round trip) | -4.6 / -10.6 bps per trade |
| Beyond plain momentum? | no (t = -0.2 once last hour's move is included) |

Calibration: when the model said 53 to 56% up, it actually went up 48 to 53%.
The small lean it has comes from the incoming slope, not the walls.

## Model-free check: do walls actually reflect?
When price touched a wall, was it back on the original side 30 minutes later?
Compared with fake walls placed at the same distance on the other side:

| | Real walls | Fake walls |
|---|---|---|
| BTC | 50.9% | 51.6% |
| ETH | 52.3% | 53.0% |
| SOL | 52.1% | 53.0% |
| Strongest walls only | 50.4 to 51.8% | 51.7 to 53.3% |

Real walls reflect slightly *less* than random levels, and strong ones less
still. Levels people watch get pushed through a little more often (stop runs),
the opposite of glass. The gap (about 1 point) is far too small to pay fees.

## Run it
```
mkdir data && python3 fetch.py BTCUSDT data   # also ETHUSDT, SOLUSDT
python3 backtest.py data && python3 analyze.py data && python3 wallcheck.py data
```
Needs numpy and pandas. Free data, no keys. About 10 minutes on 4 cores.
