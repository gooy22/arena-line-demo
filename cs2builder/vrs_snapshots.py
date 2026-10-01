from __future__ import annotations
import argparse, csv, hashlib, io, json, re, unicodedata
from collections import defaultdict, Counter
from pathlib import Path

import pandas as pd
import requests

CSAPI="https://api.csapi.de"
ROW_RE=re.compile(r"^\|\s*(\d+)\s*\|\s*([0-9.]+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|")
DATE_RE=re.compile(r"standings_global_(\d{4})_(\d{2})_(\d{2})\.md$")

def norm(s):
    s=unicodedata.normalize("NFKD",str(s)).encode("ascii","ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+","",s)

def fetch_all_players():
    s=requests.Session();s.headers["User-Agent"]="cs2-vrs-builder/1.0"
    rows=[]; off=0
    while True:
        r=s.get(f"{CSAPI}/players/",params={"limit":100,"offset":off},timeout=30)
        r.raise_for_status(); page=r.json()
        if not page: break
        rows.extend(page)
        print(f"PLAYER_DIRECTORY offset={off} got={len(page)} total={len(rows)}",flush=True)
        if len(page)<100: break
        off+=100
        if off>20000: break
    by=defaultdict(list)
    for x in rows: by[norm(x["name"])].append((int(x["id"]),x["name"]))

    # Identity-only fallback from a public HLTV-derived player directory.
    # Player IDs are stable identifiers; no performance values are consumed here.
    fallback_added=0
    try:
        u="https://raw.githubusercontent.com/StrandedPond/hltv_scraper/main/hltv_cs2_player_stats_scrapling.csv"
        rr=s.get(u,timeout=30);rr.raise_for_status()
        for x in csv.DictReader(io.StringIO(rr.text)):
            name=(x.get("Player") or "").strip(); url=x.get("Profile URL") or ""
            mm=re.search(r"/stats/players/(\d+)/",url)
            key=norm(name)
            if not key or not mm or key in by:
                continue
            pid=int(mm.group(1))
            by[key].append((pid,name));fallback_added+=1
        print(f"PLAYER_DIRECTORY_FALLBACK added={fallback_added} total_names={len(by)}",flush=True)
    except Exception as e:
        print(f"PLAYER_DIRECTORY_FALLBACK_ERROR {e!r}",flush=True)
    return rows,by

def roster_hash(ids):
    ids=sorted(set(int(x) for x in ids))
    if len(ids)!=5: return None
    return hashlib.sha1(";".join(map(str,ids)).encode()).hexdigest()[:20]

def parse_vrs_detail(path):
    out={
      "starting_rank_value":None,"h2h_adjustment":None,
      "bounty_offered":None,"bounty_collected":None,
      "opponent_network":None,"lan_wins":None,"vrs_matches_played":None,
    }
    if path is None or not Path(path).exists(): return out
    text=Path(path).read_text(encoding="utf-8")
    pats={
      "starting_rank_value":r"Starting Rank Value \(([+-]?[0-9.]+)\)",
      "h2h_adjustment":r"Head To Head Adjustments \(([+-]?[0-9.]+)\)",
      "bounty_offered":r"- Bounty Offered:\s*([0-9.]+)",
      "bounty_collected":r"- Bounty Collected:\s*([0-9.]+)",
      "opponent_network":r"- Opponent Network:\s*([0-9.]+)",
      "lan_wins":r"- LAN Wins:\s*([0-9.]+)",
    }
    for k,pat in pats.items():
        m=re.search(pat,text)
        if m:
            try: out[k]=float(m.group(1))
            except Exception: pass
    played=[int(x) for x in re.findall(r"^\|\s*(\d+)\s*\|\s*\d+\s*\|\s*\d{4}-\d{2}-\d{2}\s*\|",text,re.M)]
    if played: out["vrs_matches_played"]=max(played)
    return out

def build_team_name_index(maps):
    c=defaultdict(Counter)
    for r in maps.itertuples(index=False):
        c[norm(r.team_a_name)][int(r.team_a_id)]+=1
        c[norm(r.team_b_name)][int(r.team_b_id)]+=1
    return c

