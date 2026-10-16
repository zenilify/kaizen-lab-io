#!/usr/bin/env python3
"""3D printing KPIs for kaizen-lab.io: Rework / first-pass yield (from the K1C's Moonraker history) and
Make vs Buy (lead time + landed cost per part, from data/3d-savings.yaml). Lane L100, 2026-10-12.

No third-party modules: runs on the workstation (probe, review) and inside the lab worker container (collector).
Moonraker access is READ-ONLY: GET /server/history/list only. Never send anything else to the printer.

  python3 collector/printing.py --repo .                   # config check + public aggregate from a live read
  python3 collector/printing.py --repo . --table           # private Markdown tables for the review doc
  python3 collector/printing.py --repo . --jobs FILE.json  # use a saved history instead of the printer

Definitions (see docs/make-vs-buy-rework-review-2026-10-12.md):
  attempt       a job that printed >= 60 s or extruded >= 50 mm (shorter = no-start: counted in jobs_total only)
  good / failed Moonraker status `completed` = good, anything else = failed; data/print-map.yaml overrides
                win (landmine 260: `completed` only means the G-code ran to the end)
  unit          consecutive attempts of one part ending with a good attempt (= one delivered part);
                trailing failures form an open unit (attempted, not delivered)
  RFT           Right First Time: units whose FIRST attempt was good / units attempted
  rework        attempts beyond the first in delivered units; attempts_per_part = attempts / delivered units
  COPQ          Cost of Poor Quality (internal failure): failed attempts' filament × MXN/kg + their print hours
                × K1C W × MXN/kWh; machine hours lost shown as hours (grams = mm used × G-code weight/length)
  make lead     ordered_at (Erick asks for the part) -> end of the final good print; split design/render
                (order -> first print start) and print + rework (first start -> final good end)
"""
import json, os, re, statistics, sys, urllib.request
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/Mexico_City")
NO_START_S, NO_START_MM = 60, 50
TITLE_OK = re.compile(r"^[A-Za-z0-9 ,.:;()'+/&\-→—–]{3,60}$")
# Generic private-network shapes live here; the lab-specific ban words (people, places, hostnames, internal
# domains) are NOT in this public file: they come from KL_TITLE_BAN_FILE (one regex fragment per line, '#' =
# comment), kept in the private ops repo / the collector's /etc/kaizen-lab. Without the file only the generic
# shapes apply and a warning goes to stderr. A file that is set but unreadable is an error.
_BAN_GENERIC = r"\b(192\.168|10\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01]))\.|\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|\.ts\.net\b"


def _title_ban():
    path = os.environ.get("KL_TITLE_BAN_FILE")
    if not path:
        print("warning: KL_TITLE_BAN_FILE not set - generic title ban only", file=sys.stderr)
        return re.compile(_BAN_GENERIC, re.I)
    with open(path, encoding="utf-8") as f:
        extra = [l.strip() for l in f if l.strip() and not l.lstrip().startswith("#")]
    return re.compile("|".join([_BAN_GENERIC] + extra), re.I)


TITLE_BAN = _title_ban()
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")      # ordered_at, local America/Mexico_City

MAP_KEYS = {"part_id", "match", "public", "title", "evidence", "job_id", "outcome", "material"}
LEDGER_KEYS = {"date", "item", "problem", "filament_g", "print_cost_mxn", "alternative_mxn", "saving_mxn", "photo",
               "note", "part_id", "public", "title", "material", "requested_at", "designed_at", "delivered_at",
               "buy_lead_days", "buy_price_mxn", "buy_shipping_mxn", "import_tax_pct", "buy_source", "evidence",
               "ordered_at", "ordered_evidence"}
LEDGER_NUM = {"filament_g", "print_cost_mxn", "alternative_mxn", "saving_mxn", "buy_lead_days", "buy_price_mxn",
              "buy_shipping_mxn", "import_tax_pct"}
LEDGER_DATES = {"date", "requested_at", "designed_at", "delivered_at"}


