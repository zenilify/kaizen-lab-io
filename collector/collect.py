#!/usr/bin/env python3
"""kaizen-lab.io collector: build the WHITELISTED public metrics snapshot and PUT it to Workers KV.

Runs every 15 min from kaizen-lab-collector.timer (the lab worker container). Push-only: nothing on the
internet can reach the lab; the lab sends an aggregate snapshot out.

Sources (each one isolated: a failing source yields status "stale" with its last value, or "unknown"):
  1 uptime + backups  Uptime Kuma (python uptime-kuma-api, socket timeouts; landmine 234: the Kuma
                      MCP can hang and the DB was corrupt on 10-07/08, so treat errors as "unknown")
  2 AI renders        ComfyUI /history on every mesh node that answers (asleep nodes keep their counts)
  3 PDCA cycles       Perseus (HTTP MCP): landmine-next-free + landmine entities (hourly, cached)
  4 ideas             /var/lib/kaizen-lab/ideas.json, pushed hourly by the workstation probe: the idea-funnel aggregate of the
                      repo ledger data/ideas.yaml (tools/ideas.py) + quick-capture counts per ISO week
  5 3D printing       K1C Moonraker history (read-only GET /server/history/list) -> rework / first-pass yield,
                      + make vs buy per part from the repo ledger; config (print-map, ledger, assumptions) and a
                      fallback copy of the history ride ideas.json from the workstation probe. Printer off = cached jobs carried.
  (the legacy 3D-savings tile is a static ledger in the repo; the site reads it directly)

Secrets come from systemd EnvironmentFile= (/etc/kaizen-lab/*.env, 0600) and the 0600 Perseus header
file. Nothing secret is ever printed, logged, or put in argv.
"""
import json, os, re, signal, socket, statistics, sys, time, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import printing                                    # collector/printing.py, installed next to this file

TZ = ZoneInfo("America/Mexico_City")
STATE_DIR = os.environ.get("KL_STATE_DIR", "/var/lib/kaizen-lab")
ETC = os.environ.get("KL_ETC", "/etc/kaizen-lab")
STATE = os.path.join(STATE_DIR, "state.json")
OUT = os.path.join(STATE_DIR, "metrics.json")
IDEAS = os.path.join(STATE_DIR, "ideas.json")
DRY = "--dry-run" in sys.argv

signal.alarm(int(os.environ.get("KL_HARD_TIMEOUT", "240")))   # never hang a timer slot
socket.setdefaulttimeout(20)


def log(*a):
    print(*a, flush=True)


def now_utc():
    return datetime.now(timezone.utc)


def today():
    return now_utc().astimezone(TZ).date()


def load_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_json(path, obj, mode=0o640):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=1, sort_keys=True)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def ids(var):
    return [int(x) for x in os.environ.get(var, "").replace(" ", "").split(",") if x]


# ---------------------------------------------------------------- 1. Uptime Kuma
def kuma_parse_time(s):
    # Kuma stores heartbeat time in UTC as "YYYY-MM-DD HH:MM:SS(.fff)"
    return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)


