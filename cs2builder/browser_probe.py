import json, threading, traceback
from fastapi import FastAPI
from scrapling.fetchers import StealthyFetcher

app=FastAPI()
state={"status":"booting","result":None}

def run():
    state["status"]="probing"
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
        state["result"]={
          "ok": True,
          "status": getattr(page,"status",None),
          "title": (page.css("title::text").get() or "") if hasattr(page,"css") else "",
          "text_head": text[:1000],
          "html_bytes": len(html.encode("utf-8","ignore")),
          "has_matches": "Matches" in text,
          "has_cloudflare": "Just a moment" in text or "Performing security verification" in text,
        }
    except Exception as e:
        state["result"]={"ok":False,"error":repr(e),"trace":traceback.format_exc()[-2500:]}
    state["status"]="done"
    print("BROWSER_PROBE_RESULT",json.dumps(state),flush=True)

@app.on_event("startup")
def startup(): threading.Thread(target=run,daemon=True).start()

@app.get("/")
def root(): return state
@app.get("/health")
def health(): return {"ok":True,"status":state["status"]}