# ---------------------------------------------------------------- restricted flat YAML
def parse_flat(text, starters, keys, num=()):
    entries, cur = [], None
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^(- |  )([a-z_]+):\s*(.*)$", line)
        if not m:
            raise ValueError("line %d: not 'key: value'" % n)
        lead, key, val = m.groups()
        if key not in keys:
            raise ValueError("line %d: unknown key %r" % (n, key))
        if lead == "- ":
            if key not in starters:
                raise ValueError("line %d: an entry must start with %s" % (n, "/".join(sorted(starters))))
            cur = {}
            entries.append(cur)
        elif cur is None:
            raise ValueError("line %d: field before the first entry" % n)
        if key in cur:
            raise ValueError("line %d: duplicate key %r" % (n, key))
        if val in ("", "null", "~"):
            v = None
        elif val in ("true", "false"):
            v = val == "true"
        elif val.startswith('"') and val.endswith('"') and len(val) >= 2:
            v = val[1:-1]
        else:
            v = val
        if key in num and v is not None:
            try:
                v = float(v)
                v = int(v) if v.is_integer() else v
            except (TypeError, ValueError):
                raise ValueError("line %d: %s must be a number or null" % (n, key))
        cur[key] = v
    return entries


def title_ok(t):
    return isinstance(t, str) and bool(TITLE_OK.match(t)) and not TITLE_BAN.search(t)


def load_config(repo):
    """data/print-map.yaml + data/3d-savings.yaml + data/assumptions.json -> one JSON-serialisable dict.
    Raises ValueError on a malformed file (the probe then skips the push; the deploy stops)."""
    d = os.path.join(repo, "data")
    raw = parse_flat(open(os.path.join(d, "print-map.yaml"), encoding="utf-8").read(), {"part_id", "job_id"}, MAP_KEYS)
    rules, overrides = [], {}
    for e in raw:
        if "job_id" in e:
            if e.get("outcome") not in ("failed", "good", "ignore") or set(e) - {"job_id", "outcome", "evidence"}:
                raise ValueError("print-map: override %s needs outcome failed|good|ignore" % e.get("job_id"))
            overrides[str(e["job_id"])] = e["outcome"]
        else:
            if not e.get("match") or not isinstance(e.get("public"), bool):
                raise ValueError("print-map: part %s needs match + public" % e.get("part_id"))
            if e["public"] and not title_ok(e.get("title")):
                raise ValueError("print-map: public part %s needs a whitelisted title" % e["part_id"])
            rules.append({"part_id": e["part_id"], "match": [m.strip().lower() for m in e["match"].split("|") if m.strip()],
                          "public": e["public"], "title": e.get("title") if e["public"] else None,
                          "material": e.get("material")})
    ledger = parse_flat(open(os.path.join(d, "3d-savings.yaml"), encoding="utf-8").read(), {"date"}, LEDGER_KEYS, LEDGER_NUM)
    for e in ledger:
        for k in LEDGER_DATES:
            if e.get(k) is not None and not (isinstance(e[k], str) and DATE.match(e[k])):
                raise ValueError("3d-savings: %s %s must be YYYY-MM-DD" % (e.get("item"), k))
        if e.get("date") is None:
            raise ValueError("3d-savings: entry without date")
        if e.get("ordered_at") is not None and not (isinstance(e["ordered_at"], str) and STAMP.match(e["ordered_at"])):
            raise ValueError("3d-savings: %s ordered_at must be YYYY-MM-DDTHH:MM (local)" % e.get("item"))
        if e.get("public") is True and not title_ok(e.get("title")):
            raise ValueError("3d-savings: public entry %r needs a whitelisted title" % e.get("item"))
    a = json.load(open(os.path.join(d, "assumptions.json"), encoding="utf-8"))
    val = lambda k: (a.get(k) or {}).get("value")
    assumptions = {"import_tax_pct": val("import_tax_pct_china"), "buy_lead_days": val("buy_lead_days_aliexpress"),
                   "mxn_per_kwh": val("electricity_mxn_per_kwh"), "k1c_w": val("k1c_avg_watts"),
                   "g_per_mm": val("filament_g_per_mm_fallback") or 0.003054,
                   "mxn_per_kg": {m: (v or {}).get("value") for m, v in (a.get("filament_price_mxn_per_kg") or {}).items()}}
    # which inputs are still proposals (COPQ / cost to make say "assumptions pending" while any is used)
    st = lambda x: str((x or {}).get("status") or "")
    assumptions["proposal"] = sorted(
        ["mxn_per_kwh"] * st(a.get("electricity_mxn_per_kwh")).startswith("proposal") +
        ["k1c_w"] * st(a.get("k1c_avg_watts")).startswith("proposal") +
        ["kg:" + m for m, v in (a.get("filament_price_mxn_per_kg") or {}).items() if st(v).startswith("proposal")])
    # the ledger copy that travels to the CT keeps only what the computation needs (no problem/item text)
    slim = [{k: e.get(k) for k in ("date", "part_id", "public", "title", "material", "requested_at", "delivered_at",
                                    "filament_g", "print_cost_mxn", "saving_mxn", "alternative_mxn", "buy_lead_days",
                                    "buy_price_mxn", "buy_shipping_mxn", "import_tax_pct", "ordered_at")} for e in ledger]
    for e, full in zip(slim, ledger):
        e["_item"] = full.get("item")          # private; dropped by public_view(), used by --table only
    return {"rules": rules, "overrides": overrides, "ledger": slim, "assumptions": assumptions}


