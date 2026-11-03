# Reports

`fm train` (or `fm backtest`) writes the walk-forward report here: `backtest.md`, `equity.png`,
`gate_weights.png`, `backtest_results.json`, `daily_record.csv`.

No real-data report is committed yet: the environment this code was written in could not reach
any market-data host. Run `fm update && fm train` on a machine with internet access.
`fm demo` writes a synthetic-data report to `reports/_synthetic/` (git-ignored) to show the format.
