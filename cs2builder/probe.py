import json, threading, requests
from fastapi import FastAPI

app=FastAPI()
state={"status":"booting","results":{}}

def probe(name,url):
    try:
        r=requests.get(url,headers={"User-Agent":"Mozilla/5.0"},timeout=45)
        ct=r.headers.get("content-type","")
        body=r.text[:1200]
        state["results"][name]={"ok":True,"status":r.status_code,"bytes":len(r.content),"content_type":ct,"head":body}
    except Exception as e:
        state["results"][name]={"ok":False,"error":repr(e)}

def run():
    state["status"]="probing"
    urls={
      "csapi_counts":"https://api.csapi.de/counts/",
      "csapi_matches":"https://api.csapi.de/matches/?limit=3&offset=0",
      "csapi_rankings":"https://api.csapi.de/rankings/?limit=3",
      "hltv_api_www":"https://www.hltv-api.com/v1/results?limit=3&offset=0",
      "hltv_api_bare":"https://hltv-api.com/v1/results?limit=3&offset=0",
      "sqady":"https://sqady.com/cs2/matches/",
    }
    ts=[threading.Thread(target=probe,args=(k,v),daemon=True) for k,v in urls.items()]
    [t.start() for t in ts]; [t.join() for t in ts]
    state["status"]="done"
    print("PROBE_RESULT",json.dumps(state),flush=True)

@app.on_event("startup")
def start(): threading.Thread(target=run,daemon=True).start()

@app.get("/")
def root(): return state

@app.get("/health")
def health(): return {"ok":True,"status":state["status"]}
