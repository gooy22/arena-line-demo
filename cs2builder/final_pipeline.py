from __future__ import annotations

import argparse
import hashlib
import json
import time
from bisect import bisect_right
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBClassifier

from feature_engineering import build_features


BASE = "https://api.csapi.de"
START_DATE = "2025-01-01"
END_DATE = "2026-09-30"
UA = "cs2-final-dataset-builder/1.0"


class Api:
    def __init__(self):
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept": "application/json"})

    def get(self, path, timeout=35, attempts=5):
        err = None
        for i in range(attempts):
            try:
                r = self.s.get(BASE + path, timeout=timeout)
                if r.status_code == 429:
                    time.sleep(2 + i * 2)
                    continue
                r.raise_for_status()
                return r.json()
            except Exception as e:
                err = e
                time.sleep(min(5, 0.5 * (2 ** i)))
        raise err


def adaptive_match_range(api: Api, offset: int, n: int, skipped: list[int]):
    try:
        rows = api.get(f"/matches/?limit={n}&offset={offset}", attempts=3)
        return rows, False
    except Exception as e:
        if n <= 1:
            skipped.append(offset)
            print(f"MATCH_SKIP offset={offset} error={e!r}", flush=True)
            return [], True
        a = n // 2
        left, _ = adaptive_match_range(api, offset, a, skipped)
        right, _ = adaptive_match_range(api, offset + a, n - a, skipped)
        return left + right, True


def fetch_matches(api: Api):
    counts = api.get("/counts/")
    total = int(counts["matches"])
    rows, skipped, seen = [], [], set()
    empty_blocks = 0
    for offset in range(0, total + 100, 100):
        n = min(100, max(1, total - offset)) if offset < total else 100
        page, had_error = adaptive_match_range(api, offset, n, skipped)
        added = 0
        for x in page:
            mid = int(x["id"])
            if mid not in seen:
                seen.add(mid)
                rows.append(x)
                added += 1
        print(f"MATCH_PAGE offset={offset} fetched={len(page)} added={added} total={len(rows)}", flush=True)
        if not page and not had_error:
            empty_blocks += 1
            if empty_blocks >= 3:
                break
        else:
            empty_blocks = 0
    return counts, rows, skipped


def deterministic_orientation(mid, mapid):
    return hashlib.sha1(f"{mid}:{mapid}".encode()).digest()[0] & 1


def explode_maps(matches):
    out, ties = [], 0
    for m in matches:
        d = str(m.get("date", ""))
        if not (START_DATE <= d <= END_DATE):
            continue
        t1, t2 = m["team1"], m["team2"]
        for mp in m.get("maps", []):
            if not mp.get("name") or int(mp.get("id", 0)) == 0:
                continue
            s1, s2 = int(mp["team1_score"]), int(mp["team2_score"])
            if s1 == s2:
                ties += 1
                continue
            if deterministic_orientation(m["id"], mp["id"]):
                a, b, sa, sb = t2, t1, s2, s1
            else:
                a, b, sa, sb = t1, t2, s1, s2
            winner = int(a["id"]) if sa > sb else int(b["id"])
            out.append({
                "map_uid": f"{m['id']}:{mp['id']}",
                "match_id": int(m["id"]),
                "date": d,
                "event": m.get("event", ""),
                "best_of": int(m.get("best_of") or 0),
                "map_id": int(mp["id"]),
                "map_name": str(mp["name"]),
                "team_a_id": int(a["id"]),
                "team_a_name": str(a["name"]),
                "team_b_id": int(b["id"]),
                "team_b_name": str(b["name"]),
                "team_a_score": sa,
                "team_b_score": sb,
                "winner_team_id": winner,
            })
    df = pd.DataFrame(out)
    if not df.empty:
        df = df.drop_duplicates(["match_id", "map_id"]).sort_values(["date","match_id","map_id"]).reset_index(drop=True)
    print(f"MAP_ROWS unique={len(df)} ties_skipped={ties}", flush=True)
    return df


