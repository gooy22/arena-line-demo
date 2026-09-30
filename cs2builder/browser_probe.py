import json, threading, traceback, requests, time
from collections import Counter
from fastapi import FastAPI

app=FastAPI()
state={"status":"booting","census":None}

BASE="https://api.csapi.de"

def get_json(path, timeout=20):
    last=None
    for attempt in range(4):
        try:
            r=requests.get(BASE+path,headers={"User-Agent":"cs2-dataset-builder/1.0","Accept":"application/json"},timeout=timeout)
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last=e
            time.sleep(0.5*(attempt+1))
    raise last

def run():
    state["status"]="census"
    try:
        rows=[]
        offset=0
        while True:
            page=get_json(f"/matches/?limit=100&offset={offset}")
            if not page: break
            rows.extend(page)
            print(f"CENSUS_PAGE offset={offset} got={len(page)} total={len(rows)}",flush=True)
            if len(page)<100: break
            offset+=100
            if offset>10000: break
        lo="2025-01-01"; hi="2026-09-30"
        keep=[m for m in rows if lo<=m.get("date","")<=hi]
        maps=[]
        cov=Counter()
        for m in keep:
            for mp in m.get("maps",[]):
                if not mp.get("name") or int(mp.get("id",0))==0: continue
                maps.append((m["id"],mp["id"],m["date"],m["team1"]["id"],m["team2"]["id"],mp["name"]))
                cov[m["team1"]["id"]]+=1; cov[m["team2"]["id"]]+=1
        latest=get_json("/rankings/")
        top150={x["id"] for x in latest.get("rankings",[])[:150]}
        eligible={tid for tid in top150 if cov[tid]>=12}
        state["census"]={
          "api_matches_returned":len(rows),
          "matches_2025_2026":len(keep),
          "unique_maps_2025_2026":len(set((x[0],x[1]) for x in maps)),
          "date_min":min((m["date"] for m in keep),default=None),
          "date_max":max((m["date"] for m in keep),default=None),
          "unique_teams":len(set([x[3] for x in maps]+[x[4] for x in maps])),
          "latest_ranking_date":latest.get("date"),
          "latest_ranking_count":len(latest.get("rankings",[])),
          "top150_with_12plus_maps":len(eligible),
          "top150_coverage":{"ready_40plus":sum(cov[t]>=40 for t in top150),"eligible_12plus":len(eligible),"under12":sum(cov[t]<12 for t in top150)},
          "top_map_coverage":cov.most_common(20),
        }
        print("CORPUS_CENSUS "+json.dumps(state["census"]),flush=True)
        state["status"]="done"
    except Exception as e:
        state["status"]="failed"; state["census"]={"error":repr(e),"trace":traceback.format_exc()[-4000:]}
        print("CORPUS_CENSUS_ERROR "+json.dumps(state["census"]),flush=True)

@app.on_event("startup")
def startup(): threading.Thread(target=run,daemon=True).start()

@app.get("/")
def root(): return state
@app.get("/health")
def health(): return {"ok":True,"status":state["status"]}
