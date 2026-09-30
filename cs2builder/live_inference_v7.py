from __future__ import annotations

import gc
import json
import math
import threading
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from feature_engineering_v2 import build_features

ROOT = Path(__file__).resolve().parent
ART = ROOT / "final_artifacts"
WEB_INDEX = ROOT / "web" / "index.html"

MODEL_PATH = ART / "saved_model.joblib"
MATCHES_PATH = ART / "matches.csv"
RANKING_PATH = ART / "ranking_snapshots.csv"
ROSTER_PATH = ART / "roster_snapshots.csv"
PLAYER_PATH = ART / "player_snapshots.csv"
ALIASES_PATH = ART / "team_aliases.csv"
UI_PATH = ART / "ui_teams.json"
META_PATH = ART / "saved_model_metadata.json"

MAP_TO_INTERNAL = {
    "ancient": "anc",
    "anubis": "anb",
    "dust2": "d2",
    "inferno": "inf",
    "mirage": "mrg",
    "nuke": "nuke",
    "overpass": "ovp",
}
INTERNAL_TO_MAP = {v: k for k, v in MAP_TO_INTERNAL.items()}
PAIR_A_FIELDS = {
    "elo_prob_a",
    "map_elo_prob_a",
    "vrs_prob_a",
    "h2h_wr_a",
    "roster_elo_prob_a",
    "roster_map_elo_prob_a",
    "roster_vrs_blend_a",
}

app = FastAPI(title="CS2 Match Prediction", version="7.0")
lock = threading.RLock()
state: dict[str, Any] = {
    "phase": "starting",
    "ready": False,
    "error": None,
    "artifact": None,
    "metadata": None,
    "teams": [],
    "team_name_to_id": {},
    "profiles": {},
    "team_entity": {},
    "h2h": {},
    "parity": None,
    "prediction_date": None,
}


class PredictRequest(BaseModel):
    team1: str = Field(min_length=1)
    team2: str = Field(min_length=1)
    map: str = Field(min_length=1)


def _finite(v) -> bool:
    try:
        return v is not None and not pd.isna(v) and math.isfinite(float(v))
    except Exception:
        return False


def _current_entity_map(rosters: pd.DataFrame, aliases: pd.DataFrame, team_ids: list[int]) -> dict[int, int]:
    r = rosters.copy()
    r["snapshot_date"] = pd.to_datetime(r["snapshot_date"]).dt.normalize()
    r = r[r["team_id"].notna()].copy()
    r["team_id"] = r["team_id"].astype(int)
    a = aliases.copy()
    alias_by_hash = {
        str(x.roster_hash): int(x.canonical_team_id)
        for x in a.itertuples(index=False)
        if getattr(x, "roster_hash", None) is not None and not pd.isna(x.roster_hash)
    }
    out = {}
    for tid in team_ids:
        g = r[(r["team_id"] == int(tid)) & r["roster_hash"].notna()].sort_values("snapshot_date")
        if len(g):
            h = str(g.iloc[-1]["roster_hash"])
            out[int(tid)] = int(alias_by_hash.get(h, int(tid)))
        else:
            out[int(tid)] = int(tid)
    return out


def _history_h2h(matches: pd.DataFrame) -> dict[tuple[int, int], deque]:
    hist = defaultdict(lambda: deque(maxlen=20))
    m = matches.copy()
    m["date"] = pd.to_datetime(m["date"]).dt.normalize()
    for r in m.sort_values(["date", "mapstatsid"]).itertuples(index=False):
        a0, b0 = int(r.team_a_id), int(r.team_b_id)
        a = int(getattr(r, "team_a_entity_id", a0) or a0)
        b = int(getattr(r, "team_b_entity_id", b0) or b0)
        y = int(int(r.winner_team_id) == a0)
        hk = tuple(sorted((a, b)))
        hist[hk].append(y if hk[0] == a else 1 - y)
    return {k: deque(v, maxlen=20) for k, v in hist.items()}


def _h2h_for(a: int, b: int, h2h: dict[tuple[int, int], deque]) -> float:
    hk = tuple(sorted((int(a), int(b))))
    vals = list(h2h.get(hk, []))
    if not vals:
        return 0.5
    p = float(np.mean(vals))
    return p if hk[0] == int(a) else 1.0 - p


