/* OEE calculator — client-side only. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function val(id) { var v = parseFloat($(id).value); return isFinite(v) ? v : NaN; }
  function pct(x) { return isFinite(x) ? (x * 100).toFixed(1) + '%' : '–'; }
  function mins(x) { return isFinite(x) ? x.toFixed(0) + ' min' : '–'; }
  function setBar(k, x) { $('b-' + k).style.width = isFinite(x) ? Math.max(0, Math.min(100, x * 100)) + '%' : '0'; $('p-' + k).textContent = pct(x); }
  function clear(msg) {
    ['a', 'p', 'q'].forEach(function (k) { setBar(k, NaN); });
    ['l-a', 'l-p', 'l-q', 'l-f'].forEach(function (i) { $(i).textContent = '–'; });
    $('oee-val').textContent = '–'; $('oee-class').textContent = ''; $('oee-err').textContent = msg || '';
  }
  function calc() {
    var planned = val('planned'), down = val('down'), ideal = val('ideal'), total = val('total'), good = val('good');
    if ([planned, down, ideal, total, good].some(isNaN)) return clear('Fill in every field with a number.');
    if (planned <= 0) return clear('Planned production time must be more than 0.');
    if (down < 0 || down >= planned) return clear('Downtime must be at least 0 and less than the planned time.');
    if (ideal <= 0) return clear('Ideal cycle time must be more than 0.');
    if (total < 0 || good < 0) return clear('Unit counts cannot be negative.');
    if (good > total) return clear('Good units cannot exceed total units.');
    var run = planned - down;
    var A = run / planned;
    var P = (ideal * total / 60) / run;
    var Q = total ? good / total : 0;
    var note = '';
    if (P > 1) note = 'Performance above 100% usually means the ideal cycle time is set too slow. ';
    var oee = A * Math.min(P, 1) * Q;
    setBar('a', A); setBar('p', Math.min(P, 1)); setBar('q', Q);
    $('p-p').textContent = pct(P);
    var fpt = ideal * good / 60;
    $('l-a').textContent = mins(down);
    $('l-p').textContent = mins(Math.max(0, run - ideal * total / 60));
    $('l-q').textContent = mins(ideal * (total - good) / 60);
    $('l-f').textContent = mins(fpt);
    $('oee-val').textContent = pct(oee);
    var cls = oee >= 0.85 ? 'World-class territory.' : oee >= 0.6 ? 'Typical for discrete manufacturing; clear room to improve.' : 'Large hidden capacity: a focused PDCA cycle usually pays back fast.';
    var losses = [['availability', 1 - A], ['performance', 1 - Math.min(P, 1)], ['quality', 1 - Q]].sort(function (a, b) { return b[1] - a[1]; });
    $('oee-class').textContent = cls + ' Biggest loss: ' + losses[0][0] + '.';
    $('oee-err').textContent = note;
  }
  document.addEventListener('DOMContentLoaded', function () {
    $('oee').addEventListener('input', calc);
    $('oee').addEventListener('submit', function (e) { e.preventDefault(); calc(); });
    calc();
  });
})();