# ---------------------------------------------------------------- Moonraker (read-only)
def slim_job(j):
    m = j.get("metadata") or {}
    return {"job_id": str(j.get("job_id")), "filename": j.get("filename") or "", "status": j.get("status") or "",
            "start_time": float(j.get("start_time") or 0), "end_time": float(j.get("end_time") or 0), "print_duration": float(j.get("print_duration") or 0),
            "filament_used": float(j.get("filament_used") or 0),
            "filament_total": m.get("filament_total"), "filament_weight_total": m.get("filament_weight_total"),
            "filament_type": m.get("filament_type")}


def fetch_jobs(base, timeout=8):
    """GET /server/history/list, paged. Returns a list of slim jobs; raises when the printer is unreachable."""
    out, start = [], 0
    while True:
        url = "%s/server/history/list?limit=100&start=%d&order=asc" % (base.rstrip("/"), start)
        with urllib.request.urlopen(urllib.request.Request(url, method="GET"), timeout=timeout) as r:
            res = json.loads(r.read().decode("utf-8", "replace"))["result"]
        jobs = res.get("jobs") or []
        out += [slim_job(j) for j in jobs]
        start += len(jobs)
        if not jobs or start >= int(res.get("count") or 0) or start > 5000:
            return out


def grams(job, g_per_mm):
    ft, fw = job.get("filament_total"), job.get("filament_weight_total")
    if isinstance(ft, (int, float)) and isinstance(fw, (int, float)) and ft > 0 and fw > 0:
        return job["filament_used"] * fw / ft
    return job["filament_used"] * g_per_mm


def day_of(ts):
    return datetime.fromtimestamp(ts, timezone.utc).astimezone(TZ).date().isoformat() if ts > 0 else None


# ---------------------------------------------------------------- the computation
def part_of(job, rules):
    name = job["filename"].lower()
    for r in rules:
        if any(m in name for m in r["match"]):
            return r
    return None


def _r(x, n=0):
    return None if x is None else (int(round(x)) if n == 0 else round(x, n))


def half(h):
    """durations: 0.5 h steps (no clock times are ever published)"""
    return None if h is None else round(h * 2) / 2.0


def month_of(ts):
    d = day_of(ts)
    return d[:7] if d else None


