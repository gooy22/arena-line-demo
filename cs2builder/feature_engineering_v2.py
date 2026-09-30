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
    names=["rating","kd","adr","kast","kpr","dpr","maps"]
    vals={k:[] for k in names}
    snapshot_ages=[]
    empty={f"player_{k}":np.nan for k in names}
    for k in ["rating","kd","adr","maps"]:
        empty |= {f"player_{k}_min":np.nan,f"player_{k}_max":np.nan,f"player_{k}_std":np.nan}
    empty |= {"player_rating_top2":np.nan,"player_rating_bottom2":np.nan,
              "player_rating_spread":np.nan,"player_snapshot_age_mean":np.nan,
              "player_snapshot_age_max":np.nan,"player_coverage":0.0}
    if not roster:return empty
    ids=[int(x) for x in str(roster.get("player_ids","")).split(";") if x.strip().isdigit()]
    for pid in ids:
        r=_asof(player_idx,pid,cutoff)
        if not r:continue
        if r.get("snapshot_date") is not None:
            snapshot_ages.append(max(0,(cutoff-pd.Timestamp(r["snapshot_date"]).normalize()).days))
        for k in names:
            v=r.get(k)
            if v is not None and not pd.isna(v):vals[k].append(float(v))
    out={f"player_{k}":float(np.mean(v)) if v else np.nan for k,v in vals.items()}
    for k in ["rating","kd","adr","maps"]:
        arr=np.asarray(vals[k],dtype=float)
        out[f"player_{k}_min"]=float(np.min(arr)) if len(arr) else np.nan
        out[f"player_{k}_max"]=float(np.max(arr)) if len(arr) else np.nan
        out[f"player_{k}_std"]=float(np.std(arr)) if len(arr) else np.nan
    rs=sorted(vals["rating"],reverse=True)
    out["player_rating_top2"]=float(np.mean(rs[:2])) if rs else np.nan
    out["player_rating_bottom2"]=float(np.mean(rs[-2:])) if rs else np.nan
    out["player_rating_spread"]=(float(rs[0]-rs[-1]) if len(rs)>=2 else 0.0 if len(rs)==1 else np.nan)
    out["player_snapshot_age_mean"]=float(np.mean(snapshot_ages)) if snapshot_ages else np.nan
    out["player_snapshot_age_max"]=float(np.max(snapshot_ages)) if snapshot_ages else np.nan
    out["player_coverage"]=len(vals["rating"])/max(1,len(ids))
    return out