def fetch_rankings_for_dates(api: Api, match_dates):
    def one(d):
        cutoff = (pd.Timestamp(d) - pd.Timedelta(days=1)).date().isoformat()
        try:
            return d, api.get(f"/rankings/?date={cutoff}", attempts=4)
        except Exception as e:
            return d, {"error": repr(e)}

    results = {}
    dates = sorted(set(match_dates))
    with ThreadPoolExecutor(max_workers=8) as ex:
        futs = [ex.submit(one, d) for d in dates]
        for i, fut in enumerate(as_completed(futs), 1):
            d, obj = fut.result()
            results[d] = obj
            if i % 75 == 0:
                print(f"RANK_ASOF fetched={i}/{len(futs)}", flush=True)

    rows, errors = [], 0
    for d, obj in results.items():
        if not obj or "error" in obj or not obj.get("date"):
            errors += 1
            continue
        sd = obj["date"]
        for x in obj.get("rankings", []):
            rows.append({
                "snapshot_date": sd,
                "team_id": int(x["id"]),
                "team_name": x.get("name",""),
                "rank": int(x["rank"]),
                "points": int(x["points"]),
            })
    df = pd.DataFrame(rows)
    if len(df):
        df = df.drop_duplicates(["snapshot_date","team_id"])
    else:
        df = pd.DataFrame(columns=["snapshot_date","team_id","team_name","rank","points"])
    print(f"RANK_SNAPSHOTS rows={len(df)} dates={df['snapshot_date'].nunique() if len(df) else 0} errors={errors}", flush=True)
    return df, results


def fetch_match_stats(api: Api, matches_df):
    mids = matches_df["match_id"].drop_duplicates().astype(int).tolist()

    def one(mid):
        try:
            return mid, api.get(f"/matches/{mid}/stats?by_map=true", attempts=4)
        except Exception as e:
            return mid, {"error": repr(e)}

    payload = {}
    with ThreadPoolExecutor(max_workers=12) as ex:
        futs = [ex.submit(one, m) for m in mids]
        for i, fut in enumerate(as_completed(futs), 1):
            mid, obj = fut.result()
            payload[mid] = obj
            if i % 250 == 0:
                print(f"PLAYER_STATS fetched={i}/{len(futs)}", flush=True)

    map_meta = {
        (int(r.match_id), int(r.map_id)): {
            "date": str(r.date), "rounds": int(r.team_a_score + r.team_b_score),
            "event": str(r.event), "map_name": str(r.map_name)
        }
        for r in matches_df.itertuples(index=False)
    }
    rows, errors = [], []
    for mid, obj in payload.items():
        if isinstance(obj, dict) and "error" in obj:
            errors.append((mid, obj["error"]))
            continue
        if not isinstance(obj, list):
            continue
        for mp in obj:
            mapid = int(mp.get("id", 0) or 0)
            meta = map_meta.get((mid, mapid))
            if not meta:
                continue
            for side in ("team1", "team2"):
                t = mp.get(side) or {}
                tid = t.get("id")
                if tid is None:
                    continue
                for p in t.get("players", []) or []:
                    deaths = float(p.get("d") or 0)
                    rounds = max(1, int(meta["rounds"]))
                    kills = float(p.get("k") or 0)
                    rows.append({
                        "date": meta["date"], "match_id": mid, "map_id": mapid,
                        "map_name": meta["map_name"], "event": meta["event"], "rounds": rounds,
                        "team_id": int(tid), "team_name": t.get("name",""),
                        "player_id": int(p["id"]), "player_name": p.get("name",""),
                        "k": kills, "d": deaths, "kd": kills/max(1.0,deaths),
                        "adr": float(p.get("adr")) if p.get("adr") is not None else np.nan,
                        "kast": float(p.get("kast")) if p.get("kast") is not None else np.nan,
                        "rating": float(p.get("rating")) if p.get("rating") is not None else np.nan,
                        "kpr": kills/rounds, "dpr": deaths/rounds,
                    })
    df = pd.DataFrame(rows)
    print(f"PLAYER_MAP_ROWS rows={len(df)} matches_with_errors={len(errors)}", flush=True)
    return df, errors