def energy_mxn(hours, A):
    if A.get("k1c_w") is None or A.get("mxn_per_kwh") is None:
        return None
    return hours * A["k1c_w"] / 1000.0 * A["mxn_per_kwh"]


def compute(jobs, cfg):
    """jobs: slim Moonraker jobs (any order, duplicates by job_id collapsed). cfg: load_config() output (or None).
    Returns {"rft", "copq", "make_vs_buy", "_parts", "_ledger"}; keys starting with "_" are private detail for the
    review doc and are never published."""
    cfg = cfg or {"rules": [], "overrides": {}, "ledger": [], "assumptions": {}}
    A = cfg["assumptions"]
    g_mm = A.get("g_per_mm") or 0.003054
    jobs = sorted({j["job_id"]: j for j in jobs}.values(), key=lambda j: j["start_time"])
    parts, order = {}, []
    tally = {"jobs_total": 0, "no_starts": 0, "attempts": 0, "failed": 0, "scrap_g": 0.0, "hours": 0.0, "grams": 0.0,
             "lost_h": 0.0}
    days = []
    copq_month, proposal_used = {}, set()
    copq = {"mxn": 0.0, "unpriced_g": 0.0, "unpriced_jobs": 0}
    for j in jobs:
        if j["status"] == "in_progress":
            continue
        ov = cfg["overrides"].get(j["job_id"])
        if ov == "ignore":
            continue
        tally["jobs_total"] += 1
        if j["start_time"] > 0:
            days.append(day_of(j["start_time"]))
        if j["print_duration"] < NO_START_S and j["filament_used"] < NO_START_MM:
            tally["no_starts"] += 1
            continue
        good = (ov == "good") or (ov is None and j["status"] == "completed")
        g = grams(j, g_mm)
        rule = part_of(j, cfg["rules"])
        key = rule["part_id"] if rule else "unmatched:" + j["filename"]
        if key not in parts:
            parts[key] = {"part_id": key, "public": bool(rule and rule["public"]), "title": rule and rule["title"],
                          "material": (rule or {}).get("material"), "units": [[]], "attempts": 0, "grams": 0.0,
                          "hours": 0.0, "scrap_g": 0.0, "failed": 0, "lost_h": 0.0, "copq_mxn": 0.0, "copq_priced": True,
                          "first": day_of(j["start_time"]), "last": None, "matched": bool(rule),
                          "first_start": j["start_time"] or None, "good_end": None}
            order.append(key)
        p = parts[key]
        h = j["print_duration"] / 3600.0
        att = {"job_id": j["job_id"], "good": good, "g": g, "h": h, "day": day_of(j["start_time"])}
        p["units"][-1].append(att)
        if good:
            p["units"].append([])
            p["good_end"] = j.get("end_time") or None
        p["attempts"] += 1
        p["grams"] += g
        p["hours"] += h
        p["last"] = att["day"]
        tally["attempts"] += 1
        tally["grams"] += g
        tally["hours"] += h
        if not good:
            # COPQ, internal failure: scrapped filament + the energy the failed job burned (+ machine hours lost)
            p["failed"] += 1
            p["scrap_g"] += g
            p["lost_h"] += h
            tally["failed"] += 1
            tally["scrap_g"] += g
            tally["lost_h"] += h
            mat = p["material"] or j.get("filament_type")
            kg = (A.get("mxn_per_kg") or {}).get(mat)
            en = energy_mxn(h, A)
            m = month_of(j["start_time"]) or "unknown"
            cm = copq_month.setdefault(m, {"m": m, "mxn": 0.0, "g": 0.0, "h": 0.0})
            cm["g"] += g
            cm["h"] += h
            if kg is None or en is None:
                copq["unpriced_g"] += g
                copq["unpriced_jobs"] += 1
                p["copq_priced"] = False
            else:
                mx = g / 1000.0 * kg + en
                copq["mxn"] += mx
                p["copq_mxn"] += mx
                cm["mxn"] += mx
                proposal_used |= {"kg:" + mat, "mxn_per_kwh", "k1c_w"} & set(A.get("proposal") or [])
    units = [u for p in parts.values() for u in p["units"] if u]
    delivered = [u for u in units if u[-1]["good"]]
    first_pass = sum(1 for u in units if u[0]["good"])
    att_delivered = sum(len(u) for u in delivered)
    rft = {
        "rft_pct": round(100.0 * first_pass / len(units), 1) if units else None,
        "right_first_time": first_pass, "parts_attempted": len(units), "parts_delivered": len(delivered),
        "attempts_per_part": round(att_delivered / len(delivered), 2) if delivered else None,
        "rework_attempts": att_delivered - len(delivered), "no_starts": tally["no_starts"],
        "jobs_total": tally["jobs_total"], "attempts": tally["attempts"], "failed_attempts": tally["failed"],
        "filament_g": round(tally["grams"], 1), "print_hours": round(tally["hours"], 1),
        "first_job": min(days) if days else None, "last_job": max(days) if days else None,
        "unmatched_parts": sum(1 for p in parts.values() if not p["matched"]),
    }
    pub_parts = [{"t": p["title"], "mxn": _r(p["copq_mxn"], 2) if p["copq_priced"] else None, "g": _r(p["scrap_g"], 1),
                  "h": _r(p["lost_h"], 1), "jobs": p["failed"]}
                 for p in parts.values() if p["failed"] and p["public"] and p["title"]]
    copq_out = {
        "copq_mxn": _r(copq["mxn"], 2), "assumptions_pending": bool(proposal_used),
        "unpriced_g": _r(copq["unpriced_g"], 1), "unpriced_jobs": copq["unpriced_jobs"],
        "scrap_g": _r(tally["scrap_g"], 1), "scrap_jobs": tally["failed"], "hours_lost": _r(tally["lost_h"], 1),
        "by_part": pub_parts[-10:],
        "private_scrap_jobs": sum(p["failed"] for p in parts.values() if not (p["public"] and p["title"])),
        "by_month": [{"m": v["m"], "mxn": _r(v["mxn"], 2), "g": _r(v["g"], 1), "h": _r(v["h"], 1)}
                     for k, v in sorted(copq_month.items()) if k != "unknown"][-12:],
    }
    for p in parts.values():
        p["units_n"] = len([u for u in p["units"] if u])
        p["delivered_n"] = len([u for u in p["units"] if u and u[-1]["good"]])
        p["first_pass_n"] = len([u for u in p["units"] if u and u[0]["good"]])
    mvb = make_vs_buy(cfg, parts, A)
    return {"rft": rft, "copq": copq_out, "make_vs_buy": mvb["public"], "_parts": [parts[k] for k in order],
            "_ledger": mvb["rows"]}


