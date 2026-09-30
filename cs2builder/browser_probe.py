import json, threading, traceback, requests
from fastapi import FastAPI
from scrapling.fetchers import StealthyFetcher

app=FastAPI()
state={"status":"booting","api":{},"browser":None}

def api_probe():
    urls={
      "csapi_counts":"https://api.csapi.de/counts/",
      "csapi_matches":"https://api.csapi.de/matches/?limit=3&offset=0",
      "csapi_rankings":"https://api.csapi.de/rankings/",
      "hltv_api_www":"https://www.hltv-api.com/v1/results?limit=3&offset=0",
      "hltv_api_bare":"https://hltv-api.com/v1/results?limit=3&offset=0",
    }
    def one(k,u):
        try:
            r=requests.get(u,headers={"User-Agent":"Mozilla/5.0","Accept":"application/json"},timeout=12)
            state["api"][k]={"status":r.status_code,"bytes":len(r.content),"head":r.text[:5000]}
        except Exception as e:
            state["api"][k]={"error":repr(e)}
    ts=[threading.Thread(target=one,args=x,daemon=True) for x in urls.items()]
    [t.start() for t in ts]; [t.join(15) for t in ts]
    print("API_PROBE_RESULT",json.dumps(state["api"]),flush=True)

def browser_probe():
    url="https://www.hltv.org/stats/matches?startDate=2025-01-01&endDate=2025-01-31&csVersion=CS2&offset=0"
    try:
        page=StealthyFetcher.fetch(
            url,
            headless=True,
            solve_cloudflare=True,
            block_webrtc=True,
            google_search=True,
            network_idle=True,
            timeout=90000,
        )
        text=page.get_all_text(strip=True)
        html=page.html_content if hasattr(page,"html_content") else str(page)
        state["browser"]={
          "ok":True,
          "status":getattr(page,"status",None),
          "title":(page.css("title::text").get() or "") if hasattr(page,"css") else "",
          "text_head":text[:1500],
          "html_bytes":len(html.encode("utf-8","ignore")),
          "has_matches":"Matches" in text,
          "has_cloudflare":"Just a moment" in text or "Performing security verification" in text,
        }
    except Exception as e:
        state["browser"]={"ok":False,"error":repr(e),"trace":traceback.format_exc()[-3000:]}
    print("BROWSER_PROBE_RESULT",json.dumps(state["browser"]),flush=True)

def run():
    state["status"]="probing"
    api_probe()
    browser_probe()
    state["status"]="done"

@app.on_event("startup")
def startup(): threading.Thread(target=run,daemon=True).start()

@app.get("/")
def root(): return state

@app.get("/health")
def health(): return {"ok":True,"status":state["status"]}
