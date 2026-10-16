#!/usr/bin/env python3
"""Convert data/3d-savings.yaml (restricted flat format, see its header) to the public JSON.

Only whitelisted fields leave the repo: date, saving_mxn. Item names and notes stay private.
Usage: python3 tools/ledger.py data/3d-savings.yaml > dist/data/3d-savings.json
Exit 2 on a malformed ledger, so a deploy stops instead of publishing garbage.
"""
import json, re, sys

KEYS = {"date", "item", "problem", "filament_g", "print_cost_mxn", "alternative_mxn", "saving_mxn", "photo", "note",
        # v2 make-vs-buy fields (lane L100); computed and published by collector/printing.py, not here
        "part_id", "public", "title", "material", "requested_at", "designed_at", "delivered_at", "buy_lead_days",
        "buy_price_mxn", "buy_shipping_mxn", "import_tax_pct", "buy_source", "evidence", "ordered_at", "ordered_evidence"}
NUM = {"filament_g", "print_cost_mxn", "alternative_mxn", "saving_mxn", "buy_lead_days", "buy_price_mxn", "buy_shipping_mxn",
       "import_tax_pct"}


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
            if key != "date":
                raise ValueError("line %d: an entry must start with '- date:'" % n)
            cur = {}
            entries.append(cur)
        elif cur is None:
            raise ValueError("line %d: field before the first entry" % n)
        if val in ("", "null", "~"):
            v = None
        elif val.startswith('"') and val.endswith('"') and len(val) >= 2:
            v = val[1:-1]
        else:
            v = val
        if key in NUM and v is not None:
            try:
                v = float(v)
                v = int(v) if v.is_integer() else v
            except ValueError:
                raise ValueError("line %d: %s must be a number or null" % (n, key))
        if key == "date" and not re.match(r"^\d{4}-\d{2}-\d{2}$", str(v or "")):
            raise ValueError("line %d: date must be YYYY-MM-DD" % n)
        cur[key] = v
    return entries


def main():
    try:
        entries = parse(open(sys.argv[1], encoding="utf-8").read())
    except (OSError, ValueError, IndexError) as e:
        print("ledger: %s" % e, file=sys.stderr)
        sys.exit(2)
    public = [{"date": e["date"], "saving_mxn": e.get("saving_mxn")} for e in entries]
    priced = [e["saving_mxn"] for e in public if isinstance(e["saving_mxn"], (int, float))]
    out = {"entries": sorted(public, key=lambda e: e["date"]),
           "count": len(public), "priced": len(priced), "saving_mxn_total": sum(priced) if priced else None}
    json.dump(out, sys.stdout, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
