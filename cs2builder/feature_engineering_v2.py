from __future__ import annotations
from bisect import bisect_right
from collections import defaultdict, deque
import math
import numpy as np
import pandas as pd

def _idx(df, keys):
    out={}
    if df is None or df.empty:return out
    d=df.copy();d["snapshot_date"]=pd.to_datetime(d["snapshot_date"]).dt.normalize()
    for key,g in d.sort_values("snapshot_date").groupby(keys,dropna=False):
        if not isinstance(key,tuple):key=(key,)
        out[key]=(g["snapshot_date"].tolist(),g.to_dict("records"))
    return out

def _asof(idx,key,cutoff):
    if not isinstance(key,tuple):key=(key,)
    z=idx.get(key)
    if not z:return None
    dates,rows=z;p=bisect_right(dates,cutoff)-1
    return rows[p] if p>=0 else None

def _asof_hist(idx,key,cutoff,days=90):
    if not isinstance(key,tuple):key=(key,)
    z=idx.get(key)
    if not z:return []
    dates,rows=z;p=bisect_right(dates,cutoff);lo=cutoff-pd.Timedelta(days=days)
    return [r for d,r in zip(dates[:p],rows[:p]) if d>=lo]

def _player_features(roster,player_idx,cutoff):
    names=["rating","kd","adr","kast","kpr","dpr"]
    vals={k:[] for k in names}
    if not roster:return {f"player_{k}":np.nan for k in names}|{"player_coverage":0.0}
    ids=[int(x) for x in str(roster.get("player_ids","")).split(";") if x.strip().isdigit()]
    for pid in ids:
        r=_asof(player_idx,pid,cutoff)
        if not r:continue
        for k in names:
            v=r.get(k)
            if v is not None and not pd.isna(v):vals[k].append(float(v))
    out={f"player_{k}":float(np.mean(v)) if v else np.nan for k,v in vals.items()}
    out["player_coverage"]=len(vals["rating"])/max(1,len(ids))
    return out

