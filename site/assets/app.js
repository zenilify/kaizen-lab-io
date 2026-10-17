/* kaizen-lab.io shared helpers: theme toggle, metrics loader, formatting. No tracking, no cookies. */
(function () {
  'use strict';
  var KL = window.KL = {};
  document.documentElement.classList.add('js');
  var THEMES = ['auto', 'light', 'dark'];

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    var b = document.querySelector('.theme-btn');
    if (b) { b.textContent = t === 'auto' ? 'Theme: auto' : 'Theme: ' + t; b.setAttribute('aria-label', 'Colour theme: ' + t + '. Click to change.'); }
  }
  var cur = store('kl-theme') || 'auto';
  applyTheme(cur);
  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(cur);
    var b = document.querySelector('.theme-btn');
    if (b) b.addEventListener('click', function () {
      cur = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
      store('kl-theme', cur); applyTheme(cur);
    });
  });

  /* Tools dropdown: button + aria-expanded, Esc / outside click / focus-out close, arrow keys move. */
  document.addEventListener('DOMContentLoaded', function () {
    var dd = document.querySelector('.nav-dd'); if (!dd) return;
    var btn = dd.querySelector('.nav-dd-btn'), links = dd.querySelectorAll('.nav-dd-menu a');
    function set(open, focusFirst) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && focusFirst && links[0]) links[0].focus();
    }
    btn.addEventListener('click', function () { set(btn.getAttribute('aria-expanded') !== 'true'); });
    btn.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown') { e.preventDefault(); set(true, true); } });
    dd.addEventListener('keydown', function (e) {
      var i = Array.prototype.indexOf.call(links, document.activeElement);
      if (e.key === 'Escape') { set(false); btn.focus(); }
      else if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); links[(i + 1) % links.length].focus(); }
      else if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); if (i === 0) btn.focus(); else links[i - 1].focus(); }
    });
    dd.addEventListener('focusout', function (e) { if (!dd.contains(e.relatedTarget)) set(false); });
    document.addEventListener('click', function (e) { if (!dd.contains(e.target)) set(false); });
  });

  function getJSON(url) {
    return fetch(url, { cache: 'no-store', headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  KL.getJSON = getJSON;

  /* Live feed first (Pages Function -> Workers KV), bundled nightly snapshot as fallback. */
  KL.loadMetrics = function () {
    return getJSON('/api/metrics').then(function (d) {
      if (!d || !d.kpis) throw new Error('empty');
      return { data: d, source: 'live' };
    }).catch(function () {
      return getJSON('/data/metrics.json').then(function (d) { return { data: d, source: 'snapshot' }; })
        .catch(function () { return { data: null, source: 'none' }; });
    });
  };
  KL.loadStatic = function () {
    return Promise.all([
      getJSON('/data/targets.json').catch(function () { return {}; }),
      getJSON('/data/3d-savings.json').catch(function () { return { entries: [] }; }),
      getJSON('/data/ideas.json').catch(function () { return {}; }),
      getJSON('/data/stories.json').catch(function () { return {}; })
    ]).then(function (a) { return { targets: a[0], prints: a[1], ideas: a[2], stories: (a[3] && a[3].tiles) || {} }; });
  };
  /* Idea funnel: the live feed when it carries the ledger aggregate, else the copy bundled at deploy time. */
  KL.ideaFunnel = function (live, bundled) {
    if (live && typeof live.total === 'number') return { d: live, src: 'live' };
    if (bundled && typeof bundled.total === 'number') return { d: bundled, src: 'bundled' };
    return { d: {}, src: 'none' };
  };

  KL.ageText = function (iso) {
    if (!iso) return 'unknown';
    var t = Date.parse(iso); if (isNaN(t)) return 'unknown';
    var m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 90) return m + ' min ago';
    var h = Math.round(m / 60); if (h < 48) return h + ' h ago';
    return Math.round(h / 24) + ' days ago';
  };
  KL.fmtTime = function (iso) {
    try {
      return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }) + ' (Mexico City)';
    } catch (e) { return iso; }
  };
  KL.statusLine = function (el, res) {
    if (!el) return;
    var d = res.data, live = res.source === 'live';
    var fresh = d && d.updated_at && (Date.now() - Date.parse(d.updated_at)) < 45 * 60000;
    var cls = live && fresh ? 'live' : 'stale';
    var src = res.source === 'live' ? 'live feed' : res.source === 'snapshot' ? 'bundled snapshot' : 'no data';
    el.innerHTML = '';
    var dot = document.createElement('span'); dot.className = 'dot ' + cls; dot.setAttribute('aria-hidden', 'true');
    el.appendChild(dot);
    el.appendChild(document.createTextNode(
      d && d.updated_at ? 'Updated ' + KL.ageText(d.updated_at) + ' · ' + KL.fmtTime(d.updated_at) + ' · ' + src : 'No measurements available yet · ' + src));
  };
  KL.num = function (v, digits) {
    if (v === null || v === undefined || v === 'unknown' || (typeof v === 'number' && isNaN(v))) return '–';
    return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits === undefined ? 0 : digits, minimumFractionDigits: digits || 0 });
  };
  KL.esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
})();
