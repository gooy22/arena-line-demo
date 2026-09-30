from __future__ import annotations
import argparse, hashlib, json, time
from bisect import bisect_right
from collections import Counter, defaultdict, deque
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
from sklearn.metrics import accuracy_score, roc_auc_score, log_loss, brier_score_loss
from sklearn.model_selection import TimeSeriesSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBClassifier

from feature_engineering_v2 import build_features

CSAPI="https://api.csapi.de"

def deterministic_flip(x):
    return hashlib.sha1(str(int(x)).encode()).digest()[0] & 1

def orient_maps(df):
    m=df.copy()
    for i,r in m.iterrows():
        if deterministic_flip(r["mapstatsid"]):
            for a,b in [("team_a_id","team_b_id"),("team_a_name","team_b_name"),("team_a_score","team_b_score")]:
                m.at[i,a],m.at[i,b]=r[b],r[a]
    m["winner_team_id"]=np.where(m["team_a_score"]>m["team_b_score"],m["team_a_id"],m["team_b_id"]).astype(int)
    m["date"]=pd.to_datetime(m["date"]).dt.strftime("%Y-%m-%d")
    return m.sort_values(["date","mapstatsid"]).drop_duplicates("mapstatsid").reset_index(drop=True)

def fetch_player_snapshots(snapshot_dates,outdir):
    s=requests.Session();s.headers.update({"User-Agent":"cs2-final-v2/1.0","Accept":"application/json"})
    rows=[]; errors=[]
    for ix,sd in enumerate(sorted(set(snapshot_dates)),1):
        end=(pd.Timestamp(sd)-pd.Timedelta(days=1)).date()
        start=(pd.Timestamp(end)-pd.Timedelta(days=89)).date()
        off=0; got_date=0
        while True:
            try:
                r=s.get(CSAPI+"/players/stats",params={
                    "start_date":str(start),"end_date":str(end),"limit":100,"offset":off,"min_played":3,"sideid":0
                },timeout=40)
                r.raise_for_status(); page=r.json()
            except Exception as e:
                errors.append({"snapshot_date":str(end),"offset":off,"error":repr(e)})
                break
            if not page: break
            for x in page:
                k=float(x.get("k") or 0);d=float(x.get("d") or 0)
                rows.append({
                  "snapshot_date":str(end),"player_id":int(x["id"]),"player_name":x.get("name",""),
                  "maps":int(x.get("N") or 0),"rating":float(x["rating"]) if x.get("rating") is not None else np.nan,
                  "kd":k/max(1.0,d),"adr":float(x["adr"]) if x.get("adr") is not None else np.nan,
                  "kast":float(x["kast"]) if x.get("kast") is not None else np.nan,
                  "kpr":np.nan,"dpr":np.nan
                });got_date+=1
            if len(page)<100: break
            off+=100
            if off>10000: break
        print(f"PLAYER_SNAPSHOT {ix}/{len(set(snapshot_dates))} date={end} rows={got_date}",flush=True)
    df=pd.DataFrame(rows)
    if len(df):df=df.drop_duplicates(["snapshot_date","player_id"])
    else:df=pd.DataFrame(columns=["snapshot_date","player_id","player_name","maps","rating","kd","adr","kast","kpr","dpr"])
    Path(outdir,"player_snapshot_errors.json").write_text(json.dumps(errors,indent=2),encoding="utf-8")
    return df

def build_entity_aliases(rosters):
    r=rosters.copy();r=r[r["roster_hash"].notna() & r["team_id"].notna()].copy()
    if r.empty:return {},pd.DataFrame(columns=["roster_hash","canonical_team_id","team_ids","team_names"])
    r["snapshot_date"]=pd.to_datetime(r["snapshot_date"])
    mapping={};out=[]
    for h,g in r.groupby("roster_hash"):
        latest=g.sort_values("snapshot_date").iloc[-1]
        canon=int(latest["team_id"])
        tids=sorted(set(int(x) for x in g["team_id"]))
        mapping[h]=canon
        out.append({"roster_hash":h,"canonical_team_id":canon,"team_ids":";".join(map(str,tids)),
                    "team_names":";".join(sorted(set(g["team_name"].astype(str)))),
                    "cross_team_id":int(len(tids)>1)})
    return mapping,pd.DataFrame(out)