def parse_standings(root,maps,out):
    _,players=fetch_all_players()
    team_idx=build_team_name_index(maps)
    ranking=[]; rosters=[]; unresolved=[]
    for year in (2025,2026):
        d=Path(root)/"live"/str(year)
        for p in sorted(d.glob("standings_global_*.md")):
            dm=DATE_RE.search(p.name)
            if not dm: continue
            date=f"{dm.group(1)}-{dm.group(2)}-{dm.group(3)}"
            if date>"2026-09-30": continue
            detail_dir=d/"details"/date.replace("-","_")
            detail_by_rank={}
            if detail_dir.exists():
                for q in detail_dir.glob("*.md"):
                    mm=re.match(r"^(\d{4})--",q.name)
                    if mm: detail_by_rank[int(mm.group(1))]=q
            for line in p.read_text(encoding="utf-8").splitlines():
                m=ROW_RE.match(line)
                if not m: continue
                rank=int(m.group(1)); points=float(m.group(2)); team=m.group(3).strip()
                rnames=[x.strip() for x in m.group(4).split(",") if x.strip()]
                tid_counts=team_idx.get(norm(team),Counter())
                tid=tid_counts.most_common(1)[0][0] if tid_counts else None
                pids=[]; amb=[]
                for name in rnames:
                    cand=players.get(norm(name),[])
                    if len(cand)==1: pids.append(cand[0][0])
                    else: amb.append({"name":name,"candidates":cand})
                rh=roster_hash(pids)
                strength=parse_vrs_detail(detail_by_rank.get(rank))
                ranking.append({"snapshot_date":date,"team_id":tid,"team_name":team,"rank":rank,"points":points,
                                "roster_hash":rh,**strength})
                rosters.append({
                    "snapshot_date":date,"team_id":tid,"team_name":team,
                    "player_ids":";".join(map(str,sorted(pids))) if pids else "",
                    "player_names":";".join(rnames),"roster_hash":rh,
                    "players_resolved":len(pids),"players_expected":len(rnames),
                })
                if tid is None or rh is None:
                    unresolved.append({"snapshot_date":date,"team_name":team,"team_id":tid,"rank":rank,"players_resolved":len(pids),"roster":rnames,"ambiguous":amb})
    rdf=pd.DataFrame(ranking).drop_duplicates(["snapshot_date","team_name","roster_hash","rank"])
    rodf=pd.DataFrame(rosters).drop_duplicates(["snapshot_date","team_name","roster_hash","rank"] if "rank" in pd.DataFrame(rosters).columns else ["snapshot_date","team_name","player_names"])
    # roster hash aliases across org/team IDs
    alias=[]
    good=rodf[rodf["roster_hash"].notna()]
    for h,g in good.groupby("roster_hash"):
        tids=sorted(set(int(x) for x in g["team_id"].dropna()))
        names=sorted(set(g["team_name"].astype(str)))
        alias.append({"roster_hash":h,"team_ids":";".join(map(str,tids)),"team_names":";".join(names),"variant_count":len(g)})
    adf=pd.DataFrame(alias)
    out=Path(out);out.mkdir(parents=True,exist_ok=True)
    rdf.to_csv(out/"ranking_snapshots_vrs.csv",index=False)
    rodf.to_csv(out/"roster_snapshots_vrs.csv",index=False)
    adf.to_csv(out/"roster_aliases.csv",index=False)
    (out/"vrs_unresolved.json").write_text(json.dumps(unresolved,ensure_ascii=False,indent=2),encoding="utf-8")
    summary={
      "ranking_rows":len(rdf),"ranking_dates":rdf["snapshot_date"].nunique(),
      "roster_rows":len(rodf),"full_roster_hash_rows":int(rodf["roster_hash"].notna().sum()),
      "team_id_resolved_rows":int(rodf["team_id"].notna().sum()),
      "unresolved_rows":len(unresolved),
      "unique_roster_hashes":int(rodf["roster_hash"].nunique()),
      "cross_name_roster_hashes":int(sum(1 for _,g in good.groupby("roster_hash") if g["team_name"].nunique()>1)),
      "detail_strength_rows":int(rdf["starting_rank_value"].notna().sum()) if "starting_rank_value" in rdf.columns else 0
    }
    (out/"vrs_summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    print("VRS_SUMMARY "+json.dumps(summary),flush=True)

if __name__=="__main__":
    ap=argparse.ArgumentParser();ap.add_argument("--vrs-root",required=True);ap.add_argument("--maps",required=True);ap.add_argument("--out",required=True)
    a=ap.parse_args(); build_team_name_index
    maps=pd.read_csv(a.maps)
    parse_standings(a.vrs_root,maps,a.out)