def _ts_local(stamp):
    try:
        return datetime.strptime(stamp, "%Y-%m-%dT%H:%M").replace(tzinfo=TZ).timestamp()
    except (TypeError, ValueError):
        return None


def make_vs_buy(cfg, parts, A):
    """Make lead time = ORDER (Erick asks for the part: ordered_at) -> end of the final good print (Moonraker),
    split into design/render (order -> first print start) and print + rework (first start -> final good end)."""
    rows = []
    for e in cfg["ledger"]:
        p = parts.get(e.get("part_id")) if e.get("part_id") else None
        t0 = _ts_local(e.get("ordered_at"))
        first, end = (p or {}).get("first_start"), (p or {}).get("good_end")
        lead_h = (end - t0) / 3600.0 if (t0 and end and end >= t0) else None
        design_h = (first - t0) / 3600.0 if (t0 and first and first >= t0) else None
        print_h = (end - first) / 3600.0 if (first and end and end >= first) else None
        buy_d = e.get("buy_lead_days") if e.get("buy_lead_days") is not None else A.get("buy_lead_days")
        saved_d = round(buy_d - lead_h / 24.0, 1) if (lead_h is not None and buy_d is not None) else None
        grams_ = p["grams"] if p else e.get("filament_g")
        hours = p["hours"] if p else None
        attempts = p["attempts"] if p else None
        cost = e.get("print_cost_mxn")
        why = []
        if t0 is None:
            why.append("ordered_at")
        if cost is None:
            kg = (A.get("mxn_per_kg") or {}).get(e.get("material"))
            if grams_ is None:
                why.append("grams")
            if kg is None:
                why.append("filament price (%s)" % (e.get("material") or "material?"))
            if hours is None or A.get("k1c_w") is None or A.get("mxn_per_kwh") is None:
                why.append("energy (hours/W/kWh)")
            if not [w for w in why if w != "ordered_at"]:
                cost = grams_ / 1000.0 * kg + energy_mxn(hours, A)
        price, ship = e.get("buy_price_mxn"), e.get("buy_shipping_mxn")
        if price is None and e.get("alternative_mxn") is not None:
            price, ship = e["alternative_mxn"], (ship if ship is not None else 0)
        tax = e.get("import_tax_pct") if e.get("import_tax_pct") is not None else A.get("import_tax_pct")
        landed = (price + ship) * (1 + tax / 100.0) if None not in (price, ship, tax) else None
        if price is None:
            why.append("buy price")
        elif ship is None:
            why.append("shipping")
        saved = (landed - cost) if (landed is not None and cost is not None) else None
        if saved is None and e.get("saving_mxn") is not None:
            saved = e["saving_mxn"]
        rows.append({"item": e.get("_item"), "part_id": e.get("part_id"), "public": e.get("public") is True,
                     "title": e.get("title") if e.get("public") is True else None, "ordered_at": e.get("ordered_at"),
                     "first_start": first, "good_end": end, "lead_h": lead_h, "design_h": design_h, "print_h": print_h,
                     "buy_d": buy_d, "saved_d": saved_d, "attempts": attempts, "grams": _r(grams_, 1),
                     "hours": _r(hours, 2), "cost_make": _r(cost, 2), "landed_buy": _r(landed, 2),
                     "saved_mxn": _r(saved, 2), "pending": why})
    known = [r for r in rows if r["lead_h"] is not None]
    med = lambda k: half(statistics.median([r[k] for r in known if r[k] is not None])) if known else None
    priced = [r["saved_mxn"] for r in rows if r["saved_mxn"] is not None]
    items = [{"t": r["title"], "make_h": half(r["lead_h"]), "design_h": half(r["design_h"]), "print_h": half(r["print_h"]),
              "buy_d": r["buy_d"], "saved_d": r["saved_d"], "saved_mxn": _r(r["saved_mxn"]), "attempts": r["attempts"]}
             for r in rows if r["public"] and r["title"]]
    mh = med("lead_h")
    pub = {"parts": len(rows), "delivered": sum(1 for r in rows if r["good_end"]), "lead_known": len(known),
           "median_make_h": mh, "median_design_h": med("design_h"), "median_print_h": med("print_h"),
           "median_days_make": round(mh / 24.0, 1) if mh is not None else None,
           "median_days_buy": A.get("buy_lead_days"),
           "days_saved_total": round(sum(r["saved_d"] for r in known), 1) if known else None,
           "mxn_saved_total": _r(sum(priced)) if priced else None,
           "priced": len(priced), "pending": len(rows) - len(priced),
           "import_tax_pct": A.get("import_tax_pct"), "buy_lead_days_default": A.get("buy_lead_days"),
           "items": items[-10:], "private_parts": sum(1 for r in rows if not r["public"])}
    return {"public": pub, "rows": rows}


