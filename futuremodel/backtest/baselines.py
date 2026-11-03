"""Simple rules every model must beat, on exactly the same days and with the same costs."""
from __future__ import annotations

import numpy as np
import pandas as pd


def baseline_positions(q: pd.DataFrame) -> dict[str, pd.Series]:
    """q: target-ticker rows of the feature panel (index = date)."""
    s = lambda c: np.sign(q[c]).fillna(0)
    return {
        "always_long": pd.Series(1.0, index=q.index),
        "always_short": pd.Series(-1.0, index=q.index),
        "morning_momentum": s("since_close_z"),            # follow prev close -> 10:30
        "morning_reversal": -s("since_close_z"),
        "first_hour_momentum": s("fh_ret_z"),               # follow open -> 10:30
        "gap_fade": -s("gap_z"),
        "prev_day_intraday_momentum": s("prev_label_z"),
        "trend_20d": s("r20_z"),
    }
