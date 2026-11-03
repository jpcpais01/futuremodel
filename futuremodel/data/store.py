"""A tiny parquet store. Every downloader merges into it, so history accumulates across runs.

This matters because Yahoo only serves ~730 days of 60-minute bars: running `fm update` regularly
keeps every day you have ever downloaded, so the training set keeps growing past that window.
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from .. import config


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", name)


class Store:
    def __init__(self, root: Path | str | None = None):
        self.root = Path(root) if root else config.DATA_DIR

    def path(self, kind: str, name: str) -> Path:
        return self.root / kind / f"{_safe(name)}.parquet"

    def exists(self, kind: str, name: str) -> bool:
        return self.path(kind, name).exists()

    def read(self, kind: str, name: str) -> pd.DataFrame | None:
        p = self.path(kind, name)
        if not p.exists():
            return None
        return pd.read_parquet(p)

    def write(self, kind: str, name: str, df: pd.DataFrame) -> None:
        p = self.path(kind, name)
        p.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(p)

    def merge(self, kind: str, name: str, df: pd.DataFrame) -> pd.DataFrame:
        """Union with what is stored; new rows win on duplicate index values."""
        if df is None or df.empty:
            old = self.read(kind, name)
            return old if old is not None else pd.DataFrame()
        old = self.read(kind, name)
        if old is not None and not old.empty:
            df = pd.concat([old, df])
            df = df[~df.index.duplicated(keep="last")]
        df = df.sort_index()
        self.write(kind, name, df)
        return df

    def names(self, kind: str) -> list[str]:
        d = self.root / kind
        return sorted(p.stem for p in d.glob("*.parquet")) if d.exists() else []
