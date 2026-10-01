from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse

from feature_engineering_v2 import build_features

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "final_artifacts"

MAP_LABELS = {
    "anc": "Ancient", "anb": "Anubis", "d2": "Dust2", "inf": "Inferno",
    "mrg": "Mirage", "nuke": "Nuke", "ovp": "Overpass", "trn": "Train",
    "cbl": "Cobblestone", "cch": "Cache", "tcn": "Tuscan", "vtg": "Vertigo",
}
MAP_ALIASES = {
    "ancient": "anc", "anc": "anc",
    "anubis": "anb", "anb": "anb",
    "dust2": "d2", "dust 2": "d2", "d2": "d2",
    "inferno": "inf", "inf": "inf",
    "mirage": "mrg", "mrg": "mrg",
    "nuke": "nuke",
    "overpass": "ovp", "ovp": "ovp",
    "train": "trn", "trn": "trn",
    "cobblestone": "cbl", "cbl": "cbl",
    "cache": "cch", "cch": "cch",
    "tuscan": "tcn", "tcn": "tcn",
    "vertigo": "vtg", "vtg": "vtg",
}

app = FastAPI(title="CS2 v7 staging", version="7.0")

MODEL_BUNDLE: dict[str, Any] | None = None
MATCHES: pd.DataFrame | None = None
RANKING: pd.DataFrame | None = None
ROSTERS: pd.DataFrame | None = None
PLAYERS: pd.DataFrame | None = None
UI_TEAMS: list[dict[str, Any]] = []
TEAM_BY_ID: dict[int, dict[str, Any]] = {}
TEAM_BY_NAME: dict[str, int] = {}
ALIAS_CANON: dict[str, int] = {}
PREDICTION_DATE: pd.Timestamp | None = None
MAX_MAPSTATS_ID = 0
SUMMARY: dict[str, Any] = {}


def _normalise_map(value: Any) -> str:
    key = str(value or "").strip().lower()
    if key in MAP_ALIASES:
        return MAP_ALIASES[key]
    raise HTTPException(400, f"Unknown map: {value}")


def _resolve_team(value: Any) -> int:
    if value is None:
        raise HTTPException(400, "Team is required")
    try:
        tid = int(value)
        if tid in TEAM_BY_ID:
            return tid
    except (TypeError, ValueError):
        pass
    key = str(value).strip().casefold()
    if key in TEAM_BY_NAME:
        return TEAM_BY_NAME[key]
    raise HTTPException(400, f"Unknown or UI-ineligible team: {value}")


def _latest_roster(team_id: int, cutoff: pd.Timestamp) -> dict[str, Any] | None:
    g = ROSTERS[(ROSTERS["team_id"] == team_id) & (pd.to_datetime(ROSTERS["snapshot_date"]) <= cutoff)]
    if g.empty:
        return None
    g = g.copy()
    g["_date"] = pd.to_datetime(g["snapshot_date"])
    g["_full"] = g["roster_hash"].notna().astype(int)
    g["_resolved"] = pd.to_numeric(g.get("players_resolved", 0), errors="coerce").fillna(0)
    return g.sort_values(["_date", "_full", "_resolved"]).iloc[-1].to_dict()


def _entity_id(team_id: int, cutoff: pd.Timestamp) -> tuple[int, str | None]:
    r = _latest_roster(team_id, cutoff)
    rh = None
    if r:
        x = r.get("roster_hash")
        if x is not None and not pd.isna(x) and str(x):
            rh = str(x)
    return int(ALIAS_CANON.get(rh, team_id)), rh


def _payload_value(payload: dict[str, Any], *keys: str):
    for key in keys:
        if key in payload and payload[key] not in (None, ""):
            return payload[key]
    return None


