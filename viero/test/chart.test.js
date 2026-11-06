'use strict';
const { chart } = require('../chart.js');

const bench = (model, stt, start) => ({ model, clips: 'clips<x>', n: 20, intentOk: 19, stt, start });

module.exports = async function (ok) {
  const svg = chart([bench('tiny.en', { p50: 160, p95: 180 }, { p50: 500, p95: 900 }), bench('base.en', { p50: 400, p95: 600 }, { p50: 600, p95: 700 })]);
  ok('one group per bench, named by model, clips and accuracy', /tiny\.en · clips&lt;x&gt; · 19\/20 understood/.test(svg) && /base\.en · /.test(svg));
  ok('four median bars and four p95 bars', (svg.match(/class="p50"/g) || []).length === 4 && (svg.match(/class="p95"/g) || []).length === 4);
  const w = [...svg.matchAll(/class="p50"[^>]*width="([\d.]+)"/g)].map(m => +m[1]);
  ok('bars are to scale', Math.abs(w[1] / w[0] - 500 / 160) < 0.02, JSON.stringify(w));
  ok('a dashed 1 s target line', /class="target"/.test(svg) && /1 s target/.test(svg));
  ok('labels are escaped', !/clips<x>/.test(svg));
  ok('a complete svg element', svg.startsWith('<svg') && svg.endsWith('</svg>'));
};
