"""Headline scoring for the live news overlay.

Backends, picked automatically (override with FM_NEWS_BACKEND=lexicon|finbert|llm):
  * llm      - any open instruct model via Hugging Face transformers (set FM_LLM_MODEL, e.g.
               Qwen/Qwen2.5-32B-Instruct on an H200). Scores each headline's likely effect on US
               mega-cap tech *today* in [-1, 1] and tags the event type.
  * finbert  - ProsusAI/finbert, runs on CPU.
  * lexicon  - built-in finance word list, zero dependencies (the default fallback).

The score is shown live as context and archived; it is not part of the traded model until enough
archived days exist to validate it (see README, "Promoting live-only signals").
"""
from __future__ import annotations

import json
import logging
import os
import re

import numpy as np

log = logging.getLogger(__name__)

POS = {"beat", "beats", "surge", "surges", "soar", "soars", "rally", "rallies", "record", "upgrade", "upgrades",
       "jump", "jumps", "gain", "gains", "rise", "rises", "strong", "boost", "boosts", "optimism", "bullish",
       "rebound", "rebounds", "cut rates", "rate cut", "easing", "cools", "cooling", "deal", "approval", "approves",
       "tops", "exceeds", "raises guidance", "buyback", "outperform", "higher", "recovery", "breakthrough"}
NEG = {"miss", "misses", "plunge", "plunges", "tumble", "tumbles", "slump", "slumps", "sell-off", "selloff",
       "downgrade", "downgrades", "fall", "falls", "drop", "drops", "weak", "warning", "warns", "fears", "fear",
       "bearish", "recession", "hike", "hikes", "hot inflation", "tariff", "tariffs", "ban", "probe", "lawsuit",
       "crash", "crisis", "default", "layoffs", "cuts guidance", "lower", "slowdown", "sanctions", "shutdown",
       "war", "attack", "turmoil", "volatility", "losses", "loses"}


def _lexicon(titles: list[str]) -> list[dict]:
    out = []
    for t in titles:
        s = t.lower()
        p = sum(1 for w in POS if re.search(rf"\b{re.escape(w)}\b", s))
        n = sum(1 for w in NEG if re.search(rf"\b{re.escape(w)}\b", s))
        out.append({"score": float(np.tanh(0.7 * (p - n))), "event": None})
    return out


def _finbert(titles: list[str]) -> list[dict]:
    from transformers import pipeline
    clf = pipeline("text-classification", model="ProsusAI/finbert", top_k=None, truncation=True)
    out = []
    for res in clf(titles, batch_size=32):
        d = {r["label"].lower(): r["score"] for r in res}
        out.append({"score": float(d.get("positive", 0) - d.get("negative", 0)), "event": None})
    return out


PROMPT = """You are a sell-side index strategist. For each numbered headline, estimate its likely
effect on the Nasdaq-100 (QQQ) between 10:30 and 16:00 New York time TODAY.
Return ONLY a JSON list, one object per headline: {{"i": <number>, "score": <float -1..1>, "event":
"<macro|fed|earnings|guidance|geopolitics|regulation|ai|flows|other>"}}. Use 0 for irrelevant items.

Headlines:
{items}
"""


def _llm(titles: list[str], model_name: str, batch: int = 40) -> list[dict]:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    tok = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForCausalLM.from_pretrained(model_name, torch_dtype=torch.bfloat16, device_map="auto")
    results = [{"score": 0.0, "event": None} for _ in titles]
    for s in range(0, len(titles), batch):
        chunk = titles[s:s + batch]
        items = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(chunk))
        msgs = [{"role": "user", "content": PROMPT.format(items=items)}]
        ids = tok.apply_chat_template(msgs, add_generation_prompt=True, return_tensors="pt").to(model.device)
        with torch.no_grad():
            gen = model.generate(ids, max_new_tokens=60 * len(chunk), do_sample=False)
        text = tok.decode(gen[0, ids.shape[1]:], skip_special_tokens=True)
        m = re.search(r"\[.*\]", text, re.S)
        if not m:
            continue
        try:
            for obj in json.loads(m.group(0)):
                k = int(obj["i"]) - 1
                if 0 <= k < len(chunk):
                    results[s + k] = {"score": float(np.clip(obj.get("score", 0), -1, 1)), "event": obj.get("event")}
        except Exception as e:
            log.warning("could not parse LLM output: %s", e)
    return results


def score_headlines(titles: list[str], backend: str | None = None) -> tuple[list[dict], str]:
    backend = backend or os.environ.get("FM_NEWS_BACKEND", "auto")
    if not titles:
        return [], backend
    order = [backend] if backend != "auto" else (["llm"] if os.environ.get("FM_LLM_MODEL") else []) + ["finbert", "lexicon"]
    for b in order:
        try:
            if b == "llm":
                return _llm(titles, os.environ["FM_LLM_MODEL"]), b
            if b == "finbert":
                return _finbert(titles), b
            if b == "lexicon":
                return _lexicon(titles), b
        except Exception as e:
            log.info("news backend %s unavailable (%s), falling back", b, e)
    return _lexicon(titles), "lexicon"


def aggregate(items: list[dict], scores: list[dict]) -> dict:
    if not items:
        return {"n": 0, "tone": None}
    s = np.array([x["score"] for x in scores])
    nz = s[s != 0]
    events = {}
    for sc in scores:
        if sc.get("event"):
            events[sc["event"]] = events.get(sc["event"], 0) + 1
    top = sorted(zip(items, scores), key=lambda p: -abs(p[1]["score"]))[:5]
    return {"n": len(items), "n_scored": int(len(nz)), "tone": float(nz.mean()) if len(nz) else 0.0,
            "share_negative": float((s < 0).mean()), "events": events,
            "top": [{"title": i["title"], "source": i["source"], "score": round(sc["score"], 2)} for i, sc in top]}