def roster_hash(ids):
    s = ";".join(str(int(x)) for x in sorted(set(ids)))
    return hashlib.sha1(s.encode()).hexdigest()[:20], s


def make_roster_snapshots(raw):
    cols = ["snapshot_date","team_id","team_name","player_ids","roster_hash","maps_observed"]
    if raw.empty:
        return pd.DataFrame(columns=cols)
    map_rosters = []
    for (d, tid, tname, mid, mapid), g in raw.groupby(["date","team_id","team_name","match_id","map_id"]):
        h, ids = roster_hash(g["player_id"].tolist())
        map_rosters.append({
            "snapshot_date": d, "team_id": int(tid), "team_name": tname,
            "match_id": int(mid), "map_id": int(mapid),
            "player_ids": ids, "roster_hash": h
        })
    mr = pd.DataFrame(map_rosters)
    out = []
    for (d, tid), g in mr.groupby(["snapshot_date","team_id"]):
        counts = g["roster_hash"].value_counts()
        h = counts.index[0]
        q = g[g["roster_hash"] == h].iloc[-1]
        out.append({
            "snapshot_date": d, "team_id": int(tid), "team_name": q["team_name"],
            "player_ids": q["player_ids"], "roster_hash": h,
            "maps_observed": int(counts.iloc[0]),
        })
    return pd.DataFrame(out).sort_values(["snapshot_date","team_id"]).reset_index(drop=True)


def make_player_snapshots(raw, window=30):
    cols = ["snapshot_date","player_id","player_name","team_id","maps","rating","kd","adr","kast","kpr","dpr"]
    if raw.empty:
        return pd.DataFrame(columns=cols)
    out = []
    raw = raw.copy()
    raw["date"] = pd.to_datetime(raw["date"]).dt.normalize()
    for pid, g in raw.sort_values(["player_id","date","match_id","map_id"]).groupby("player_id"):
        dq = deque(maxlen=window)
        for day, dg in g.groupby("date", sort=True):
            for r in dg.to_dict("records"):
                dq.append(r)
            q = list(dq)
            rounds = sum(max(1, float(x["rounds"])) for x in q)
            kills = sum(float(x["k"]) for x in q)
            deaths = sum(float(x["d"]) for x in q)
            def wavg(k):
                vals = [(float(x[k]), max(1,float(x["rounds"]))) for x in q if x.get(k) is not None and not pd.isna(x.get(k))]
                return sum(v*w for v,w in vals)/sum(w for _,w in vals) if vals else np.nan
            last = dg.iloc[-1]
            out.append({
                "snapshot_date": day.strftime("%Y-%m-%d"),
                "player_id": int(pid), "player_name": last["player_name"], "team_id": int(last["team_id"]),
                "maps": len(q), "rating": wavg("rating"), "kd": kills/max(1.0,deaths),
                "adr": wavg("adr"), "kast": wavg("kast"),
                "kpr": kills/max(1.0,rounds), "dpr": deaths/max(1.0,rounds),
            })
    return pd.DataFrame(out)


def make_team_map_snapshots(matches, window=30):
    rows = []
    for r in matches.itertuples(index=False):
        y = int(r.winner_team_id == r.team_a_id)
        rows.append({"date":r.date,"team_id":int(r.team_a_id),"map_name":r.map_name,"win":y})
        rows.append({"date":r.date,"team_id":int(r.team_b_id),"map_name":r.map_name,"win":1-y})
    p = pd.DataFrame(rows)
    p["date"] = pd.to_datetime(p["date"]).dt.normalize()
    out = []
    for (tid, mapn), g in p.sort_values("date").groupby(["team_id","map_name"]):
        dq = deque(maxlen=window)
        for day, dg in g.groupby("date", sort=True):
            for y in dg["win"].tolist():
                dq.append(int(y))
            out.append({
                "snapshot_date":day.strftime("%Y-%m-%d"), "team_id":int(tid), "map_name":mapn,
                "played":len(dq), "win_rate":float(np.mean(dq)),
                "ct_win_rate":np.nan, "t_win_rate":np.nan, "side_data_available":0,
            })
    return pd.DataFrame(out)