def collect_kuma(st):
    from uptime_kuma_api import UptimeKumaApi, MonitorStatus
    core, backups = ids("KUMA_CORE_IDS"), ids("KUMA_BACKUP_IDS")
    api = UptimeKumaApi(os.environ["KUMA_URL"], timeout=20)
    try:
        api.login(os.environ["KUMA_USER"], os.environ["KUMA_PASS"])
        up = api.uptime()                       # {id: {24: frac, 720: frac, ...}}
        mons = {m["id"]: m for m in api.get_monitors()}
        # ---- uptime (aggregate of the core services; paused monitors are skipped)
        core = [i for i in core if i in mons and mons[i].get("active")]
        u30 = [up[i][720] for i in core if i in up and up[i].get(720) is not None]
        u24 = [up[i][24] for i in core if i in up and up[i].get(24) is not None]
        if not u30:
            raise RuntimeError("no uptime values for the core monitors")
        day = today().isoformat()
        daily = st.setdefault("uptime_daily", {})
        if u24:
            daily[day] = round(100 * sum(u24) / len(u24), 3)   # last run of the day wins
        for d in sorted(daily)[:-35]:
            daily.pop(d)
        uptime = {"status": "ok", "value_pct": round(100 * sum(u30) / len(u30), 2), "window_days": 30,
                  "services": len(u30),
                  "trend": [{"d": d, "pct": round(daily[d], 2)} for d in sorted(daily)[-30:]]}
        # ---- backups: a day is bad when any job has a DOWN beat overlapping it
        backups = [i for i in backups if i in mons and mons[i].get("active")]
        bad = set()
        first_seen = {}
        for mid in backups:
            beats = api.get_monitor_beats(mid, 24 * 31)
            for b in beats:
                t0 = kuma_parse_time(b["time"]).astimezone(TZ)
                first_seen[mid] = min(first_seen.get(mid, t0.date()), t0.date())
                # Kuma 2 condenses beats; `duration` is the time since the PREVIOUS beat, so a DOWN
                # beat marks the day it was recorded (the job missed its window), not the days after.
                if b["status"] == MonitorStatus.DOWN:
                    bad.add(t0.date())
            if beats and beats[-1]["status"] == MonitorStatus.DOWN:
                bad.add(today())                      # still down right now: today is not green
        if not backups:
            raise RuntimeError("no active backup monitors")
        start = max(first_seen.values()) if first_seen else today()
        streak, d = 0, today()
        while d >= start and d not in bad and streak < 365:
            streak += 1
            d -= timedelta(days=1)
        trend = []
        for k in range(29, -1, -1):
            dd = today() - timedelta(days=k)
            if dd >= start:
                trend.append({"d": dd.isoformat(), "ok": dd not in bad})
        backups_out = {"status": "ok", "streak_days": streak, "jobs": len(backups), "trend": trend}
        return uptime, backups_out
    finally:
        try:
            api.disconnect()
        except Exception:
            pass


# ---------------------------------------------------------------- 2. ComfyUI renders
def http_json(url, timeout=6, headers=None, data=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def collect_renders(st):
    nodes = json.load(open(os.path.join(ETC, "nodes.json")))["nodes"]
    seen = st.setdefault("renders_seen", {})        # "<node#>:<prompt_id>" -> [day, seconds, images]
    answering = 0
    for idx, n in enumerate(nodes):
        try:
            hist = http_json("http://%s:%d/history" % (n["host"], n["port"]), timeout=6)
        except Exception:
            continue                                   # asleep / offline: keep what we already counted
        answering += 1
        for pid, item in hist.items():
            key = "%d:%s" % (idx, pid)
            if key in seen:
                continue
            s = item.get("status") or {}
            if s.get("status_str") != "success":
                continue
            ts = {}
            for m in s.get("messages") or []:
                if isinstance(m, list) and len(m) == 2 and isinstance(m[1], dict):
                    ts[m[0]] = m[1].get("timestamp")
            t0, t1 = ts.get("execution_start"), ts.get("execution_success")
            if not (t0 and t1 and t1 >= t0):
                continue
            imgs = 0
            for o in (item.get("outputs") or {}).values():
                for kind in ("images", "gifs", "videos"):
                    imgs += sum(1 for x in (o.get(kind) or []) if isinstance(x, dict) and x.get("type") == "output")
            day = datetime.fromtimestamp(t1 / 1000, timezone.utc).astimezone(TZ).date().isoformat()
            seen[key] = [day, round((t1 - t0) / 1000.0, 2), max(1, imgs)]
    cutoff = (today() - timedelta(days=9)).isoformat()
    for k in [k for k, v in seen.items() if v[0] < cutoff]:
        seen.pop(k)
    days = [(today() - timedelta(days=k)).isoformat() for k in range(6, -1, -1)]
    per_day = {d: 0 for d in days}
    spi = []
    for day, secs, imgs in seen.values():
        if day in per_day:
            per_day[day] += imgs
            spi.append(secs / imgs)
    total = sum(per_day.values())
    status = "ok" if answering else "stale"
    return {"status": status, "per_day": [{"d": d, "n": per_day[d]} for d in days], "total_7d": total,
            "avg_per_day": round(total / 7.0, 1),
            "median_s_per_image": round(statistics.median(spi), 1) if spi else None,
            "nodes_answering": answering, "nodes_total": len(nodes)}


# ---------------------------------------------------------------- 3. Perseus (PDCA = landmines)
class Perseus:
    def __init__(self):
        self.url = os.environ["PERSEUS_URL"]
        self.h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
        path = os.path.join(ETC, "perseus.headers")
        if os.stat(path).st_mode & 0o077:
            raise RuntimeError("perseus.headers is not 0600")
        for line in open(path):
            if ":" in line:
                k, v = line.split(":", 1)
                self.h[k.strip()] = v.strip()
        self.n = 0
        self.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                "clientInfo": {"name": "kaizen-lab-collector", "version": "1"}}, keep=True)
        try:
            self.rpc("notifications/initialized", None, notify=True)
        except Exception:
            pass

    def rpc(self, method, params, notify=False, keep=False):
        body = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notify:
            self.n += 1
            body["id"] = self.n
        req = urllib.request.Request(self.url, json.dumps(body).encode(), self.h)
        with urllib.request.urlopen(req, timeout=60) as r:
            if keep and r.headers.get("Mcp-Session-Id"):
                self.h["Mcp-Session-Id"] = r.headers["Mcp-Session-Id"]
            raw = r.read().decode("utf-8", "replace")
        if notify or not raw.strip():
            return None
        msg = None
        if raw.lstrip().startswith("{"):
            msg = json.loads(raw)
        else:
            for line in raw.splitlines():
                if line.startswith("data:"):
                    c = json.loads(line[5:].strip())
                    if c.get("id") == body.get("id"):
                        msg = c
        if not msg or "error" in msg:
            raise RuntimeError("perseus %s failed" % method)
        return msg["result"]

    def tool(self, name, args):
        res = self.rpc("tools/call", {"name": name, "arguments": args})
        if res.get("isError"):
            raise RuntimeError("perseus tool %s isError" % name)
        if res.get("structuredContent"):
            return res["structuredContent"]
        return json.loads("".join(c.get("text", "") for c in res.get("content", [])))