def enrich_entities(matches,rosters,hash_to_entity):
    rr=rosters.copy();rr=rr[rr["team_id"].notna()].copy()
    rr["team_id"]=rr["team_id"].astype(int);rr["snapshot_date"]=pd.to_datetime(rr["snapshot_date"]).dt.normalize()
    idx={}
    for tid,g in rr.sort_values("snapshot_date").groupby("team_id"):
        idx[int(tid)]=(g["snapshot_date"].tolist(),g.to_dict("records"))
    def one(tid,d):
        z=idx.get(int(tid))
        if not z:return None,int(tid)
        dates,rows=z;cut=pd.Timestamp(d).normalize()-pd.Timedelta(days=1)
        p=bisect_right(dates,cut)-1
        if p<0:return None,int(tid)
        h=rows[p].get("roster_hash")
        return h,hash_to_entity.get(h,int(tid)) if h else int(tid)
    ah=[];bh=[];ae=[];be=[]
    for r in matches.itertuples(index=False):
        x,y=one(r.team_a_id,r.date);u,v=one(r.team_b_id,r.date)
        ah.append(x);ae.append(y);bh.append(u);be.append(v)
    m=matches.copy();m["team_a_roster_hash_asof"]=ah;m["team_b_roster_hash_asof"]=bh
    m["team_a_entity_id"]=ae;m["team_b_entity_id"]=be
    return m

def make_team_map_snapshots(matches,window=30):
    hist=defaultdict(lambda:deque(maxlen=window));rows=[]
    m=matches.copy();m["date"]=pd.to_datetime(m["date"]).dt.normalize()
    for day,dg in m.sort_values(["date","mapstatsid"]).groupby("date"):
        # update after all maps that day; snapshot labelled day is only usable from next day
        for r in dg.itertuples(index=False):
            a=int(r.team_a_entity_id);b=int(r.team_b_entity_id);mp=str(r.map_name)
            y=int(r.winner_team_id==r.team_a_id)
            hist[(a,mp)].append(y);hist[(b,mp)].append(1-y)
        touched=set()
        for r in dg.itertuples(index=False):
            touched.add((int(r.team_a_entity_id),str(r.map_name)))
            touched.add((int(r.team_b_entity_id),str(r.map_name)))
        for tid,mp in touched:
            q=list(hist[(tid,mp)])
            rows.append({"snapshot_date":day.strftime("%Y-%m-%d"),"team_id":tid,"map":mp,
                         "played":len(q),"win_rate":float(np.mean(q)) if q else np.nan,
                         "ct_win_rate":np.nan,"t_win_rate":np.nan,"side_data_available":0})
    return pd.DataFrame(rows)

def build_coverage(matches,ranking,rosters,players):
    latest=ranking["snapshot_date"].max()
    top=ranking[ranking["snapshot_date"]==latest].sort_values("rank").head(150).copy()
    counts=Counter()
    for r in matches.itertuples(index=False):
        counts[int(r.team_a_id)]+=1;counts[int(r.team_b_id)]+=1
    rs=ranking[ranking["team_id"].notna()].groupby("team_id")["snapshot_date"].nunique().to_dict()
    ros=rosters[rosters["team_id"].notna() & rosters["roster_hash"].notna()].groupby("team_id")["snapshot_date"].nunique().to_dict()
    player_dates=set(players["snapshot_date"].astype(str)) if len(players) else set()
    out=[]
    for r in top.itertuples(index=False):
        tid=int(r.team_id) if not pd.isna(r.team_id) else None
        maps=counts.get(tid,0) if tid is not None else 0
        rsc=int(rs.get(tid,0)) if tid is not None else 0;roc=int(ros.get(tid,0)) if tid is not None else 0
        if maps>=40 and rsc>=3 and roc>=3:status="READY"
        elif maps>=12:status="PARTIAL"
        else:status="MISSING"
        out.append({"rank":int(r.rank),"points":float(r.points),"team_id":tid,"team_name":r.team_name,
                    "roster_hash":r.roster_hash,"maps":int(maps),"ranking_snapshots":rsc,"roster_snapshots":roc,
                    "ui_eligible":bool(maps>=12),"status":status})
    return pd.DataFrame(out)

