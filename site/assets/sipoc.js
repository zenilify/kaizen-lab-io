/* SIPOC of the lab, drawn as inline SVG (wide screens) plus a stacked list (phones).
   KL.sipoc(container, metrics|null). With metrics, live numbers ride on the arrows. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var COLS = [
    { k: 'Suppliers', c: 'var(--plan)', items: ['CFE (power grid)', 'Internet provider', 'Hardware vendors', 'Open source'] },
    { k: 'Inputs', c: 'var(--do)', items: ['kWh', 'Bandwidth', 'Photos & docs', 'Prompts', 'Ideas'] },
    { k: 'Process', c: 'var(--check)', items: ['2 Proxmox hosts', '1 GPU AI node', '~40 self-hosted apps', 'PDCA on failures'] },
    { k: 'Outputs', c: 'var(--act)', items: ['Backups', 'AI renders', 'Uptime', '3D-printed fixes'] },
    { k: 'Customers', c: 'var(--accent)', items: ['Family', 'Consulting clients', 'The builder'] }
  ];
  function ideaLabel(k, bundled) {
    var KL = window.KL, n = KL.num;
    var d = KL.ideaFunnel ? KL.ideaFunnel(k && k.ideas, bundled).d : {};
    if (typeof d.total !== 'number') return 'ideas: –';
    return n(d.total) + ' ideas since Jul · ' + n(d.implemented) + ' implemented (' + n(d.implementation_rate_pct, 0) + '%)';
  }
  // 3D printing on the Process -> Outputs arrow (lane L100): make lead time vs buying + import duty
  function printLabel(mv) {
    var n = window.KL.num;
    if (!mv || typeof mv.median_make_h !== 'number') return '';
    var h = mv.median_make_h, lead = h < 48 ? n(h, h % 1 ? 1 : 0) + ' h' : n(h / 24, 1) + ' d';
    return ' · print at home: ' + lead + ' · vs ' + n(mv.median_days_buy) + ' d + ' + n(mv.import_tax_pct, 1) + ' % tax';
  }
  function arrowLabels(m, bundledIdeas) {
    if (!m || !m.kpis) return ['', '', '', ''];
    var k = m.kpis, n = window.KL.num;
    var pdca = k.pdca && k.pdca.total;
    var up = k.uptime && k.uptime.value_pct, st = k.backups && k.backups.streak_days;
    var r7 = k.renders && k.renders.total_7d;
    return [
      ideaLabel(k, bundledIdeas),
      pdca == null ? 'PDCA: –' : n(pdca) + ' PDCA cycles',
      (up == null ? 'uptime: –' : n(up, 1) + '% uptime (30 d)') + printLabel(k.make_vs_buy),
      (r7 == null ? '– renders' : n(r7) + ' renders/7 d') + ' · ' + (st == null ? '–' : n(st)) + ' d backup streak'
    ];
  }
  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  window.KL = window.KL || {};
  window.KL.sipoc = function (box, metrics, bundledIdeas) {
    var labels = arrowLabels(metrics, bundledIdeas);
    var live = labels.some(function (l) { return l; });
    var W = 1000, colW = 168, gap = (W - colW * 5) / 4, H = live ? 392 : 310;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'sipoc', role: 'img',
      'aria-label': 'SIPOC map of the lab: suppliers, inputs, process, outputs and customers, left to right' });
    var defs = el('defs', {});
    var mk = el('marker', { id: 'ah', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
    mk.appendChild(el('path', { d: 'M0 0 L10 5 L0 10 z', class: 'arrowhead' }));
    defs.appendChild(mk); svg.appendChild(defs);
    COLS.forEach(function (col, i) {
      var x = i * (colW + gap), top = 70;
      svg.appendChild(el('text', { x: x + colW / 2, y: 52, 'text-anchor': 'middle', class: 'col-title', style: 'fill:' + col.c }, col.k));
      svg.appendChild(el('rect', { x: x, y: top, width: colW, height: 230, rx: 12, class: 'box' }));
      svg.appendChild(el('rect', { x: x, y: top, width: colW, height: 5, rx: 2, style: 'fill:' + col.c }));
      col.items.forEach(function (it, j) {
        svg.appendChild(el('text', { x: x + 14, y: top + 38 + j * 38, class: 'item' }, it));
      });
      if (i < 4) {
        var ax = x + colW + 4, bx = x + colW + gap - 4, ay = 185;
        svg.appendChild(el('line', { x1: ax, y1: ay, x2: bx, y2: ay, class: 'arrow', 'marker-end': 'url(#ah)' }));
      }
    });
    if (labels.some(function (l) { return l; })) {
      labels.forEach(function (l, i) {
        var cx = (i + 1) * (colW + gap) - gap / 2;
        var t = el('text', { x: cx, y: 22, 'text-anchor': 'middle', class: 'num' });
        l.split(' · ').forEach(function (part, j) {
          t.appendChild(el('tspan', { x: cx, dy: j ? '1.2em' : '0' }, part));
        });
        // the number for each arrow sits under the gap it belongs to, tied to it by a dotted tick
        t.setAttribute('y', 334);
        svg.appendChild(el('line', { x1: cx, y1: 192, x2: cx, y2: 318, class: 'arrow', 'stroke-dasharray': '2 4', style: 'stroke-width:1' }));
        svg.appendChild(t);
      });
    }
    // stacked list for phones
    var list = document.createElement('div'); list.className = 'sipoc-list';
    COLS.forEach(function (col, i) {
      var s = document.createElement('section'); s.style.setProperty('--c', col.c);
      s.innerHTML = '<h3>' + col.k + '</h3><ul>' + col.items.map(function (t) { return '<li>' + window.KL.esc(t) + '</li>'; }).join('') + '</ul>';
      list.appendChild(s);
      if (i < 4) {
        var d = document.createElement('div'); d.className = 'down';
        d.innerHTML = '↓' + (labels[i] ? ' <span class="num">' + window.KL.esc(labels[i]) + '</span>' : '');
        list.appendChild(d);
      }
    });
    box.innerHTML = ''; box.classList.add('stackable');
    box.appendChild(svg); box.appendChild(list);
  };
})();
