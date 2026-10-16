/* Takt time calculator — client-side only. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function val(id, optional) { var s = $(id).value.trim(); if (optional && s === '') return null; var v = parseFloat(s); return isFinite(v) ? v : NaN; }
  function out(id, t) { $(id).textContent = t; }
  function clear(msg) {
    out('takt-val', '–'); ['o-avail', 'o-pace', 'o-ops', 'o-bn'].forEach(function (i) { out(i, '–'); });
    out('takt-verdict', ''); out('takt-err', msg || '');
  }
  function calc() {
    var shifts = val('shifts'), hours = val('hours'), breaks = val('breaks'), demand = val('demand');
    var work = val('work', true), bn = val('bottleneck', true);
    if ([shifts, hours, breaks, demand].some(isNaN) || (work !== null && isNaN(work)) || (bn !== null && isNaN(bn))) return clear('Use numbers only.');
    if (shifts <= 0 || hours <= 0) return clear('Shifts and shift length must be more than 0.');
    if (breaks < 0 || breaks >= hours * 60) return clear('Breaks must be at least 0 and shorter than the shift.');
    if (demand <= 0) return clear('Demand must be more than 0.');
    var availS = shifts * (hours * 60 - breaks) * 60;
    var takt = availS / demand;
    out('takt-err', '');
    out('takt-val', takt >= 100 ? takt.toFixed(0) : takt.toFixed(1));
    out('o-avail', (availS / 60).toFixed(0) + ' min');
    out('o-pace', (3600 / takt).toFixed(1) + ' units/hour');
    out('o-ops', work ? Math.ceil(work / takt) + ' (' + (work / takt).toFixed(2) + ')' : '–');
    var verdict = '';
    if (bn) {
      var r = bn / takt;
      out('o-bn', (r * 100).toFixed(0) + '% of takt');
      verdict = r > 1 ? 'The slowest station is slower than takt: the line cannot meet demand without overtime. Attack that station first.'
        : r > 0.9 ? 'The slowest station is within 10% of takt: any stoppage there causes missed output. Build in stability before adding volume.'
        : 'The line has headroom against takt. Check that the extra capacity is not hiding as overproduction or waiting.';
    } else { out('o-bn', '–'); }
    out('takt-verdict', verdict);
  }
  document.addEventListener('DOMContentLoaded', function () {
    $('takt').addEventListener('input', calc);
    $('takt').addEventListener('submit', function (e) { e.preventDefault(); calc(); });
    calc();
  });
})();