def build_aliases(rosters, latest_rankings):
    cols=["roster_hash","team_ids","team_names","canonical_team_id","canonical_team_name"]
    if rosters.empty:
        return pd.DataFrame(columns=cols)
    rank_pos = {int(x["id"]): int(x["rank"]) for x in latest_rankings}
    latest_name = {int(x["id"]): x["name"] for x in latest_rankings}
    out=[]
    r=rosters.copy()
    r["snapshot_date"]=pd.to_datetime(r["snapshot_date"])
    for h,g in r.groupby("roster_hash"):
        tids=sorted(set(int(x) for x in g["team_id"]))
        names=sorted(set(str(x) for x in g["team_name"]))
        ranked=[x for x in tids if x in rank_pos]
        canon=min(ranked,key=lambda x:rank_pos[x]) if ranked else int(g.sort_values("snapshot_date").iloc[-1]["team_id"])
        out.append({
            "roster_hash":h, "team_ids":";".join(map(str,tids)), "team_names":";".join(names),
            "canonical_team_id":canon,
            "canonical_team_name":latest_name.get(canon, str(g[g["team_id"]==canon].iloc[-1]["team_name"])),
        })
    return pd.DataFrame(out)


def enrich_matches_roster(matches, rosters, aliases):
    if rosters.empty:
        return matches
    idx={}
    rr=rosters.copy()
    rr["snapshot_date"]=pd.to_datetime(rr["snapshot_date"]).dt.normalize()
    for tid,g in rr.sort_values("snapshot_date").groupby("team_id"):
        idx[int(tid)]=(g["snapshot_date"].tolist(),g.to_dict("records"))
    canon={r.roster_hash:int(r.canonical_team_id) for r in aliases.itertuples(index=False)}
    def lookup(tid,d):
        x=idx.get(int(tid))
        if not x:
            return None,int(tid)
        dates,rows=x
        cutoff=pd.Timestamp(d).normalize()-pd.Timedelta(days=1)
        p=bisect_right(dates,cutoff)-1
        if p<0:
            return None,int(tid)
        h=rows[p]["roster_hash"]
        return h,canon.get(h,int(tid))
    a_hash=[];b_hash=[];a_entity=[];b_entity=[]
    for r in matches.itertuples(index=False):
        ah,ae=lookup(r.team_a_id,r.date); bh,be=lookup(r.team_b_id,r.date)
        a_hash.append(ah);b_hash.append(bh);a_entity.append(ae);b_entity.append(be)
    m=matches.copy()
    m["team_a_roster_hash_asof"]=a_hash
    m["team_b_roster_hash_asof"]=b_hash
    m["team_a_entity_id"]=a_entity
    m["team_b_entity_id"]=b_entity
    return m


def build_coverage(matches, rankings, rosters, raw_stats, latest):
    top = latest.get("rankings", [])[:150]
    map_count = Counter()
    for r in matches.itertuples(index=False):
        map_count[int(r.team_a_id)] += 1
        map_count[int(r.team_b_id)] += 1
    rank_count = rankings.groupby("team_id")["snapshot_date"].nunique().to_dict() if len(rankings) else {}
    roster_count = rosters.groupby("team_id")["snapshot_date"].nunique().to_dict() if len(rosters) else {}
    if len(raw_stats):
        ps = {}
        for tid,g in raw_stats.groupby("team_id"):
            ps[int(tid)] = g[["match_id","map_id"]].drop_duplicates().shape[0]
    else:
        ps={}
    rows=[]
    for x in top:
        tid=int(x["id"]); maps=int(map_count[tid])
        rc=int(rank_count.get(tid,0)); roc=int(roster_count.get(tid,0)); pm=int(ps.get(tid,0))
        if maps >= 40 and rc >= 3 and roc >= 3 and pm >= 20:
            status="READY"
        elif maps >= 12:
            status="PARTIAL"
        else:
            status="MISSING"
        rows.append({
            "rank":int(x["rank"]),"points":int(x["points"]),"team_id":tid,"team_name":x["name"],
            "maps":maps,"ranking_snapshots":rc,"roster_snapshots":roc,"player_stat_maps":pm,
            "ui_eligible":bool(maps>=12),"status":status,
        })
    return pd.DataFrame(rows)