def public_view(res):
    """Whitelisted public parts of compute(): nothing that starts with '_', titles only for public parts."""
    return {"rft": dict(res["rft"]), "copq": dict(res["copq"]), "make_vs_buy": dict(res["make_vs_buy"])}


# ---------------------------------------------------------------- CLI (workstation: checks + review tables)
def _fmt(v, suffix=""):
    return "pending" if v is None else ("%s%s" % (v, suffix))


def tables(res, jobs, cfg):
    out = ["### Moonraker jobs", "", "| job | day | status | counted as | part | print h | g |", "|---|---|---|---|---|---|---|"]
    g_mm = cfg["assumptions"].get("g_per_mm") or 0.003054
    for j in sorted(jobs, key=lambda j: j["start_time"]):
        ov = cfg["overrides"].get(j["job_id"])
        if j["print_duration"] < NO_START_S and j["filament_used"] < NO_START_MM:
            kind = "no-start"
        else:
            kind = "good" if (ov == "good" or (ov is None and j["status"] == "completed")) else "failed"
            if ov:
                kind += " (override)"
        r = part_of(j, cfg["rules"])
        out.append("| %s | %s | %s | %s | %s | %.2f | %.1f |" % (j["job_id"], day_of(j["start_time"]), j["status"], kind,
                   r["part_id"] if r else "unmatched", j["print_duration"] / 3600.0, grams(j, g_mm)))
    out += ["", "### Parts (RFT + COPQ)", "", "| part | public | attempts | delivered | right first time | failed | scrap g | hours lost | COPQ MXN | g total | print h |",
            "|---|---|---|---|---|---|---|---|---|---|---|"]
    for p in res["_parts"]:
        out.append("| %s | %s | %d | %d | %d | %d | %.1f | %.2f | %s | %.1f | %.2f |" % (p["part_id"], "yes" if p["public"] else "**no**",
                   p["attempts"], p["delivered_n"], p["first_pass_n"], p["failed"], p["scrap_g"], p["lost_h"],
                   ("%.2f" % p["copq_mxn"]) if p["copq_priced"] else ("%.2f + unpriced" % p["copq_mxn"] if p["copq_mxn"] else "pending"),
                   p["grams"], p["hours"]))
    loc = lambda ts: datetime.fromtimestamp(ts, timezone.utc).astimezone(TZ).strftime("%Y-%m-%d %H:%M") if ts else "pending"
    hh = lambda h: "pending" if h is None else "%.1f h" % h
    out += ["", "### Make vs buy (per ledger entry; lead time = order → final good print)", "",
            "| part | public | ordered_at | first print start | final good end | lead time | design/render | print + rework | buy d | days saved | attempts | g (all attempts) | cost make MXN | landed buy MXN | MXN saved | pending inputs |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in res["_ledger"]:
        out.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            r["part_id"] or r["item"], "yes" if r["public"] else "**no**", _fmt(r["ordered_at"]), loc(r["first_start"]),
            loc(r["good_end"]), hh(r["lead_h"]), hh(r["design_h"]), hh(r["print_h"]), _fmt(r["buy_d"]), _fmt(r["saved_d"]),
            _fmt(r["attempts"]), _fmt(r["grams"]), _fmt(r["cost_make"]), _fmt(r["landed_buy"]), _fmt(r["saved_mxn"]),
            ", ".join(r["pending"]) or "—"))
    return "\n".join(out)


def main(argv):
    repo = argv[argv.index("--repo") + 1] if "--repo" in argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    try:
        cfg = load_config(repo)
    except (OSError, ValueError) as e:
        print("printing config: %s" % e, file=sys.stderr)
        return 2
    if "--check" in argv:
        print("ok: %d part rules · %d overrides · %d ledger entries" % (len(cfg["rules"]), len(cfg["overrides"]), len(cfg["ledger"])))
        return 0
    if "--jobs" in argv:
        jobs = json.load(open(argv[argv.index("--jobs") + 1]))
        jobs = [slim_job(j) if "metadata" in j else j for j in (jobs.get("result", {}).get("jobs") if isinstance(jobs, dict) else jobs)]
    else:
        jobs = fetch_jobs(os.environ["KL_MOONRAKER"])
    res = compute(jobs, cfg)
    if "--table" in argv:
        print(tables(res, jobs, cfg))
    else:
        print(json.dumps(public_view(res), indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
