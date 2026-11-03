"""Command line: `fm <command>` (or `python -m futuremodel <command>`)."""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys

from . import config


def _store(args):
    from .data.store import Store
    return Store(args.data_dir) if getattr(args, "data_dir", None) else Store()


def cmd_update(args):
    from .data.update import update_all
    rep = update_all(_store(args), intraday=not args.daily_only, extras=not args.no_extras)
    for k, v in rep.items():
        print(f"{k:<14} {len(v):>3} series")


def cmd_backfill_av(args):
    from .data.alphavantage import backfill
    key = args.key or os.environ.get("ALPHAVANTAGE_API_KEY")
    if not key:
        sys.exit("Pass --key or set ALPHAVANTAGE_API_KEY (free at alphavantage.co).")
    print(backfill(_store(args), key, tickers=args.tickers, start=args.start, max_calls=args.max_calls))


def _cfgs(args):
    m, b, d = config.ModelConfig(), config.BacktestConfig(), config.DecisionConfig()
    if args.cost_bps is not None:
        d.cost_bps = args.cost_bps
    if getattr(args, "permutations", None):
        b.n_permutations = args.permutations
    if getattr(args, "fast", False):
        m.num_boost_round = 120
        b.n_bootstrap = 300
    return m, b, d


def cmd_backtest(args):
    from .pipeline import backtest
    m, b, d = _cfgs(args)
    out = backtest(_store(args), m, b, d)
    print(f"report: {out['report']}")
    _print_headline(out["res"])


def cmd_train(args):
    from .pipeline import train
    m, b, d = _cfgs(args)
    out = train(_store(args), m, b, d)
    print(f"report: {out['report']}\nmodel:  {out['model_path']}")
    _print_headline(out["res"])


def _print_headline(res):
    ch = res["chosen"]
    for p in ("dev", "holdout"):
        s = res["variants"][ch][p]
        if s:
            lo, hi = s["sharpe_ci90"]
            print(f"{ch:<12} {p:<8} Sharpe {s['sharpe']:+.2f} [{lo:+.2f},{hi:+.2f}]  {s['avg_bps_per_day']:+.2f} bps/day  "
                  f"hit {100 * s['hit_rate']:.1f}%  trades {s['trades']}/{s['days']}")


def cmd_signal(args):
    import pandas as pd
    from .live.signal import format_signal, run_signal
    now = pd.Timestamp(args.at, tz=config.TZ) if args.at else None
    out = run_signal(_store(args), now=now, refresh=not args.no_refresh, context=not args.no_context, force=args.force)
    print(json.dumps(out, indent=1, default=str) if args.json else format_signal(out))


def cmd_reconcile(args):
    from .live.signal import reconcile
    df = reconcile(_store(args))
    print(df.tail(20).to_string(index=False))
    done = df.dropna(subset=["net"])
    if len(done):
        print(f"\nlive record: {len(done)} days, {1e4 * done['net'].mean():+.1f} bps/day, "
              f"hit {(done.loc[done['position'] != 0, 'net'] > 0).mean() * 100:.0f}%")


def cmd_demo(args):
    """Full pipeline on synthetic data: proves the code runs end to end without network."""
    import tempfile
    from pathlib import Path
    sys.path.insert(0, str(config.ROOT))
    from tests.synthetic import make_store
    from .pipeline import train
    tmp = Path(tempfile.mkdtemp(prefix="fm_demo_"))
    store = make_store(tmp / "data", signal=args.signal)
    m, b, d = config.ModelConfig(num_boost_round=120), config.BacktestConfig(n_bootstrap=300), config.DecisionConfig()
    out = train(store, m, b, d, out_dir=config.ROOT / "reports" / "_synthetic", model_path=tmp / "model.joblib", synthetic=True)
    print(f"SYNTHETIC demo report: {out['report']}")
    _print_headline(out["res"])


def main(argv=None):
    p = argparse.ArgumentParser(prog="fm", description="QQQ 10:30 -> close model (free data only)")
    p.add_argument("--data-dir", help="override the data store directory")
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("update", help="download/refresh every free data source")
    s.add_argument("--daily-only", action="store_true")
    s.add_argument("--no-extras", action="store_true", help="skip FRED / CBOE / sentiment")
    s.set_defaults(fn=cmd_update)

    s = sub.add_parser("backfill-av", help="extend intraday history with Alpha Vantage (free key, resumable)")
    s.add_argument("--key")
    s.add_argument("--tickers", nargs="+", default=["QQQ"])
    s.add_argument("--start", default="2005-01")
    s.add_argument("--max-calls", type=int, default=25)
    s.set_defaults(fn=cmd_backfill_av)

    for name, fn, hlp in (("backtest", cmd_backtest, "walk-forward backtest + report"),
                          ("train", cmd_train, "backtest, then fit and save the final model")):
        s = sub.add_parser(name, help=hlp)
        s.add_argument("--cost-bps", type=float)
        s.add_argument("--permutations", type=int, default=0, help="label-permutation significance test runs")
        s.add_argument("--fast", action="store_true", help="fewer trees / bootstrap draws")
        s.set_defaults(fn=fn)

    s = sub.add_parser("signal", help="today's 10:30 decision")
    s.add_argument("--json", action="store_true")
    s.add_argument("--no-refresh", action="store_true", help="skip refreshing daily/FRED/sentiment first")
    s.add_argument("--no-context", action="store_true", help="skip GEX / news overlay")
    s.add_argument("--force", action="store_true", help="run before 10:30 (incomplete first hour)")
    s.add_argument("--at", help="pretend the current NY time is this (testing)")
    s.set_defaults(fn=cmd_signal)

    s = sub.add_parser("reconcile", help="fill realised outcomes for logged live signals")
    s.set_defaults(fn=cmd_reconcile)

    s = sub.add_parser("demo", help="run everything on synthetic data (no network)")
    s.add_argument("--signal", type=float, default=0.15, help="planted effect size")
    s.set_defaults(fn=cmd_demo)

    args = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO if args.verbose or args.cmd in ("backtest", "train", "demo", "update") else logging.WARNING,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
    args.fn(args)


if __name__ == "__main__":
    main()
