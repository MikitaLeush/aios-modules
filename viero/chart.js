'use strict';
/* bench.js results → the README latency chart (plain SVG, no dependencies).
 *   node modules/viero/chart.js <out.svg> <bench.json> [more bench.json…]
 * Each bench file is one group: speech-to-text and key-up → action, median bar over a p95 bar. */
const fs = require('fs');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const W = 720, LEFT = 170, RIGHT = 120, BAR = 16, TARGET = 1000;

function chart(benches) {
  const max = Math.max(TARGET, ...benches.map(b => Math.max(b.stt.p95, b.start.p95))) * 1.1;
  const x = ms => LEFT + (W - LEFT - RIGHT) * ms / max;
  const parts = [];
  let y = 44;
  for (const b of benches) {
    parts.push('<text x="0" y="' + y + '" class="title">' + esc(b.model + ' · ' + b.clips + ' · ' + b.intentOk + '/' + b.n + ' understood') + '</text>');
    y += 10;
    for (const [label, s] of [['speech-to-text', b.stt], ['key-up → action', b.start]]) {
      parts.push(
        '<text x="0" y="' + (y + 12) + '" class="label">' + esc(label) + '</text>',
        '<rect class="p95" x="' + LEFT + '" y="' + y + '" width="' + (x(s.p95) - LEFT).toFixed(1) + '" height="' + BAR + '"/>',
        '<rect class="p50" x="' + LEFT + '" y="' + y + '" width="' + (x(s.p50) - LEFT).toFixed(1) + '" height="' + BAR + '"/>',
        '<text x="' + (x(s.p95) + 6).toFixed(1) + '" y="' + (y + 12) + '" class="value">' + s.p50 + ' / ' + s.p95 + ' ms</text>');
      y += BAR + 8;
    }
    y += 24;
  }
  const h = y, tx = x(TARGET).toFixed(1);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + h + '" viewBox="0 0 ' + W + ' ' + h + '" font-family="system-ui, sans-serif" font-size="12">' +
    '<style>.title{fill:#8b949e;font-weight:600}.label,.value,.note{fill:#8b949e}.p50{fill:#4f8cff}.p95{fill:#4f8cff;opacity:.35}.target{stroke:#d29922;stroke-dasharray:4 4}</style>' +
    '<text x="0" y="16" class="note">Viero latency in ms, median / 95th percentile. Dashed line: 1 s target.</text>' +
    parts.join('') +
    '<line class="target" x1="' + tx + '" y1="26" x2="' + tx + '" y2="' + (h - 8) + '"/></svg>';
}

module.exports = { chart };

if (require.main === module) {
  const [out, ...inputs] = process.argv.slice(2);
  if (!out || !inputs.length) { console.error('usage: node modules/viero/chart.js <out.svg> <bench.json> [more…]'); process.exit(2); }
  fs.writeFileSync(out, chart(inputs.map(f => JSON.parse(fs.readFileSync(f, 'utf8')))));
  console.log('wrote ' + out);
}