def _synthetic_row(mid: int, date: str, a_id: int, a_name: str, b_id: int, b_name: str,
                   map_name: str, a_entity: int, b_entity: int) -> dict[str, Any]:
    return {
        "mapstatsid": int(mid),
        "date": date,
        "team_a_id": int(a_id),
        "team_a_name": a_name,
        "team_b_id": int(b_id),
        "team_b_name": b_name,
        "team_a_score": 13,
        "team_b_score": 0,
        "winner_team_id": int(a_id),
        "map_name": map_name,
        "event": "LIVE_SYNTHETIC",
        "source_url": "",
        "team_a_roster_hash_asof": np.nan,
        "team_b_roster_hash_asof": np.nan,
        "team_a_entity_id": int(a_entity),
        "team_b_entity_id": int(b_entity),
    }


def _combine(team1_id: int, team2_id: int, map_internal: str) -> pd.DataFrame:
    artifact = state["artifact"]
    cols = artifact["feature_columns"]
    pa = state["profiles"].get((int(team1_id), map_internal))
    pb = state["profiles"].get((int(team2_id), map_internal))
    if pa is None or pb is None:
        raise KeyError("Live profile unavailable for selected team/map")

    row: dict[str, Any] = {}
    for c in cols:
        if c == "map_name":
            row[c] = map_internal
        elif c.endswith("_a"):
            row[c] = pa.get(c, np.nan)
        elif c.endswith("_b"):
            row[c] = pb.get(c[:-2] + "_a", np.nan)
        else:
            row[c] = np.nan

    # Every ordinary *_diff feature is A-B. Two ranking transforms are special.
    for c in cols:
        if not c.endswith("_diff") or c in {"rank_log_diff", "rank_strength_diff"}:
            continue
        stem = c[:-5]
        ca, cb = stem + "_a", stem + "_b"
        if ca in row and cb in row and _finite(row[ca]) and _finite(row[cb]):
            row[c] = float(row[ca]) - float(row[cb])

    ra, rb = row.get("rank_a"), row.get("rank_b")
    if _finite(ra) and _finite(rb):
        row["rank_log_diff"] = float(np.log1p(float(rb)) - np.log1p(float(ra)))
        row["rank_strength_diff"] = float(1.0 / max(1.0, float(ra)) - 1.0 / max(1.0, float(rb)))
    else:
        row["rank_log_diff"] = 0.0
        row["rank_strength_diff"] = 0.0

    pta, ptb = row.get("points_a"), row.get("points_b")
    if _finite(pta) and _finite(ptb):
        row["points_log_ratio"] = float(np.log1p(max(0.0, float(pta))) - np.log1p(max(0.0, float(ptb))))
        row["vrs_prob_a"] = float(1.0 / (1.0 + np.exp(-(float(pta) - float(ptb)) / 260.0)))
    else:
        row["points_log_ratio"] = 0.0
        row["vrs_prob_a"] = 0.5

    if _finite(row.get("recent_round_diff_a")) and _finite(row.get("recent_round_diff_b")):
        row["recent_round_diff_delta"] = float(row["recent_round_diff_a"]) - float(row["recent_round_diff_b"])

    ea, eb = float(row["elo_a"]), float(row["elo_b"])
    mea, meb = float(row["map_elo_a"]), float(row["map_elo_b"])
    rea, reb = float(row["roster_elo_a"]), float(row["roster_elo_b"])
    rmea, rmeb = float(row["roster_map_elo_a"]), float(row["roster_map_elo_b"])
    row["elo_prob_a"] = float(1.0 / (1.0 + 10.0 ** ((eb - ea) / 400.0)))
    row["map_elo_prob_a"] = float(1.0 / (1.0 + 10.0 ** ((meb - mea) / 400.0)))
    row["roster_elo_prob_a"] = float(1.0 / (1.0 + 10.0 ** ((reb - rea) / 400.0)))
    row["roster_map_elo_prob_a"] = float(1.0 / (1.0 + 10.0 ** ((rmeb - rmea) / 400.0)))
    row["roster_vrs_blend_a"] = 0.5 * row["roster_elo_prob_a"] + 0.5 * row["vrs_prob_a"]

    ent1 = state["team_entity"][int(team1_id)]
    ent2 = state["team_entity"][int(team2_id)]
    row["h2h_wr_a"] = _h2h_for(ent1, ent2, state["h2h"])

    return pd.DataFrame([row], columns=cols)


