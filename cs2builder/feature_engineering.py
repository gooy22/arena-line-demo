from __future__ import annotations

from bisect import bisect_right
from collections import defaultdict, deque
from datetime import timedelta
import math
import pandas as pd
import numpy as np


def _index_snapshots(df: pd.DataFrame, key_cols: list[str]):
    out = {}
    if df.empty:
        return out
    d = df.copy()
    d["snapshot_date"] = pd.to_datetime(d["snapshot_date"]).dt.normalize()
    for key, g in d.sort_values("snapshot_date").groupby(key_cols, dropna=False):
        if not isinstance(key, tuple):
            key = (key,)
        dates = g["snapshot_date"].tolist()
        rows = g.to_dict("records")
        out[key] = (dates, rows)
    return out


def _asof(idx, key, cutoff):
    if not isinstance(key, tuple):
        key = (key,)
    item = idx.get(key)
    if not item:
        return None
    dates, rows = item
    p = bisect_right(dates, cutoff) - 1
    return rows[p] if p >= 0 else None


def _asof_all_before(idx, key, cutoff, days=60):
    if not isinstance(key, tuple):
        key = (key,)
    item = idx.get(key)
    if not item:
        return []
    dates, rows = item
    p = bisect_right(dates, cutoff)
    lo = cutoff - pd.Timedelta(days=days)
    return [r for d, r in zip(dates[:p], rows[:p]) if d >= lo]


def _player_team_features(roster_row, player_idx, cutoff):
    names = ["rating","kd","adr","kast","kpr","dpr"]
    vals = {k: [] for k in names}
    if not roster_row:
        return {f"player_{k}": np.nan for k in names} | {"player_coverage": 0.0}
    ids = roster_row.get("player_ids", "")
    if isinstance(ids, float) and math.isnan(ids):
        ids = ""
    pids = [int(x) for x in str(ids).split(";") if str(x).strip().isdigit()]
    for pid in pids:
        row = _asof(player_idx, pid, cutoff)
        if not row:
            continue
        for k in names:
            v = row.get(k)
            if v is not None and not pd.isna(v):
                vals[k].append(float(v))
    out = {f"player_{k}": (float(np.mean(v)) if v else np.nan) for k,v in vals.items()}
    out["player_coverage"] = len(vals["rating"]) / max(1, len(pids))
    return out


