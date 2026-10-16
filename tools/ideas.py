#!/usr/bin/env python3
"""Idea ledger (data/ideas.yaml) -> validated entries -> the PUBLIC aggregate for the Ideas KPI.

The ledger is the source of truth: one entry per distinct idea raised since 2026-07-01, with status and
evidence. Only aggregates leave the repo, plus the titles of implemented ideas marked `public: true`
(newest 10), each re-checked against a character whitelist and a privacy ban list.

Usage:
  python3 tools/ideas.py data/ideas.yaml              # public aggregate JSON (stdout)
  python3 tools/ideas.py data/ideas.yaml --check      # validate only, print counts
  python3 tools/ideas.py data/ideas.yaml --table      # full Markdown table (private: for the review doc)
Exit 2 on a malformed ledger, so a deploy or a probe run stops instead of publishing garbage.
Imported by the workstation probe (summary()) — no third-party modules (no PyYAML there).
"""
import json, os, re, sys
from datetime import date, datetime
from zoneinfo import ZoneInfo

SINCE = "2026-07-01"
TZ = ZoneInfo("America/Mexico_City")
CATEGORIES = ["voice", "smart-home", "visualization", "diagrams", "icons", "3d-printing-design",
              "storage-backup", "networking", "ai-genai", "automation", "ops-tooling", "web-brand", "other"]
