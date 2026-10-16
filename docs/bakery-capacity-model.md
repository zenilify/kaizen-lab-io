# Bakery capacity & resource model (spec)

Page: `/tools/capacity/` (`site/tools/capacity/index.html` + `site/assets/capacity.js`). Story: `/cases/bakery/`.
Lane L101, 2026-10-14. Client-side only: no data leaves the browser.

## What is real and what is illustrative

- **Real (Erick's plant, a US bakery in New York where he was plant manager):** the *structure*: the areas, their order, their units, the resource types (4 mixers, drums 4 × 600 lb + 4 × 300 lb, filling lines A/B/C/D, trolley types 1/2/3, ovens 1 × 80 + 4 × 60 rotary + 2 new ovens taking one 15-tray trolley, cake-mould rules, 30 min – 24 h cooling window, ~12 h flash freezing, the brownie cutter at ~75 trays/day, the IWP-or-clam constraint, the −28 °C warehouse, MOQ in pallets), and the kaizen stories.
- **Illustrative (Erick's decision: no former employer's data):** every *number* that is a time, rate, crew, inventory, cost, SKU pack config, and the preloaded order. All are editable inputs on the page and labelled as defaults. Type 3 trolley = 25 trays is an **assumed** default (type 1 with one level left empty). Shifts were not given: default 2 × 8 h, 30 min breaks, 5 days.
- No company, customer or employer names anywhere.

## Backward explosion (per area, in its own unit)

```
ORDER (SKU × boxes | pallets; MOQ in pallets)
 → pack config      boxes × (pieces per clam/wrap × clams/wraps per box) = pieces
 → items            pieces ÷ pieces per item (slab cut 12/24/48/96 · wedges per cake · 1)
 → trays            ⌈items × (1 + loss) ÷ items per tray⌉        (loss default 5 %)
 → batter           trays × items per tray × oz per item ÷ 16 = lb, pooled per batter type
 → drums            ⌊lb ÷ 600⌋ big + remainder in one 300 (if ≤ 300) else one more 600; leftover = WIP/waste flag
 → mixer batches    one batch fills one drum
 → filling          trays × s/tray + one changeover per SKU, per line (lines run in parallel)
 → oven batches     greedy: earliest-free eligible oven, best fit for the remainder; cake moulds only in rotary ovens
 → trolleys         rotary trays ÷ (30 type 1 | 25 type 3 tall | ≤ 15 cake moulds); new-oven trays ÷ 15 (type 2)
 → cooling          FIFO lane, min 30 min, max 24 h on the trolley (over = scrap = COPQ)
 → confectionery 1  cakes to halve × s/cake
 → confectionery 2  trays × min/tray (assembly, layers, demould + decorate)
 → confectionery 3  brownie cutter, trays ÷ trays/h (5/h × 15 h = 75/day)
 → flash freezing   trays × 12 h in N tray positions (24 h/day); adds ~0.5 day
 → cutting frozen   sticky brownies + cake wedges, min/tray (knives vs ultrasonic)
 → packaging 1/2    clams ÷ clams/min → boxes ÷ boxes/min → pallets
 → packaging 3      IWP pieces ÷ pcs/min OR clams ÷ clams/min, never both: (2 × campaigns − 1) changeovers
 → warehouse        pallets vs free pallet positions
 → people + hours   per area: crew per shift when the area has work; hours; days = hours ÷ net h/day
```

- **Net hours per day** = shifts × (shift h − breaks) = 2 × (8 − 0.5) = 15 h.
- **Days per area** = hours ÷ net h/day; mixers share by count (÷ 4); the oven area uses the greedy schedule's makespan; the freezer uses tray-hours ÷ (positions × 24 h).
- **Load %** = days ÷ planning window (default 5 working days). **Bottleneck** = the area with the most days.
- **Takt** = window × net h × 3600 ÷ trays in the order; compared with the bottleneck's cycle per tray.

## Capable-to-promise ship date

`working days = ⌈ bottleneck days + remake days + flow time ÷ net h/day + (any freezing ? 12 h ÷ 24 : 0) + QA release & loading (1) ⌉`

- *Flow time* = the slowest single trolley through the labour areas: mixer batch + fill one trolley + bake + load + 30 min cooling + halving + conf. 2 + cutter + frozen cut + 0.5 h packing.
- Counted forward from the start date over working days (5-day week skips Sat/Sun). Compared with the **10-working-day promise**.
- *Remake days* only appear when cooling expiry scraps trays (push without WIP cap).

## WIP, drums, trays in rotation

- **Per SKU flow:** rate = min(filling, eligible ovens, halving, conf. 2, cutter) in trays/h; loop = fill one trolley + bake + load + 30 min + slowest post-cooling step for one trolley + 15 min wash/return.
- **WIP cap on:** trolleys per flow = ⌈rate × loop ÷ trays per trolley⌉ + 1; per line the max of its SKUs; plant = sum of lines (Little's law). At most (cap − 1) trolleys wait in front of the slow step.
- **WIP cap off (push):** the lines release until trolleys run out: min(trolley pool, trolley loads). The queue in front of a slow post-cooling step waits `queue ÷ rate` working hours (× 24 ÷ 15 for calendar hours); anything past 24 h is scrap.
- **Drums:** pull = 2 per running line (one at the line, one being mixed); push = all 8 filled ahead. Batter age = mixer batch + minutes to empty a drum (× drums ahead per line in push); over the hold limit (default 4 h) = stale flag.
- **Trays in rotation** = trolleys in rotation × average trays per trolley + freezer peak; compared with trays owned.
- **Freezer peak** = (frozen trays ÷ production days ÷ net h) × min(12 h, net h/day).

## COPQ: the broken ultrasonic knife

Per frozen-cut tray: knives = knife cost ÷ trays per knife + tray value × knife loss % + knife min × crew × labour rate; ultrasonic = tray value × ultrasonic loss % + ultrasonic min × crew × labour rate. Payback weeks = repair cost ÷ (saving per tray × frozen-cut trays per week). Illustrative defaults: $6.90 vs $2.20 per tray, $6,500 repair, 300 trays/week → 4.6 weeks.

## Worked example, hand-checked: IWP Brownie box 96, 100 boxes, alone

Defaults: 96 pieces per box, slab cut 96, 1 slab per tray, 1 oz per piece (96 oz per tray), loss 5 %, line B 15 s/tray, bake 35 min + 8 min load, cutter 5 trays/h, frozen yes, Pack. 3 IWP 60 pcs/min.

| Step | Calculation | Result |
|---|---|---|
| Pieces | 100 boxes × 96 | **9,600 pcs** |
| Slabs (items) | 9,600 ÷ 96 pieces per slab | 100 |
| Trays | net 100 ÷ 1 = 100; with loss ⌈100 × 1.05⌉ | **105 trays** |
| Batter | 105 × 96 oz = 10,080 oz ÷ 16 | **630 lb** |
| Drums | ⌊630 ÷ 600⌋ = 1 big, remainder 30 ≤ 300 → 1 small; 900 lb mixed | **1 × 600 + 1 × 300 lb, 270 lb leftover (flag)** |
| Mixer batches | 1 per drum; 2 × 30 min ÷ 4 mixers | **2 batches**, 1.0 h |
| Filling (line B) | 105 × 15 s = 26.25 min + 20 min changeover | 0.77 h |
| Oven batches | no oven fits 105 → largest (80) takes 80; remainder 25 → smallest fitting oven = a 60-tray rotary | **2 batches: 80 + 25 of 60 (42 %, flag)** |
| Trolleys | 105 ÷ 30 (type 1) = 3.5 | **4 trolley loads** |
| Conf. 2 | 105 × 0.5 min | 0.88 h |
| Brownie cutter | 105 ÷ 5 trays/h = 21 h ÷ 15 h/day | **1.40 days → bottleneck** |
| Freezing | 105 × 12 h ÷ (360 × 24 h) | 0.15 days |
| Pack. 3 IWP | 9,600 ÷ 60 pcs/min = 160 min | 2.67 h |
| Flow time | 0.5 + (30 × 15 s = 0.125) + 43 min (0.717) + 0.5 + (30 × 0.5 min = 0.25) + (30 ÷ 5 = 6) + 0.5 | 8.59 h = 0.57 day |
| Ship date | ⌈1.40 + 0.57 + 0.5 freezing + 1 release⌉ = ⌈3.47⌉ | **4 working days** (start Wed 2026-10-14 → Tue 2026-10-20) |

The page's engine reproduces every number in this table (node check in lane L101). In the full preloaded order the same SKU shares the brownie batter with the other two brownie SKUs (pooled drums) and shares the ovens, so its own batch split differs.

## Preloaded order (illustrative) and its result with the defaults

240 × IWP Brownie box 24 · 100 × IWP Brownie box 96 · 60 × Brownie Tiramisu · 150 × Chocolate lava cake box · 80 × 2-layer cream cake (wedges) · 30 × Mini dessert 12-pack.

- 781 trays, 7 drum batches (4 × 600 + 3 × 300 lb, 376 lb leftover across 4 batters), 17 oven batches (5 part-full), 35 trolley loads, 11 pallets.
- **Bottleneck: Confectionery 3, brownie cutter**: 357 trays = 71.4 h = **4.76 days** (95 % of the 5-day window). Confectionery 2 is next (2.07 days).
- **Earliest ship (pull + WIP cap):** 7 working days, start Wed 2026-10-14 → **Fri 2026-10-23**, 3 days inside the 10-day promise (Wed 2026-10-28). 14 trolleys in rotation, cooling wait ≤ 19.7 h, nothing expires.
- **Same order in push without the cap:** 35 trolleys on the floor (21 blocked in front of the cutter), 200 brownie trays wait past 24 h and are scrapped (COPQ $8,000 at $40/tray) and remade → ship slips to the promise day itself (10 working days); batter waits up to 5.2 h.
- Flags shown: lava mould 9 vs 8 per box (planning one tray per box overproduces 1 cake per tray = 150 over the order), partial drums per batter, part-full oven batches, half pallets, brownie line IWP ↔ clam changeover.
- In the browser the start date defaults to *today*, so the dates move; the working-day counts do not.

## Not modelled (on purpose)

Mixer-to-batter compatibility, oven bake-profile changeovers, allergen sequencing, labour skill matrices, breakdowns (use OEE on `/tools/oee/`), multi-day overlap of areas beyond flow (areas are assumed to run concurrently at their own pace, which is the optimistic CTP).