def build_features(matches,ranking,rosters,players,min_history=12):
    m=matches.copy();m["date"]=pd.to_datetime(m["date"]).dt.normalize()
    m=m.sort_values(["date","mapstatsid"]).reset_index(drop=True)
    ri=_idx(ranking,["team_id"]); roi=_idx(rosters,["team_id"]); pi=_idx(players,["player_id"])
    recent=defaultdict(lambda:deque(maxlen=30));rdiff=defaultdict(lambda:deque(maxlen=30))
    map_recent=defaultdict(lambda:deque(maxlen=30));elo=defaultdict(lambda:1500.0);melo=defaultdict(lambda:1500.0)
    h2h=defaultdict(lambda:deque(maxlen=20));last={};n=defaultdict(int)
    rows=[]
    for day,dg in m.groupby("date",sort=True):
        cutoff=day-pd.Timedelta(days=1)
        for r in dg.itertuples(index=False):
            a0,b0=int(r.team_a_id),int(r.team_b_id)
            a=int(getattr(r,"team_a_entity_id",a0) or a0);b=int(getattr(r,"team_b_entity_id",b0) or b0)
            mp=str(r.map_name)
            ra=_asof(ri,a0,cutoff);rb=_asof(ri,b0,cutoff)
            roa=_asof(roi,a0,cutoff);rob=_asof(roi,b0,cutoff)
            pa=_player_features(roa,pi,cutoff);pb=_player_features(rob,pi,cutoff)
            wa=list(recent[a]);wb=list(recent[b]);ma=list(map_recent[(a,mp)]);mb=list(map_recent[(b,mp)])
            rda=list(rdiff[a]);rdb=list(rdiff[b])
            hk=tuple(sorted((a,b))); hh=list(h2h[hk])
            hwa=(np.mean(hh) if hh else .5) if hk[0]==a else (1-np.mean(hh) if hh else .5)
            ah=_asof_hist(roi,a0,cutoff);bh=_asof_hist(roi,b0,cutoff)
            ca=max(0,len({x.get("roster_hash") for x in ah if x.get("roster_hash")})-1)
            cb=max(0,len({x.get("roster_hash") for x in bh if x.get("roster_hash")})-1)
            da=(day-last[a]).days if a in last else np.nan; db=(day-last[b]).days if b in last else np.nan
            y=int(r.winner_team_id==a0)
            f={
              "date":day.strftime("%Y-%m-%d"),"mapstatsid":int(r.mapstatsid),"map_name":mp,
              "team_a_id":a0,"team_b_id":b0,"target":y,
              "rank_a":ra.get("rank") if ra else np.nan,"rank_b":rb.get("rank") if rb else np.nan,
              "rank_diff":(ra.get("rank")-rb.get("rank")) if ra and rb else np.nan,
              "points_a":ra.get("points") if ra else np.nan,"points_b":rb.get("points") if rb else np.nan,
              "points_diff":(ra.get("points")-rb.get("points")) if ra and rb else np.nan,
              "ranking_available_a":float(ra is not None),"ranking_available_b":float(rb is not None),
              "recent_matches_a":len(wa),"recent_matches_b":len(wb),
              "recent_wr_a":float(np.mean(wa)) if wa else .5,"recent_wr_b":float(np.mean(wb)) if wb else .5,
              "recent_wr_diff":(float(np.mean(wa)) if wa else .5)-(float(np.mean(wb)) if wb else .5),
              "recent_round_diff_a":float(np.mean(rda)) if rda else 0.0,
              "recent_round_diff_b":float(np.mean(rdb)) if rdb else 0.0,
              "recent_round_diff_delta":(float(np.mean(rda)) if rda else 0.0)-(float(np.mean(rdb)) if rdb else 0.0),
              "map_played_a":len(ma),"map_played_b":len(mb),
              "map_wr_a":float(np.mean(ma)) if ma else .5,"map_wr_b":float(np.mean(mb)) if mb else .5,
              "map_wr_diff":(float(np.mean(ma)) if ma else .5)-(float(np.mean(mb)) if mb else .5),
              "elo_a":elo[a],"elo_b":elo[b],"elo_diff":elo[a]-elo[b],
              "map_elo_a":melo[(a,mp)],"map_elo_b":melo[(b,mp)],"map_elo_diff":melo[(a,mp)]-melo[(b,mp)],
              "h2h_wr_a":float(hwa),"days_since_a":da,"days_since_b":db,
              "days_since_diff":(da-db) if not pd.isna(da) and not pd.isna(db) else np.nan,
              "lineup_changes_90d_a":ca,"lineup_changes_90d_b":cb,
              "roster_available_a":float(roa is not None and bool(roa.get("roster_hash"))),
              "roster_available_b":float(rob is not None and bool(rob.get("roster_hash"))),
              "history_n_a":n[a],"history_n_b":n[b],
            }
            for k,v in pa.items():f[k+"_a"]=v
            for k,v in pb.items():f[k+"_b"]=v
            for k in ["rating","kd","adr","kast","kpr","dpr"]:
                va=f.get("player_"+k+"_a",np.nan);vb=f.get("player_"+k+"_b",np.nan)
                f["player_"+k+"_diff"]=va-vb if not pd.isna(va) and not pd.isna(vb) else np.nan
            if n[a]>=min_history and n[b]>=min_history:rows.append(f)
        # critical leakage guard: all same-day maps are updated only after all features on D are built
        for r in dg.itertuples(index=False):
            a0,b0=int(r.team_a_id),int(r.team_b_id)
            a=int(getattr(r,"team_a_entity_id",a0) or a0);b=int(getattr(r,"team_b_entity_id",b0) or b0)
            mp=str(r.map_name); y=int(r.winner_team_id==a0)
            recent[a].append(y);recent[b].append(1-y);map_recent[(a,mp)].append(y);map_recent[(b,mp)].append(1-y)
            sd=float(r.team_a_score-r.team_b_score);rdiff[a].append(sd);rdiff[b].append(-sd)
            n[a]+=1;n[b]+=1;last[a]=day;last[b]=day
            ea,eb=elo[a],elo[b];p=1/(1+10**((eb-ea)/400));k=24
            elo[a]=ea+k*(y-p);elo[b]=eb+k*((1-y)-(1-p))
            xa,xb=melo[(a,mp)],melo[(b,mp)];pm=1/(1+10**((xb-xa)/400));mk=28
            melo[(a,mp)]=xa+mk*(y-pm);melo[(b,mp)]=xb+mk*((1-y)-(1-pm))
            hk=tuple(sorted((a,b)));h2h[hk].append(y if hk[0]==a else 1-y)
    return pd.DataFrame(rows)
