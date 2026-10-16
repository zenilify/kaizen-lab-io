/* Bakery capacity & resource calculator (kaizen-lab.io/tools/capacity).
   Client-side only: nothing leaves the browser. Every number is an ILLUSTRATIVE, editable default
   that keeps the structure of a real bakery, not any company's data.
   Backward explosion, per area in its own units:
   order -> pack config -> pieces -> trays -> batter -> drums -> oven batches -> trolleys -> people and hours.
   Spec: docs/bakery-capacity-model.md in the repo. */
(function () {
  'use strict';

  var DEF = {
    start: '', shifts: 2, shiftH: 8, breakMin: 30, daysWeek: 5, windowDays: 5, promiseDays: 10,
    loss: 5, mode: 'pull', wipCap: true, ultrasonic: false, p3Campaigns: 1,
    releaseDays: 1, freezeH: 12, coolMinMin: 30, coolMaxH: 24, batterHoldH: 4, moqPallets: 1,
    res: {
      mixers: 4, mixBatchMin: 30, mixCrew: 2,
      drumBig: 600, nBig: 4, drumSmall: 300, nSmall: 4,
      lines: {
        A: { name: 'Line A · cakes', sPer: 20, crew: 4, changeMin: 20 },
        B: { name: 'Line B · brownies', sPer: 15, crew: 3, changeMin: 20 },
        C: { name: 'Line C · slow-bake / slow-fill', sPer: 40, crew: 3, changeMin: 30 },
        D: { name: 'Line D · low volume', sPer: 45, crew: 2, changeMin: 30 }
      },
      t1: 30, t2: 15, t3: 25, cakeMouldMax: 15, trolley13: 90, trolley2: 10, returnMin: 15,
      ovens: [
        { name: 'Rotary convection 80', cap: 80, n: 1, kind: 'rotary', loadMin: 8 },
        { name: 'Rotary convection 60', cap: 60, n: 4, kind: 'rotary', loadMin: 8 },
        { name: 'New oven (one type 2 trolley)', cap: 15, n: 2, kind: 'new', loadMin: 2 }
      ],
      ovenCrew: 3, trays: 1500,
      conf1Crew: 2, conf2Crew: 8, cutterTraysH: 5, cutterCrew: 2,
      freezerTrays: 360,
      cutCrew: 3, knifeMin: 6, usMin: 2,
      p1ClamsMin: 12, p1Crew: 6, p2BoxesMin: 4, p2Crew: 3,
      p3IwpPcsMin: 60, p3ClamsMin: 10, p3ChangeMin: 45, p3Crew: 4,
      whPositions: 300, whUsedPct: 70,
      trayValue: 40, knifeCost: 45, traysPerKnife: 150, knifeLossPct: 3, usLossPct: 1,
      labourRate: 18, usRepair: 6500, stickyTraysWeek: 300
    },
    skus: [
      { name: 'IWP Brownie box 24', line: 'B', tray: 'slab', perTray: 1, piecesPerItem: 24, ozPerItem: 96, batter: 'brownie', bakeMin: 35, tall: false, halve: false, halveSec: 0, conf2Min: 0.5, cut: 'cutter', freeze: false, pack: 'P3iwp', piecesPerPack: 1, packsPerBox: 24, boxesPerPallet: 80 },
      { name: 'IWP Brownie box 96', line: 'B', tray: 'slab', perTray: 1, piecesPerItem: 96, ozPerItem: 96, batter: 'brownie', bakeMin: 35, tall: false, halve: false, halveSec: 0, conf2Min: 0.5, cut: 'cutter', freeze: true, pack: 'P3iwp', piecesPerPack: 1, packsPerBox: 96, boxesPerPallet: 80 },
      { name: 'Brownie Tiramisu (layered, caramel)', line: 'B', tray: 'slab', perTray: 1, piecesPerItem: 24, ozPerItem: 72, batter: 'brownie', bakeMin: 30, tall: false, halve: false, halveSec: 0, conf2Min: 4, cut: 'frozen', freeze: true, pack: 'P3clam', piecesPerPack: 2, packsPerBox: 6, boxesPerPallet: 60 },
      { name: 'Chocolate lava cake box (4 shells × 2)', line: 'C', tray: 'mould', perTray: 9, piecesPerItem: 1, ozPerItem: 3, batter: 'lava', bakeMin: 14, tall: true, halve: false, halveSec: 0, conf2Min: 3, cut: 'none', freeze: true, pack: 'P1', piecesPerPack: 2, packsPerBox: 4, boxesPerPallet: 100 },
      { name: '2-layer cream cake, wedges', line: 'A', tray: 'cakemould', perTray: 2, piecesPerItem: 8, ozPerItem: 24, batter: 'sponge', bakeMin: 40, tall: true, halve: true, halveSec: 40, conf2Min: 6, cut: 'frozen', freeze: true, pack: 'P1', piecesPerPack: 2, packsPerBox: 6, boxesPerPallet: 50 },
      { name: 'Mini dessert 12-pack', line: 'D', tray: 'mould', perTray: 12, piecesPerItem: 1, ozPerItem: 1.5, batter: 'mini', bakeMin: 18, tall: true, halve: false, halveSec: 0, conf2Min: 4, cut: 'none', freeze: true, pack: 'P1', piecesPerPack: 12, packsPerBox: 6, boxesPerPallet: 60 }
    ],
    order: [
      { sku: 0, qty: 240, unit: 'boxes' },
      { sku: 1, qty: 100, unit: 'boxes' },
      { sku: 2, qty: 60, unit: 'boxes' },
      { sku: 3, qty: 150, unit: 'boxes' },
      { sku: 4, qty: 80, unit: 'boxes' },
      { sku: 5, qty: 30, unit: 'boxes' }
    ]
  };

  var LINES = ['A', 'B', 'C', 'D'];
  var EPS = 1e-9;
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function ceil(x) { return Math.ceil(x - EPS) || 0; }

  /* drums: as many big drums as fit, the remainder in one small drum if it fits, else one more big drum.
     Demand rounds UP to whole drums; the leftover is WIP or waste. */
  function drumsFor(lb, R) {
    var big = Math.floor(lb / R.drumBig + EPS), small = 0, r = lb - big * R.drumBig;
    if (r > EPS) { if (r <= R.drumSmall + EPS) small = 1; else big += 1; }
    var cap = big * R.drumBig + small * R.drumSmall;
    return { big: big, small: small, cap: cap, leftover: cap - lb };
  }

  function isWorkday(d, daysWeek) {
    var w = d.getUTCDay(); // 0 Sun .. 6 Sat
    if (daysWeek >= 7) return true;
    var idx = w === 0 ? 7 : w; // Mon 1 .. Sun 7
    return idx <= daysWeek;
  }
  function addWorkDays(start, n, daysWeek) {
    var d = new Date(start + 'T12:00:00Z'), c = 0;
    while (c < n) { d.setUTCDate(d.getUTCDate() + 1); if (isWorkday(d, daysWeek)) c++; }
    return d;
  }
  function iso(d) { return d.toISOString().slice(0, 10); }

  var POSITIVE = [
    ['shifts', 'Shifts per day'], ['shiftH', 'Shift length'], ['daysWeek', 'Working days per week'], ['windowDays', 'Planning window'],
    ['res.mixers', 'Mixers'], ['res.mixBatchMin', 'Mixer batch time'], ['res.drumBig', 'Big drum size'], ['res.drumSmall', 'Small drum size'],
    ['res.t1', 'Trays per type 1 trolley'], ['res.t2', 'Trays per type 2 trolley'], ['res.t3', 'Trays per type 3 trolley'], ['res.cakeMouldMax', 'Cake-mould trays per trolley'],
    ['res.cutterTraysH', 'Brownie cutter rate'], ['res.freezerTrays', 'Freezer positions'], ['res.knifeMin', 'Knife cutting time'], ['res.usMin', 'Ultrasonic cutting time'],
    ['res.p1ClamsMin', 'Packaging 1 rate'], ['res.p2BoxesMin', 'Packaging 2 rate'], ['res.p3IwpPcsMin', 'Packaging 3 IWP rate'], ['res.p3ClamsMin', 'Packaging 3 clam rate'],
    ['res.traysPerKnife', 'Trays per knife'], ['res.stickyTraysWeek', 'Sticky trays per week']
  ];
  function getP(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }

  function validate(S) {
    var bad = null;
    (function walk(o, path) {
      if (bad) return;
      if (typeof o === 'number') { if (!isFinite(o) || o < 0) bad = 'Use positive numbers only (check ' + path + ').'; return; }
      if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { walk(o[k], path ? path + '.' + k : k); });
    })(S, '');
    if (bad) return bad;
    for (var i = 0; i < POSITIVE.length; i++) if (!(getP(S, POSITIVE[i][0]) > 0)) return POSITIVE[i][1] + ' must be more than 0.';
    if (S.breakMin >= S.shiftH * 60) return 'Breaks must be shorter than the shift.';
    var ln;
    for (i = 0; i < LINES.length; i++) { ln = S.res.lines[LINES[i]]; if (!(ln.sPer > 0)) return ln.name + ': seconds per tray must be more than 0.'; }
    for (i = 0; i < S.res.ovens.length; i++) if (!(S.res.ovens[i].cap > 0)) return S.res.ovens[i].name + ': trays per batch must be more than 0.';
    if (!S.res.ovens.some(function (o) { return o.kind === 'rotary' && o.n > 0; })) return 'At least one rotary oven is needed (cake moulds bake only there).';
    for (i = 0; i < S.skus.length; i++) {
      var k = S.skus[i];
      if (!(k.perTray > 0 && k.piecesPerItem > 0 && k.piecesPerPack > 0 && k.packsPerBox > 0 && k.boxesPerPallet > 0)) return (k.name || 'SKU ' + (i + 1)) + ': pack config and items per tray must be more than 0.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(S.start || '')) return 'Pick a start date.';
    return null;
  }

  function compute(S) {
    var err = validate(S);
    if (err) return { error: err };
    var R = S.res, loss = S.loss / 100;
    var dayH = S.shifts * (S.shiftH - S.breakMin / 60);
    var flags = [];
    function flag(level, text) { flags.push({ level: level, text: text }); }

    /* 1. explode the order, per SKU (several lines of one SKU are pooled) */
    var bySku = {};
    S.order.forEach(function (o) {
      var k = S.skus[o.sku];
      if (!k || !(o.qty > 0)) return;
      var boxes = o.unit === 'pallets' ? o.qty * k.boxesPerPallet : o.qty;
      bySku[o.sku] = (bySku[o.sku] || 0) + Math.ceil(boxes - EPS);
    });
    var rows = Object.keys(bySku).map(function (i) {
      var k = S.skus[i], boxes = bySku[i];
      var piecesPerBox = k.piecesPerPack * k.packsPerBox;
      var itemsPerBox = piecesPerBox / k.piecesPerItem;
      var pallets = ceil(boxes / k.boxesPerPallet);
      var pieces = boxes * piecesPerBox, packs = boxes * k.packsPerBox;
      var items = ceil(pieces / k.piecesPerItem);
      var itemsGross = ceil(items * (1 + loss));
      var traysNet = ceil(items / k.perTray);
      var trays = ceil(itemsGross / k.perTray);
      var ozTray = k.perTray * k.ozPerItem;
      return {
        i: +i, k: k, boxes: boxes, pallets: pallets, pieces: pieces, packs: packs, items: items, itemsGross: itemsGross,
        itemsPerBox: itemsPerBox, traysNet: traysNet, trays: trays, emptyCavities: trays * k.perTray - itemsGross,
        ozTray: ozTray, lb: trays * ozTray / 16, batches: 0, partial: 0, rotTrays: 0, newTrays: 0
      };
    });
    if (!rows.length) return { error: 'Add at least one order line with a quantity.' };

    rows.forEach(function (r) {
      if (r.pallets < S.moqPallets) flag('warn', r.k.name + ': ' + r.pallets + ' pallet(s) is below the MOQ of ' + S.moqPallets + ' pallet(s).');
      if (r.boxes % r.k.boxesPerPallet) flag('info', r.k.name + ': the last pallet is a half pallet (' + (r.boxes % r.k.boxesPerPallet) + ' of ' + r.k.boxesPerPallet + ' boxes). Half pallets are what got lost in the freezer warehouse.');
      if (r.k.tray !== 'slab' && r.emptyCavities > 0) flag('info', r.k.name + ': the last tray runs with ' + r.emptyCavities + ' of ' + r.k.perTray + ' cavities empty (partial tray).');
      var ipb = r.itemsPerBox;
      if (Math.abs(ipb - Math.round(ipb)) < EPS && r.k.perTray > ipb && r.k.perTray % ipb > EPS) {
        var extra = r.k.perTray - Math.floor(r.k.perTray / ipb) * ipb;
        flag('warn', r.k.name + ': mould has ' + r.k.perTray + ' cavities but a box takes ' + ipb + '. Planning one tray per box overproduces ' + extra + ' per tray (' + Math.round(extra * r.boxes) + ' over this order). Pooling trays across boxes, as this calculator does, overproduces ' + (r.trays * r.k.perTray - r.itemsGross) + '.');
      }
    });

    /* 2. mixing: batter pooled per batter type, rounded up to whole drums */
    var batters = {};
    rows.forEach(function (r) { var b = batters[r.k.batter] || (batters[r.k.batter] = { lb: 0, names: [] }); b.lb += r.lb; b.names.push(r.k.name); });
    var mixBatches = 0, drumsBig = 0, drumsSmall = 0, leftoverLb = 0;
    Object.keys(batters).forEach(function (n) {
      var b = batters[n], d = drumsFor(b.lb, R);
      b.drums = d; mixBatches += d.big + d.small; drumsBig += d.big; drumsSmall += d.small; leftoverLb += d.leftover;
      if (d.leftover > 0.5) flag('warn', 'Batter "' + n + '": ' + fmt(b.lb, 0) + ' lb needed, ' + fmt(d.cap, 0) + ' lb mixed in whole drums. ' + fmt(d.leftover, 0) + ' lb left over = WIP or waste.');
    });
    var mixHours = mixBatches * R.mixBatchMin / 60;

    /* 3. filling lines (run in parallel) */
    var lineH = {}, lineTrays = {}, lineSkus = {};
    LINES.forEach(function (L) { lineH[L] = 0; lineTrays[L] = 0; lineSkus[L] = []; });
    rows.forEach(function (r) {
      var L = r.k.line, ln = R.lines[L];
      lineH[L] += r.trays * ln.sPer / 3600 + ln.changeMin / 60;
      lineTrays[L] += r.trays; lineSkus[L].push(r);
    });
    var fillHours = 0, fillDays = 0, fillCrew = 0, activeLines = [];
    LINES.forEach(function (L) {
      fillHours += lineH[L];
      if (lineTrays[L] > 0) { activeLines.push(L); fillCrew += R.lines[L].crew; fillDays = Math.max(fillDays, lineH[L] / dayH); }
    });

    /* 4. baking: greedy batches, earliest free oven, best fit; cake moulds only in rotary ovens */
    var ovens = [];
    R.ovens.forEach(function (g) { for (var n = 0; n < g.n; n++) ovens.push({ name: g.name, cap: g.cap, kind: g.kind, load: g.loadMin, free: 0, busy: 0 }); });
    var ovenRows = rows.slice().sort(function (a, b) { return (b.k.tray === 'cakemould') - (a.k.tray === 'cakemould'); });
    var ovenBatches = 0, partialBatches = 0;
    ovenRows.forEach(function (r) {
      var el = ovens.filter(function (o) { return r.k.tray !== 'cakemould' || o.kind === 'rotary'; });
      var rem = r.trays, guard = 0;
      while (rem > 0 && guard++ < 100000) {
        var minF = Math.min.apply(null, el.map(function (o) { return o.free; }));
        var cands = el.filter(function (o) { return o.free <= minF + EPS; });
        var fits = cands.filter(function (o) { return o.cap >= rem; }).sort(function (a, b) { return a.cap - b.cap; });
        var o = fits[0] || cands.sort(function (a, b) { return b.cap - a.cap; })[0];
        var t = Math.min(o.cap, rem), dur = r.k.bakeMin + o.load;
        o.free += dur; o.busy += dur; rem -= t; r.batches++; ovenBatches++;
        if (o.kind === 'new') r.newTrays += t; else r.rotTrays += t;
        if (t < o.cap) { r.partial++; partialBatches++; r.lastPartial = t + ' of ' + o.cap + ' trays in a ' + o.name; }
      }
    });
    var makespan = Math.max.apply(null, ovens.map(function (o) { return o.free; }));
    var ovenBusy = ovens.reduce(function (s, o) { return s + o.busy; }, 0);
    if (partialBatches) flag('info', partialBatches + ' oven batch(es) run part-full (' + rows.filter(function (r) { return r.partial; }).map(function (r) { return r.k.name + ': ' + r.lastPartial; }).join('; ') + ').');
    if (rows.some(function (r) { return r.k.tray === 'cakemould'; })) flag('info', 'Cake-mould trays: max ' + R.cakeMouldMax + ' per trolley and only the conventional rotary ovens.');

    /* trolley loads */
    rows.forEach(function (r) {
      r.tpt = r.k.tray === 'cakemould' ? Math.min(R.cakeMouldMax, R.t1) : (r.k.tall ? R.t3 : R.t1);
      r.loads13 = ceil(r.rotTrays / r.tpt);
      r.loads2 = ceil(r.newTrays / R.t2);
    });

    /* 5. confectionery, cutter, freezing, cutting, packaging, warehouse */
    var sum = function (f) { return rows.reduce(function (s, r) { return s + f(r); }, 0); };
    var halveCakes = sum(function (r) { return r.k.halve ? r.trays * r.k.perTray : 0; });
    var conf1Hours = sum(function (r) { return r.k.halve ? r.trays * r.k.perTray * r.k.halveSec / 3600 : 0; });
    var conf2Trays = sum(function (r) { return r.k.conf2Min > 0 ? r.trays : 0; });
    var conf2Hours = sum(function (r) { return r.trays * r.k.conf2Min / 60; });
    var cutterTrays = sum(function (r) { return r.k.cut === 'cutter' ? r.trays : 0; });
    var cutterHours = cutterTrays / R.cutterTraysH;
    var freezeTrays = sum(function (r) { return r.k.freeze ? r.trays : 0; });
    var freezeDays = freezeTrays * S.freezeH / (R.freezerTrays * 24);
    var frozenCutTrays = sum(function (r) { return r.k.cut === 'frozen' ? r.trays : 0; });
    var cutMin = S.ultrasonic ? R.usMin : R.knifeMin;
    var cutHours = frozenCutTrays * cutMin / 60;
    var p1Clams = sum(function (r) { return r.k.pack === 'P1' ? r.packs : 0; });
    var p1Hours = p1Clams / R.p1ClamsMin / 60;
    var p2Boxes = sum(function (r) { return r.k.pack === 'P1' ? r.boxes : 0; });
    var p2Hours = p2Boxes / R.p2BoxesMin / 60;
    var iwpPcs = sum(function (r) { return r.k.pack === 'P3iwp' ? r.pieces : 0; });
    var p3Clams = sum(function (r) { return r.k.pack === 'P3clam' ? r.packs : 0; });
    var both = iwpPcs > 0 && p3Clams > 0;
    var p3Changes = both ? 2 * Math.max(1, S.p3Campaigns) - 1 : 0;
    var p3Hours = iwpPcs / R.p3IwpPcsMin / 60 + p3Clams / R.p3ClamsMin / 60 + p3Changes * R.p3ChangeMin / 60;
    if (both) flag('info', 'Brownie packaging line runs EITHER IWP OR clams, never both: ' + p3Changes + ' changeover(s) × ' + R.p3ChangeMin + ' min for ' + Math.max(1, S.p3Campaigns) + ' campaign(s) of each.');
    var pallets = sum(function (r) { return r.pallets; });
    var whFree = Math.floor(R.whPositions * (1 - R.whUsedPct / 100));

    /* 6. flow rates per SKU and the WIP (trolleys) that each flow really needs */
    function ovenRate(k) {
      return ovens.reduce(function (s, o) { return (k.tray !== 'cakemould' || o.kind === 'rotary') ? s + o.cap * 60 / (k.bakeMin + o.load) : s; }, 0);
    }
    var pool = R.trolley13 + R.trolley2, poolTrays = R.trolley13 * R.t1;
    var capByLine = {}, expiredTrays = 0, maxWaitCal = S.coolMinMin / 60, expiryNames = [], remakeH = 0;
    rows.forEach(function (r) {
      var k = r.k, ln = R.lines[k.line];
      var fill = 3600 / ln.sPer, oven = ovenRate(k);
      var post = Math.min(k.halve && k.halveSec > 0 ? 3600 / (k.halveSec * k.perTray) : Infinity,
        k.conf2Min > 0 ? 60 / k.conf2Min : Infinity, k.cut === 'cutter' ? R.cutterTraysH : Infinity);
      var pre = Math.min(fill, oven), rate = Math.min(pre, post);
      var postH = isFinite(post) ? r.tpt / post : 0;
      var ovenLoad = Math.max.apply(null, ovens.map(function (o) { return o.load; }));
      r.loopH = r.tpt * ln.sPer / 3600 + (k.bakeMin + ovenLoad) / 60 + S.coolMinMin / 60 + postH + R.returnMin / 60;
      r.rate = rate; r.post = post; r.pre = pre;
      r.capTrolleys = ceil(rate * r.loopH / r.tpt) + 1;
      capByLine[k.line] = Math.max(capByLine[k.line] || 0, r.capTrolleys);
      // cooling queue in front of the slowest post-cooling step (FIFO window min..max)
      if (isFinite(post) && pre > post) {
        // WIP cap: at most (cap - 1) trolleys wait while one is worked; push: the lines release all they can
        var queue = S.wipCap ? Math.min(r.trays, (r.capTrolleys - 1) * r.tpt)
          : Math.max(0, Math.min(r.trays, poolTrays) - post * (Math.min(r.trays, poolTrays) / pre));
        var waitCal = (queue / post) * 24 / dayH;
        maxWaitCal = Math.max(maxWaitCal, waitCal + S.coolMinMin / 60);
        var ok = post * S.coolMaxH * dayH / 24;
        if (queue > ok) { var ex = Math.round(queue - ok); expiredTrays += ex; expiryNames.push(k.name + ' (' + ex + ' trays)'); remakeH += ex / post; }
      }
    });
    var capRot = Object.keys(capByLine).reduce(function (s, L) { return s + capByLine[L]; }, 0);
    var totalLoads = sum(function (r) { return r.loads13 + r.loads2; });
    var pushRot = Math.min(pool, totalLoads);
    var trolleysRot = S.wipCap ? Math.min(capRot, totalLoads) : pushRot;
    var blocked = S.wipCap ? 0 : Math.max(0, pushRot - Math.min(capRot, totalLoads));
    if (capRot > pool) flag('bad', 'The flows need ' + capRot + ' trolleys in rotation but only ' + pool + ' exist.');
    if (expiredTrays > 0) flag('bad', 'Cooling expiry: trolleys wait more than ' + S.coolMaxH + ' h before the next step (up to ' + fmt(maxWaitCal, 0) + ' h). ' + expiredTrays + ' trays scrapped = COPQ ' + money(expiredTrays * R.trayValue) + ' and a remake: ' + expiryNames.join(', ') + '. Turn the WIP cap on.');
    if (!S.wipCap && blocked > 0) flag('warn', blocked + ' trolleys sit loaded in the cooling lane in front of the slow steps, blocked for the other areas.');

    /* drums in rotation and batter age */
    var drumsTotal = R.nBig + R.nSmall, fillMinPerDrum = 0;
    activeLines.forEach(function (L) {
      // minutes one line needs to empty the drum it uses (a small drum when the line's batter fits one)
      var lb = lineSkus[L].reduce(function (s, r) { return s + r.lb; }, 0);
      var main = lineSkus[L].slice().sort(function (a, b) { return b.trays - a.trays; })[0];
      var drumLb = Math.min(lb, lb <= R.drumSmall ? R.drumSmall : R.drumBig);
      fillMinPerDrum = Math.max(fillMinPerDrum, (drumLb * 16 / main.ozTray) * R.lines[L].sPer / 60);
    });
    var drumsRot, batterAgeMin;
    if (S.mode === 'pull') { drumsRot = Math.min(drumsTotal, 2 * activeLines.length); batterAgeMin = R.mixBatchMin + fillMinPerDrum; }
    else { drumsRot = drumsTotal; batterAgeMin = R.mixBatchMin + fillMinPerDrum * Math.ceil(drumsTotal / Math.max(1, activeLines.length)); }
    if (batterAgeMin > S.batterHoldH * 60) flag('bad', 'Batter waits up to ' + fmt(batterAgeMin / 60, 1) + ' h in the drum (limit ' + S.batterHoldH + ' h): stale risk. Mixing is pushing ahead of filling; switch to pull (one drum per signal).');

    /* 7. areas, each in its own unit */
    function area(id, name, unit, hours, days, crew, rot, extra) {
      return { id: id, name: name, unit: unit, hours: hours, days: days, crew: days > 0 ? crew : 0, rot: rot || '', load: days / S.windowDays, extra: extra || '' };
    }
    var A = [];
    A.push(area('mix', 'Mixing', fmt(mixBatches, 0) + ' drum batches (' + drumsBig + ' × ' + R.drumBig + ' lb + ' + drumsSmall + ' × ' + R.drumSmall + ' lb)', mixHours, mixHours / (R.mixers * dayH), R.mixCrew, drumsRot + ' of ' + drumsTotal + ' drums'));
    A.push(area('fill', 'Filling', fmt(sum(function (r) { return r.trays; }), 0) + ' trays on ' + activeLines.length + ' lines', fillHours, fillDays, fillCrew, ''));
    A.push(area('bake', 'Baking', ovenBatches + ' oven batches', ovenBusy / 60, makespan / 60 / dayH, R.ovenCrew, ''));
    A.push(area('cool', 'Cooling (FIFO lane)', totalLoads + ' trolley loads', 0, 0, 0, fmt(trolleysRot, 0) + ' of ' + pool + ' trolleys', 'wait ' + fmt(S.coolMinMin, 0) + ' min – ' + fmt(maxWaitCal, 1) + ' h'));
    if (halveCakes) A.push(area('conf1', 'Confectionery 1 · halve cakes', fmt(halveCakes, 0) + ' cakes', conf1Hours, conf1Hours / dayH, R.conf1Crew, ''));
    A.push(area('conf2', 'Confectionery 2 · assemble / decorate', fmt(conf2Trays, 0) + ' trays', conf2Hours, conf2Hours / dayH, R.conf2Crew, ''));
    if (cutterTrays) A.push(area('cutter', 'Confectionery 3 · brownie cutter', fmt(cutterTrays, 0) + ' trays (max ' + fmt(R.cutterTraysH * dayH, 0) + '/day)', cutterHours, cutterHours / dayH, R.cutterCrew, ''));
    if (freezeTrays) A.push(area('freeze', 'Flash freezing (' + S.freezeH + ' h)', fmt(freezeTrays, 0) + ' trays', freezeDays * 24, freezeDays, 0, ''));
    if (frozenCutTrays) A.push(area('cut', 'Cutting frozen (' + (S.ultrasonic ? 'ultrasonic' : 'standard knives') + ')', fmt(frozenCutTrays, 0) + ' trays', cutHours, cutHours / dayH, R.cutCrew, ''));
    if (p1Clams) A.push(area('p1', 'Packaging 1 · clams / shells', fmt(p1Clams, 0) + ' clams', p1Hours, p1Hours / dayH, R.p1Crew, ''));
    if (p2Boxes) A.push(area('p2', 'Packaging 2 · boxes → pallets', fmt(p2Boxes, 0) + ' boxes', p2Hours, p2Hours / dayH, R.p2Crew, ''));
    if (iwpPcs || p3Clams) A.push(area('p3', 'Packaging 3 · brownie line', (iwpPcs ? fmt(iwpPcs, 0) + ' IWP pcs' : '') + (both ? ' + ' : '') + (p3Clams ? fmt(p3Clams, 0) + ' clams' : ''), p3Hours, p3Hours / dayH, R.p3Crew, ''));

    var bn = A.reduce(function (b, a) { return a.days > b.days ? a : b; }, A[0]);
    bn.bottleneck = true;

    /* freezer: peak occupancy at the bottleneck pace */
    var prodDays = bn.days + remakeH / dayH;
    var freezePerH = freezeTrays / Math.max(1, prodDays) / dayH;
    var freezerPeak = freezePerH * Math.min(S.freezeH, dayH);
    var fz = A.filter(function (a) { return a.id === 'freeze'; })[0];
    if (fz) { fz.rot = fmt(freezerPeak, 0) + ' of ' + R.freezerTrays + ' positions at peak'; fz.peak = freezerPeak / R.freezerTrays; }
    if (freezerPeak > R.freezerTrays) flag('bad', 'Freezer overflow: peak ' + fmt(freezerPeak, 0) + ' trays for ' + R.freezerTrays + ' positions. Level the mix (heijunka) or slow the pace into the freezer.');
    else if (freezerPeak > 0.85 * R.freezerTrays) flag('warn', 'Freezer at ' + fmt(100 * freezerPeak / R.freezerTrays, 0) + ' % at peak: a strong bottleneck candidate.');
    A.push({ id: 'wh', name: 'Freezer warehouse (−28 °C)', unit: pallets + ' pallets', hours: 0, days: 0, crew: 0, rot: pallets + ' of ' + whFree + ' free positions', load: 0, extra: '' });
    if (pallets > whFree) flag('bad', 'Warehouse: ' + pallets + ' pallets but only ' + whFree + ' free positions (' + R.whPositions + ' × ' + (100 - R.whUsedPct) + ' % free).');

    /* trays in rotation */
    var avgTpt = totalLoads ? sum(function (r) { return r.trays; }) / totalLoads : R.t1;
    var traysRot = Math.round(trolleysRot * avgTpt + freezerPeak);
    if (traysRot > R.trays) flag('bad', 'Trays in rotation ' + traysRot + ' exceed the ' + R.trays + ' trays owned.');

    /* 8. capable-to-promise ship date */
    var anyFreeze = freezeTrays > 0;
    var flowH = Math.max.apply(null, rows.map(function (r) {
      var k = r.k, ln = R.lines[k.line];
      return R.mixBatchMin / 60 + r.tpt * ln.sPer / 3600 + (k.bakeMin + 8) / 60 + S.coolMinMin / 60 +
        (k.halve ? r.tpt * k.perTray * k.halveSec / 3600 : 0) + r.tpt * k.conf2Min / 60 +
        (k.cut === 'cutter' ? r.tpt / R.cutterTraysH : 0) + (k.cut === 'frozen' ? r.tpt * cutMin / 60 : 0) + 0.5;
    }));
    var ctpDays = ceil(prodDays + flowH / dayH + (anyFreeze ? S.freezeH / 24 : 0) + S.releaseDays);
    var ship = addWorkDays(S.start, ctpDays, S.daysWeek);
    var promise = addWorkDays(S.start, S.promiseDays, S.daysWeek);
    var slack = S.promiseDays - ctpDays; // working days

    /* takt vs the bottleneck cycle */
    var totalTrays = sum(function (r) { return r.trays; });
    var takt = S.windowDays * dayH * 3600 / totalTrays;

    /* 9. knife wear (COPQ) vs ultrasonic knife repaired */
    var knifePerTray = R.knifeCost / R.traysPerKnife + R.trayValue * R.knifeLossPct / 100 + R.knifeMin / 60 * R.cutCrew * R.labourRate;
    var usPerTray = R.trayValue * R.usLossPct / 100 + R.usMin / 60 * R.cutCrew * R.labourRate;
    var saving = knifePerTray - usPerTray;
    var copq = {
      knifePerTray: knifePerTray, usPerTray: usPerTray, saving: saving, orderTrays: frozenCutTrays,
      orderCost: frozenCutTrays * (S.ultrasonic ? usPerTray : knifePerTray),
      paybackWeeks: saving > 0 ? R.usRepair / (saving * R.stickyTraysWeek) : Infinity
    };

    return {
      dayH: dayH, rows: rows, batters: batters, areas: A, bottleneck: bn, flags: flags,
      mixBatches: mixBatches, drumsBig: drumsBig, drumsSmall: drumsSmall, leftoverLb: leftoverLb,
      ovenBatches: ovenBatches, partialBatches: partialBatches, makespan: makespan,
      totalLoads: totalLoads, pool: pool, capRot: capRot, pushRot: pushRot, trolleysRot: trolleysRot, blocked: blocked,
      drumsRot: drumsRot, batterAgeMin: batterAgeMin, traysRot: traysRot, expiredTrays: expiredTrays, maxWaitCal: maxWaitCal,
      freezerPeak: freezerPeak, pallets: pallets, whFree: whFree,
      prodDays: prodDays, flowH: flowH, ctpDays: ctpDays, ship: iso(ship), promise: iso(promise), slack: slack,
      takt: takt, bnCycle: bn.hours * 3600 / totalTrays, totalTrays: totalTrays, copq: copq, cutterTrays: cutterTrays
    };
  }

  function fmt(x, d) { return isFinite(x) ? Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–'; }
  function money(x) { return '$' + fmt(x, 0); }

  var API = { DEF: DEF, compute: compute, drumsFor: drumsFor, clone: clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') window.KLCapacity = API;
})();

/* ---------- UI (browser only) ---------- */
(function () {
  'use strict';
  if (typeof document === 'undefined' || !window.KLCapacity) return;
  var C = window.KLCapacity, S;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(x, d) { return isFinite(x) ? Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–'; }
  function getP(o, p) { return p.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setP(o, p, v) { var ks = p.split('.'), a = o; for (var i = 0; i < ks.length - 1; i++) a = a[ks[i]]; a[ks[ks.length - 1]] = v; }
  var uid = 0;
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* field builders: [path, label, hint, type, options] */
  function field(f) {
    var path = f[0], label = f[1], hint = f[2] || '', type = f[3] || 'n', id = 'f' + (++uid), v = getP(S, path);
    var h = hint ? '<span class="hint" id="' + id + 'h">' + esc(hint) + '</span>' : '';
    var desc = hint ? ' aria-describedby="' + id + 'h"' : '';
    if (type === 'b') return '<div class="field check"><input id="' + id + '" type="checkbox" data-k="' + path + '" data-t="b"' + (v ? ' checked' : '') + desc + '><label for="' + id + '">' + esc(label) + '</label>' + h + '</div>';
    if (type === 's') return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' + h + '<select id="' + id + '" data-k="' + path + '" data-t="s"' + desc + '>' +
      f[4].map(function (o) { return '<option value="' + o[0] + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>';
    if (type === 't') return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' + h + '<input id="' + id + '" type="text" data-k="' + path + '" data-t="t" value="' + esc(v) + '"' + desc + '></div>';
    return '<div class="field"><label for="' + id + '">' + esc(label) + '</label>' + h + '<input id="' + id + '" type="number" min="0" step="any" inputmode="decimal" data-k="' + path + '" data-t="n" value="' + v + '"' + desc + '></div>';
  }
  function fields(list) { return '<div class="fgrid">' + list.map(field).join('') + '</div>'; }

  function renderPolicy() {
    $('policy').innerHTML =
      '<fieldset><legend>Shifts and promise</legend>' + fields([
        ['shifts', 'Shifts per day', 'Not given in the real case; 2 is a default.'], ['shiftH', 'Shift length (h)'], ['breakMin', 'Breaks per shift (min)'],
        ['daysWeek', 'Working days per week'], ['windowDays', 'Planning window (working days)', 'Load % = hours needed ÷ hours available in this window.'],
        ['promiseDays', 'Promised lead time (working days)', 'The fixed promise the earliest ship date is compared with.'],
        ['start', 'Production starts', '', 't'], ['releaseDays', 'QA release + loading (days)'], ['moqPallets', 'MOQ (pallets per SKU)'], ['loss', 'Production loss (%)', 'Added to trays, moulds and batter.']
      ]) + '</fieldset>' +
      '<fieldset><legend>Flow policy</legend>' + fields([
        ['mode', 'Mixing → filling', 'Push: mixers produce ahead, batter ages. Pull: filling is the pacemaker and sends one signal per drum.', 's', [['pull', 'Pull (filling is the pacemaker)'], ['push', 'Push (mixing produces ahead)']]],
        ['wipCap', 'WIP cap: trolleys in rotation = what each flow\'s constraint needs', '', 'b'],
        ['ultrasonic', 'Ultrasonic knife repaired', 'Frozen sticky products are cut with standard knives while it is broken.', 'b'],
        ['p3Campaigns', 'Brownie packaging campaigns per mode', 'Heijunka: more, smaller campaigns level the mix but add IWP ↔ clam changeovers.'],
        ['freezeH', 'Flash freezing time (h)'], ['coolMinMin', 'Cooling minimum (min)'], ['coolMaxH', 'Cooling maximum (h)', 'Older than this on the trolley = scrap.'], ['batterHoldH', 'Batter hold limit (h)']
      ]) + '</fieldset>';
    var st = document.querySelector('[data-k="start"]'); if (st) { st.type = 'date'; }
  }

  function renderOrder() {
    var opts = S.skus.map(function (k, i) { return [i, k.name || 'SKU ' + (i + 1)]; });
    $('order-rows').innerHTML = S.order.map(function (o, i) {
      var a = 'o' + i;
      return '<div class="order-row">' +
        '<div class="field"><label for="' + a + 's">SKU</label><select id="' + a + 's" class="sku" data-k="order.' + i + '.sku" data-t="i">' +
        opts.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === o.sku ? ' selected' : '') + '>' + esc(p[1]) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="' + a + 'q">Quantity</label><input id="' + a + 'q" type="number" min="0" step="1" inputmode="numeric" data-k="order.' + i + '.qty" data-t="n" value="' + o.qty + '"></div>' +
        '<div class="field"><label for="' + a + 'u">Unit</label><select id="' + a + 'u" data-k="order.' + i + '.unit" data-t="s"><option value="boxes"' + (o.unit === 'boxes' ? ' selected' : '') + '>boxes</option><option value="pallets"' + (o.unit === 'pallets' ? ' selected' : '') + '>pallets</option></select></div>' +
        '<button type="button" class="rm" data-rm="' + i + '" aria-label="Remove order line ' + (i + 1) + '">×</button></div>';
    }).join('');
  }

  function renderResources() {
    var L = ['A', 'B', 'C', 'D'], h = '';
    h += '<fieldset><legend>Mixing</legend>' + fields([['res.mixers', 'Industrial mixers'], ['res.mixBatchMin', 'Minutes per drum batch', 'Load, mix, discharge.'], ['res.mixCrew', 'People per shift'],
      ['res.drumBig', 'Big drum (lb)'], ['res.nBig', 'Big drums'], ['res.drumSmall', 'Small drum (lb)'], ['res.nSmall', 'Small drums']]) + '</fieldset>';
    h += '<fieldset><legend>Filling lines</legend>' + L.map(function (x) {
      return '<p class="mini-h">' + esc(S.res.lines[x].name) + '</p>' + fields([['res.lines.' + x + '.sPer', 'Seconds per tray'], ['res.lines.' + x + '.crew', 'People per shift'], ['res.lines.' + x + '.changeMin', 'Changeover per SKU (min)']]);
    }).join('') + '</fieldset>';
    h += '<fieldset><legend>Trolleys and trays</legend>' + fields([['res.t1', 'Type 1 trolley (trays)'], ['res.t3', 'Type 3 trolley (trays)', 'Type 1 with one level empty for tall items; 25 is an assumed default.'], ['res.t2', 'Type 2 trolley (trays)', 'Rolls straight into the new ovens.'],
      ['res.cakeMouldMax', 'Cake-mould trays per trolley (max)'], ['res.trolley13', 'Type 1/3 trolleys owned'], ['res.trolley2', 'Type 2 trolleys owned'], ['res.trays', 'Aluminium trays owned'], ['res.returnMin', 'Trolley wash + return (min)']]) + '</fieldset>';
    h += '<fieldset><legend>Ovens</legend>' + S.res.ovens.map(function (o, i) {
      return '<p class="mini-h">' + esc(o.name) + (o.kind === 'rotary' ? ' · manual load, takes cake moulds' : ' · no cake moulds') + '</p>' +
        fields([['res.ovens.' + i + '.n', 'Ovens'], ['res.ovens.' + i + '.cap', 'Trays per batch'], ['res.ovens.' + i + '.loadMin', 'Load + unload (min)']]);
    }).join('') + fields([['res.ovenCrew', 'Oven people per shift']]) + '</fieldset>';
    h += '<fieldset><legend>Confectionery, freezing, cutting</legend>' + fields([['res.conf1Crew', 'Conf. 1 people (halving)'], ['res.conf2Crew', 'Conf. 2 people (assembly)'],
      ['res.cutterTraysH', 'Brownie cutter (trays per hour)', '5 × 15 net hours = 75 trays/day.'], ['res.cutterCrew', 'Cutter people'], ['res.freezerTrays', 'Flash freezer positions (trays)'],
      ['res.knifeMin', 'Frozen cut, standard knives (min/tray)'], ['res.usMin', 'Frozen cut, ultrasonic (min/tray)'], ['res.cutCrew', 'Cutting people']]) + '</fieldset>';
    h += '<fieldset><legend>Packaging and warehouse</legend>' + fields([['res.p1ClamsMin', 'Pack. 1 clams per minute'], ['res.p1Crew', 'Pack. 1 people'], ['res.p2BoxesMin', 'Pack. 2 boxes per minute'], ['res.p2Crew', 'Pack. 2 people'],
      ['res.p3IwpPcsMin', 'Pack. 3 IWP pieces per minute'], ['res.p3ClamsMin', 'Pack. 3 clams per minute'], ['res.p3ChangeMin', 'Pack. 3 IWP ↔ clam changeover (min)'], ['res.p3Crew', 'Pack. 3 people'],
      ['res.whPositions', 'Warehouse pallet positions'], ['res.whUsedPct', 'Warehouse already used (%)']]) + '</fieldset>';
    h += '<fieldset><legend>Costs (illustrative, for COPQ)</legend>' + fields([['res.trayValue', 'Value of a tray of product ($)'], ['res.knifeCost', 'Standard knife ($)'], ['res.traysPerKnife', 'Trays per knife'],
      ['res.knifeLossPct', 'Cutting loss with knives (%)'], ['res.usLossPct', 'Cutting loss ultrasonic (%)'], ['res.labourRate', 'Labour ($/h)'], ['res.usRepair', 'Ultrasonic repair ($)'], ['res.stickyTraysWeek', 'Frozen-cut trays per week']]) + '</fieldset>';
    $('resources').innerHTML = h;
  }

  function renderSkus() {
    $('skus').innerHTML = S.skus.map(function (k, i) {
      var p = 'skus.' + i + '.';
      return '<details class="sku-card"><summary>' + esc(k.name) + '</summary>' + fields([
        [p + 'name', 'Name', '', 't'],
        [p + 'line', 'Filling line', '', 's', [['A', 'A · cakes'], ['B', 'B · brownies'], ['C', 'C · slow-bake / slow-fill'], ['D', 'D · low volume']]],
        [p + 'tray', 'Tray content', '', 's', [['slab', 'Batter slab (cut later)'], ['mould', 'Mini-dessert mould (9/12/18/24)'], ['cakemould', 'Cake mould (2/3), rotary only']]],
        [p + 'perTray', 'Items per tray', 'Slab = 1, mould = cavities.'], [p + 'piecesPerItem', 'Pieces per item', 'Cutter setting 12/24/48/96, wedges per cake, or 1.'],
        [p + 'ozPerItem', 'Batter per item (oz)'], [p + 'batter', 'Batter type', 'Same type = shared drums.', 't'], [p + 'bakeMin', 'Bake time (min)'],
        [p + 'tall', 'Tall: type 3 trolley', '', 'b'], [p + 'halve', 'Halve for layers (Conf. 1)', '', 'b'], [p + 'halveSec', 'Seconds per cake to halve'],
        [p + 'conf2Min', 'Conf. 2 minutes per tray'],
        [p + 'cut', 'Cutting', '', 's', [['cutter', 'Brownie cutter, before freezing'], ['frozen', 'Frozen, knives (sticky / wedges)'], ['none', 'No cutting']]],
        [p + 'freeze', 'Flash freeze', 'About 90 % of products; some brownies are exempt.', 'b'],
        [p + 'pack', 'Packaging', '', 's', [['P1', 'Pack. 1 clams/shells → Pack. 2 boxes'], ['P3iwp', 'Pack. 3 IWP'], ['P3clam', 'Pack. 3 clams']]],
        [p + 'piecesPerPack', 'Pieces per clam / wrap'], [p + 'packsPerBox', 'Clams or wraps per box'], [p + 'boxesPerPallet', 'Boxes per pallet']
      ]) + '</details>';
    }).join('');
  }

  function pill(level) { return '<span class="pill ' + (level === 'bad' ? 'bad' : level === 'warn' ? 'warn' : 'na') + '">' + (level === 'bad' ? 'waste' : level === 'warn' ? 'check' : 'note') + '</span>'; }
  function loadBar(x) { var w = Math.min(100, x * 100); return '<span class="load" aria-hidden="true"><i class="' + (x > 1 ? 'over' : x > 0.85 ? 'high' : '') + '" style="width:' + w.toFixed(0) + '%"></i></span>' + fmt(x * 100, 0) + ' %'; }
  function dateTxt(s) { var d = new Date(s + 'T12:00:00Z'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }); }

  function calc() {
    var o = C.compute(S);
    if (o.error) { $('cap-err').textContent = o.error; $('cap-out').setAttribute('aria-busy', 'true'); return; }
    $('cap-err').textContent = ''; $('cap-out').removeAttribute('aria-busy');
    var bn = o.bottleneck;
    $('s-bn').textContent = bn.name;
    $('s-bn-sub').textContent = fmt(bn.days, 1) + ' working days of work · ' + fmt(bn.load * 100, 0) + ' % of the ' + S.windowDays + '-day window';
    $('s-ship').textContent = dateTxt(o.ship);
    $('s-ship-sub').innerHTML = o.ctpDays + ' working days · promise ' + S.promiseDays + ' days = ' + dateTxt(o.promise) + ' ' +
      (o.slack === 0 ? '<span class="pill warn">on the promise day</span>' : o.slack > 0 ? '<span class="pill ok">' + o.slack + ' day' + (o.slack === 1 ? '' : 's') + ' early</span>' : '<span class="pill bad">' + (-o.slack) + ' day' + (o.slack === -1 ? '' : 's') + ' late</span>');
    $('s-trol').textContent = o.trolleysRot + ' of ' + o.pool;
    $('s-trol-sub').textContent = S.wipCap ? 'trolleys in rotation, capped at what the flows need' : o.blocked + ' trolleys waiting loaded in front of slow steps';
    $('s-takt').textContent = fmt(o.takt, 0) + ' s';
    $('s-takt-sub').textContent = 'takt per tray · bottleneck cycle ' + fmt(o.bnCycle, 0) + ' s per tray of the order';

    $('areas').innerHTML = o.areas.map(function (a) {
      return '<tr' + (a.bottleneck ? ' class="bn"' : '') + '><th scope="row">' + esc(a.name) + (a.bottleneck ? ' <span class="pill bad">bottleneck</span>' : '') + '</th>' +
        '<td>' + esc(a.unit) + '</td><td class="n">' + (a.hours ? fmt(a.hours, 1) : '–') + '</td><td class="n">' + (a.days ? fmt(a.days, 2) : '–') + '</td>' +
        '<td class="n">' + (a.crew || '–') + '</td><td>' + esc(a.rot || a.extra || '') + (a.rot && a.extra ? ' · ' + esc(a.extra) : '') + '</td>' +
        '<td class="nowrap">' + (a.id === 'wh' ? loadBar(o.pallets / Math.max(1, o.whFree)) : a.id === 'cool' ? '' : a.id === 'freeze' ? loadBar(a.peak || 0) + ' peak' : loadBar(a.load)) + '</td></tr>';
    }).join('');
    var people = o.areas.reduce(function (s, a) { return s + (a.crew || 0); }, 0);
    $('people').textContent = people + ' people per shift across the areas with work in this order (' + S.shifts + ' shift' + (S.shifts > 1 ? 's' : '') + ', ' + fmt(o.dayH, 1) + ' net hours a day).';

    $('flags').innerHTML = o.flags.length ? o.flags.slice().sort(function (a, b) { var r = { bad: 0, warn: 1, info: 2 }; return r[a.level] - r[b.level]; })
      .map(function (f) { return '<li>' + pill(f.level) + ' ' + esc(f.text) + '</li>'; }).join('') : '<li>No waste flags for this order.</li>';

    $('explode').innerHTML = o.rows.map(function (r) {
      return '<tr><th scope="row">' + esc(r.k.name) + '</th><td class="n">' + fmt(r.boxes, 0) + '</td><td class="n">' + r.pallets + '</td><td class="n">' + fmt(r.pieces, 0) + '</td><td class="n">' + fmt(r.items, 0) +
        '</td><td class="n">' + r.traysNet + ' → ' + r.trays + '</td><td class="n">' + fmt(r.lb, 0) + '</td><td class="n">' + r.batches + (r.partial ? ' (' + r.partial + ' part)' : '') +
        '</td><td class="n">' + (r.loads13 + r.loads2) + '</td></tr>';
    }).join('');
    $('drums').textContent = Object.keys(o.batters).map(function (n) { var b = o.batters[n]; return n + ': ' + fmt(b.lb, 0) + ' lb → ' + b.drums.big + ' × ' + S.res.drumBig + ' + ' + b.drums.small + ' × ' + S.res.drumSmall + ' lb'; }).join(' · ') +
      '. Drums in rotation: ' + o.drumsRot + ' (' + S.mode + '); batter waits up to ' + fmt(o.batterAgeMin / 60, 1) + ' h.';

    var cutterWord = o.cutterTrays ? 'The brownie cutter cuts at most ' + fmt(S.res.cutterTraysH * o.dayH, 0) + ' trays a day. ' : '';
    $('wip').innerHTML = '<p>' + cutterWord + 'With the WIP cap the flows need <strong>' + Math.min(o.capRot, o.totalLoads) + ' trolleys</strong> in rotation (Little\'s law: rate of the slowest step × loop time). ' +
      'Without it the lines push <strong>' + o.pushRot + '</strong> of ' + o.pool + ' trolleys onto the floor for this order, and ' + Math.max(0, o.pushRot - Math.min(o.capRot, o.totalLoads)) +
      ' of them just wait loaded in the cooling lane, blocked for the other areas. Trays in rotation now: ' + fmt(o.traysRot, 0) + ' of ' + fmt(S.res.trays, 0) + '.</p>' +
      '<p class="note">Longest wait in the cooling lane: ' + fmt(o.maxWaitCal, 1) + ' h (FIFO window ' + S.coolMinMin + ' min to ' + S.coolMaxH + ' h). ' +
      (o.expiredTrays ? '<strong>' + o.expiredTrays + ' trays expire.</strong>' : 'Nothing expires.') + '</p>';

    var c = o.copq;
    $('knife').innerHTML = '<p>' + fmt(c.orderTrays, 0) + ' trays in this order are cut frozen. With standard knives each tray costs about <strong>$' + fmt(c.knifePerTray, 2) + '</strong> (knife wear, crumbs, extra cutting time); ' +
      'with the ultrasonic knife about <strong>$' + fmt(c.usPerTray, 2) + '</strong>. ' +
      (c.saving > 0 ? 'At ' + fmt(S.res.stickyTraysWeek, 0) + ' frozen-cut trays a week, a $' + fmt(S.res.usRepair, 0) + ' repair pays back in <strong>' + fmt(c.paybackWeeks, 1) + ' weeks</strong>.' : 'With these inputs the repair does not pay back.') +
      ' This order: $' + fmt(c.orderCost, 0) + ' of cutting cost (' + (S.ultrasonic ? 'repaired' : 'still broken') + ').</p>';
  }

  function rebuild() { renderPolicy(); renderOrder(); renderResources(); renderSkus(); calc(); }

  function onInput(e) {
    var el = e.target, k = el.getAttribute('data-k'); if (!k) return;
    var t = el.getAttribute('data-t'), v;
    if (t === 'b') v = el.checked;
    else if (t === 'n' || t === 'i') { v = t === 'i' ? parseInt(el.value, 10) : parseFloat(el.value); if (!isFinite(v)) { el.setAttribute('aria-invalid', 'true'); $('cap-err').textContent = 'Use numbers only.'; return; } }
    else v = el.value;
    el.removeAttribute('aria-invalid');
    setP(S, k, v);
    if (/^skus\.\d+\.name$/.test(k) && e.type === 'change') { renderOrder(); var sm = el.closest('details'); if (sm) sm.querySelector('summary').textContent = v; }
    calc();
  }

  document.addEventListener('DOMContentLoaded', function () {
    S = C.clone(C.DEF); S.start = today();
    var form = $('capacity');
    form.addEventListener('input', onInput);
    form.addEventListener('change', onInput);
    form.addEventListener('submit', function (e) { e.preventDefault(); calc(); });
    form.addEventListener('click', function (e) {
      var rm = e.target.getAttribute && e.target.getAttribute('data-rm');
      if (rm !== null && rm !== undefined) { S.order.splice(+rm, 1); renderOrder(); calc(); }
    });
    $('add-line').addEventListener('click', function () { S.order.push({ sku: 0, qty: 10, unit: 'boxes' }); renderOrder(); calc(); var q = document.querySelectorAll('.order-row input'); if (q.length) q[q.length - 1].focus(); });
    $('reset').addEventListener('click', function () { S = C.clone(C.DEF); S.start = today(); rebuild(); });
    rebuild();
  });
})();
