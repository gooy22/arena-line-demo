import os, json, threading, requests
from fastapi import FastAPI
from curl_cffi import requests as crequests

app=FastAPI()
state={"status":"booting","results":{}}

def probe(name, fn):
    try:
        r=fn()
        state["results"][name]={"ok":True,"status":r.status_code,"bytes":len(r.content),"head":r.text[:180]}
    except Exception as e:
        state["results"][name]={"ok":False,"error":repr(e)}

def run():
    state["status"]="probing"
    jobs=[
      ("github",lambda:requests.get("https://api.github.com/repos/ValveSoftware/counter-strike_regional_standings/contents/invitation/2025",timeout=15)),
      ("hltv",lambda:crequests.get("https://www.hltv.org/stats/matches?startDate=2025-01-01&endDate=2025-01-31&offset=0",impersonate="chrome",timeout=15)),
      ("hf",lambda:requests.get("https://huggingface.co/api/datasets/blanchon/cs2_dataset_demo",timeout=15)),
    ]
    ts=[threading.Thread(target=probe,args=x,daemon=True) for x in jobs]
    [t.start() for t in ts]; [t.join() for t in ts]
    state["status"]="done"
    print("PROBE_RESULT",json.dumps(state),flush=True)

@app.on_event("startup")
def start(): threading.Thread(target=run,daemon=True).start()

@app.get("/")
def root(): return state

@app.get("/health")
def health(): return {"ok":True,"status":state["status"]}