def _compare_rows(expected: pd.Series, actual: pd.Series, cols: list[str]) -> list[dict[str, Any]]:
    diffs = []
    for c in cols:
        ev, av = expected.get(c, np.nan), actual.get(c, np.nan)
        if c == "map_name":
            if str(ev) != str(av):
                diffs.append({"feature": c, "expected": str(ev), "actual": str(av)})
            continue
        en, an = pd.isna(ev), pd.isna(av)
        if en and an:
            continue
        if en != an:
            diffs.append({"feature": c, "expected": None if en else float(ev), "actual": None if an else float(av)})
            continue
        try:
            if not np.isclose(float(ev), float(av), rtol=1e-10, atol=1e-10, equal_nan=True):
                diffs.append({"feature": c, "expected": float(ev), "actual": float(av)})
        except Exception:
            if str(ev) != str(av):
                diffs.append({"feature": c, "expected": str(ev), "actual": str(av)})
    return diffs


def _bootstrap() -> None:
    with lock:
        state.update({"phase": "loading", "ready": False, "error": None})
    try:
        for p in [MODEL_PATH, MATCHES_PATH, RANKING_PATH, ROSTER_PATH, PLAYER_PATH, ALIASES_PATH, UI_PATH, META_PATH]:
            if not p.exists():
                raise FileNotFoundError(str(p))

        artifact = joblib.load(MODEL_PATH)
        if not isinstance(artifact, dict) or "model" not in artifact or len(artifact.get("feature_columns", [])) != 253:
            raise RuntimeError("Expected v7 253-feature saved_model.joblib")

        matches = pd.read_csv(MATCHES_PATH)
        ranking = pd.read_csv(RANKING_PATH)
        rosters = pd.read_csv(ROSTER_PATH)
        players = pd.read_csv(PLAYER_PATH)
        aliases = pd.read_csv(ALIASES_PATH)
        metadata = json.loads(META_PATH.read_text(encoding="utf-8"))
        ui = json.loads(UI_PATH.read_text(encoding="utf-8"))
        ui = [x for x in ui if bool(x.get("maps", 0) >= 12)]
        teams = sorted(ui, key=lambda x: str(x["team_name"]).lower())
        if len(teams) < 2:
            raise RuntimeError("Fewer than two UI teams")

        team_ids = [int(x["team_id"]) for x in teams]
        name_to_id = {str(x["team_name"]): int(x["team_id"]) for x in teams}
        id_to_name = {int(x["team_id"]): str(x["team_name"]) for x in teams}
        entity_map = _current_entity_map(rosters, aliases, team_ids)
        h2h = _history_h2h(matches)

        max_date = pd.to_datetime(matches["date"]).max().normalize()
        prediction_day = (max_date + pd.Timedelta(days=1)).strftime("%Y-%m-%d")
        maps = list(MAP_TO_INTERNAL.values())

        synthetic = []
        profile_mid_to_key = {}
        test_mid_to_key = {}
        seq = 0
        for tid in team_ids:
            ref = team_ids[0] if team_ids[0] != tid else team_ids[1]
            for mp in maps:
                mid = 900_000_000 + seq
                seq += 1
                synthetic.append(_synthetic_row(
                    mid, prediction_day, tid, id_to_name[tid], ref, id_to_name[ref],
                    mp, entity_map[tid], entity_map[ref]
                ))
                profile_mid_to_key[mid] = (tid, mp)

        # Direct arbitrary-pair rows are the parity oracle for the fast combiner.
        parity_specs = []
        seed_maps = maps[:]
        for i in range(min(6, len(team_ids) - 1)):
            a = team_ids[i]
            b = team_ids[-(i + 1)]
            if a == b:
                b = team_ids[(i + 1) % len(team_ids)]
            mp = seed_maps[i % len(seed_maps)]
            mid = 910_000_000 + i
            synthetic.append(_synthetic_row(
                mid, prediction_day, a, id_to_name[a], b, id_to_name[b],
                mp, entity_map[a], entity_map[b]
            ))
            test_mid_to_key[mid] = (a, b, mp)
            parity_specs.append((mid, a, b, mp))

        all_matches = pd.concat([matches, pd.DataFrame(synthetic)], ignore_index=True, sort=False)

        with lock:
            state["phase"] = "profiling"

        features = build_features(all_matches, ranking, rosters, players, min_history=12)
        by_mid = features.set_index("mapstatsid", drop=False)

        profiles = {}
        missing_profiles = []
        for mid, key in profile_mid_to_key.items():
            if mid not in by_mid.index:
                missing_profiles.append(key)
                continue
            profiles[key] = by_mid.loc[mid].to_dict()
        if missing_profiles:
            raise RuntimeError(f"Missing {len(missing_profiles)} live profiles; first={missing_profiles[:5]}")

        with lock:
            state.update({
                "artifact": artifact,
                "metadata": metadata,
                "teams": [x["team_name"] for x in teams],
                "team_name_to_id": name_to_id,
                "profiles": profiles,
                "team_entity": entity_map,
                "h2h": h2h,
                "prediction_date": prediction_day,
            })

        parity_results = []
        all_diffs = []
        for mid, a, b, mp in parity_specs:
            if mid not in by_mid.index:
                raise RuntimeError(f"Parity oracle row missing: {mid}")
            expected = by_mid.loc[mid]
            actual = _combine(a, b, mp).iloc[0]
            diffs = _compare_rows(expected, actual, artifact["feature_columns"])
            parity_results.append({
                "team1": id_to_name[a], "team2": id_to_name[b], "map": INTERNAL_TO_MAP[mp],
                "mismatch_count": len(diffs), "first_mismatches": diffs[:8],
            })
            all_diffs.extend(diffs)

        if all_diffs:
            raise RuntimeError(f"Live feature parity failed: {len(all_diffs)} mismatches; sample={all_diffs[:8]}")

        with lock:
            state.update({
                "phase": "ready",
                "ready": True,
                "error": None,
                "parity": parity_results,
            })
        print("V7_LIVE_READY", json.dumps({
            "teams": len(teams),
            "profiles": len(profiles),
            "feature_count": len(artifact["feature_columns"]),
            "prediction_date": prediction_day,
            "parity_checks": len(parity_results),
            "holdout_accuracy": metadata.get("holdout", {}).get("accuracy"),
            "holdout_auc": metadata.get("holdout", {}).get("roc_auc"),
        }), flush=True)

        del features, all_matches
        gc.collect()
    except Exception as exc:
        with lock:
            state.update({"phase": "error", "ready": False, "error": repr(exc)})
        print("V7_LIVE_BOOT_ERROR", repr(exc), flush=True)