def metric_dict(y, p, threshold=0.5):
    pred=(np.asarray(p)>=threshold).astype(int)
    return {
        "accuracy":float(accuracy_score(y,pred)),
        "roc_auc":float(roc_auc_score(y,p)) if len(set(y))>1 else None,
        "log_loss":float(log_loss(y,p,labels=[0,1])),
        "brier":float(brier_score_loss(y,p)),
        "threshold":float(threshold),"n":int(len(y)),
    }


def train_models(features, outdir):
    meta_cols={"date","match_id","map_id","team_a_id","team_b_id","target"}
    feat_cols=[c for c in features.columns if c not in meta_cols]
    cat_cols=["map_name"]
    num_cols=[c for c in feat_cols if c not in cat_cols]
    prep=ColumnTransformer([
        ("num",SimpleImputer(strategy="median",add_indicator=True,keep_empty_features=True),num_cols),
        ("cat",Pipeline([
            ("imp",SimpleImputer(strategy="most_frequent")),
            ("oh",OneHotEncoder(handle_unknown="ignore",sparse_output=False))
        ]),cat_cols),
    ])
    candidates={
      "random_forest":RandomForestClassifier(
          n_estimators=650,max_depth=16,min_samples_leaf=4,min_samples_split=8,
          max_features="sqrt",class_weight="balanced_subsample",random_state=42,n_jobs=-1
      ),
      "xgboost":XGBClassifier(
          n_estimators=650,max_depth=5,learning_rate=0.035,subsample=0.86,
          colsample_bytree=0.86,min_child_weight=4,reg_lambda=2.0,reg_alpha=0.05,
          objective="binary:logistic",eval_metric="logloss",random_state=42,n_jobs=2
      ),
    }
    df=features.sort_values(["date","match_id","map_id"]).reset_index(drop=True)
    unique_dates=np.array(sorted(df["date"].unique()))
    hold_pos=max(1,int(len(unique_dates)*0.80))
    train_dates=set(unique_dates[:hold_pos]); hold_dates=set(unique_dates[hold_pos:])
    train_df=df[df["date"].isin(train_dates)].copy(); hold=df[df["date"].isin(hold_dates)].copy()
    if len(hold)<100:
        split=max(1,int(len(df)*.8)); train_df=df.iloc[:split].copy(); hold=df.iloc[split:].copy()

    Xtr=train_df[feat_cols]; ytr=train_df["target"].astype(int)
    Xh=hold[feat_cols]; yh=hold["target"].astype(int)
    dts=np.array(sorted(train_df["date"].unique()))
    tss=TimeSeriesSplit(n_splits=4)
    model_reports={}; thresholds={}
    for name,clf in candidates.items():
        pooled_y=[]; pooled_p=[]; folds=[]
        for fold,(trd,vad) in enumerate(tss.split(dts),1):
            tr_dates=set(dts[trd]); va_dates=set(dts[vad])
            tr=train_df[train_df["date"].isin(tr_dates)]
            va=train_df[train_df["date"].isin(va_dates)]
            pipe=Pipeline([("prep",clone(prep)),("model",clone(clf))])
            pipe.fit(tr[feat_cols],tr["target"].astype(int))
            p=pipe.predict_proba(va[feat_cols])[:,1]
            pooled_y.extend(va["target"].astype(int).tolist()); pooled_p.extend(p.tolist())
            folds.append(metric_dict(va["target"].astype(int).values,p,0.5))
            print(f"MODEL_CV {name} fold={fold} "+json.dumps(folds[-1]),flush=True)
        py=np.asarray(pooled_y); pp=np.asarray(pooled_p)
        best_thr=.5; best_acc=-1
        for thr in np.linspace(.35,.65,61):
            acc=accuracy_score(py,(pp>=thr).astype(int))
            if acc>best_acc:
                best_acc=acc;best_thr=float(thr)
        thresholds[name]=best_thr
        pooled=metric_dict(py,pp,best_thr)
        model_reports[name]={
            "cv_folds":folds,"cv_pooled":pooled,
            "cv_accuracy_mean":float(np.mean([x["accuracy"] for x in folds])),
            "cv_auc_mean":float(np.mean([x["roc_auc"] for x in folds if x["roc_auc"] is not None])),
        }
    best=max(model_reports,key=lambda n:(model_reports[n]["cv_pooled"]["accuracy"],-model_reports[n]["cv_pooled"]["brier"]))
    final_eval=Pipeline([("prep",clone(prep)),("model",clone(candidates[best]))])
    final_eval.fit(Xtr,ytr)
    ph=final_eval.predict_proba(Xh)[:,1]
    hold_metrics=metric_dict(yh.values,ph,thresholds[best])
    print("FINAL_HOLDOUT "+json.dumps({"model":best,**hold_metrics}),flush=True)

    prod=Pipeline([("prep",clone(prep)),("model",clone(candidates[best]))])
    prod.fit(df[feat_cols],df["target"].astype(int))
    joblib.dump({
        "model":prod,"threshold":thresholds[best],"feature_columns":feat_cols,
        "categorical_columns":cat_cols,"model_name":best,
    },outdir/"saved_model.joblib",compress=3)
    report={
        "selected_model":best,"feature_count":len(feat_cols),"samples_total":int(len(df)),
        "train_samples":int(len(train_df)),"holdout_samples":int(len(hold)),
        "train_date_min":str(train_df["date"].min()),"train_date_max":str(train_df["date"].max()),
        "holdout_date_min":str(hold["date"].min()),"holdout_date_max":str(hold["date"].max()),
        "threshold":thresholds[best],"models":model_reports,"holdout":hold_metrics,
    }
    (outdir/"saved_model_metadata.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    return report


def main(outdir):
    outdir=Path(outdir);outdir.mkdir(parents=True,exist_ok=True)
    api=Api()
    counts, match_objs, skipped_offsets=fetch_matches(api)
    filtered=[m for m in match_objs if START_DATE<=str(m.get("date",""))<=END_DATE]
    matches=explode_maps(filtered)
    if len(matches)<8000:
        print(f"WARNING_TARGET maps={len(matches)} below requested 8000; continuing honestly without duplication",flush=True)

    ranking_snapshots,_=fetch_rankings_for_dates(api,matches["date"].unique().tolist())
    raw_stats,stat_errors=fetch_match_stats(api,matches)
    raw_stats.to_csv(outdir/"player_map_stats_raw.csv",index=False)
    roster_snapshots=make_roster_snapshots(raw_stats)
    player_snapshots=make_player_snapshots(raw_stats)
    team_map_snapshots=make_team_map_snapshots(matches)

    latest=api.get("/rankings/")
    aliases=build_aliases(roster_snapshots,latest.get("rankings",[]))
    matches=enrich_matches_roster(matches,roster_snapshots,aliases)

    ranking_snapshots.to_csv(outdir/"ranking_snapshots.csv",index=False)
    roster_snapshots.to_csv(outdir/"roster_snapshots.csv",index=False)
    player_snapshots.to_csv(outdir/"player_snapshots.csv",index=False)
    team_map_snapshots.to_csv(outdir/"team_map_snapshots.csv",index=False)
    aliases.to_csv(outdir/"team_aliases.csv",index=False)
    matches.to_csv(outdir/"matches.csv",index=False)

    coverage=build_coverage(matches,ranking_snapshots,roster_snapshots,raw_stats,latest)
    coverage.to_csv(outdir/"coverage_top150.csv",index=False)
    eligible=coverage[coverage["ui_eligible"]].sort_values("rank")
    (outdir/"ui_teams.json").write_text(json.dumps(
        eligible[["rank","team_id","team_name","maps","status"]].to_dict("records"),
        ensure_ascii=False,indent=2),encoding="utf-8")

    features=build_features(matches,ranking_snapshots,roster_snapshots,player_snapshots,team_map_snapshots,min_history=12)
    features.to_csv(outdir/"training_features.csv",index=False)
    if len(features)<500:
        raise RuntimeError(f"Too few leakage-safe training samples: {len(features)}")
    model_report=train_models(features,outdir)

    status_counts=coverage["status"].value_counts().to_dict()
    summary={
      "generated_at":datetime.utcnow().isoformat()+"Z",
      "source":"api.csapi.de (HLTV-derived) + historical VRS snapshots",
      "source_counts":counts,"api_match_rows_retrieved":len(match_objs),
      "api_bad_offsets_skipped":skipped_offsets,"matches_in_window":len(filtered),
      "unique_map_rows":int(len(matches)),
      "date_min":matches["date"].min() if len(matches) else None,
      "date_max":matches["date"].max() if len(matches) else None,
      "unique_teams":int(len(set(matches["team_a_id"]).union(set(matches["team_b_id"])))) if len(matches) else 0,
      "ranking_snapshot_rows":int(len(ranking_snapshots)),
      "ranking_snapshot_dates":int(ranking_snapshots["snapshot_date"].nunique()) if len(ranking_snapshots) else 0,
      "roster_snapshot_rows":int(len(roster_snapshots)),
      "player_snapshot_rows":int(len(player_snapshots)),
      "team_map_snapshot_rows":int(len(team_map_snapshots)),
      "player_stat_fetch_errors":len(stat_errors),"training_samples":int(len(features)),
      "top150_status":status_counts,"ui_eligible_12plus":int(coverage["ui_eligible"].sum()),
      "model":model_report,
      "leakage_guard":"All persisted snapshots use snapshot_date <= match_date - 1 day; rolling and Elo state updates after the full date batch.",
      "ct_t_note":"CSAPI exposes total map scores but not CT/T round wins; ct_win_rate and t_win_rate are explicitly null, never fabricated.",
    }
    (outdir/"build_summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    report_lines=[
      "# CS2 Final Dataset Build","",
      f"- Unique map rows: **{len(matches):,}**",
      f"- Date range: **{summary['date_min']} -> {summary['date_max']}**",
      f"- Teams: **{summary['unique_teams']}**",
      f"- Training samples after 12-map warmup: **{len(features):,}**",
      f"- UI eligible top-150 teams (>=12 maps): **{summary['ui_eligible_12plus']}**",
      f"- Coverage: **{status_counts}**",
      f"- Selected model: **{model_report['selected_model']}**",
      f"- Holdout Accuracy: **{model_report['holdout']['accuracy']:.4f}**",
      f"- Holdout ROC-AUC: **{model_report['holdout']['roc_auc']:.4f}**",
      f"- Holdout Log Loss: **{model_report['holdout']['log_loss']:.4f}**",
      f"- Holdout Brier: **{model_report['holdout']['brier']:.4f}**","",
      "## Leakage rule",
      "Every ranking, roster, player and team-map snapshot is looked up with snapshot_date <= D - 1 day.",
      "Rolling form, H2H and Elo are updated only after all maps on date D are featurized.","",
      "## Side data",
      "The selected HLTV-derived API does not expose per-side round wins in the match result payload. CT/T snapshot columns are retained as null with side_data_available=0 rather than being fabricated.",
    ]
    (outdir/"BUILD_REPORT.md").write_text("\n".join(report_lines)+"\n",encoding="utf-8")
    print("FINAL_BUILD_SUMMARY "+json.dumps(summary),flush=True)


if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--out",default="cs2builder/artifacts")
    args=ap.parse_args()
    main(args.out)
