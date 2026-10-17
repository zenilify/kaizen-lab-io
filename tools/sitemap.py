#!/usr/bin/env python3
"""Write dist/sitemap.xml from the pages in site/ (every index.html except the 404). Run by tools/build.sh."""
import pathlib, sys
from xml.sax.saxutils import escape
root = pathlib.Path(__file__).resolve().parent.parent
urls = []
for f in sorted((root / "site").rglob("index.html")):
    rel = f.parent.relative_to(root / "site").as_posix()
    urls.append("https://kaizen-lab.io/" + ("" if rel == "." else rel + "/"))
body = "".join(f"  <url><loc>{escape(u)}</loc></url>\n" for u in urls)
out = root / "dist" / "sitemap.xml"
out.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n")
print(f"sitemap: {len(urls)} urls", file=sys.stderr)