@app.on_event("startup")
def startup() -> None:
    threading.Thread(target=_bootstrap, name="v7-live-bootstrap", daemon=True).start()


@app.get("/")
def index():
    return FileResponse(WEB_INDEX)


@app.get("/health")
def health():
    with lock:
        return {"status": "ok", "phase": state["phase"], "ready": state["ready"]}


@app.get("/api/status")
def api_status():
    with lock:
        md = state.get("metadata") or {}
        return {
            "phase": state["phase"],
            "ready": state["ready"],
            "error": state["error"],
            "teams": len(state["teams"]),
            "maps": len(MAP_TO_INTERNAL),
            "model": "random_forest_v7_253",
            "threshold": (state.get("artifact") or {}).get("threshold"),
            "feature_count": len((state.get("artifact") or {}).get("feature_columns", [])),
            "prediction_date": state.get("prediction_date"),
            "parity": state.get("parity"),
            "metrics": {
                "holdout": md.get("holdout"),
                "blend_holdout": md.get("blend_holdout"),
            },
        }


@app.get("/api/options")
def options():
    with lock:
        if not state["ready"]:
            raise HTTPException(status_code=503, detail={"phase": state["phase"], "error": state["error"]})
        return {"teams": state["teams"], "maps": list(MAP_TO_INTERNAL.keys())}


@app.post("/predict")
def predict(payload: PredictRequest):
    if payload.team1 == payload.team2:
        raise HTTPException(status_code=400, detail="team1 and team2 must be different")
    with lock:
        if not state["ready"]:
            raise HTTPException(status_code=503, detail={"phase": state["phase"], "error": state["error"]})
        names = dict(state["team_name_to_id"])
        artifact = state["artifact"]

    if payload.team1 not in names or payload.team2 not in names:
        raise HTTPException(status_code=404, detail="Unknown team")
    map_name = payload.map.strip().lower()
    if map_name not in MAP_TO_INTERNAL:
        raise HTTPException(status_code=404, detail="Unknown map")

    try:
        features = _combine(names[payload.team1], names[payload.team2], MAP_TO_INTERNAL[map_name])
        pipeline = artifact["model"]
        probs = pipeline.predict_proba(features)[0]
        classes = list(pipeline.named_steps["model"].classes_)
        p1 = float(probs[classes.index(1)]) if 1 in classes else float(pipeline.predict(features)[0])
        threshold = float(artifact.get("threshold", 0.5))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}") from exc

    return {
        "team1": payload.team1,
        "team2": payload.team2,
        "map": map_name,
        "team1_win_probability": round(p1, 6),
        "team2_win_probability": round(1.0 - p1, 6),
        "team1_percent": round(p1 * 100.0, 2),
        "team2_percent": round((1.0 - p1) * 100.0, 2),
        "predicted_winner": payload.team1 if p1 >= threshold else payload.team2,
        "model": "Random Forest v7 leakage-safe (253 features)",
    }
