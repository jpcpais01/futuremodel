"""Central configuration: universe, data sources, feature families, model and backtest settings.

Everything that a person might reasonably want to tweak lives here, so that the rest of the
code base never hard-codes a ticker list or a magic number.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("FM_DATA_DIR", ROOT / "data"))
MODEL_DIR = Path(os.environ.get("FM_MODEL_DIR", ROOT / "models"))
SIGNAL_DIR = Path(os.environ.get("FM_SIGNAL_DIR", ROOT / "signals"))
REPORT_DIR = Path(os.environ.get("FM_REPORT_DIR", ROOT / "reports"))

TZ = "America/New_York"
TARGET = "QQQ"

# Decision time. Features may only use information time-stamped at or before this.
DECISION_HOUR, DECISION_MINUTE = 10, 30

# ---------------------------------------------------------------------------------------------
# Universe
# ---------------------------------------------------------------------------------------------
# Tickers whose 10:30 -> close move we *learn from*. Pooling many liquid names with the exact same
# setup gives the own-ticker features (first-hour shape, gap, trend, volume) ~40x more samples than
# QQQ alone. QQQ itself is up-weighted and the final model is evaluated on QQQ only.
INDEX_ETFS = ["QQQ", "SPY", "IWM", "DIA", "SMH", "XLK", "XLF", "XLE", "XLV", "XLY", "XLP",
              "XLI", "XLU", "XLB", "XLC", "ARKK", "KRE", "XBI"]
MEGACAPS = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "COST", "NFLX",
            "AMD", "ADBE", "PEP", "CSCO", "QCOM", "TXN", "AMAT", "INTU", "MU", "ISRG"]
TRAIN_UNIVERSE = INDEX_ETFS + MEGACAPS

# Top QQQ holdings and rough weights, used for the breadth/divergence block. Weights drift; they are
# only used to build a cap-weighted "megacap pulse", so approximate values are fine.
TOP_HOLDINGS = {"NVDA": 0.090, "MSFT": 0.085, "AAPL": 0.080, "AMZN": 0.055, "AVGO": 0.050,
                "META": 0.035, "GOOGL": 0.050, "TSLA": 0.030, "COST": 0.025, "NFLX": 0.025}

# Market-context instruments (features only, never labels).
VOL_INDICES = ["^VIX", "^VIX9D", "^VIX3M", "^VVIX", "^SKEW"]
CROSS_ASSET = ["TLT", "IEF", "UUP", "HYG", "LQD", "GLD", "USO", "BTC-USD", "^TNX"]
# Leveraged ETFs whose end-of-day rebalancing is mechanical. Value = leverage.
LEVERAGED = {"QQQ": {"TQQQ": 3, "SQQQ": -3, "QLD": 2, "QID": -2},
             "SPY": {"SPXL": 3, "UPRO": 3, "SPXU": -3, "SSO": 2, "SDS": -2},
             "SMH": {"SOXL": 3, "SOXS": -3},
             "IWM": {"TNA": 3, "TZA": -3}}
LEVERAGED_TICKERS = sorted({t for d in LEVERAGED.values() for t in d})

DAILY_TICKERS = sorted(set(TRAIN_UNIVERSE + VOL_INDICES + CROSS_ASSET + LEVERAGED_TICKERS))
INTRADAY_TICKERS = sorted(set(TRAIN_UNIVERSE + ["^VIX", "^VIX9D"] + CROSS_ASSET))

# FRED series and how many calendar days after the observation date the value is safely public.
FRED_SERIES = {
    "BAMLH0A0HYM2": 1,   # ICE BofA US High Yield OAS
    "BAMLC0A0CM": 1,     # ICE BofA US Corporate (IG) OAS
    "T10Y2Y": 1,         # 10y - 2y Treasury
    "T10Y3M": 1,         # 10y - 3m Treasury
    "DGS10": 1,          # 10y Treasury yield
    "DTWEXBGS": 3,       # broad trade-weighted dollar (published with a lag)
    "NFCI": 7,           # Chicago Fed financial conditions (weekly, released Wed for prior Fri)
}

# ---------------------------------------------------------------------------------------------
# Feature families -> each one gets its own specialist model
# ---------------------------------------------------------------------------------------------
FAMILIES: dict[str, list[str]] = {
    # 1) first-hour behaviour of the ticker itself and of QQQ / megacaps
    "first_hour": [
        "gap_z", "fh_ret_z", "since_close_z", "fh_range_z", "fh_clv", "fh_vwap_dev_z", "fh_rvol",
        "gap_filled", "fh_rel_mkt_z",
        "m_qqq_since_close_z", "m_qqq_fh_ret_z", "m_qqq_fh_clv", "m_qqq_fh_rvol", "m_spy_since_close_z",
        "m_iwm_minus_qqq_z", "m_smh_minus_qqq_z", "m_breadth_fh", "m_breadth_since_close",
        "m_mega_wavg_z", "m_mega_div_z", "m_mega_dispersion",
    ],
    # 2) volatility / options positioning (free proxies; real GEX history is paid -> live only)
    "vol_options": [
        "v_vix", "v_vix_pct", "v_vix_chg_1030", "v_vix_chg_1d", "v_vix9d_ratio", "v_vix3m_ratio",
        "v_vvix", "v_skew", "v_vrp", "own_rv_ratio",
    ],
    # 3) mechanical flows and calendar
    "flows_calendar": [
        "f_lev_flow_own", "f_lev_flow_qqq", "f_voltarget_qqq", "f_cta_score_qqq", "f_cta_flip_qqq",
        "c_dow", "c_tdays_to_month_end", "c_tdays_from_month_start", "c_is_opex", "c_tdays_to_opex",
        "c_is_quad", "c_is_fomc", "c_is_post_fomc", "c_is_pre_holiday",
    ],
    # 4) multi-scale price context and regime
    "context": [
        "r1_z", "r5_z", "r20_z", "r60_z", "r120_z", "r250_z", "sma50_dist_z", "sma200_dist_z",
        "dd252", "rv5_rv20", "rv20_pct", "prev_close_loc", "prev_label_z", "prev_fh_z",
        "label_mean5_z", "gap_mean5_z", "m_qqq_r20_z", "m_qqq_rv20_pct",
    ],
    # 5) cross-asset morning moves (prev close -> 10:30) plus slow macro (FRED, lagged)
    "cross_asset": [
        "x_tlt", "x_ief", "x_uup", "x_hyg", "x_lqd", "x_gld", "x_uso", "x_btc", "x_tnx_bps",
        "x_hyg_lqd", "x_tlt_1d", "x_hyg_1d",
        "macro_hy_oas", "macro_hy_oas_chg5", "macro_ig_oas_chg5", "macro_t10y2y", "macro_t10y3m",
        "macro_dgs10_chg5", "macro_usd_chg5", "macro_nfci",
    ],
    # 6) sentiment (historical, free): CNN fear & greed, AAII survey, GDELT news tone
    "sentiment": [
        "s_fg", "s_fg_chg5", "s_aaii_spread", "s_aaii_spread_z", "s_gdelt_tone", "s_gdelt_tone_z",
        "s_gdelt_vol_z",
    ],
}
ALL_FEATURES = sorted({f for fs in FAMILIES.values() for f in fs})

# Regime variables fed to the gate (all known at 10:30).
GATE_FEATURES = ["g_vix_pct", "g_rv_pct", "g_trend", "g_move_size"]


@dataclass
class ModelConfig:
    lgb_params: dict = field(default_factory=lambda: dict(
        objective="huber", alpha=1.5, learning_rate=0.03, num_leaves=15, min_data_in_leaf=150,
        feature_fraction=0.7, bagging_fraction=0.7, bagging_freq=1, lambda_l2=10.0,
        max_bin=63, verbose=-1, num_threads=0, seed=7, deterministic=True, force_row_wise=True))
    num_boost_round: int = 250
    target_clip: float = 4.0         # clip vol-normalised targets (fat tails) for training only
    target_weight: float = 4.0       # sample weight multiplier on QQQ rows
    half_life_days: float = 0.0      # optional time-decay of sample weights (0 = off)
    use_generalist: bool = True      # one extra expert on all features
    gate_l2: float = 3.0             # shrinkage of gate towards equal weights
    gate_min_dates: int = 60         # below this many OOF dates the gate stays at equal weights
    specialize: bool = False         # QQQ residual booster (chosen by dev-period results)


@dataclass
class DecisionConfig:
    cost_bps: float = 2.0            # round trip: 10:30 entry (spread+slippage) + MOC exit, for QQQ
    dead_zone_z: float = 0.30        # |signal| below this (in std units of the signal) -> flat
    full_size_z: float = 1.50        # |signal| at/above this -> full size
    max_size: float = 1.0            # 1.0 = 100% of capital long/short


@dataclass
class BacktestConfig:
    min_train_days: int = 150
    refit_every: int = 21
    holdout_frac: float = 0.20       # final fraction of dates never used for any choice
    embargo_days: int = 1
    n_permutations: int = 0          # >0 runs a label-permutation significance test
    n_bootstrap: int = 2000
