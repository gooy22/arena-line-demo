from __future__ import annotations
import calendar, csv, json, re, time
from pathlib import Path
from urllib.parse import urljoin
from bs4 import BeautifulSoup
from scrapling.fetchers import StealthySession

BASE="https://www.hltv.org"
OUT=Path("cs2builder/raw_artifacts")
OUT.mkdir(parents=True,exist_ok=True)
MAP_RE=re.compile(r"/stats/matches/mapstatsid/(\d+)/")
TEAM_RE=re.compile(r"/stats/teams/(\d+)/")

def months():
    y,m=2025,1
    while (y,m)<=(2026,9):
        last=calendar.monthrange(y,m)[1]
        yield f"{y:04d}-{m:02d}-01",f"{y:04d}-{m:02d}-{last:02d}"
        m+=1
        if m==13:y+=1;m=1

def parse_page(html):
    soup=BeautifulSoup(html,"html.parser")
    txt=soup.get_text(" ",strip=True)
    if "Just a moment" in txt or "Performing security verification" in txt:
        raise RuntimeError("cloudflare_challenge")
    out=[]
    for tr in soup.select("table.stats-table tbody tr, table.stats-table tr"):
        tds=tr.find_all("td",recursive=False)
        if len(tds)<5: continue
        a0=tds[0].find("a",href=True)
        mm=MAP_RE.search(a0.get("href","") if a0 else "")
        if not mm: continue
        teams=[];scores=[];bad=False
        for td in (tds[1],tds[2]):
            a=td.find("a",href=True); tm=TEAM_RE.search(a.get("href","") if a else "")
            sc=td.select_one("span.score")
            sm=re.search(r"(-?\d+)",sc.get_text(" ",strip=True) if sc else "")
            if not a or not tm or not sm: bad=True;break
            teams.append((int(tm.group(1)),a.get_text(" ",strip=True)))
            scores.append(int(sm.group(1)))
        if bad or scores[0]==scores[1]: continue
        de=tds[0].select_one("[data-unix]")
        if de and de.get("data-unix"):
            date=time.strftime("%Y-%m-%d",time.gmtime(int(de["data-unix"])/1000))
        else:
            date=tds[0].get_text(" ",strip=True)
        ms=tds[3].select_one(".dynamic-map-name-short")
        map_name=(ms.get_text(" ",strip=True) if ms else tds[3].get_text(" ",strip=True)).lower()
        ea=tds[4].find("a",href=True)
        event=ea.get_text(" ",strip=True) if ea else tds[4].get_text(" ",strip=True)
        out.append({
          "mapstatsid":int(mm.group(1)),"date":date,
          "team_a_id":teams[0][0],"team_a_name":teams[0][1],
          "team_b_id":teams[1][0],"team_b_name":teams[1][1],
          "team_a_score":scores[0],"team_b_score":scores[1],
          "winner_team_id":teams[0][0] if scores[0]>scores[1] else teams[1][0],
          "map_name":map_name,"event":event,
          "source_url":urljoin(BASE,a0["href"])
        })
    return out

def write(rows):
    p=OUT/"hltv_maps_2025_2026.csv"
    vals=sorted(rows.values(),key=lambda x:(x["date"],x["mapstatsid"]))
    if vals:
        with p.open("w",newline="",encoding="utf-8") as f:
            w=csv.DictWriter(f,fieldnames=list(vals[0].keys()));w.writeheader();w.writerows(vals)
    return vals

def main():
    rows={};pages=0;month_counts={}
    with StealthySession(headless=True,block_webrtc=True,solve_cloudflare=True,disable_resources=True,timeout=90000) as session:
        for start,end in months():
            mon=start[:7]; off=0; before=len(rows)
            while True:
                url=f"{BASE}/stats/matches?startDate={start}&endDate={end}&csVersion=CS2&offset={off}"
                last=None
                for attempt in range(4):
                    try:
                        p=session.fetch(url,solve_cloudflare=True,network_idle=False,timeout=90000,wait_selector="table.stats-table")
                        html=p.html_content if hasattr(p,"html_content") else str(p)
                        got=parse_page(html);last=None;break
                    except Exception as e:
                        last=e
                        print("HLTV_RETRY",json.dumps({"month":mon,"offset":off,"attempt":attempt+1,"error":repr(e)}),flush=True)
                        time.sleep(2+attempt*2)
                        if attempt==2:
                            try: session.close_pages()
                            except Exception: pass
                if last is not None: raise last
                pages+=1
                for r in got: rows.setdefault(r["mapstatsid"],r)
                print("HLTV_PAGE",json.dumps({"month":mon,"offset":off,"rows":len(got),"unique":len(rows)}),flush=True)
                if len(got)<50: break
                off+=50
                if off>5000: raise RuntimeError(f"pagination_guard:{mon}")
                time.sleep(.15)
            month_counts[mon]=len(rows)-before
            write(rows)
            print("HLTV_MONTH_DONE",json.dumps({"month":mon,"added":month_counts[mon],"unique":len(rows)}),flush=True)
    vals=write(rows)
    summary={
      "unique_maps":len(vals),
      "date_min":vals[0]["date"] if vals else None,
      "date_max":vals[-1]["date"] if vals else None,
      "unique_teams":len({x["team_a_id"] for x in vals}|{x["team_b_id"] for x in vals}),
      "pages":pages,"month_counts":month_counts,"target_10000_met":len(vals)>=10000
    }
    (OUT/"hltv_summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    print("HLTV_CORPUS_DONE",json.dumps(summary),flush=True)

if __name__=="__main__": main()
