/* KPI board: five tiles, each with a value, a target and a 7/30-day (or weekly) trend. */
(function () {
  'use strict';
  var KL = window.KL, n = KL.num, esc = KL.esc;

  /* Language: EN default; ?lang=es or the remembered choice (localStorage, try/catch) switches KPI labels, chips and verdicts to ES.
     The measurement detail lines stay in English. Same pattern as zenilify-consulting.com/erick/. */
  var ES = {
    'Uptime & backups': 'Disponibilidad y respaldos', 'AI renders': 'Renders de IA', 'PDCA cycles': 'Ciclos PDCA',
    'Ideas → implemented': 'Ideas → implementadas', '3D-printed fixes': 'Soluciones impresas en 3D', 'Make vs buy (3D)': 'Fabricar vs comprar (3D)',
    'RFT — Right First Time': 'RFT — Bien a la primera', 'COPQ — Cost of Poor Quality': 'COPQ — Costo de mala calidad',
    'Plan': 'Planear', 'Do': 'Hacer', 'Check': 'Verificar', 'Act': 'Actuar', 'Plan → Do': 'Planear → Hacer',
    'on target': 'en la meta', 'close': 'cerca', 'below target': 'bajo la meta', 'no data': 'sin datos', 'baseline': 'línea base', 'pricing pending': 'precio pendiente',
    'target': 'meta', 'Read the story': 'Leer la historia'
  };
  var lang = 'en';
  function T9(k) { return lang === 'es' && ES[k] ? ES[k] : k; }
  KL.initLang = function () {
    var q = (location.search.match(/[?&]lang=(en|es)/) || [])[1], s = null;
    try { s = localStorage.getItem('kl-lang'); } catch (e) {}
    lang = q || (s === 'es' || s === 'en' ? s : 'en');
    return lang;
  };
  KL.setLang = function (l) {
    lang = l === 'es' ? 'es' : 'en';
    try { localStorage.setItem('kl-lang', lang); } catch (e) {}
    document.documentElement.lang = lang === 'es' ? 'es-MX' : 'en';
    Array.prototype.forEach.call(document.querySelectorAll('[data-lang]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-es]'), function (el) {
      if (!el.hasAttribute('data-en')) el.setAttribute('data-en', el.textContent);
      el.textContent = lang === 'es' ? el.getAttribute('data-es') : el.getAttribute('data-en');
    });
    if (KL._rerender) KL._rerender();
  };

  function spark(points, opts) {
    // points: [{label, v}] ; opts: {kind:'bar'|'line', target, min, max, unit}
    var W = 300, H = 48, pad = 2;
    var vals = points.map(function (p) { return p.v; }).filter(function (v) { return typeof v === 'number'; });
    var title = opts.title || '';
    if (!vals.length) {
      return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(title) + ': no trend data yet"><text class="empty" x="0" y="30">trend builds as days are recorded</text></svg>';
    }
    var max = opts.max !== undefined ? opts.max : Math.max.apply(null, vals.concat(opts.target || 0)) || 1;
    var min = opts.min !== undefined ? opts.min : 0;
    function y(v) { return H - pad - ((v - min) / ((max - min) || 1)) * (H - pad * 2); }
    var out = '', nP = points.length, bw = Math.min(W / nP, 44);
    if (opts.kind === 'bar') {
      points.forEach(function (p, i) {
        if (typeof p.v !== 'number') return;
        var top = Math.min(y(p.v), H - pad - 1.5);
        out += '<rect class="bar" x="' + (i * bw + bw * 0.15).toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + (H - pad - top).toFixed(1) + '" rx="2"><title>' + esc(p.label + ': ' + n(p.v, opts.digits || 0) + (opts.unit || '')) + '</title></rect>';
      });
    } else {
      var d = '';
      points.forEach(function (p, i) {
        if (typeof p.v !== 'number') return;
        var x = nP === 1 ? W / 2 : (i / (nP - 1)) * (W - 8) + 4;
        d += (d ? ' L' : 'M') + x.toFixed(1) + ' ' + y(Math.max(min, p.v)).toFixed(1);
        out += '<circle cx="' + x.toFixed(1) + '" cy="' + y(Math.max(min, p.v)).toFixed(1) + '" r="2.5" fill="var(--accent)"><title>' + esc(p.label + ': ' + n(p.v, opts.digits || 0) + (opts.unit || '')) + '</title></circle>';
      });
      out = '<path class="line" d="' + d + '"/>' + out;
    }
    if (typeof opts.target === 'number' && opts.target >= min && opts.target <= max) {
      out = '<line class="tgt" x1="0" x2="' + W + '" y1="' + y(opts.target).toFixed(1) + '" y2="' + y(opts.target).toFixed(1) + '"/>' + out;
    }
    var summary = points.filter(function (p) { return typeof p.v === 'number'; }).map(function (p) { return p.label + ' ' + n(p.v, opts.digits || 0); }).join(', ');
    return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc(title + ' trend: ' + summary) + '">' + out + '</svg>';
  }

  function strip(days) {
    // one cell per day: green = every nightly backup job reported OK, red = at least one missed or failed
    if (!days.length) return '';
    var W = 300, cw = W / 30, cells = '';
    days.forEach(function (d, i) {
      var x = (30 - days.length + i) * cw;
      cells += '<rect x="' + (x + 1).toFixed(1) + '" y="2" width="' + (cw - 2).toFixed(1) + '" height="10" rx="2" fill="' + (d.ok ? 'var(--ok)' : 'var(--bad)') + '"><title>' + esc(d.d + (d.ok ? ': all backups OK' : ': a backup job missed or failed')) + '</title></rect>';
    });
    var bad = days.filter(function (d) { return !d.ok; }).length;
    return '<svg class="spark" style="height:14px" viewBox="0 0 ' + W + ' 14" preserveAspectRatio="none" role="img" aria-label="Backups, last ' + days.length + ' days: ' + (days.length - bad) + ' green, ' + bad + ' with a missed or failed job"></svg>'.replace('</svg>', cells + '</svg>') + '<span class="note" style="font-size:12px">backups, last ' + days.length + ' days</span>';
  }
  function pill(state, text) { return '<span class="pill ' + state + '">' + esc(T9(text)) + '</span>'; }
  function judge(v, target, higherIsBetter, nearAbs) {
    if (typeof v !== 'number' || typeof target !== 'number') return pill('na', 'no data');
    var ok = higherIsBetter ? v >= target : v <= target;
    var near = nearAbs !== undefined ? Math.abs(v - target) <= nearAbs : higherIsBetter ? v >= target * 0.9 : v <= target * 1.25;
    return ok ? pill('ok', 'on target') : near ? pill('warn', 'close') : pill('bad', 'below target');
  }
  var STORIES = {};
  function storyLink(id) {
    var s = STORIES[id];
    return s && /^https:\/\//.test(s.url || '') ? '<a class="story-link" href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(T9('Read the story')) + ' <span aria-hidden="true">↗</span></a>' : '';
  }
  function tile(o) {
    return '<article class="card tile" aria-labelledby="t-' + o.id + '">' +
      '<span class="label" id="t-' + o.id + '">' + esc(T9(o.label)) + ' <span class="pdca-chip">' + esc(T9(o.pdca)) + '</span></span>' +
      '<div class="value">' + o.value + (o.unit ? '<span class="unit">' + esc(o.unit) + '</span>' : '') + '</div>' +
      '<div class="sub">' + o.sub + '</div>' +
      '<div class="target">' + o.judge + ' <span class="note">' + T9('target') + ' ' + esc(o.target) + '</span></div>' +
      o.spark + (o.extra || '') + (o.stale ? '<div class="note">' + esc(o.stale) + '</div>' : '') + storyLink(o.id) + '</article>';
  }
  function lastN(arr, k) { arr = Array.isArray(arr) ? arr : []; return arr.slice(Math.max(0, arr.length - k)); }
  function staleNote(x) { return x && x.status && x.status !== 'ok' ? (x.status === 'stale' ? 'Source unreachable on the last run; showing the last measured value.' : 'Source unavailable; value unknown.') : ''; }

  KL.renderKPIs = function (box, metrics, stat) {
    STORIES = (stat && stat.stories) || {};
    KL._rerender = function () { KL.renderKPIs(box, metrics, stat); };
    var k = (metrics && metrics.kpis) || {}, T = stat.targets || {};
    var up = k.uptime || {}, bk = k.backups || {}, r = k.renders || {}, p = k.pdca || {}, id = k.ideas || {};
    var html = '';
    // 1 uptime + backups
    html += tile({ id: 'up', label: 'Uptime & backups', pdca: 'Check', value: n(up.value_pct, 2), unit: '%',
      sub: 'core services, 30 days · backup streak <strong>' + n(bk.streak_days) + '</strong> days (' + n(bk.jobs) + ' nightly jobs)',
      judge: judge(up.value_pct, T.uptime_pct, true, 1), target: '≥ ' + n(T.uptime_pct, 1) + '% · streak ≥ ' + n(T.backup_streak_days) + ' d',
      spark: spark(lastN(up.trend, 30).map(function (t) { return { label: t.d, v: t.pct }; }), { kind: 'line', target: T.uptime_pct, min: 80, max: 100, digits: 2, unit: '%', title: 'Daily uptime' }),
      extra: strip(lastN(bk.trend, 30)),
      stale: staleNote(up) || staleNote(bk) });
    // 2 renders
    html += tile({ id: 'ai', label: 'AI renders', pdca: 'Do', value: n(r.total_7d), unit: 'in 7 days',
      sub: 'median <strong>' + n(r.median_s_per_image, 1) + ' s</strong> per image · ' + n(r.avg_per_day, 1) + ' per day on average',
      judge: judge(r.median_s_per_image, T.render_median_s, false), target: '≤ ' + n(T.render_median_s) + ' s per image',
      spark: spark(lastN(r.per_day, 7).map(function (t) { return { label: t.d, v: t.n }; }), { kind: 'bar', title: 'Renders per day' }),
      stale: staleNote(r) });
    // 3 PDCA
    var closedPct = (typeof p.closed === 'number' && typeof p.total === 'number' && p.total) ? (p.closed / (p.closed + (p.open || 0))) * 100 : null;
    html += tile({ id: 'pdca', label: 'PDCA cycles', pdca: 'Act', value: n(p.total), unit: 'recorded',
      sub: (typeof p.closed === 'number' ? '<strong>' + n(p.closed) + '</strong> closed with a countermeasure · ' + n(p.open) + ' open or unverified' : 'closure status not published yet'),
      judge: judge(closedPct, T.pdca_closed_pct, true), target: '≥ ' + n(T.pdca_closed_pct) + '% closed',
      spark: spark(lastN(p.per_week, 8).map(function (t) { return { label: t.w, v: t.n }; }), { kind: 'bar', title: 'New cycles per week' }),
      stale: staleNote(p) });
    // 4 ideas: the funnel since July (ledger aggregate) — rendered as a wide tile after the other four
    var ideasHtml = ideaTile(id, stat, T);
    // 5 3D prints (static ledger in the repo)
    var ent = (stat.prints && stat.prints.entries) || [];
    var priced = ent.filter(function (e) { return typeof e.saving_mxn === 'number'; });
    var saved = priced.reduce(function (s, e) { return s + e.saving_mxn; }, 0);
    var months = {}; ent.forEach(function (e) { var m = String(e.date || '').slice(0, 7); if (m) months[m] = (months[m] || 0) + 1; });
    var mk = Object.keys(months).sort();
    html += tile({ id: 'print', label: '3D-printed fixes', pdca: 'Do', value: n(ent.length), unit: ent.length === 1 ? 'solution' : 'solutions',
      sub: priced.length ? 'MXN <strong>' + n(saved) + '</strong> saved (' + priced.length + ' of ' + ent.length + ' priced)' : 'savings in MXN being priced',
      judge: priced.length ? judge(saved, T.print_saving_mxn_year, true) : pill('na', 'pricing pending'), target: 'MXN ' + n(T.print_saving_mxn_year) + ' saved per year',
      spark: spark(mk.map(function (m) { return { label: m, v: months[m] }; }), { kind: 'bar', title: 'Solutions per month' }) });
    // 6 make vs buy (3D) + 7 RFT + 8 COPQ — K1C history + the make-vs-buy ledger (lanes L100/L100b)
    html += makeBuyTile(k.make_vs_buy || {}, T) + rftTile(k.rft || {}, T) + copqTile(k.copq || {}, T);
    box.innerHTML = html + ideasHtml;
  };

  function proposed(flag) { return flag ? ' (proposed)' : ''; }
  // lead times: 0.5 h steps below 48 h, days above (KL.lead is shared with /flow)
  KL.lead = function (h) { return typeof h !== 'number' ? '–' : h < 48 ? n(h, h % 1 ? 1 : 0) + ' h' : n(h / 24, 1) + ' d'; };
  function makeBuyTile(m, T) {
    var items = Array.isArray(m.items) ? m.items : [];
    var mxn = typeof m.mxn_saved_total === 'number'
      ? 'MXN <strong>' + n(m.mxn_saved_total) + '</strong> saved (' + n(m.priced) + ' of ' + n(m.parts) + ' priced)'
      : 'MXN saved: <strong>pending</strong> (' + n(m.pending) + ' of ' + n(m.parts) + ' parts not priced yet)';
    var list = items.length ? '<ul class="recent">' + items.map(function (it) {
      return '<li>' + esc(it.t) + ' — <strong>' + KL.lead(it.make_h) + '</strong> (design ' + KL.lead(it.design_h) + ' · print ' + KL.lead(it.print_h) + ')' +
        ' vs ' + n(it.buy_d) + ' d' + (typeof it.saved_mxn === 'number' ? ' · MXN ' + n(it.saved_mxn) : '') +
        (it.attempts > 1 ? ' · ' + n(it.attempts) + ' attempts' : '') + '</li>';
    }).join('') + '</ul>' : '';
    var mh = m.median_make_h, value = typeof mh === 'number' && mh >= 48 ? n(mh / 24, 1) : n(mh, mh % 1 ? 1 : 0);
    return tile({ id: 'mvb', label: 'Make vs buy (3D)', pdca: 'Do', value: value,
      unit: (typeof mh === 'number' && mh >= 48 ? 'days' : 'hours') + ' order → part in hand (median)',
      sub: 'vs <strong>' + n(m.median_days_buy) + ' days</strong> to buy from China + ' + n(m.import_tax_pct, 1) + ' % import tax · waiting is in design: median <strong>' +
        KL.lead(m.median_design_h) + '</strong> design/render, ' + KL.lead(m.median_print_h) + ' print + rework · <strong>' + n(m.days_saved_total, 1) + '</strong> days saved over ' +
        n(m.lead_known) + ' parts · ' + mxn,
      judge: judge(typeof mh === 'number' ? mh / 24 : null, T.make_lead_days, false, 1),
      target: 'make ≤ ' + n(T.make_lead_days) + ' d vs buy ' + n(T.buy_lead_days_reference) + ' d' + proposed(T.make_lead_proposal) +
        ' · MXN ' + n(T.print_saving_mxn_year) + '/year',
      spark: spark(items.map(function (it) { return { label: it.t + ' (h)', v: it.make_h }; }), { kind: 'bar', title: 'Hours from order to part in hand' }),
      extra: list + '<div class="note">Lead time = order (the part is asked for) → end of the final good print. Buying = order → delivery (~3 weeks) plus duty on parcels from non-treaty countries. <a href="/tools/make-or-buy/">Make-or-buy calculator →</a></div>',
      stale: staleNote(m) });
  }
  function rftTile(r, T) {
    var lab = typeof r.lab_rft_pct === 'number'
      ? '<div class="note">Whole lab: <strong>' + n(r.lab_rft_pct, 1) + ' %</strong> of ' + n(r.lab_implemented) + ' implemented ideas needed no documented redo (' + n(r.lab_rework_ideas) + ' did) <span class="pill na">first count · under review</span></div>' : '';
    var off = r.printer_reachable === false && r.history_as_of ? '<div class="note">Printer is off; print history as of ' + esc(r.history_as_of) + '.</div>' : '';
    return tile({ id: 'rft', label: 'RFT — Right First Time', pdca: 'Check', value: n(r.rft_pct, 0), unit: '% of printed parts',
      sub: '<strong>' + n(r.right_first_time) + '</strong> of ' + n(r.parts_attempted) + ' parts right on the first attempt · ' + n(r.parts_delivered) + ' delivered',
      judge: judge(r.rft_pct, T.rft_pct, true), target: 'RFT ≥ ' + n(T.rft_pct) + ' %' + proposed(T.rft_proposal),
      spark: '',
      extra: '<div class="note">' + n(r.attempts_per_part, 2) + ' attempts per delivered part · ' + n(r.rework_attempts) + ' reprints · ' + n(r.no_starts) +
        ' no-starts (aborted before the first layer, not counted) · ' + n(r.jobs_total) + ' print jobs since ' + esc(r.first_job || '–') + '</div>' + lab + off,
      stale: staleNote(r) });
  }
  var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function copqTile(c, T) {
    var parts = Array.isArray(c.by_part) ? c.by_part : [], months = Array.isArray(c.by_month) ? c.by_month : [];
    var pend = (c.assumptions_pending ? ' · <span class="pill na">assumptions pending</span>' : '') +
      (c.unpriced_g ? ' · ' + n(c.unpriced_g, 1) + ' g not priced yet' : '');
    var list = parts.length ? '<h3 class="mini">By part</h3><ul class="recent">' + parts.map(function (p) {
      return '<li>' + esc(p.t) + ' — ' + (typeof p.mxn === 'number' ? 'MXN ' + n(p.mxn, 2) : 'MXN pending') + ' · ' + n(p.g, 1) + ' g · ' + n(p.h, 1) + ' h · ' + n(p.jobs) + ' failed</li>';
    }).join('') + '</ul>' : '';
    return tile({ id: 'copq', label: 'COPQ — Cost of Poor Quality', pdca: 'Act', value: n(c.copq_mxn, 2), unit: 'MXN (internal failure)',
      sub: 'scrap <strong>' + n(c.scrap_g, 1) + ' g</strong> from ' + n(c.scrap_jobs) + ' failed prints · <strong>' + n(c.hours_lost, 1) + ' h</strong> of printer time lost' + pend,
      judge: pill('na', 'baseline'), target: 'trend to zero; no MXN target yet',
      spark: spark(months.map(function (m) { var i = parseInt(String(m.m).slice(5, 7), 10) - 1; return { label: (MON3[i] || m.m) + ' ' + String(m.m).slice(2, 4) + ' MXN', v: m.mxn }; }), { kind: 'bar', digits: 2, title: 'COPQ per month (MXN)' }),
      extra: list + '<div class="note">Filament of failed or cancelled prints × MXN/kg + their energy (hours × average W × MXN/kWh). Machine hours lost are shown as hours, not money.</div>',
      stale: staleNote(c) });
  }

  var CAT_LABEL = { 'voice': 'Voice', 'smart-home': 'Smart home', 'visualization': 'Visualization', 'diagrams': 'Diagrams',
    'icons': 'Icons', '3d-printing-design': '3D printing & design', 'storage-backup': 'Storage & backup', 'networking': 'Networking',
    'ai-genai': 'AI & generative', 'automation': 'Automation', 'ops-tooling': 'Ops tooling', 'web-brand': 'Web & brand', 'other': 'Other' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function monLabel(m) { var i = parseInt(String(m).slice(5, 7), 10) - 1; return (MON[i] || m) + ' ' + String(m).slice(2, 4); }

  function funnelRow(label, v, total, cls) {
    var pct = total ? Math.max(0, Math.min(100, (v / total) * 100)) : 0;
    return '<div class="bar-row"><span>' + esc(label) + '</span><span class="track"><span class="fill ' + (cls || '') + '" style="width:' + pct.toFixed(1) + '%"></span></span><span class="pct">' + n(v) + '</span></div>';
  }
  function catRows(byCat) {
    var cats = Object.keys(byCat || {}).filter(function (c) { return byCat[c] && byCat[c].raised; });
    cats.sort(function (a, b) { return byCat[b].raised - byCat[a].raised || a.localeCompare(b); });
    var max = cats.length ? byCat[cats[0]].raised : 1;
    return cats.map(function (c) {
      var r = byCat[c].raised, im = byCat[c].implemented;
      return '<div class="bar-row cat"><span>' + esc(CAT_LABEL[c] || c) + '</span><span class="track"><span class="raised" style="width:' + ((r / max) * 100).toFixed(1) + '%"><span class="fill" style="width:' + (r ? (im / r) * 100 : 0).toFixed(1) + '%"></span></span></span><span class="pct">' + n(im) + '/' + n(r) + '</span></div>';
    }).join('');
  }
  function monthBars(monthly) {
    if (!monthly.length) return '';
    var W = 300, H = 70, pad = 14, gw = W / monthly.length, max = 1;
    monthly.forEach(function (m) { max = Math.max(max, m.raised || 0, m.implemented || 0); });
    function h(v) { return ((v || 0) / max) * (H - pad - 4); }
    var out = '';
    monthly.forEach(function (m, i) {
      var x = i * gw, bw = Math.min(18, gw * 0.3);
      var r = h(m.raised), im = h(m.implemented);
      out += '<rect class="bar raised-bar" x="' + (x + gw / 2 - bw - 1).toFixed(1) + '" y="' + (H - pad - r).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + r.toFixed(1) + '" rx="2"><title>' + esc(monLabel(m.m) + ': ' + n(m.raised) + ' raised') + '</title></rect>';
      out += '<rect class="bar" x="' + (x + gw / 2 + 1).toFixed(1) + '" y="' + (H - pad - im).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + im.toFixed(1) + '" rx="2"><title>' + esc(monLabel(m.m) + ': ' + n(m.implemented) + ' implemented') + '</title></rect>';
      out += '<text class="axis" x="' + (x + gw / 2).toFixed(1) + '" y="' + (H - 2) + '" text-anchor="middle">' + esc(monLabel(m.m)) + '</text>';
    });
    var summary = monthly.map(function (m) { return monLabel(m.m) + ' ' + n(m.raised) + ' raised, ' + n(m.implemented) + ' implemented'; }).join('; ');
    return '<svg class="spark months" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc('Ideas per month: ' + summary) + '">' + out + '</svg>' +
      '<div class="legend note"><span class="key raised-key"></span>raised <span class="key impl-key"></span>implemented</div>';
  }

  function ideaTile(live, stat, T) {
    var f = KL.ideaFunnel(live, stat.ideas), d = f.d;
    var rate = d.implementation_rate_pct, total = d.total;
    var review = d.under_review !== false ? ' <span class="pill na">first count · under review</span>' : '';
    var titles = (d.public_titles_implemented || []).slice(0, 5);
    var caps = lastN(live && live.captures_per_week, 8).reduce(function (s, t) { return s + (t.n || 0); }, 0);
    var html = '<article class="card tile wide" aria-labelledby="t-idea">' +
      '<span class="label" id="t-idea">' + esc(T9('Ideas → implemented')) + ' <span class="pdca-chip">' + esc(T9('Plan → Do')) + '</span>' + review + '</span>' +
      '<div class="value">' + n(d.implemented) + '<span class="unit">of ' + n(total) + ' ideas implemented</span></div>' +
      '<div class="sub"><strong>' + n(rate, 1) + '%</strong> implementation rate since July 2026 · ' + n(d.in_progress) + ' in progress · ' + n(d.parked) + ' parked · ' + n(d.dropped) + ' dropped</div>' +
      '<div class="target">' + judge(rate, T.implementation_rate_pct, true) + ' <span class="note">' + T9('target') + ' ≥ ' + n(T.implementation_rate_pct) + '%' + (T.implementation_rate_proposal ? ' (proposed)' : '') + '</span></div>' +
      '<div class="idea-grid">' +
        '<section><h3 class="mini">Funnel</h3><div class="bars">' +
          funnelRow('Raised', total, total, 'muted') + funnelRow('In progress', d.in_progress, total) +
          funnelRow('Implemented', d.implemented, total, 'ok') + funnelRow('Parked', d.parked, total, 'muted') + funnelRow('Dropped', d.dropped, total, 'muted') +
        '</div><h3 class="mini">By month</h3>' + monthBars(d.monthly || []) + '</section>' +
        '<section><h3 class="mini">By category <span class="note">(implemented / raised)</span></h3><div class="bars">' + catRows(d.by_category) + '</div></section>' +
      '</div>' +
      (titles.length ? '<h3 class="mini">Recently implemented</h3><ul class="recent">' + titles.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="note">One ledger entry per distinct idea, each backed by a note or a commit; personal items are counted but never named.' +
      (live && live.captures_per_week ? ' Quick captures in the last 8 weeks: ' + n(caps) + '.' : '') + '</div>' +
      (f.src === 'bundled' ? '<div class="note">Showing the copy bundled with the site; the live feed has not carried the funnel yet.</div>' : '') +
      (f.src === 'live' && staleNote(live) ? '<div class="note">' + esc(staleNote(live)) + '</div>' : '') +
      storyLink('idea') + '</article>';
    return html;
  }
})();