def build_features(
    matches: pd.DataFrame,
    ranking_snapshots: pd.DataFrame,
    roster_snapshots: pd.DataFrame,
    player_snapshots: pd.DataFrame,
    team_map_snapshots: pd.DataFrame,
    min_history: int = 12,
):
    """
    Leakage-safe feature builder.

    Hard rule: for a map played on date D, every persisted snapshot is looked up
    with snapshot_date <= D-1 day. Same-day maps never update rolling/Elo state
    until *all* maps on that date have had their features generated.
    """
    m = matches.copy()
    m["date"] = pd.to_datetime(m["date"]).dt.normalize()
    m = m.sort_values(["date","match_id","map_id"]).reset_index(drop=True)

    rank_idx = _index_snapshots(ranking_snapshots, ["team_id"])
    roster_idx = _index_snapshots(roster_snapshots, ["team_id"])
    player_idx = _index_snapshots(player_snapshots, ["player_id"])
    map_idx = _index_snapshots(team_map_snapshots, ["team_id","map_name"])

    recent = defaultdict(lambda: deque(maxlen=30))
    recent_round = defaultdict(lambda: deque(maxlen=30))
    last_date = {}
    elo = defaultdict(lambda: 1500.0)
    map_elo = defaultdict(lambda: 1500.0)
    h2h = defaultdict(lambda: deque(maxlen=20))
    history_n = defaultdict(int)

    rows = []

    for day, dg in m.groupby("date", sort=True):
        cutoff = day - pd.Timedelta(days=1)

        for r in dg.itertuples(index=False):
            a = int(r.team_a_id); b = int(r.team_b_id)
            map_name = str(r.map_name)

            ra = _asof(rank_idx, a, cutoff)
            rb = _asof(rank_idx, b, cutoff)
            roa = _asof(roster_idx, a, cutoff)
            rob = _asof(roster_idx, b, cutoff)
            ma = _asof(map_idx, (a,map_name), cutoff)
            mb = _asof(map_idx, (b,map_name), cutoff)

            pa = _player_team_features(roa, player_idx, cutoff)
            pb = _player_team_features(rob, player_idx, cutoff)

            wa = list(recent[a]); wb = list(recent[b])
            rda = list(recent_round[a]); rdb = list(recent_round[b])

            hkey = tuple(sorted((a,b)))
            hh = list(h2h[hkey])
            if hkey[0] == a:
                h2h_wr_a = np.mean(hh) if hh else 0.5
            else:
                h2h_wr_a = 1.0 - np.mean(hh) if hh else 0.5

            roster_hist_a = _asof_all_before(roster_idx, a, cutoff, 90)
            roster_hist_b = _asof_all_before(roster_idx, b, cutoff, 90)
            changes_a = max(0, len({x.get("roster_hash") for x in roster_hist_a if x.get("roster_hash")}) - 1)
            changes_b = max(0, len({x.get("roster_hash") for x in roster_hist_b if x.get("roster_hash")}) - 1)

            roster_age_a = (day - pd.to_datetime(roa["snapshot_date"])).days if roa else np.nan
            roster_age_b = (day - pd.to_datetime(rob["snapshot_date"])).days if rob else np.nan
            days_a = (day - last_date[a]).days if a in last_date else np.nan
            days_b = (day - last_date[b]).days if b in last_date else np.nan

            f = {
                "date": day.strftime("%Y-%m-%d"),
                "match_id": int(r.match_id),
                "map_id": int(r.map_id),
                "map_name": map_name,
                "team_a_id": a,
                "team_b_id": b,
                "target": int(r.winner_team_id == a),

                "rank_a": ra.get("rank") if ra else np.nan,
                "rank_b": rb.get("rank") if rb else np.nan,
                "rank_diff": (ra.get("rank") - rb.get("rank")) if ra and rb else np.nan,
                "points_a": ra.get("points") if ra else np.nan,
                "points_b": rb.get("points") if rb else np.nan,
                "points_diff": (ra.get("points") - rb.get("points")) if ra and rb else np.nan,
                "ranking_available_a": float(ra is not None),
                "ranking_available_b": float(rb is not None),

                "recent_matches_a": len(wa),
                "recent_matches_b": len(wb),
                "recent_wr_a": float(np.mean(wa)) if wa else 0.5,
                "recent_wr_b": float(np.mean(wb)) if wb else 0.5,
                "recent_wr_diff": (float(np.mean(wa)) if wa else 0.5) - (float(np.mean(wb)) if wb else 0.5),
                "recent_round_diff_a": float(np.mean(rda)) if rda else 0.0,
                "recent_round_diff_b": float(np.mean(rdb)) if rdb else 0.0,
                "recent_round_diff_delta": (float(np.mean(rda)) if rda else 0.0) - (float(np.mean(rdb)) if rdb else 0.0),

                "map_played_a": ma.get("played") if ma else 0,
                "map_played_b": mb.get("played") if mb else 0,
                "map_wr_a": ma.get("win_rate") if ma else 0.5,
                "map_wr_b": mb.get("win_rate") if mb else 0.5,
                "map_wr_diff": (ma.get("win_rate") if ma else 0.5) - (mb.get("win_rate") if mb else 0.5),

                "elo_a": elo[a],
                "elo_b": elo[b],
                "elo_diff": elo[a]-elo[b],
                "map_elo_a": map_elo[(a,map_name)],
                "map_elo_b": map_elo[(b,map_name)],
                "map_elo_diff": map_elo[(a,map_name)]-map_elo[(b,map_name)],
                "h2h_wr_a": h2h_wr_a,

                "days_since_a": days_a,
                "days_since_b": days_b,
                "days_since_diff": (days_a-days_b) if not pd.isna(days_a) and not pd.isna(days_b) else np.nan,
                "roster_age_a": roster_age_a,
                "roster_age_b": roster_age_b,
                "lineup_changes_90d_a": changes_a,
                "lineup_changes_90d_b": changes_b,
                "same_roster_hash": float(bool(roa and rob and roa.get("roster_hash") == rob.get("roster_hash"))),

                "history_n_a": history_n[a],
                "history_n_b": history_n[b],
            }
            for k,v in pa.items():
                f[k+"_a"] = v
            for k,v in pb.items():
                f[k+"_b"] = v
            for k in ["rating","kd","adr","kast","kpr","dpr"]:
                va=f.get("player_"+k+"_a",np.nan); vb=f.get("player_"+k+"_b",np.nan)
                f["player_"+k+"_diff"] = va-vb if not pd.isna(va) and not pd.isna(vb) else np.nan

            if history_n[a] >= min_history and history_n[b] >= min_history:
                rows.append(f)

        # Update states only after every map on this date has been featurized.
        for r in dg.itertuples(index=False):
            a = int(r.team_a_id); b = int(r.team_b_id)
            y = int(r.winner_team_id == a)
            recent[a].append(y); recent[b].append(1-y)
            score_delta = float(r.team_a_score-r.team_b_score)
            recent_round[a].append(score_delta); recent_round[b].append(-score_delta)
            history_n[a] += 1; history_n[b] += 1
            last_date[a] = day; last_date[b] = day

            ea, eb = elo[a], elo[b]
            p = 1/(1+10**((eb-ea)/400))
            k=24.0
            elo[a] = ea + k*(y-p)
            elo[b] = eb + k*((1-y)-(1-p))

            keya=(a,str(r.map_name)); keyb=(b,str(r.map_name))
            ema, emb = map_elo[keya], map_elo[keyb]
            pm=1/(1+10**((emb-ema)/400))
            mk=28.0
            map_elo[keya]=ema+mk*(y-pm)
            map_elo[keyb]=emb+mk*((1-y)-(1-pm))

            hkey=tuple(sorted((a,b)))
            h2h[hkey].append(y if hkey[0]==a else 1-y)

    return pd.DataFrame(rows)
