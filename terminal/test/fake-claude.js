'use strict';
/* Stand-in for the Claude CLI in chat tests. Mode comes from FAKE_CLAUDE_MODE:
 * ok | dead | fail | slow | iserr | split. Reads stdin to the end like `claude -p`, then prints stream-json. */
const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const init = () => out({ type: 'system', subtype: 'init', session_id: 's1' });
const answer = () => {
  init();
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Four. Two plus two is four.' }] } });
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'projects/x.md' } }] } });
  out({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } });
  out({ type: 'result', session_id: 's1', duration_ms: 12, total_cost_usd: 0.01, is_error: false });
};

let input = '';
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  if (mode === 'fail') { process.stderr.write('boom'); process.exit(2); }
  if (mode === 'dead' && process.argv.includes('--resume')) {
    process.stdout.write('No conversation found with session ID: s0\n');
    process.exit(1);
  }
  if (mode === 'slow') { init(); setTimeout(() => {}, 5000); return; }
  if (mode === 'iserr') {
    init();
    out({ type: 'result', session_id: 's1', duration_ms: 3, total_cost_usd: 0, is_error: true, result: 'bad thing' });
    return;
  }
  if (mode === 'split') {
    // one text event with multi-byte characters, written in two chunks cut mid-character
    init();
    const line = Buffer.from(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a — привет' }] } }) + String.fromCharCode(10));
    const cut = line.indexOf(Buffer.from('—')) + 1;
    process.stdout.write(line.subarray(0, cut));
    setTimeout(() => {
      process.stdout.write(line.subarray(cut));
      out({ type: 'result', session_id: 's1', duration_ms: 3, total_cost_usd: 0, is_error: false });
    }, 150);
    return;
  }
  answer();
});
