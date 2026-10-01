from __future__ import annotations

import calendar
import csv
import io
import json
import re
import threading
import time
from pathlib import Path
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from scrapling.fetchers import StealthySession

START_YEAR, START_MONTH = 2025, 1
END_YEAR, END_MONTH = 2026, 9
BASE = "https://www.hltv.org"
OUT = Path("/app/artifacts")
OUT.mkdir(parents=True, exist_ok=True)

app = FastAPI()
state = {
    "status": "booting",
    "months_done": 0,
    "months_total": 21,
    "pages": 0,
    "rows_seen": 0,
    "unique_maps": 0,
    "current_month": None,
    "last_error": None,
    "summary": None,
}

MAP_RE = re.compile(r"/stats/matches/mapstatsid/(\d+)/")
TEAM_RE = re.compile(r"/stats/teams/(\d+)/")

def months():
    y, m = START_YEAR, START_MONTH
    while (y, m) <= (END_YEAR, END_MONTH):
        last = calendar.monthrange(y, m)[1]
        yield f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{last:02d}"
        m += 1
        if m == 13:
            y += 1
            m = 1

def parse_page(html: str):
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    if "Just a moment" in text or "Performing security verification" in text:
        raise RuntimeError("cloudflare_challenge")
    rows = []
    for tr in soup.select("table.stats-table tbody tr, table.stats-table tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) < 5:
            continue
        date_link = tds[0].find("a", href=True)
        if not date_link:
            continue
        mm = MAP_RE.search(date_link.get("href", ""))
        if not mm:
            continue
        team_cells = [tds[1], tds[2]]
        teams = []
        scores = []
        ok = True
        for td in team_cells:
            a = td.find("a", href=True)
            tm = TEAM_RE.search(a.get("href", "") if a else "")
            score_el = td.select_one("span.score")
            if not a or not tm or not score_el:
                ok = False
                break
            sm = re.search(r"(-?\d+)", score_el.get_text(" ", strip=True))
            if not sm:
                ok = False
                break
            teams.append((int(tm.group(1)), a.get_text(" ", strip=True)))
            scores.append(int(sm.group(1)))
        if not ok or scores[0] == scores[1]:
            continue
        date_el = tds[0].select_one("[data-unix]")
        if date_el and date_el.get("data-unix"):
            ts = int(date_el["data-unix"]) / 1000
            date = time.strftime("%Y-%m-%d", time.gmtime(ts))
        else:
            raw = tds[0].get_text(" ", strip=True)
            date = raw
        map_short = tds[3].select_one(".dynamic-map-name-short")
        map_name = (map_short.get_text(" ", strip=True) if map_short else tds[3].get_text(" ", strip=True)).lower()
        event_a = tds[4].find("a", href=True)
        event = event_a.get_text(" ", strip=True) if event_a else tds[4].get_text(" ", strip=True)
        rows.append({
            "mapstatsid": int(mm.group(1)),
            "date": date,
            "team_a_id": teams[0][0],
            "team_a_name": teams[0][1],
            "team_b_id": teams[1][0],
            "team_b_name": teams[1][1],
            "team_a_score": scores[0],
            "team_b_score": scores[1],
            "winner_team_id": teams[0][0] if scores[0] > scores[1] else teams[1][0],
            "map_name": map_name,
            "event": event,
            "source_url": urljoin(BASE, date_link["href"]),
        })
    return rows

def run():
    state["status"] = "scraping"
    all_rows = {}
    try:
        with StealthySession(
            headless=True,
            block_webrtc=True,
            solve_cloudflare=True,
            disable_resources=True,
            timeout=90000,
        ) as session:
            for start, end in months():
                state["current_month"] = start[:7]
                offset = 0
                month_unique = 0
                while True:
                    url = f"{BASE}/stats/matches?startDate={start}&endDate={end}&csVersion=CS2&offset={offset}"
                    page = session.fetch(
                        url,
                        solve_cloudflare=True,
                        network_idle=False,
                        timeout=90000,
                        wait_selector="table.stats-table",
                    )
                    html = page.html_content if hasattr(page, "html_content") else str(page)
                    parsed = parse_page(html)
                    state["pages"] += 1
                    state["rows_seen"] += len(parsed)
                    added = 0
                    for r in parsed:
                        if r["mapstatsid"] not in all_rows:
                            all_rows[r["mapstatsid"]] = r
                            added += 1
                            month_unique += 1
                    state["unique_maps"] = len(all_rows)
                    print(json.dumps({
                        "kind": "HLTV_PAGE", "month": start[:7], "offset": offset,
                        "rows": len(parsed), "added": added, "unique_maps": len(all_rows)
                    }), flush=True)
                    if len(parsed) < 50:
                        break
                    offset += 50
                    if offset > 5000:
                        raise RuntimeError(f"pagination_guard month={start[:7]}")
                state["months_done"] += 1
                print(json.dumps({
                    "kind": "HLTV_MONTH_DONE", "month": start[:7],
                    "month_unique": month_unique, "total_unique": len(all_rows)
                }), flush=True)

        rows = sorted(all_rows.values(), key=lambda r: (r["date"], r["mapstatsid"]))
        csv_path = OUT / "hltv_maps_2025_2026.csv"
        if rows:
            with csv_path.open("w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                w.writeheader()
                w.writerows(rows)
        summary = {
            "unique_maps": len(rows),
            "date_min": rows[0]["date"] if rows else None,
            "date_max": rows[-1]["date"] if rows else None,
            "unique_teams": len({r["team_a_id"] for r in rows} | {r["team_b_id"] for r in rows}),
            "pages": state["pages"],
            "months": state["months_done"],
            "target_10000_met": len(rows) >= 10000,
        }
        (OUT / "hltv_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
        state["summary"] = summary
        state["status"] = "done"
        state["current_month"] = None
        print("HLTV_CORPUS_DONE " + json.dumps(summary), flush=True)
    except Exception as e:
        state["status"] = "failed"
        state["last_error"] = repr(e)
        print("HLTV_CORPUS_ERROR " + json.dumps(state), flush=True)

@app.on_event("startup")
def startup():
    threading.Thread(target=run, daemon=True).start()

@app.get("/")
def root():
    return state

@app.get("/health")
def health():
    return {"ok": True, "status": state["status"], "unique_maps": state["unique_maps"]}

@app.get("/artifact/{name}")
def artifact(name: str):
    allowed = {"hltv_maps_2025_2026.csv", "hltv_summary.json"}
    if name not in allowed:
        raise HTTPException(404)
    p = OUT / name
    if not p.exists():
        raise HTTPException(404, "not ready")
    return FileResponse(p)
