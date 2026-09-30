import csv, os, re, time, json, traceback
from pathlib import Path
from bs4 import BeautifulSoup
from scrapling.fetchers import StealthyFetcher

START=os.environ["START_DATE"]
END=os.environ["END_DATE"]
MONTH=os.environ.get("MONTH",START[:7])
OUT=Path(os.environ.get("OUT_DIR","out"))
OUT.mkdir(parents=True,exist_ok=True)
BASE="https://www.hltv.org/stats/matches"

def fetch(url, attempts=4):
    last=None
    for i in range(attempts):
        try:
            p=StealthyFetcher.fetch(
                url, headless=True, solve_cloudflare=True, block_webrtc=True,
                humanize=True, google_search=True, network_idle=True, timeout=90000
            )
            html=p.html_content if hasattr(p,"html_content") else str(p)
            txt=BeautifulSoup(html,"html.parser").get_text(" ",strip=True)
            if "Just a moment" in txt or "Performing security verification" in txt:
                raise RuntimeError("cloudflare_challenge")
            if "stats-table" not in html:
                raise RuntimeError("stats_table_missing")
            return html
        except Exception as e:
            last=e
            print("GHA_RETRY",json.dumps({"month":MONTH,"attempt":i+1,"error":repr(e)}),flush=True)
            time.sleep(5*(i+1))
    raise last

def parse(html):
    soup=BeautifulSoup(html,"html.parser")
    out=[]
    for tr in soup.select("table.stats-table tbody tr, table.stats-table tr"):
        link=tr.select_one("td.date-col a[href*='/stats/matches/mapstatsid/']")
        teams=tr.select("td.team-col")
        map_node=tr.select_one(".dynamic-map-name-full") or tr.select_one(".dynamic-map-name-short")
        if not link or len(teams)<2 or not map_node:
            continue
        href=link.get("href","")
        mm=re.search(r"/mapstatsid/(\d+)/",href)
        if not mm: continue
        t=[]
        ok=True
        for td in teams[:2]:
            a=td.select_one("a[href*='/stats/teams/']")
            sc=td.select_one(".score")
            if not a or not sc: ok=False; break
            tm=re.search(r"/stats/teams/(\d+)/",a.get("href",""))
            sm=re.search(r"(-?\d+)",sc.get_text(" ",strip=True))
            if not tm or not sm: ok=False; break
            t.append((int(tm.group(1)),a.get_text(" ",strip=True),int(sm.group(1))))
        if not ok: continue
        dnode=tr.select_one("td.date-col .time")
        unix=int(dnode.get("data-unix","0") or 0) if dnode else 0
        day=time.strftime("%Y-%m-%d",time.gmtime(unix/1000)) if unix else ""
        event=tr.select_one("td.event-col")
        s1,s2=t[0][2],t[1][2]
        if s1==s2: continue
        out.append({
            "mapstats_id":int(mm.group(1)),
            "date":day,
            "team_a_id":t[0][0],"team_a_name":t[0][1],
            "team_b_id":t[1][0],"team_b_name":t[1][1],
            "team_a_score":s1,"team_b_score":s2,
            "winner_team_id":t[0][0] if s1>s2 else t[1][0],
            "map_name":map_node.get_text(" ",strip=True).lower(),
            "event":event.get_text(" ",strip=True) if event else "",
            "source_url":"https://www.hltv.org"+href.split("?")[0],
        })
    return out

rows={}
offset=0
pages=0
error=None
try:
    while True:
        url=f"{BASE}?startDate={START}&endDate={END}&csVersion=CS2&offset={offset}"
        html=fetch(url)
        page=parse(html)
        pages+=1
        added=0
        for r in page:
            if r["mapstats_id"] not in rows:
                rows[r["mapstats_id"]]=r; added+=1
        print("GHA_MONTH_PAGE",json.dumps({"month":MONTH,"offset":offset,"rows":len(page),"added":added,"total":len(rows)}),flush=True)
        if len(page)<50:
            break
        offset+=50
        if offset>5000:
            raise RuntimeError("pagination_safety")
        time.sleep(1.5)
except Exception as e:
    error=repr(e)
    print("GHA_MONTH_ERROR",json.dumps({"month":MONTH,"error":error,"trace":traceback.format_exc()[-2500:]}),flush=True)

fields=["mapstats_id","date","team_a_id","team_a_name","team_b_id","team_b_name","team_a_score","team_b_score","winner_team_id","map_name","event","source_url"]
path=OUT/f"hltv_{MONTH}.csv"
with path.open("w",newline="",encoding="utf-8") as f:
    w=csv.DictWriter(f,fieldnames=fields); w.writeheader()
    w.writerows(sorted(rows.values(),key=lambda x:(x["date"],x["mapstats_id"])))
summary={"month":MONTH,"start":START,"end":END,"pages":pages,"unique_maps":len(rows),"error":error}
(OUT/f"summary_{MONTH}.json").write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
print("GHA_MONTH_FINAL",json.dumps(summary,ensure_ascii=False),flush=True)
if not rows:
    raise SystemExit(2)
