/* Make-or-buy calculator — client-side only. Same formula as the lab's Make vs Buy KPI (collector/printing.py):
   landed buy = (price + shipping) × (1 + duty/100); make = (g/1000 × MXN/kg + h × W/1000 × MXN/kWh) ÷ RFT; COPQ = make − one attempt. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function val(id) { var v = parseFloat($(id).value.trim()); return isFinite(v) ? v : NaN; }
  function out(id, t) { $(id).textContent = t; }
  function mxn(v) { return (v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 }); }
  var IDS = ['price', 'ship', 'tax', 'bdays', 'grams', 'kg', 'hours', 'watts', 'kwh', 'rft', 'mdays'];
  function clear(msg) { ['o-saved', 'o-landed', 'o-make', 'o-copq', 'o-days', 'o-break'].forEach(function (i) { out(i, '–'); }); out('mob-verdict', ''); out('mob-err', msg || ''); }
  function calc() {
    var v = {}; IDS.forEach(function (i) { v[i] = val(i); });
    if (IDS.some(function (i) { return isNaN(v[i]); })) return clear('Use numbers only.');
    if (IDS.some(function (i) { return v[i] < 0; })) return clear('Values cannot be negative.');
    if (v.rft <= 0 || v.rft > 100) return clear('Right First Time is between 1 and 100 %.');
    var tries = 100 / v.rft;
    var landed = (v.price + v.ship) * (1 + v.tax / 100);
    var perTry = v.grams / 1000 * v.kg + v.hours * v.watts / 1000 * v.kwh;
    var make = perTry * tries, saved = landed - make, days = v.bdays - v.mdays;
    out('mob-err', '');
    out('o-saved', mxn(saved));
    out('o-landed', 'MXN ' + mxn(landed));
    out('o-make', 'MXN ' + mxn(make) + ' (' + mxn(perTry) + ' per attempt)');
    out('o-copq', 'MXN ' + mxn(make - perTry) + ' (' + (tries - 1).toFixed(2) + ' extra attempts per good part)');
    out('o-days', (days >= 0 ? days : '−' + Math.abs(days)) + ' days');
    out('o-break', perTry > 0 ? (landed / perTry).toFixed(1) + ' attempts' : '–');
    out('mob-verdict', saved >= 0 && days >= 0
      ? 'Printing wins on both cost and time. Watch Right First Time: every failed attempt adds filament, hours and a day.'
      : saved >= 0 ? 'Printing is cheaper but slower: buy if the part is on the critical path.'
      : days >= 0 ? 'Buying is cheaper, printing is faster: print when waiting costs more than the difference.'
      : 'Buying wins on both cost and time.');
  }
  document.addEventListener('DOMContentLoaded', function () {
    $('mob').addEventListener('input', calc);
    $('mob').addEventListener('submit', function (e) { e.preventDefault(); calc(); });
    calc();
  });
})();