@lru_cache(maxsize=1024)
def _predict_cached(team_a_id: int, team_b_id: int, map_name: str) -> dict[str, Any]:
    if team_a_id == team_b_id:
        raise HTTPException(400, "Choose two different teams")

    cutoff = PREDICTION_DATE - pd.Timedelta(days=1)
    ent_a, rh_a = _entity_id(team_a_id, cutoff)
    ent_b, rh_b = _entity_id(team_b_id, cutoff)
    synth_id = MAX_MAPSTATS_ID + 10_000_000 + team_a_id * 100_000 + team_b_id

    ta = TEAM_BY_ID[team_a_id]
    tb = TEAM_BY_ID[team_b_id]
    synthetic = pd.DataFrame([{
        "mapstatsid": synth_id,
        "date": PREDICTION_DATE.strftime("%Y-%m-%d"),
        "team_a_id": team_a_id,
        "team_a_name": ta["team_name"],
        "team_b_id": team_b_id,
        "team_b_name": tb["team_name"],
        "team_a_score": 1,
        "team_b_score": 0,
        "winner_team_id": team_a_id,
        "map_name": map_name,
        "event": "__live_prediction__",
        "source_url": "",
        "team_a_roster_hash_asof": rh_a,
        "team_b_roster_hash_asof": rh_b,
        "team_a_entity_id": ent_a,
        "team_b_entity_id": ent_b,
    }])

    all_matches = pd.concat([MATCHES, synthetic], ignore_index=True)
    feats = build_features(all_matches, RANKING, ROSTERS, PLAYERS, min_history=12)
    row = feats[feats["mapstatsid"] == synth_id]
    if row.empty:
        raise HTTPException(422, "Insufficient leakage-safe history for this matchup")

    cols = MODEL_BUNDLE["feature_columns"]
    x = row.iloc[[-1]][cols]
    p = float(MODEL_BUNDLE["model"].predict_proba(x)[0, 1])
    threshold = float(MODEL_BUNDLE.get("threshold", 0.5))

    def finite(v):
        try:
            z = float(v)
            return z if np.isfinite(z) else None
        except Exception:
            return None

    r = row.iloc[-1]
    return {
        "team_a": {"id": team_a_id, "name": ta["team_name"], "probability": p},
        "team_b": {"id": team_b_id, "name": tb["team_name"], "probability": 1.0 - p},
        "team_a_probability": p,
        "team_b_probability": 1.0 - p,
        "prediction": team_a_id if p >= threshold else team_b_id,
        "predicted_winner": ta["team_name"] if p >= threshold else tb["team_name"],
        "map": map_name,
        "map_name": MAP_LABELS.get(map_name, map_name),
        "threshold": threshold,
        "model": MODEL_BUNDLE.get("model_name", "random_forest"),
        "feature_count": len(cols),
        "prediction_date": PREDICTION_DATE.strftime("%Y-%m-%d"),
        "diagnostics": {
            "elo_prob_a": finite(r.get("elo_prob_a")),
            "vrs_prob_a": finite(r.get("vrs_prob_a")),
            "map_elo_prob_a": finite(r.get("map_elo_prob_a")),
            "rank_a": finite(r.get("rank_a")),
            "rank_b": finite(r.get("rank_b")),
            "recent_wr_10_a": finite(r.get("recent_wr_10_a")),
            "recent_wr_10_b": finite(r.get("recent_wr_10_b")),
            "map_wr_10_a": finite(r.get("map_wr_10_a")),
            "map_wr_10_b": finite(r.get("map_wr_10_b")),
        },
    }