STATUSES = ["implemented", "in-progress", "parked", "dropped"]
KEYS = {"id", "title", "category", "raised", "status", "implemented", "evidence", "public", "note", "reworks", "rework_evidence"}
REQUIRED = KEYS - {"note", "reworks", "rework_evidence"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# public titles: plain words and light punctuation only; no hostnames, addresses, people or places
TITLE_OK = re.compile(r"^[A-Za-z0-9 ,.:;()'+/&\-→—–]{3,90}$")
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


def _value(raw, n):
    v = raw.strip()
    if v == "null":
        return None
    if v in ("true", "false"):
        return v == "true"
    if v.startswith('"') or v.startswith("["):
        try:
            return json.loads(v)
        except ValueError:
            raise ValueError("line %d: bad quoted value or list" % n)
    return v


def parse(text):
    entries, cur = [], None
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^(- |  )([a-z_]+):\s*(.*)$", line)
        if not m:
            raise ValueError("line %d: not 'key: value'" % n)
        lead, key, val = m.groups()
        if key not in KEYS:
            raise ValueError("line %d: unknown key %r" % (n, key))
        if lead == "- ":
            if key != "id":
                raise ValueError("line %d: an entry must start with '- id:'" % n)
            cur = {"_line": n}
            entries.append(cur)
        elif cur is None:
            raise ValueError("line %d: key outside an entry" % n)
        if key in cur:
            raise ValueError("line %d: duplicate key %r" % (n, key))
        cur[key] = _value(val, n)
    return entries


def validate(entries):
    seen = set()
    for e in entries:
        where = "%s (line %d)" % (e.get("id"), e["_line"])
        missing = REQUIRED - set(e)
        if missing:
            raise ValueError("%s: missing %s" % (where, sorted(missing)))
        if not re.match(r"^I-\d{3}$", str(e["id"])) or e["id"] in seen:
            raise ValueError("%s: bad or duplicate id" % where)
        seen.add(e["id"])
        if not isinstance(e["title"], str) or not e["title"].strip():
            raise ValueError("%s: title must be a quoted string" % where)
        if e["category"] not in CATEGORIES:
            raise ValueError("%s: unknown category %r" % (where, e["category"]))
        if e["status"] not in STATUSES:
            raise ValueError("%s: unknown status %r" % (where, e["status"]))
        for k in ("raised", "implemented"):
            v = e[k]
            if v is None and k == "implemented":
                continue
            if not (isinstance(v, str) and DATE.match(v)):
                raise ValueError("%s: %s must be YYYY-MM-DD" % (where, k))
            date.fromisoformat(v)
        if e["raised"] < SINCE:
            raise ValueError("%s: raised before %s" % (where, SINCE))
        if e["status"] == "implemented" and not e["implemented"]:
            raise ValueError("%s: implemented needs a date" % where)
        if e["status"] in ("in-progress", "parked") and e["implemented"]:
            raise ValueError("%s: %s must have implemented: null" % (where, e["status"]))
        if e["implemented"] and e["implemented"] < e["raised"]:
            raise ValueError("%s: implemented before raised" % where)
        ev = e["evidence"]
        if not (isinstance(ev, list) and ev and all(isinstance(x, str) and re.match(r"^(vault|git): \S", x) for x in ev)):
            raise ValueError("%s: evidence must be a non-empty list of 'vault: …' / 'git: …'" % where)
        if not isinstance(e["public"], bool):
            raise ValueError("%s: public must be true or false" % where)
        # lab-level rework (lane L100): optional; reworks = redo cycles after the first working attempt
        if "reworks" in e:
            try:
                e["reworks"] = int(e["reworks"])
            except (TypeError, ValueError):
                raise ValueError("%s: reworks must be an integer" % where)
            re_ev = e.get("rework_evidence")
            if e["reworks"] < 0 or (e["reworks"] > 0 and not (isinstance(re_ev, list) and re_ev and all(
                    isinstance(x, str) and re.match(r"^(vault|git|repo): \S", x) for x in re_ev))):
                raise ValueError("%s: reworks > 0 needs rework_evidence ['vault: …' / 'git: …' / 'repo: …']" % where)
        elif "rework_evidence" in e:
            raise ValueError("%s: rework_evidence without reworks" % where)
        if e["public"] and e["status"] == "implemented":
            if not TITLE_OK.match(e["title"]) or TITLE_BAN.search(e["title"]):
                raise ValueError("%s: public title fails the privacy whitelist — rephrase or set public: false" % where)
    return entries


def load(path):
    with open(path, encoding="utf-8") as f:
        return validate(parse(f.read()))


def months(since, until):
    y, m = int(since[:4]), int(since[5:7])
    out = []
    while (y, m) <= (until.year, until.month):
        out.append("%04d-%02d" % (y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def summary(entries, today=None):
    """The public aggregate. Only counts, months, categories and vetted public titles."""
    today = today or datetime.now(TZ).date()
    count = {s: sum(1 for e in entries if e["status"] == s) for s in STATUSES}
    total = len(entries)
    by_cat = {c: {"raised": 0, "implemented": 0} for c in CATEGORIES}
    mon = {m: {"m": m, "raised": 0, "implemented": 0} for m in months(SINCE, today)}
    for e in entries:
        by_cat[e["category"]]["raised"] += 1
        if e["raised"][:7] in mon:
            mon[e["raised"][:7]]["raised"] += 1
        if e["status"] == "implemented":
            by_cat[e["category"]]["implemented"] += 1
            if e["implemented"][:7] in mon:
                mon[e["implemented"][:7]]["implemented"] += 1
    pub = sorted((e for e in entries if e["public"] and e["status"] == "implemented"),
                 key=lambda e: (e["implemented"], e["id"]), reverse=True)[:10]
    return {"since": SINCE, "as_of": today.isoformat(), "total": total,
            "implemented": count["implemented"], "in_progress": count["in-progress"],
            "parked": count["parked"], "dropped": count["dropped"],
            "implementation_rate_pct": round(100.0 * count["implemented"] / total, 1) if total else None,
            "by_category": {c: v for c, v in by_cat.items() if v["raised"]},
            "monthly": [mon[m] for m in sorted(mon)],
            "public_titles_implemented": [e["title"] for e in pub],
            "under_review": True,
            # lab-level rework (L100): share of implemented ideas with >= 1 documented redo cycle. Seeded only
            # where evidence exists, so it is a floor, not a measurement of every idea ("first count · under review").
            "rework_ideas": sum(1 for e in entries if e["status"] == "implemented" and e.get("reworks", 0) > 0),
            "rework_cycles": sum(e.get("reworks", 0) for e in entries if e["status"] == "implemented"),
            "lab_rework_pct": round(100.0 * sum(1 for e in entries if e["status"] == "implemented" and e.get("reworks", 0) > 0)
                                    / count["implemented"], 1) if count["implemented"] else None}


def table(entries):
    rows = ["| id | title | category | raised | status | implemented | public |", "|---|---|---|---|---|---|---|"]
    for e in entries:
        t = e["title"].replace("|", "/") + (" · *%s*" % e["note"].replace("|", "/") if e.get("note") else "")
        rows.append("| %s | %s | %s | %s | %s | %s | %s |" % (e["id"], t, e["category"], e["raised"], e["status"],
                                                            e["implemented"] or "—", "yes" if e["public"] else "**no**"))
    return "\n".join(rows)


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        entries = load(argv[1])
    except (OSError, ValueError) as e:
        print("ideas ledger: %s" % e, file=sys.stderr)
        return 2
    if "--table" in argv:
        print(table(entries))
    elif "--check" in argv:
        s = summary(entries)
        print("ok: %d ideas · %d implemented (%s%%) · %d in progress · %d parked · %d dropped" % (
            s["total"], s["implemented"], s["implementation_rate_pct"], s["in_progress"], s["parked"], s["dropped"]))
    else:
        print(json.dumps(summary(entries), indent=1, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
