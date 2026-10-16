# kaizen-lab.io

**Kaizen Lab, measured in public.** kaizen-lab.dev is where Kaizen Lab *explains*; kaizen-lab.io is where it *measures*: a home lab shown as a process with inputs and outputs, a handful of honest KPIs, a SIPOC map and lean calculators that end with a call to [zenilify-consulting.com](https://zenilify-consulting.com).

- Live: https://kaizen-lab.io (and `www.`) · Cloudflare Pages project `kaizen-lab-io`

## Pages

| Path | What | Data |
|---|---|---|
| `/` | manifesto (input → process → output → improve), SIPOC of the lab, links | static |
| `/kpi/` | KPI tiles, each with a target and a 7/30-day or weekly trend | `/api/metrics` → fallback `/data/metrics.json` |
| `/flow/` | the SIPOC with a live number on each arrow | same |
| `/tools/oee/`, `/tools/takt/`, `/tools/make-or-buy/` | client-side calculators, nothing leaves the browser | none |
| `/tools/capacity/` | bakery capacity calculator, illustrative defaults (spec: `docs/bakery-capacity-model.md`) | none |
| `/cases/bakery/` | three plant-floor stories | static |

Hand-written HTML, CSS and vanilla JS (no framework, no build step beyond copying). Light/dark via `prefers-color-scheme` plus a toggle. Business-card QR: `site/assets/qr/` (see its README).

## Architecture (push-only)

```
lab worker (systemd timer, every 15 min)
  Uptime Kuma ─┐
  ComfyUI      ┼─► collector/collect.py ─► whitelist ─► PUT ─► Workers KV (key "metrics")
  memory store ─┤                                               ▲
  idea ledger  ─┘ (aggregate only)                  functions/api/metrics.js (binding METRICS)
                                                                ▲
                                     kaizen-lab.io (static Pages site) ── fallback: /data/*.json
```

- **Push, never pull.** Nothing on the internet can reach the lab. If the lab sleeps, the site keeps the last snapshot and shows "updated N ago".
- **Least privilege.** The collector holds only a token scoped to Workers KV; the site deploy uses a Pages-only token stored as a GitHub secret.
- **Private inputs stay private.** The collector's configuration, the idea ledger and the 3D-print ledgers live in a separate private repository. This repository carries the code and the public aggregates only (`data/ideas.json`, `data/3d-savings.json`, `data/metrics.json`).

## Privacy whitelist

`collector/collect.py` builds the output by **copying named fields only** (`SCHEMA` in `whitelist()`), then validates every value: numbers, booleans, null, or strings that are a date, an ISO week, a UTC timestamp or one of `ok/stale/unknown`. Anything else aborts the run. The only free text allowed is a short list of vetted public titles, re-checked against a character whitelist and a ban list. Generic private-network shapes are in the code; the lab-specific ban words are supplied at run time (`KL_TITLE_BAN_FILE`). No time-of-day data: daily granularity at most.

`tools/build.sh` refuses to build if `dist/` contains an RFC 1918 address, a tailnet (CGNAT) address or a MagicDNS name, plus any extra patterns passed in `KL_PRIVATE_PATTERNS`.

## Build and deploy

```bash
tools/build.sh      # dist/ = site/ + data/*.json, privacy gate; no credentials needed
```

Deploys run in GitHub Actions (`.github/workflows/deploy.yml`): a push to `main` deploys production; a manual run on any other branch deploys a preview at `https://<branch>.kaizen-lab-io.pages.dev`. Secrets are referenced by name only (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).

**Bump the asset version when JS or CSS changes** (`?v=YYYYMMDDx` on every `/assets/*` reference in `site/**/*.html`): Cloudflare serves `/assets/*` with a 4-hour cache despite `_headers`, so an unversioned file stays stale after a deploy.

## Repo layout

```
site/            static site (Pages output is dist/, built from site/ + data/)
functions/api/   Pages Function: /api/metrics from KV
data/            public aggregates: metrics.json · targets.json · ideas.json · 3d-savings.json
collector/       collect.py · printing.py (3D KPIs) - runs in the lab, configured from the private repo
tools/           build.sh · ideas.py · ledger.py · pre-commit (gitleaks)
.github/         Pages deploy workflow
```

Secrets: never in the repo. `tools/pre-commit` runs `gitleaks protect --staged --redact`; install with `ln -sf ../../tools/pre-commit .git/hooks/pre-commit`.

## License

- **Code** (`site/assets/*.js`, `site/assets/*.css`, `functions/`, `tools/`, `collector/`, `.github/`): [MIT](LICENSE).
- **Content**: site text, case stories, the Kaizen Lab name, logo and brand, images and the documents in `docs/` are © Erick Zenil, all rights reserved. See [NOTICE](NOTICE).
