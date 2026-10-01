import json, pathlib, traceback
from bs4 import BeautifulSoup
from curl_cffi import requests as crequests

URL="https://www.hltv.org/stats/matches?startDate=2025-01-01&endDate=2025-01-31&csVersion=CS2&offset=0"
out={"url":URL}

def inspect_html(html,status,transport):
    soup=BeautifulSoup(html,"html.parser")
    txt=soup.get_text(" ",strip=True)
    rows=soup.select("table.stats-table tbody tr, table.stats-table tr")
    out.update({
        "transport":transport,"status":status,"bytes":len(html.encode("utf-8","ignore")),
        "title":soup.title.get_text(" ",strip=True) if soup.title else "",
        "cloudflare":("Just a moment" in txt or "Performing security verification" in txt),
        "stats_rows":len(rows),"text_head":txt[:600],
        "first_row_html":str(rows[1] if len(rows)>1 else rows[0])[:12000] if rows else ""
    })
    return not out["cloudflare"] and len(rows)>=10

try:
    r=crequests.get(URL,impersonate="chrome",timeout=30)
    if not inspect_html(r.text,r.status_code,"curl_cffi"):
        from scrapling.fetchers import StealthyFetcher
        p=StealthyFetcher.fetch(URL,headless=True,solve_cloudflare=True,block_webrtc=True,
                                humanize=True,google_search=True,network_idle=True,timeout=90000)
        html=p.html_content if hasattr(p,"html_content") else str(p)
        inspect_html(html,getattr(p,"status",None),"scrapling")
except Exception as e:
    out["error"]=repr(e); out["trace"]=traceback.format_exc()[-3000:]

pathlib.Path("cs2builder/results").mkdir(parents=True,exist_ok=True)
pathlib.Path("cs2builder/results/gha_probe_result.json").write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding="utf-8")
print("GHA_PROBE_RESULT",json.dumps(out,ensure_ascii=False))