def metrics(y,p,thr=.5):
    pred=(np.asarray(p)>=thr).astype(int)
    return {"accuracy":float(accuracy_score(y,pred)),
            "roc_auc":float(roc_auc_score(y,p)) if len(set(y))>1 else None,
            "log_loss":float(log_loss(y,p,labels=[0,1])),
            "brier":float(brier_score_loss(y,p)),"threshold":float(thr),"n":int(len(y))}

def train_models(features,outdir):
    meta={"date","mapstatsid","team_a_id","team_b_id","target"}
    feat=[c for c in features.columns if c not in meta]
    cats=["map_name"];nums=[c for c in feat if c not in cats]
    prep=ColumnTransformer([
      ("num",SimpleImputer(strategy="median",add_indicator=True,keep_empty_features=True),nums),
      ("cat",Pipeline([("imp",SimpleImputer(strategy="most_frequent")),
                       ("oh",OneHotEncoder(handle_unknown="ignore",sparse_output=False))]),cats)
    ])
    models={
      "random_forest":RandomForestClassifier(n_estimators=900,max_depth=18,min_samples_leaf=3,min_samples_split=6,
          max_features="sqrt",class_weight="balanced_subsample",random_state=42,n_jobs=-1),
      "xgboost":XGBClassifier(n_estimators=900,max_depth=5,learning_rate=.025,subsample=.88,colsample_bytree=.88,
          min_child_weight=4,reg_lambda=2.5,reg_alpha=.05,objective="binary:logistic",eval_metric="logloss",
          random_state=42,n_jobs=2)
    }
    df=features.sort_values(["date","mapstatsid"]).reset_index(drop=True)
    dates=np.array(sorted(df.date.unique()));cut=max(1,int(len(dates)*.8))
    tr=df[df.date.isin(set(dates[:cut]))];ho=df[df.date.isin(set(dates[cut:]))]
    td=np.array(sorted(tr.date.unique()));tss=TimeSeriesSplit(n_splits=5)
    reports={};thresholds={}
    for name,clf in models.items():
        yy=[];pp=[];folds=[]
        for fi,(ti,vi) in enumerate(tss.split(td),1):
            a=tr[tr.date.isin(set(td[ti]))];b=tr[tr.date.isin(set(td[vi]))]
            pipe=Pipeline([("prep",clone(prep)),("model",clone(clf))]);pipe.fit(a[feat],a.target.astype(int))
            p=pipe.predict_proba(b[feat])[:,1];q=metrics(b.target.astype(int).values,p,.5);folds.append(q)
            yy.extend(b.target.astype(int));pp.extend(p)
            print("MODEL_CV",name,fi,json.dumps(q),flush=True)
        yy=np.array(yy);pp=np.array(pp);best=.5;ba=-1
        for th in np.linspace(.40,.60,41):
            ac=accuracy_score(yy,(pp>=th).astype(int))
            if ac>ba:ba=ac;best=float(th)
        thresholds[name]=best
        reports[name]={"folds":folds,"pooled":metrics(yy,pp,best),
                       "accuracy_mean":float(np.mean([x["accuracy"] for x in folds])),
                       "auc_mean":float(np.mean([x["roc_auc"] for x in folds if x["roc_auc"] is not None]))}
    best=max(reports,key=lambda n:(reports[n]["pooled"]["accuracy"],-reports[n]["pooled"]["brier"]))
    ev=Pipeline([("prep",clone(prep)),("model",clone(models[best]))]);ev.fit(tr[feat],tr.target.astype(int))
    hp=ev.predict_proba(ho[feat])[:,1];hold=metrics(ho.target.astype(int).values,hp,thresholds[best])
    print("FINAL_HOLDOUT",json.dumps({"model":best,**hold}),flush=True)
    prod=Pipeline([("prep",clone(prep)),("model",clone(models[best]))]);prod.fit(df[feat],df.target.astype(int))
    joblib.dump({"model":prod,"threshold":thresholds[best],"feature_columns":feat,"categorical_columns":cats,
                 "model_name":best},Path(outdir)/"saved_model.joblib",compress=3)
    report={"selected_model":best,"samples_total":len(df),"train_samples":len(tr),"holdout_samples":len(ho),
            "train_date_min":tr.date.min(),"train_date_max":tr.date.max(),
            "holdout_date_min":ho.date.min(),"holdout_date_max":ho.date.max(),
            "models":reports,"holdout":hold,"feature_count":len(feat)}
    Path(outdir,"saved_model_metadata.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    return report

def main(raw,vrsdir,outdir):
    out=Path(outdir);out.mkdir(parents=True,exist_ok=True)
    maps=orient_maps(pd.read_csv(raw))
    ranking=pd.read_csv(Path(vrsdir)/"ranking_snapshots_vrs.csv")
    rosters=pd.read_csv(Path(vrsdir)/"roster_snapshots_vrs.csv")
    ranking=ranking[ranking.team_id.notna()].copy();ranking["team_id"]=ranking.team_id.astype(int)
    rosters=rosters[rosters.team_id.notna()].copy();rosters["team_id"]=rosters.team_id.astype(int)
    players=fetch_player_snapshots(rosters.snapshot_date.unique(),out)
    alias_map,aliases=build_entity_aliases(rosters)
    maps=enrich_entities(maps,rosters,alias_map)
    teammap=make_team_map_snapshots(maps)
    coverage=build_coverage(maps,ranking,rosters,players)
    features=build_features(maps,ranking,rosters,players,min_history=12)
    if len(features)<1000:raise RuntimeError(f"too_few_training_samples:{len(features)}")
    model=train_models(features,out)
    maps.to_csv(out/"matches.csv",index=False);ranking.to_csv(out/"ranking_snapshots.csv",index=False)
    rosters.to_csv(out/"roster_snapshots.csv",index=False);players.to_csv(out/"player_snapshots.csv",index=False)
    teammap.to_csv(out/"team_map_snapshots.csv",index=False);aliases.to_csv(out/"team_aliases.csv",index=False)
    coverage.to_csv(out/"coverage_top150.csv",index=False);features.to_csv(out/"training_features.csv",index=False)
    ui=coverage[coverage.ui_eligible].sort_values("rank")
    Path(out,"ui_teams.json").write_text(json.dumps(ui[["rank","team_id","team_name","maps","status"]].to_dict("records"),ensure_ascii=False,indent=2),encoding="utf-8")
    summary={"generated_at":datetime.utcnow().isoformat()+"Z","unique_map_rows":len(maps),"unique_teams":len(set(maps.team_a_id)|set(maps.team_b_id)),
             "date_min":maps.date.min(),"date_max":maps.date.max(),"training_samples":len(features),
             "ranking_snapshot_rows":len(ranking),"roster_snapshot_rows":len(rosters),"player_snapshot_rows":len(players),
             "team_map_snapshot_rows":len(teammap),"cross_id_roster_aliases":int(aliases.cross_team_id.sum()) if len(aliases) else 0,
             "top150_status":coverage.status.value_counts().to_dict(),"ui_eligible_12plus":int(coverage.ui_eligible.sum()),
             "model":model,"leakage_guard":"All external snapshots are selected with snapshot_date <= D-1. Same-day form/Elo/map state updates only after all maps on D are featurized.",
             "side_note":"HLTV results corpus has no side-round split; CT/T fields are null and side_data_available=0, never fabricated."}
    Path(out,"build_summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    print("FINAL_BUILD_SUMMARY",json.dumps(summary),flush=True)

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--raw",required=True);p.add_argument("--vrsdir",required=True);p.add_argument("--out",required=True)
    a=p.parse_args();main(a.raw,a.vrsdir,a.out)
