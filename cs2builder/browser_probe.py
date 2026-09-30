import csv, json, re, threading, traceback, time
from collections import Counter
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup
from curl_cffi import requests as crequests
from fastapi import FastAPI, Response
from scrapling.fetchers import StealthyFetcher

app = FastAPI()
OUT = Path("/app/artifacts")
OUT.mkdir(parents=True, exist_ok=True)

state = {
    "status": "booting",
    "months_done": 0,
    "months_total": 0,
    "rows_total": 0,
    "unique_rows": 0,
    "current_month": None,
    "errors": [],
    "summary": None,
}

BASE = "https://www.hltv.org/stats/matches"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36"

def month_ranges():
    out=[]
    y,m=2025,1
    while (y,m) <= (2026,9):
        if m==12:
            ny,nm=y+1,1
        else:
            ny,nm=y,m+1
        start=date(y,m,1)
        end=date.fromordinal(date(ny,nm,1).toordinal()-1)
        out.append((start.isoformat(),end.isoformat()))
        y,m=ny,nm
    return out

def fetch_html(url):
    err=None
    try:
        r=crequests.get(url, impersonate="chrome", headers={"User-Agent":UA}, timeout=35)
        html=r.text
        if r.status_code==200 and "Just a moment" not in html and "Performing security verification" not in html and "stats-table" in html:
            return html, "curl_cffi"
        err=RuntimeError(f"curl status={r.status_code} bytes={len(html)}")
    except Exception as e:
        err=e
    p=StealthyFetcher.fetch(
        url, headless=True, solve_cloudflare=True, block_webrtc=True,
        humanize=True, google_search=True, network_idle=True, timeout=90000
    )
    html=p.html_content if hasattr(p,"html_content") else str(p)
    if "stats-table" not in html:
        raise RuntimeError(f"HLTV page missing stats table after fallback; first_error={err!r}")
    return html, "scrapling"

def parse_rows(html):
    soup=BeautifulSoup(html,"html.parser")
    out=[]
    for tr in soup.select("table.stats-table tbody tr, table.stats-table tr"):
        link=tr.select_one("td.date-col a[href*='/stats/matches/mapstatsid/']")
        teams=tr.select("td.team-col")
        map_node=tr.select_one(".dynamic-map-name-full") or tr.select_one(".dynamic-map-name-short")
        event_node=tr.select_one("td.event-col")
        if not link or len(teams)<2 or not map_node:
            continue
        href=link.get("href","")
        mm=re.search(r"/mapstatsid/(\d+)/",href)
        if not mm:
            continue
        tdata=[]
        valid=True
        for td in teams[:2]:
            a=td.select_one("a[href*='/stats/teams/']")
            sc=td.select_one(".score")
            if not a or not sc:
                valid=False; break
            tm=re.search(r"/stats/teams/(\d+)/",a.get("href",""))
            sm=re.search(r"(-?\d+)",sc.get_text(" ",strip=True))
            if not tm or not sm:
                valid=False; break
            tdata.append((int(tm.group(1)),a.get_text(" ",strip=True),int(sm.group(1))))
        if not valid:
            continue
        dnode=tr.select_one("td.date-col .time")
        unix=int(dnode.get("data-unix","0") or 0) if dnode else 0
        if unix:
            day=time.strftime("%Y-%m-%d", time.gmtime(unix/1000))
        else:
            txt=dnode.get_text(strip=True) if dnode else ""
            try:
                day=time.strftime("%Y-%m-%d",time.strptime(txt,"%d/%m/%y"))
            except Exception:
                day=""
        s1,s2=tdata[0][2],tdata[1][2]
        if s1==s2:
            continue
        out.append({
            "mapstats_id":int(mm.group(1)),
            "date":day,
            "team_a_id":tdata[0][0],
            "team_a_name":tdata[0][1],
            "team_b_id":tdata[1][0],
            "team_b_name":tdata[1][1],
            "team_a_score":s1,
            "team_b_score":s2,
            "winner_team_id":tdata[0][0] if s1>s2 else tdata[1][0],
            "map_name":map_node.get_text(" ",strip=True).lower(),
            "event":event_node.get_text(" ",strip=True) if event_node else "",
            "source_url":"https://www.hltv.org"+href.split("?")[0],
        })
    return out

