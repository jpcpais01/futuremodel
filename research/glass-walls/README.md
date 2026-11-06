# Glass walls test (Nov 2026)

**Idea (João):** price levels act like panes of glass. Random walks fired from
the current price bounce off or pass through them depending on the wall's
strength, the incoming slope and how densely walls are packed. If more "light"
ends above the start than below, that is the preferred direction.

**Verdict: no edge, in both versions.** See v2 below for the fixed walls.

## v1 (first attempt, glass.py)

### What was tested
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

### Results (year 2, all coins)
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

### Model-free check: do walls actually reflect?
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

## v2 (fixed walls, glass2.py)

João asked whether the walls were built right. Four real flaws in v1:
1. "Touches" counted every bar sitting near a level, so in quiet hours almost
   every wall maxed out at full strength. Walls were everywhere and all equal.
2. Only 1 day of history, so multi-day levels were missing.
3. The bounce rule was guessed, not learned from data.
4. Walls could only reflect. They could not do the opposite.

What v2 does:
- Walls from 3 days of history plus last week's high, low and VWAP.
- Strength comes from real rejections (separate swing turns at the level),
  volume traded there, how recently price visited, and how crowded it is.
- Refraction is learned from 326,677 wall hits in year 1: compared with a fake
  level at the same distance, how much more or less often did price bounce,
  given the wall, the approach speed and how quiet the market was?
- Walks then reflect or get pulled through using those learned factors.
- A second, direct version: learn up/down straight from the wall layout
  (glass above vs below, nearest wall each side, wall count each side).

### Do walls behave like glass? (extra bounce vs fake levels, year 1 / year 2)
| Wall | Year 1 | Year 2 |
|---|---|---|
| All walls | -0.4 pts | -0.7 pts |
| Strong swing levels | -0.7 | -0.9 |
| Prior day/week high-low | -1.5 | -2.1 |
| VWAP | -0.9 | -2.1 |
| Slow approach | -0.1 | -0.2 |
| Fast approach | -0.6 | -0.8 |
| Strong wall + slow + quiet market | +0.2 | 0.0 |

The physics direction is right (slow, quiet approaches bounce more than fast
ones), but no group bounces more than a random level. Real walls are slightly
leaky: price breaks through watched levels a bit more often.

### Results (year 2, 26,277 hours)
| | Hit rate | Big calls: hit / per trade before costs | After 4 / 10 bps |
|---|---|---|---|
| v2 simulator | 49.0% | 48.4% / -1.1 bps | -5.1 / -11.1 |
| v2 direct, walls + momentum | 51.7% | 52.5% / -1.8 bps | -5.8 / -11.8 |
| v2 direct, walls only | 51.6% | 52.7% / -0.8 bps | -4.8 / -10.8 |

The direct version is right a little more often than a coin flip, on all three
coins. But its wins are small and its losses bigger, so it still loses money
before fees. Note: year 2 was already looked at in v1, so it is not fully fresh.

Run v2: `python3 backtest2.py data && python3 analyze2.py data` (about 5 min).

## Run v1
```
mkdir data && python3 fetch.py BTCUSDT data   # also ETHUSDT, SOLUSDT
python3 backtest.py data && python3 analyze.py data && python3 wallcheck.py data
```
Needs numpy and pandas. Free data, no keys. About 10 minutes on 4 cores.