def build_features(matches,ranking,rosters,players,min_history=12):
    m=matches.copy();m["date"]=pd.to_datetime(m["date"]).dt.normalize()
    m=m.sort_values(["date","mapstatsid"]).reset_index(drop=True)
    # Build deterministic active-roster snapshots and a strict (team_id, roster_hash)
    # ranking index. Valve VRS can carry several roster variants for one org/team_id.
    rw=rosters.copy()
    rw["snapshot_date"]=pd.to_datetime(rw["snapshot_date"]).dt.normalize()
    rw["_has_hash"]=rw["roster_hash"].notna().astype(int)
    good_rw=rw[rw["roster_hash"].notna()].copy()
    if len(good_rw):
        first=(good_rw.groupby(["team_id","roster_hash"],dropna=False)["snapshot_date"]
               .min().rename("_variant_first_seen").reset_index())
        rw=rw.merge(first,on=["team_id","roster_hash"],how="left")
    else:
        rw["_variant_first_seen"]=pd.NaT
    rw["_variant_first_seen"]=rw["_variant_first_seen"].fillna(pd.Timestamp("1900-01-01"))
    if "players_resolved" not in rw.columns: rw["players_resolved"]=0
    active_rosters=(rw.sort_values(
        ["snapshot_date","team_id","_has_hash","_variant_first_seen","players_resolved"],
        ascending=[True,True,False,False,False])
        .drop_duplicates(["snapshot_date","team_id"],keep="first"))
    roi=_idx(active_rosters,["team_id"])

    rk=ranking.copy()
    rk["snapshot_date"]=pd.to_datetime(rk["snapshot_date"]).dt.normalize()
    rk_team=(rk.sort_values(["snapshot_date","team_id","points","rank"],
                            ascending=[True,True,False,True])
             .drop_duplicates(["snapshot_date","team_id"],keep="first"))
    ri=_idx(rk_team,["team_id"])
    riv=_idx(rk[rk["roster_hash"].notna()],["team_id","roster_hash"])
    pi=_idx(players,["player_id"])
    recent=defaultdict(lambda:deque(maxlen=30));rdiff=defaultdict(lambda:deque(maxlen=30))
    map_recent=defaultdict(lambda:deque(maxlen=30));elo=defaultdict(lambda:1500.0);melo=defaultdict(lambda:1500.0)
    h2h=defaultdict(lambda:deque(maxlen=20));last={};n=defaultdict(int)
    opp_elo=defaultdict(lambda:deque(maxlen=30))
    opp_vrs=defaultdict(lambda:deque(maxlen=30))
    elo_resid=defaultdict(lambda:deque(maxlen=30))
    vrs_resid=defaultdict(lambda:deque(maxlen=30))
    roster_recent=defaultdict(lambda:deque(maxlen=30))
    roster_margin=defaultdict(lambda:deque(maxlen=30))
    roster_map_recent=defaultdict(lambda:deque(maxlen=30))
    roster_elo=defaultdict(lambda:1500.0)
    roster_map_elo=defaultdict(lambda:1500.0)
    roster_n=defaultdict(int); roster_last={}; roster_first={}
    rows=[]
    for day,dg in m.groupby("date",sort=True):
        cutoff=day-pd.Timedelta(days=1)
        day_meta={}
        for r in dg.itertuples(index=False):
            a0,b0=int(r.team_a_id),int(r.team_b_id)
            a=int(getattr(r,"team_a_entity_id",a0) or a0);b=int(getattr(r,"team_b_entity_id",b0) or b0)
            mp=str(r.map_name)
            roa=_asof(roi,a0,cutoff);rob=_asof(roi,b0,cutoff)
            ha=roa.get("roster_hash") if roa and roa.get("roster_hash") and not pd.isna(roa.get("roster_hash")) else None
            hb=rob.get("roster_hash") if rob and rob.get("roster_hash") and not pd.isna(rob.get("roster_hash")) else None
            rav=_asof(riv,(a0,ha),cutoff) if ha else None
            rbv=_asof(riv,(b0,hb),cutoff) if hb else None
            ra=rav or _asof(ri,a0,cutoff);rb=rbv or _asof(ri,b0,cutoff)
            rka=("roster",str(ha)) if ha else ("entity",a)
            rkb=("roster",str(hb)) if hb else ("entity",b)
            pa=_player_features(roa,pi,cutoff);pb=_player_features(rob,pi,cutoff)
            wa=list(recent[a]);wb=list(recent[b]);ma=list(map_recent[(a,mp)]);mb=list(map_recent[(b,mp)])
            rda=list(rdiff[a]);rdb=list(rdiff[b])
            rwa=list(roster_recent[rka]);rwb=list(roster_recent[rkb])
            rma2=list(roster_map_recent[(rka,mp)]);rmb2=list(roster_map_recent[(rkb,mp)])
            rmga=list(roster_margin[rka]);rmgb=list(roster_margin[rkb])
            def wr_last(q,k):
                z=q[-k:] if q else []
                return float(np.mean(z)) if z else .5
            def avg_last(q,k):
                z=q[-k:] if q else []
                return float(np.mean(z)) if z else 0.0
            def snap_num(row,key):
                if not row:return np.nan
                v=row.get(key)
                return float(v) if v is not None and not pd.isna(v) else np.nan
            hk=tuple(sorted((a,b))); hh=list(h2h[hk])
            hwa=(np.mean(hh) if hh else .5) if hk[0]==a else (1-np.mean(hh) if hh else .5)
            ah=_asof_hist(roi,a0,cutoff);bh=_asof_hist(roi,b0,cutoff)
            ca=max(0,len({x.get("roster_hash") for x in ah if x.get("roster_hash")})-1)
            cb=max(0,len({x.get("roster_hash") for x in bh if x.get("roster_hash")})-1)
            da=(day-last[a]).days if a in last else np.nan; db=(day-last[b]).days if b in last else np.nan
            y=int(r.winner_team_id==a0)
            elo_pa=1/(1+10**((elo[b]-elo[a])/400))
            vrs_pa=(1.0/(1.0+np.exp(-float((ra.get("points")-rb.get("points")))/260.0))) if ra and rb else .5
            roster_elo_pa=1/(1+10**((roster_elo[rkb]-roster_elo[rka])/400))
            roster_map_elo_pa=1/(1+10**((roster_map_elo[(rkb,mp)]-roster_map_elo[(rka,mp)])/400))
            roster_days_a=(day-roster_last[rka]).days if rka in roster_last else np.nan
            roster_days_b=(day-roster_last[rkb]).days if rkb in roster_last else np.nan
            roster_age_a=(day-roster_first[rka]).days if rka in roster_first else 0
            roster_age_b=(day-roster_first[rkb]).days if rkb in roster_first else 0
            rank_snapshot_age_a=(day-pd.Timestamp(ra["snapshot_date"]).normalize()).days if ra else np.nan
            rank_snapshot_age_b=(day-pd.Timestamp(rb["snapshot_date"]).normalize()).days if rb else np.nan
            roster_snapshot_age_a=(day-pd.Timestamp(roa["snapshot_date"]).normalize()).days if roa else np.nan
            roster_snapshot_age_b=(day-pd.Timestamp(rob["snapshot_date"]).normalize()).days if rob else np.nan
            oea=list(opp_elo[a]);oeb=list(opp_elo[b])
            ova=list(opp_vrs[a]);ovb=list(opp_vrs[b])
            era=list(elo_resid[a]);erb=list(elo_resid[b])
            vra=list(vrs_resid[a]);vrb=list(vrs_resid[b])
            day_meta[int(r.mapstatsid)]={
                "a":a,"b":b,"a0":a0,"b0":b0,"y":y,
                "elo_pa":elo_pa,"vrs_pa":vrs_pa,
                "elo_a":float(elo[a]),"elo_b":float(elo[b]),
                "points_a":float(ra.get("points")) if ra else np.nan,
                "points_b":float(rb.get("points")) if rb else np.nan,
            }
            f={
              "date":day.strftime("%Y-%m-%d"),"mapstatsid":int(r.mapstatsid),"map_name":mp,
              "team_a_id":a0,"team_b_id":b0,"target":y,
              "rank_a":ra.get("rank") if ra else np.nan,"rank_b":rb.get("rank") if rb else np.nan,
              "rank_diff":(ra.get("rank")-rb.get("rank")) if ra and rb else np.nan,
              "points_a":ra.get("points") if ra else np.nan,"points_b":rb.get("points") if rb else np.nan,
              "points_diff":(ra.get("points")-rb.get("points")) if ra and rb else np.nan,
              "ranking_available_a":float(ra is not None),"ranking_available_b":float(rb is not None),
              "ranking_variant_match_a":float(rav is not None),"ranking_variant_match_b":float(rbv is not None),
              "rank_snapshot_age_a":rank_snapshot_age_a,"rank_snapshot_age_b":rank_snapshot_age_b,
              "rank_snapshot_age_diff":(rank_snapshot_age_a-rank_snapshot_age_b) if not pd.isna(rank_snapshot_age_a) and not pd.isna(rank_snapshot_age_b) else np.nan,
              "roster_snapshot_age_a":roster_snapshot_age_a,"roster_snapshot_age_b":roster_snapshot_age_b,
              "points_log_ratio":(np.log1p(float(ra.get("points")))-np.log1p(float(rb.get("points")))) if ra and rb else np.nan,
              "starting_rank_value_a":snap_num(ra,"starting_rank_value"),"starting_rank_value_b":snap_num(rb,"starting_rank_value"),
              "starting_rank_value_diff":(snap_num(ra,"starting_rank_value")-snap_num(rb,"starting_rank_value")) if not pd.isna(snap_num(ra,"starting_rank_value")) and not pd.isna(snap_num(rb,"starting_rank_value")) else np.nan,
              "h2h_adjustment_a":snap_num(ra,"h2h_adjustment"),"h2h_adjustment_b":snap_num(rb,"h2h_adjustment"),
              "h2h_adjustment_diff":(snap_num(ra,"h2h_adjustment")-snap_num(rb,"h2h_adjustment")) if not pd.isna(snap_num(ra,"h2h_adjustment")) and not pd.isna(snap_num(rb,"h2h_adjustment")) else np.nan,
              "bounty_offered_a":snap_num(ra,"bounty_offered"),"bounty_offered_b":snap_num(rb,"bounty_offered"),
              "bounty_offered_diff":(snap_num(ra,"bounty_offered")-snap_num(rb,"bounty_offered")) if not pd.isna(snap_num(ra,"bounty_offered")) and not pd.isna(snap_num(rb,"bounty_offered")) else np.nan,
              "bounty_collected_a":snap_num(ra,"bounty_collected"),"bounty_collected_b":snap_num(rb,"bounty_collected"),
              "bounty_collected_diff":(snap_num(ra,"bounty_collected")-snap_num(rb,"bounty_collected")) if not pd.isna(snap_num(ra,"bounty_collected")) and not pd.isna(snap_num(rb,"bounty_collected")) else np.nan,
              "opponent_network_a":snap_num(ra,"opponent_network"),"opponent_network_b":snap_num(rb,"opponent_network"),
              "opponent_network_diff":(snap_num(ra,"opponent_network")-snap_num(rb,"opponent_network")) if not pd.isna(snap_num(ra,"opponent_network")) and not pd.isna(snap_num(rb,"opponent_network")) else np.nan,
              "lan_wins_a":snap_num(ra,"lan_wins"),"lan_wins_b":snap_num(rb,"lan_wins"),
              "lan_wins_diff":(snap_num(ra,"lan_wins")-snap_num(rb,"lan_wins")) if not pd.isna(snap_num(ra,"lan_wins")) and not pd.isna(snap_num(rb,"lan_wins")) else np.nan,
              "vrs_matches_played_a":snap_num(ra,"vrs_matches_played"),"vrs_matches_played_b":snap_num(rb,"vrs_matches_played"),
              "vrs_matches_played_diff":(snap_num(ra,"vrs_matches_played")-snap_num(rb,"vrs_matches_played")) if not pd.isna(snap_num(ra,"vrs_matches_played")) and not pd.isna(snap_num(rb,"vrs_matches_played")) else np.nan,
              "rank_log_diff":(np.log1p(float(rb.get("rank")))-np.log1p(float(ra.get("rank")))) if ra and rb else np.nan,
              "recent_matches_a":len(wa),"recent_matches_b":len(wb),
              "recent_wr_a":float(np.mean(wa)) if wa else .5,"recent_wr_b":float(np.mean(wb)) if wb else .5,
              "recent_wr_diff":(float(np.mean(wa)) if wa else .5)-(float(np.mean(wb)) if wb else .5),
              "recent_wr_5_a":wr_last(wa,5),"recent_wr_5_b":wr_last(wb,5),"recent_wr_5_diff":wr_last(wa,5)-wr_last(wb,5),
              "recent_wr_10_a":wr_last(wa,10),"recent_wr_10_b":wr_last(wb,10),"recent_wr_10_diff":wr_last(wa,10)-wr_last(wb,10),
              "recent_wr_20_a":wr_last(wa,20),"recent_wr_20_b":wr_last(wb,20),"recent_wr_20_diff":wr_last(wa,20)-wr_last(wb,20),
              "recent_round_diff_a":float(np.mean(rda)) if rda else 0.0,
              "recent_round_diff_b":float(np.mean(rdb)) if rdb else 0.0,
              "recent_round_diff_delta":(float(np.mean(rda)) if rda else 0.0)-(float(np.mean(rdb)) if rdb else 0.0),
              "margin_5_a":avg_last(rda,5),"margin_5_b":avg_last(rdb,5),"margin_5_diff":avg_last(rda,5)-avg_last(rdb,5),
              "margin_10_a":avg_last(rda,10),"margin_10_b":avg_last(rdb,10),"margin_10_diff":avg_last(rda,10)-avg_last(rdb,10),
              "margin_20_a":avg_last(rda,20),"margin_20_b":avg_last(rdb,20),"margin_20_diff":avg_last(rda,20)-avg_last(rdb,20),
              "map_played_a":len(ma),"map_played_b":len(mb),
              "map_wr_a":float(np.mean(ma)) if ma else .5,"map_wr_b":float(np.mean(mb)) if mb else .5,
              "map_wr_diff":(float(np.mean(ma)) if ma else .5)-(float(np.mean(mb)) if mb else .5),
              "map_wr_5_a":wr_last(ma,5),"map_wr_5_b":wr_last(mb,5),"map_wr_5_diff":wr_last(ma,5)-wr_last(mb,5),
              "map_wr_10_a":wr_last(ma,10),"map_wr_10_b":wr_last(mb,10),"map_wr_10_diff":wr_last(ma,10)-wr_last(mb,10),
              "map_wr_20_a":wr_last(ma,20),"map_wr_20_b":wr_last(mb,20),"map_wr_20_diff":wr_last(ma,20)-wr_last(mb,20),
              "elo_a":elo[a],"elo_b":elo[b],"elo_diff":elo[a]-elo[b],
              "elo_prob_a":elo_pa,
              "opp_elo_5_a":avg_last(oea,5),"opp_elo_5_b":avg_last(oeb,5),"opp_elo_5_diff":avg_last(oea,5)-avg_last(oeb,5),
              "opp_elo_10_a":avg_last(oea,10),"opp_elo_10_b":avg_last(oeb,10),"opp_elo_10_diff":avg_last(oea,10)-avg_last(oeb,10),
              "opp_elo_20_a":avg_last(oea,20),"opp_elo_20_b":avg_last(oeb,20),"opp_elo_20_diff":avg_last(oea,20)-avg_last(oeb,20),
              "elo_resid_5_a":avg_last(era,5),"elo_resid_5_b":avg_last(erb,5),"elo_resid_5_diff":avg_last(era,5)-avg_last(erb,5),
              "elo_resid_10_a":avg_last(era,10),"elo_resid_10_b":avg_last(erb,10),"elo_resid_10_diff":avg_last(era,10)-avg_last(erb,10),
              "elo_resid_20_a":avg_last(era,20),"elo_resid_20_b":avg_last(erb,20),"elo_resid_20_diff":avg_last(era,20)-avg_last(erb,20),
              "map_elo_a":melo[(a,mp)],"map_elo_b":melo[(b,mp)],"map_elo_diff":melo[(a,mp)]-melo[(b,mp)],
              "map_elo_prob_a":1/(1+10**((melo[(b,mp)]-melo[(a,mp)])/400)),
              "vrs_prob_a":vrs_pa,
              "opp_vrs_5_a":avg_last(ova,5),"opp_vrs_5_b":avg_last(ovb,5),"opp_vrs_5_diff":avg_last(ova,5)-avg_last(ovb,5),
              "opp_vrs_10_a":avg_last(ova,10),"opp_vrs_10_b":avg_last(ovb,10),"opp_vrs_10_diff":avg_last(ova,10)-avg_last(ovb,10),
              "opp_vrs_20_a":avg_last(ova,20),"opp_vrs_20_b":avg_last(ovb,20),"opp_vrs_20_diff":avg_last(ova,20)-avg_last(ovb,20),
              "vrs_resid_5_a":avg_last(vra,5),"vrs_resid_5_b":avg_last(vrb,5),"vrs_resid_5_diff":avg_last(vra,5)-avg_last(vrb,5),
              "vrs_resid_10_a":avg_last(vra,10),"vrs_resid_10_b":avg_last(vrb,10),"vrs_resid_10_diff":avg_last(vra,10)-avg_last(vrb,10),
              "vrs_resid_20_a":avg_last(vra,20),"vrs_resid_20_b":avg_last(vrb,20),"vrs_resid_20_diff":avg_last(vra,20)-avg_last(vrb,20),
              "rank_strength_diff":((1.0/max(1,float(ra.get("rank"))))-(1.0/max(1,float(rb.get("rank"))))) if ra and rb else 0.0,
              "h2h_wr_a":float(hwa),"days_since_a":da,"days_since_b":db,
              "days_since_diff":(da-db) if not pd.isna(da) and not pd.isna(db) else np.nan,
              "lineup_changes_90d_a":ca,"lineup_changes_90d_b":cb,
              "roster_available_a":float(roa is not None and bool(roa.get("roster_hash"))),
              "roster_available_b":float(rob is not None and bool(rob.get("roster_hash"))),
              "history_n_a":n[a],"history_n_b":n[b],
              "roster_history_n_a":roster_n[rka],"roster_history_n_b":roster_n[rkb],
              "roster_recent_wr_a":float(np.mean(rwa)) if rwa else .5,
              "roster_recent_wr_b":float(np.mean(rwb)) if rwb else .5,
              "roster_recent_wr_diff":(float(np.mean(rwa)) if rwa else .5)-(float(np.mean(rwb)) if rwb else .5),
              "roster_wr_5_a":wr_last(rwa,5),"roster_wr_5_b":wr_last(rwb,5),"roster_wr_5_diff":wr_last(rwa,5)-wr_last(rwb,5),
              "roster_wr_10_a":wr_last(rwa,10),"roster_wr_10_b":wr_last(rwb,10),"roster_wr_10_diff":wr_last(rwa,10)-wr_last(rwb,10),
              "roster_map_played_a":len(rma2),"roster_map_played_b":len(rmb2),
              "roster_map_wr_a":float(np.mean(rma2)) if rma2 else .5,
              "roster_map_wr_b":float(np.mean(rmb2)) if rmb2 else .5,
              "roster_map_wr_diff":(float(np.mean(rma2)) if rma2 else .5)-(float(np.mean(rmb2)) if rmb2 else .5),
              "roster_margin_a":float(np.mean(rmga)) if rmga else 0.0,
              "roster_margin_b":float(np.mean(rmgb)) if rmgb else 0.0,
              "roster_margin_diff":(float(np.mean(rmga)) if rmga else 0.0)-(float(np.mean(rmgb)) if rmgb else 0.0),
              "roster_elo_a":roster_elo[rka],"roster_elo_b":roster_elo[rkb],"roster_elo_diff":roster_elo[rka]-roster_elo[rkb],
              "roster_elo_prob_a":roster_elo_pa,
              "roster_map_elo_a":roster_map_elo[(rka,mp)],"roster_map_elo_b":roster_map_elo[(rkb,mp)],
              "roster_map_elo_diff":roster_map_elo[(rka,mp)]-roster_map_elo[(rkb,mp)],
              "roster_map_elo_prob_a":roster_map_elo_pa,
              "roster_vrs_blend_a":0.5*roster_elo_pa+0.5*vrs_pa,
              "roster_days_since_a":roster_days_a,"roster_days_since_b":roster_days_b,
              "roster_age_days_a":roster_age_a,"roster_age_days_b":roster_age_b,
            }
            for k,v in pa.items():f[k+"_a"]=v
            for k,v in pb.items():f[k+"_b"]=v
            for k in ["rating","kd","adr","kast","kpr","dpr","maps",
                      "rating_min","rating_max","rating_std","rating_top2","rating_bottom2","rating_spread",
                      "kd_min","kd_max","kd_std","adr_min","adr_max","adr_std",
                      "maps_min","maps_max","maps_std","snapshot_age_mean","snapshot_age_max"]:
                va=f.get("player_"+k+"_a",np.nan);vb=f.get("player_"+k+"_b",np.nan)
                f["player_"+k+"_diff"]=va-vb if not pd.isna(va) and not pd.isna(vb) else np.nan
            if n[a]>=min_history and n[b]>=min_history:rows.append(f)
        # critical leakage guard: all same-day maps are updated only after all features on D are built
        for r in dg.itertuples(index=False):
            a0,b0=int(r.team_a_id),int(r.team_b_id)
            a=int(getattr(r,"team_a_entity_id",a0) or a0);b=int(getattr(r,"team_b_entity_id",b0) or b0)
            mp=str(r.map_name); y=int(r.winner_team_id==a0)
            meta=day_meta[int(r.mapstatsid)]
            opp_elo[a].append(meta["elo_b"]);opp_elo[b].append(meta["elo_a"])
            elo_resid[a].append(float(y)-meta["elo_pa"]);elo_resid[b].append(float(1-y)-(1-meta["elo_pa"]))
            if not pd.isna(meta["points_b"]): opp_vrs[a].append(meta["points_b"])
            if not pd.isna(meta["points_a"]): opp_vrs[b].append(meta["points_a"])
            if not pd.isna(meta["points_a"]) and not pd.isna(meta["points_b"]):
                vrs_resid[a].append(float(y)-meta["vrs_pa"]);vrs_resid[b].append(float(1-y)-(1-meta["vrs_pa"]))
            recent[a].append(y);recent[b].append(1-y);map_recent[(a,mp)].append(y);map_recent[(b,mp)].append(1-y)
            sd=float(r.team_a_score-r.team_b_score);rdiff[a].append(sd);rdiff[b].append(-sd)
            n[a]+=1;n[b]+=1;last[a]=day;last[b]=day
            ea,eb=elo[a],elo[b];p=1/(1+10**((eb-ea)/400));k=24
            elo[a]=ea+k*(y-p);elo[b]=eb+k*((1-y)-(1-p))
            xa,xb=melo[(a,mp)],melo[(b,mp)];pm=1/(1+10**((xb-xa)/400));mk=28
            melo[(a,mp)]=xa+mk*(y-pm);melo[(b,mp)]=xb+mk*((1-y)-(1-pm))
            hk=tuple(sorted((a,b)));h2h[hk].append(y if hk[0]==a else 1-y)

            uroa=_asof(roi,a0,cutoff);urob=_asof(roi,b0,cutoff)
            uha=uroa.get("roster_hash") if uroa and uroa.get("roster_hash") and not pd.isna(uroa.get("roster_hash")) else None
            uhb=urob.get("roster_hash") if urob and urob.get("roster_hash") and not pd.isna(urob.get("roster_hash")) else None
            urka=("roster",str(uha)) if uha else ("entity",a)
            urkb=("roster",str(uhb)) if uhb else ("entity",b)
            if urka not in roster_first:roster_first[urka]=day
            if urkb not in roster_first:roster_first[urkb]=day
            roster_recent[urka].append(y);roster_recent[urkb].append(1-y)
            roster_margin[urka].append(sd);roster_margin[urkb].append(-sd)
            roster_map_recent[(urka,mp)].append(y);roster_map_recent[(urkb,mp)].append(1-y)
            roster_n[urka]+=1;roster_n[urkb]+=1;roster_last[urka]=day;roster_last[urkb]=day
            rea,reb=roster_elo[urka],roster_elo[urkb]
            rp=1/(1+10**((reb-rea)/400));rk=28
            roster_elo[urka]=rea+rk*(y-rp);roster_elo[urkb]=reb+rk*((1-y)-(1-rp))
            rmea,rmeb=roster_map_elo[(urka,mp)],roster_map_elo[(urkb,mp)]
            rmp=1/(1+10**((rmeb-rmea)/400));rmk=30
            roster_map_elo[(urka,mp)]=rmea+rmk*(y-rmp)
            roster_map_elo[(urkb,mp)]=rmeb+rmk*((1-y)-(1-rmp))
    return pd.DataFrame(rows)