@app.on_event("startup")
def startup() -> None:
    global MODEL_BUNDLE, MATCHES, RANKING, ROSTERS, PLAYERS, UI_TEAMS
    global TEAM_BY_ID, TEAM_BY_NAME, ALIAS_CANON, PREDICTION_DATE, MAX_MAPSTATS_ID, SUMMARY

    required = [
        "saved_model.joblib", "matches.csv", "ranking_snapshots.csv",
        "roster_snapshots.csv", "player_snapshots.csv", "ui_teams.json",
        "team_aliases.csv", "build_summary.json",
    ]
    missing = [x for x in required if not (DATA / x).exists()]
    if missing:
        raise RuntimeError(f"Missing v7 artifacts: {missing}")

    MODEL_BUNDLE = joblib.load(DATA / "saved_model.joblib")
    if len(MODEL_BUNDLE.get("feature_columns", [])) != 253:
        raise RuntimeError("Wrong model artifact: expected 253 feature columns")

    MATCHES = pd.read_csv(DATA / "matches.csv")
    RANKING = pd.read_csv(DATA / "ranking_snapshots.csv")
    ROSTERS = pd.read_csv(DATA / "roster_snapshots.csv")
    PLAYERS = pd.read_csv(DATA / "player_snapshots.csv")
    UI_TEAMS = json.loads((DATA / "ui_teams.json").read_text(encoding="utf-8"))
    SUMMARY = json.loads((DATA / "build_summary.json").read_text(encoding="utf-8"))

    TEAM_BY_ID = {int(x["team_id"]): x for x in UI_TEAMS}
    TEAM_BY_NAME = {str(x["team_name"]).casefold(): int(x["team_id"]) for x in UI_TEAMS}

    aliases = pd.read_csv(DATA / "team_aliases.csv")
    ALIAS_CANON = {
        str(r.roster_hash): int(r.canonical_team_id)
        for r in aliases.itertuples(index=False)
        if getattr(r, "roster_hash", None) is not None and not pd.isna(r.roster_hash)
    }

    max_date = pd.to_datetime(MATCHES["date"]).max().normalize()
    PREDICTION_DATE = max_date + pd.Timedelta(days=1)
    MAX_MAPSTATS_ID = int(pd.to_numeric(MATCHES["mapstatsid"]).max())

    print(json.dumps({
        "event": "V7_LIVE_READY",
        "maps": int(len(MATCHES)),
        "teams": len(UI_TEAMS),
        "features": len(MODEL_BUNDLE["feature_columns"]),
        "prediction_date": PREDICTION_DATE.strftime("%Y-%m-%d"),
        "holdout_accuracy": SUMMARY["model"]["holdout"]["accuracy"],
    }), flush=True)


@app.get("/health")
def health():
    return {
        "ok": MODEL_BUNDLE is not None,
        "version": "v7",
        "model": None if MODEL_BUNDLE is None else MODEL_BUNDLE.get("model_name"),
        "feature_count": 0 if MODEL_BUNDLE is None else len(MODEL_BUNDLE["feature_columns"]),
        "history_maps": 0 if MATCHES is None else int(len(MATCHES)),
        "ui_teams": len(UI_TEAMS),
        "prediction_date": None if PREDICTION_DATE is None else PREDICTION_DATE.strftime("%Y-%m-%d"),
        "holdout_accuracy": SUMMARY.get("model", {}).get("holdout", {}).get("accuracy"),
    }


@app.get("/api/options")
def options():
    maps = [
        {"id": k, "value": k, "name": v, "label": v}
        for k, v in MAP_LABELS.items()
        if MATCHES is not None and k in set(MATCHES["map_name"].astype(str))
    ]
    teams = [
        {
            "id": int(x["team_id"]), "team_id": int(x["team_id"]),
            "name": x["team_name"], "team_name": x["team_name"],
            "rank": int(x["rank"]), "maps": int(x["maps"]), "status": x["status"],
        }
        for x in UI_TEAMS
    ]
    return {"teams": teams, "maps": maps, "version": "v7", "feature_count": 253}


@app.post("/predict")
def predict(payload: dict[str, Any]):
    a = _resolve_team(_payload_value(payload, "team_a_id", "team1_id", "team_a", "team1", "home_team", "teamA"))
    b = _resolve_team(_payload_value(payload, "team_b_id", "team2_id", "team_b", "team2", "away_team", "teamB"))
    mp = _normalise_map(_payload_value(payload, "map_name", "map", "selected_map"))
    return _predict_cached(a, b, mp)


@app.get("/", response_class=HTMLResponse)
def root():
    return """<!doctype html><html><head><meta charset='utf-8'><title>CS2 v7 staging</title>
<style>body{font-family:system-ui;background:#0b0d10;color:#eef;margin:40px;max-width:900px}code{background:#171b22;padding:3px 6px;border-radius:5px}</style></head>
<body><h1>CS2 prediction v7 — staging</h1>
<p>Leakage-safe 253-feature Random Forest. <code>GET /health</code>, <code>GET /api/options</code>, <code>POST /predict</code>.</p>
<p>This staging endpoint intentionally uses the exact training feature builder for parity validation before the optimized live-state implementation replaces it.</p>
</body></html>"""