CLOSED_RE = re.compile(r"mitigat|fixed|resolved|closed|\bdone\b|(?<!un)verified", re.I)
LM_KEY = re.compile(r"^landmine-(\d+)[a-z]?-")


def collect_pdca(st):
    cache = st.get("pdca_cache")
    if cache and time.time() - cache.get("at", 0) < 6 * 3600:
        return cache["value"]
    p = Perseus()
    sv = p.tool("perseus_vault_state_get", {"key": "landmine-next-free"})
    val = sv.get("value")
    val = json.loads(val) if isinstance(val, str) else (val or {})
    total = int(val.get("last_assigned") or (int(val["next"]) - 1))
    lm = {}
    # Read-only on purpose: a keyword (fts5) recall REINFORCES every hit (retrieval_count, decay), so an
    # unattended enumeration would keep every entity artificially fresh. Dense recall with reinforce=false
    # is side-effect-free. It ranks rather than lists, so coverage is reported as recorded_entities.
    for q in ("landmine gotcha failure root cause countermeasure", "landmine"):
        r = p.tool("perseus_vault_recall", {"query": q, "mode": "dense", "reinforce": False, "limit": 1000})
        items = r.get("items", [])
        for it in items:
            m = LM_KEY.match(it.get("key") or "")
            if not m:
                continue
            num = int(m.group(1))
            body = it
            try:
                body = dict(it, **json.loads(it.get("body_json") or "{}"))
            except ValueError:
                pass
            status = str(body.get("status") or "")
            date = str(body.get("date") or "")[:10]
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                date = datetime.fromtimestamp((it.get("created_at_unix_ms") or 0) / 1000, TZ).date().isoformat()
            prev = lm.get(num)
            closed = bool(CLOSED_RE.search(status))
            lm[num] = {"closed": closed or (prev or {}).get("closed", False), "date": min(date, (prev or {}).get("date", date))}
    closed = sum(1 for v in lm.values() if v["closed"])
    weeks = {}
    for v in lm.values():
        y, w, _ = datetime.strptime(v["date"], "%Y-%m-%d").isocalendar()
        weeks["%d-W%02d" % (y, w)] = weeks.get("%d-W%02d" % (y, w), 0) + 1
    last8 = []
    for k in range(7, -1, -1):
        y, w, _ = (today() - timedelta(weeks=k)).isocalendar()
        key = "%d-W%02d" % (y, w)
        last8.append({"w": key, "n": weeks.get(key, 0)})
    value = {"status": "ok", "total": total, "recorded_entities": len(lm), "closed": closed,
             "open": len(lm) - closed, "per_week": last8}
    st["pdca_cache"] = {"at": time.time(), "value": value}
    return value


