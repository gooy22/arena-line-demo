from __future__ import annotations
import argparse, calendar, csv, json, re, time
from pathlib import Path
from urllib.parse import urljoin
from bs4 import BeautifulSoup
from scrapling.fetchers import StealthyFetcher

BASE="https://www.hltv.org"
MAP_RE=re.compile(r"/stats/matches/mapstatsid/(\d+)/")
TEAM_RE=re.compile(r"/stats/teams/(\d+)/")

def month_range(start,end):
    sy,sm=map(int,start.split("-")); ey,em=map(int,end.split("-"))
    y,m=sy,sm
    while (y,m)<=(ey,em):
        last=calendar.monthrange(y,m)[1]
        yield f"{y:04d}-{m:02d}-01",f"{y:04d}-{m:02d}-{last:02d}"
        m+=1
        if m==13:y+=1;m=1

def parse(html):
    soup=BeautifulSoup(html,"html.parser")
    tx=soup.get_text(" ",strip=True)
    if "Just a moment" in tx or "Performing security verification" in tx:
        raise RuntimeError("cloudflare")
    out=[]
    for tr in soup.select("table.stats-table tr"):
        tds=tr.find_all("td",recursive=False)
        if len(tds)<5: continue
        a0=tds[0].find("a",href=True); mm=MAP_RE.search(a0.get("href","") if a0 else "")
        if not mm: continue
        teams=[];scores=[];bad=False
        for td in (tds[1],tds[2]):
            a=td.find("a",href=True); tm=TEAM_RE.search(a.get("href","") if a else "")
            sc=td.select_one("span.score"); sm=re.search(r"(-?\d+)",sc.get_text(" ",strip=True) if sc else "")
            if not (a and tm and sm):bad=True;break
            teams.append((int(tm.group(1)),a.get_text(" ",strip=True)));scores.append(int(sm.group(1)))
        if bad or scores[0]==scores[1]:continue
        de=tds[0].select_one("[data-unix]")
        date=time.strftime("%Y-%m-%d",time.gmtime(int(de["data-unix"])/1000)) if de and de.get("data-unix") else tds[0].get_text(" ",strip=True)
        me=tds[3].select_one(".dynamic-map-name-short")
        mp=(me.get_text(" ",strip=True) if me else tds[3].get_text(" ",strip=True)).lower()
        ea=tds[4].find("a",href=True);event=ea.get_text(" ",strip=True) if ea else tds[4].get_text(" ",strip=True)
        out.append({"mapstatsid":int(mm.group(1)),"date":date,"team_a_id":teams[0][0],"team_a_name":teams[0][1],
                    "team_b_id":teams[1][0],"team_b_name":teams[1][1],"team_a_score":scores[0],"team_b_score":scores[1],
                    "winner_team_id":teams[0][0] if scores[0]>scores[1] else teams[1][0],"map_name":mp,"event":event,
                    "source_url":urljoin(BASE,a0["href"])})
    return out

def main(start,end,out):
    rows={};pages=0
    for s,e in month_range(start,end):
        off=0
        while True:
            url=f"{BASE}/stats/matches?startDate={s}&endDate={e}&csVersion=CS2&offset={off}"
            last=None
            for attempt in range(3):
                try:
                    p=StealthyFetcher.fetch(url,headless=True,block_webrtc=True,solve_cloudflare=True,disable_resources=True,
                                           network_idle=False,timeout=90000,wait_selector="table.stats-table")
                    got=parse(p.html_content if hasattr(p,"html_content") else str(p));last=None;break
                except Exception as ex:
                    last=ex;print("RETRY",json.dumps({"month":s[:7],"offset":off,"attempt":attempt+1,"error":repr(ex)}),flush=True);time.sleep(2+2*attempt)
            if last:raise last
            pages+=1
            for r in got: rows.setdefault(r["mapstatsid"],r)
            print("PAGE",json.dumps({"month":s[:7],"offset":off,"rows":len(got),"unique":len(rows)}),flush=True)
            if len(got)<50:break
            off+=50
            if off>5000:raise RuntimeError("offset_guard")
        print("MONTH_DONE",s[:7],len(rows),flush=True)
    vals=sorted(rows.values(),key=lambda x:(x["date"],x["mapstatsid"]))
    op=Path(out);op.parent.mkdir(parents=True,exist_ok=True)
    if vals:
        with op.open("w",newline="",encoding="utf-8") as f:
            w=csv.DictWriter(f,fieldnames=list(vals[0].keys()));w.writeheader();w.writerows(vals)
    summ={"start":start,"end":end,"rows":len(vals),"pages":pages,"teams":len({r["team_a_id"] for r in vals}|{r["team_b_id"] for r in vals}),
          "date_min":vals[0]["date"] if vals else None,"date_max":vals[-1]["date"] if vals else None}
    op.with_suffix(".json").write_text(json.dumps(summ,indent=2),encoding="utf-8")
    print("CHUNK_DONE",json.dumps(summ),flush=True)

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--start",required=True);p.add_argument("--end",required=True);p.add_argument("--out",required=True)
    a=p.parse_args();main(a.start,a.end,a.out)