def write_csv(rows):
    path=OUT/"hltv_maps_2025_2026.csv"
    fields=["mapstats_id","date","team_a_id","team_a_name","team_b_id","team_b_name","team_a_score","team_b_score","winner_team_id","map_name","event","source_url"]
    with path.open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=fields); w.writeheader(); w.writerows(rows)
    return path

def run():
    months=month_ranges()
    state["months_total"]=len(months)
    state["status"]="collecting"
    all_rows={}
    transports=Counter()
    pages=0
    try:
        for mi,(start,end) in enumerate(months,1):
            state["current_month"]=start[:7]
            offset=0
            month_rows=0
            seen_page_ids=None
            while True:
                url=f"{BASE}?startDate={start}&endDate={end}&csVersion=CS2&offset={offset}"
                html,transport=fetch_html(url)
                transports[transport]+=1
                rows=parse_rows(html)
                pages+=1
                ids=tuple(r["mapstats_id"] for r in rows)
                if not rows or ids==seen_page_ids:
                    break
                seen_page_ids=ids
                added=0
                for r in rows:
                    if r["mapstats_id"] not in all_rows:
                        all_rows[r["mapstats_id"]]=r; added+=1
                month_rows+=added
                state["rows_total"]+=len(rows)
                state["unique_rows"]=len(all_rows)
                print(f"HLTV_PAGE month={start[:7]} offset={offset} rows={len(rows)} added={added} total={len(all_rows)} via={transport}",flush=True)
                if len(rows)<50:
                    break
                offset+=50
                if offset>5000:
                    raise RuntimeError(f"pagination safety hit {start[:7]}")
            state["months_done"]=mi
            print(f"HLTV_MONTH_DONE month={start[:7]} unique_added={month_rows} total={len(all_rows)}",flush=True)
            write_csv(sorted(all_rows.values(),key=lambda x:(x["date"],x["mapstats_id"])))
        rows=sorted(all_rows.values(),key=lambda x:(x["date"],x["mapstats_id"]))
        path=write_csv(rows)
        cov=Counter()
        for r in rows:
            cov[r["team_a_id"]]+=1; cov[r["team_b_id"]]+=1
        summary={
            "unique_map_rows":len(rows),
            "date_min":min((r["date"] for r in rows),default=None),
            "date_max":max((r["date"] for r in rows),default=None),
            "unique_teams":len(cov),
            "pages":pages,
            "transports":dict(transports),
            "teams_12plus":sum(v>=12 for v in cov.values()),
            "teams_40plus":sum(v>=40 for v in cov.values()),
            "top_coverage":cov.most_common(30),
            "csv_bytes":path.stat().st_size if path.exists() else 0,
        }
        (OUT/"hltv_summary.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
        state["summary"]=summary
        state["status"]="done"
        print("HLTV_FINAL "+json.dumps(summary,ensure_ascii=False),flush=True)
    except Exception as e:
        state["status"]="failed"
        state["errors"].append({"error":repr(e),"trace":traceback.format_exc()[-5000:]})
        print("HLTV_ERROR "+json.dumps(state["errors"][-1]),flush=True)

@app.on_event("startup")
def startup():
    threading.Thread(target=run,daemon=True).start()

@app.get("/")
def root():
    return state

@app.get("/health")
def health():
    return {"ok":True,"status":state["status"],"unique_rows":state["unique_rows"],"months_done":state["months_done"]}

@app.get("/summary")
def summary():
    return state

@app.get("/corpus.csv")
def corpus():
    path=OUT/"hltv_maps_2025_2026.csv"
    if not path.exists():
        return Response("not ready",status_code=404)
    return Response(path.read_bytes(),media_type="text/csv")