# ---------------------------------------------------------------- 4. ideas (counts pushed by the workstation probe)
def collect_ideas(st):
    """Idea funnel since 2026-07-01. The workstation probe (private ops repo) reads the ledger (data/ideas.yaml) through
    tools/ideas.py and pushes {generated_at, per_week (quick captures), ledger (public aggregate)} hourly over
    the existing workstation -> worker ssh trust. Every field is re-validated by whitelist() below."""
    d = json.load(open(IDEAS))
    gen = datetime.strptime(d["generated_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    led = d.get("ledger")
    if not isinstance(led, dict) or not isinstance(led.get("total"), int):
        raise ValueError("ideas.json carries no ledger aggregate")
    weeks = {w["w"]: int(w["n"]) for w in d.get("per_week", []) if re.match(r"^\d{4}-W\d{2}$", str(w["w"]))}
    last8 = []
    for k in range(7, -1, -1):
        y, w, _ = (today() - timedelta(weeks=k)).isocalendar()
        key = "%d-W%02d" % (y, w)
        last8.append({"w": key, "n": weeks.get(key, 0)})
    stale = now_utc() - gen > timedelta(hours=26)
    out = {k: led.get(k) for k in IDEA_FIELDS if k in led}
    out.update({"status": "stale" if stale else "ok", "captures_per_week": last8})
    return out


# ---------------------------------------------------------------- 5. 3D printing (K1C, lane L100)
def collect_printing(st):
    """Returns (rework, make_vs_buy). The K1C is often powered off: jobs are cached by job_id in state, so the
    KPI keeps its last value (history_as_of says when the printer was last read). READ-ONLY API calls only."""
    try:
        d = json.load(open(IDEAS))
    except (OSError, ValueError):
        d = {}
    if isinstance(d.get("printing_config"), dict):
        st["k1c_cfg"] = d["printing_config"]
    cfg = st.get("k1c_cfg")
    cache = st.setdefault("k1c_jobs", {})
    reachable, read_day = False, st.get("k1c_read_day")
    try:
        jobs = printing.fetch_jobs(os.environ["KL_MOONRAKER"], timeout=6)
        reachable, read_day = True, today().isoformat()
    except Exception:
        jobs = []
    if not reachable and isinstance(d.get("k1c_jobs"), list) and d.get("k1c_read_at"):
        jobs = d["k1c_jobs"]                           # the workstation's hourly read (fallback path)
        read_day = max(read_day or "", datetime.strptime(d["k1c_read_at"], "%Y-%m-%dT%H:%M:%SZ")
                       .replace(tzinfo=timezone.utc).astimezone(TZ).date().isoformat())
    for j in jobs:
        if isinstance(j, dict) and j.get("job_id"):
            cache[str(j["job_id"])] = {k: j.get(k) for k in ("job_id", "filename", "status", "start_time", "end_time", "print_duration",
                                                             "filament_used", "filament_total", "filament_weight_total",
                                                             "filament_type")}
    st["k1c_read_day"] = read_day
    if not cache:
        raise RuntimeError("no K1C history yet")
    res = printing.compute(list(cache.values()), cfg)
    led = d.get("ledger") or {}
    impl, rw_ideas = led.get("implemented"), led.get("rework_ideas")
    lab_rft = round(100.0 * (impl - rw_ideas) / impl, 1) if isinstance(impl, int) and isinstance(rw_ideas, int) and impl else None
    rft = dict(res["rft"], status="ok", printer_reachable=reachable, history_as_of=read_day, lab_rft_pct=lab_rft,
               lab_rework_ideas=rw_ideas, lab_rework_cycles=led.get("rework_cycles"), lab_implemented=impl)
    copq = dict(res["copq"], status="ok" if cfg else "unknown")
    mvb = dict(res["make_vs_buy"], status="ok" if cfg else "unknown")
    return rft, copq, mvb


# ---------------------------------------------------------------- whitelist
SAFE_STR = re.compile(r"^(\d{4}-\d{2}-\d{2}|\d{4}-\d{2}|\d{4}-W\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z|ok|stale|unknown)$")
# Ideas KPI = idea funnel since 2026-07-01 from the repo ledger (data/ideas.yaml -> tools/ideas.py summary()).
# captures_per_week (quick-capture notes + voice ideas per ISO week) is kept as a secondary series.
IDEA_FIELDS = ("since", "as_of", "total", "implemented", "in_progress", "parked", "dropped",
               "implementation_rate_pct", "by_category", "monthly", "public_titles_implemented", "under_review")
SCHEMA = {
    "schema": None, "updated_at": None, "kpis": {
        "uptime": {"status", "value_pct", "window_days", "services", "trend"},
        "backups": {"status", "streak_days", "jobs", "trend"},
        "renders": {"status", "per_day", "total_7d", "avg_per_day", "median_s_per_image", "nodes_answering", "nodes_total"},
        "pdca": {"status", "total", "recorded_entities", "closed", "open", "per_week"},
        "ideas": {"status", "captures_per_week"} | set(IDEA_FIELDS),
        # L100b: Lean terms. RFT = Right First Time, COPQ = Cost of Poor Quality (internal failure)
        "rft": {"status", "rft_pct", "right_first_time", "parts_attempted", "parts_delivered", "attempts_per_part",
                "rework_attempts", "no_starts", "jobs_total", "attempts", "failed_attempts", "filament_g", "print_hours",
                "first_job", "last_job", "unmatched_parts", "printer_reachable", "history_as_of",
                "lab_rft_pct", "lab_rework_ideas", "lab_rework_cycles", "lab_implemented"},
        "copq": {"status", "copq_mxn", "assumptions_pending", "unpriced_g", "unpriced_jobs", "scrap_g", "scrap_jobs",
                 "hours_lost", "by_part", "private_scrap_jobs", "by_month"},
        "make_vs_buy": {"status", "parts", "delivered", "lead_known", "median_make_h", "median_design_h", "median_print_h",
                        "median_days_make", "median_days_buy", "days_saved_total", "mxn_saved_total", "priced", "pending",
                        "import_tax_pct", "buy_lead_days_default", "items", "private_parts"},
    }}
TITLED_LISTS = {"make_vs_buy.items": {"t", "make_h", "design_h", "print_h", "buy_d", "saved_d", "saved_mxn", "attempts"},
                "copq.by_part": {"t", "mxn", "g", "h", "jobs"}}
TREND_KEYS = {"d", "pct", "ok", "n", "w", "m", "raised", "implemented", "mxn", "g", "h"}
IDEA_CATEGORIES = {"voice", "smart-home", "visualization", "diagrams", "icons", "3d-printing-design", "storage-backup",
                   "networking", "ai-genai", "automation", "ops-tooling", "web-brand", "other"}
# public idea titles: same rules as tools/ideas.py, re-checked here (defence in depth)
TITLE_OK = re.compile(r"^[A-Za-z0-9 ,.:;()'+/&\-→—–]{3,90}$")
TITLE_BAN = printing.TITLE_BAN                    # one list, built in printing.py (KL_TITLE_BAN_FILE)


def check_value(v, where):
    if v is None or isinstance(v, bool) or isinstance(v, (int, float)):
        return
    if where == "ideas.public_titles_implemented":
        if not isinstance(v, list) or len(v) > 10:
            raise ValueError("bad public title list")
        for t in v:
            if not isinstance(t, str) or not TITLE_OK.match(t) or TITLE_BAN.search(t):
                raise ValueError("public idea title fails the whitelist")
        return
    if where in TITLED_LISTS:
        # public parts only (public: true); a whitelisted title + numbers, nothing else
        if not isinstance(v, list) or len(v) > 10:
            raise ValueError("bad titled list at %s" % where)
        for x in v:
            if not isinstance(x, dict) or set(x) - TITLED_LISTS[where]:
                raise ValueError("bad keys at %s" % where)
            t = x.get("t")
            if not isinstance(t, str) or not TITLE_OK.match(t) or TITLE_BAN.search(t):
                raise ValueError("title fails the whitelist at %s" % where)
            for k, y in x.items():
                if k != "t" and not (y is None or (isinstance(y, (int, float)) and not isinstance(y, bool))):
                    raise ValueError("bad value at %s" % where)
        return
    if where == "ideas.by_category":
        if not isinstance(v, dict) or set(v) - IDEA_CATEGORIES:
            raise ValueError("bad idea category")
        for c, x in v.items():
            if not isinstance(x, dict) or set(x) != {"raised", "implemented"} or \
                    not all(isinstance(y, int) and not isinstance(y, bool) for y in x.values()):
                raise ValueError("bad category counts at %s" % c)
        return
    if isinstance(v, str):
        if not SAFE_STR.match(v):
            raise ValueError("non-whitelisted string at %s" % where)
        return
    if isinstance(v, list):
        for i, x in enumerate(v):
            if not isinstance(x, dict) or set(x) - TREND_KEYS:
                raise ValueError("bad trend item at %s[%d]" % (where, i))
            for k, y in x.items():
                check_value(y, "%s[%d].%s" % (where, i, k))
        return
    raise ValueError("bad type at %s" % where)


def whitelist(raw):
    """Copy ONLY the named fields; anything else a source returns is dropped. Then validate values."""
    out = {"schema": 1, "updated_at": raw["updated_at"], "kpis": {}}
    for kpi, fields in SCHEMA["kpis"].items():
        src = raw["kpis"].get(kpi) or {"status": "unknown"}
        out["kpis"][kpi] = {f: src.get(f) for f in sorted(fields) if f in src}
        for f, v in out["kpis"][kpi].items():
            check_value(v, "%s.%s" % (kpi, f))
    check_value(out["updated_at"], "updated_at")
    return out


# ---------------------------------------------------------------- Workers KV
def kv_put(doc):
    url = "https://api.cloudflare.com/client/v4/accounts/%s/storage/kv/namespaces/%s/values/metrics" % (
        os.environ["CF_ACCOUNT_ID"], os.environ["CF_KV_NAMESPACE_ID"])
    req = urllib.request.Request(url, data=json.dumps(doc, separators=(",", ":")).encode(), method="PUT",
                                 headers={"Authorization": "Bearer " + os.environ["CF_KV_TOKEN"],
                                          "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            res = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError("KV PUT HTTP %d" % e.code)
    if not res.get("success"):
        raise RuntimeError("KV PUT refused: %s" % [x.get("code") for x in res.get("errors", [])])


# ---------------------------------------------------------------- main
def main():
    os.makedirs(STATE_DIR, exist_ok=True)
    st = load_state()
    last = st.get("last_kpis", {})
    kpis = {}

    def run(name, fn):
        t = time.time()
        try:
            res = fn(st)
            log("%-8s ok    %.1fs" % (name, time.time() - t))
            return res
        except Exception as e:                     # type only: messages could carry URLs
            log("%-8s FAIL  %.1fs %s" % (name, time.time() - t, type(e).__name__))
            return None

    def carry(name, value):
        if value is not None:
            kpis[name] = value
        elif last.get(name):
            kpis[name] = dict(last[name], status="stale")
        else:
            kpis[name] = {"status": "unknown"}

    k = run("kuma", collect_kuma)
    carry("uptime", k[0] if k else None)
    carry("backups", k[1] if k else None)
    carry("renders", run("renders", collect_renders))
    carry("pdca", run("pdca", collect_pdca))
    carry("ideas", run("ideas", collect_ideas))
    pr = run("printing", collect_printing)
    carry("rft", pr[0] if pr else None)
    carry("copq", pr[1] if pr else None)
    carry("make_vs_buy", pr[2] if pr else None)

    doc = whitelist({"updated_at": now_utc().strftime("%Y-%m-%dT%H:%M:%SZ"), "kpis": kpis})
    st["last_kpis"] = {n: v for n, v in kpis.items() if v.get("status") == "ok"} or last
    for n, v in last.items():
        st["last_kpis"].setdefault(n, v)
    save_json(STATE, st, 0o600)
    save_json(OUT, doc, 0o644)
    u, b, r, p, i = (doc["kpis"][x] for x in ("uptime", "backups", "renders", "pdca", "ideas"))
    rf, cq, mv = doc["kpis"]["rft"], doc["kpis"]["copq"], doc["kpis"]["make_vs_buy"]
    log("values   3d: rft=%s%% lab_rft=%s%% copq=%sMXN (+%sg unpriced) scrap=%sg lost=%sh printer=%s · make=%sh (design %sh, print %sh) vs buy %sd · mxn=%s (pending %s)" % (
        rf.get("rft_pct"), rf.get("lab_rft_pct"), cq.get("copq_mxn"), cq.get("unpriced_g"), cq.get("scrap_g"), cq.get("hours_lost"),
        rf.get("printer_reachable"), mv.get("median_make_h"), mv.get("median_design_h"), mv.get("median_print_h"),
        mv.get("median_days_buy"), mv.get("mxn_saved_total"), mv.get("pending")))
    log("values   uptime=%s%% streak=%sd renders7d=%s median=%ss pdca=%s closed=%s ideas=%s/%s" % (
        u.get("value_pct"), b.get("streak_days"), r.get("total_7d"), r.get("median_s_per_image"),
        p.get("total"), p.get("closed"), i.get("implemented"), i.get("total")))
    if DRY:
        log("dry-run: KV not written")
        return 0
    try:
        kv_put(doc)
        log("kv       PUT ok  updated_at=%s" % doc["updated_at"])
        return 0
    except Exception as e:
        log("kv       FAIL %s" % (e if isinstance(e, RuntimeError) else type(e).__name__))
        return 1


if __name__ == "__main__":
    sys.exit(main())
