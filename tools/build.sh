#!/bin/bash
# Build dist/ for Cloudflare Pages (project kaizen-lab-io) and run the privacy gate. No credentials, no deploy:
# the GitHub Actions workflow (.github/workflows/deploy.yml) deploys dist/ with a Pages-only token.
#   tools/build.sh
# Optional extra gate patterns (lab-specific names, kept out of this public repo):
#   KL_PRIVATE_PATTERNS='regex'  (Actions secret)  or  KL_PRIVATE_PATTERNS_FILE=path (one ERE per line)
set -euo pipefail
cd "$(dirname "$0")/.."
umask 022

rm -rf dist && mkdir -p dist/data
cp -R site/. dist/
find dist -name .DS_Store -delete
# public aggregates only: the ledgers they come from live in the private ops repo
cp data/metrics.json data/targets.json data/ideas.json data/3d-savings.json data/stories.json dist/data/
for f in dist/data/*.json; do python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$f"; done

python3 tools/sitemap.py
python3 -c 'import xml.dom.minidom,sys; xml.dom.minidom.parse("dist/sitemap.xml")'
# SEO gate: every built page has a canonical (404 is noindex instead) + og:image + twitter card; no http:// links
for f in $(find dist -name '*.html'); do
  if [ "$(basename "$f")" = 404.html ]; then grep -q 'name="robots" content="noindex"' "$f" || { echo "seo gate: $f lacks noindex"; exit 4; }
  else grep -q '<link rel="canonical" href="https://kaizen-lab.io/' "$f" || { echo "seo gate: $f lacks canonical"; exit 4; }; fi
  grep -q 'property="og:image" content="https://kaizen-lab.io/assets/og-image.png"' "$f" && grep -q 'name="twitter:card" content="summary_large_image"' "$f" || { echo "seo gate: $f lacks og:image/twitter:card"; exit 4; }
done
grep -q '^Sitemap: https://kaizen-lab.io/sitemap.xml' dist/robots.txt || { echo "seo gate: robots.txt lacks Sitemap line"; exit 4; }
if grep -rIn 'href="http://\|src="http://' dist; then echo "seo gate: http:// link in dist/"; exit 4; fi

# privacy gate: RFC1918, tailnet CGNAT range, MagicDNS names (+ optional private patterns)
GATE='192\.168\.|(^|[^0-9.])10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.|\.ts\.net'
if [ -n "${KL_PRIVATE_PATTERNS:-}" ]; then GATE="$GATE|$KL_PRIVATE_PATTERNS"; fi
if [ -n "${KL_PRIVATE_PATTERNS_FILE:-}" ]; then
  while IFS= read -r p; do case "$p" in ''|'#'*) ;; *) GATE="$GATE|$p" ;; esac; done < "$KL_PRIVATE_PATTERNS_FILE"
fi
# file names only, never the matching text
if grep -rIilE "$GATE" dist; then
  echo "privacy gate: private address or internal name in dist/ - aborting"; exit 3
fi
echo "build ok: $(find dist -type f | wc -l | tr -d ' ') files in dist/"
